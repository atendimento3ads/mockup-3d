import type { Plugin } from 'vite';
import { randomUUID } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { extname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Ponte entre o servidor MCP (processo à parte) e a aba aberta do editor.
// O MCP faz POST em /__mcp/command; a ponte repassa para a página pelo WebSocket do Vite e devolve
// a resposta. Imagens e vídeos voltam da página por POST em /__mcp/blob.
//
// Segurança: só funciona no servidor de desenvolvimento (127.0.0.1), exige o cabeçalho X-Mockup-MCP
// e recusa /command vindo de qualquer página web (navegadores sempre mandam Origin).

type Client = { send(event: string, payload?: unknown): void };
interface Result {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  blob?: { base64: string; type: string };
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, code: number, body: unknown) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function mcpBridge(): Plugin {
  return {
    name: 'mockup-mcp-bridge',
    apply: 'serve',
    configureServer(server) {
      let active: Client | null = null;
      const pending = new Map<string, { resolve: (r: Result) => void; timer: ReturnType<typeof setTimeout> }>();
      const blobs = new Map<string, { data: Buffer; type: string }>();
      // Arquivos locais liberados pelo MCP (ex.: o vídeo da tela), acessíveis só por token aleatório.
      const files = new Map<string, { path: string; type: string }>();
      const TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm' };

      // A aba avisa quando abre ou ganha foco: os comandos vão para a última que avisou.
      server.ws.on('mockup:hello', (_data: unknown, client: Client) => {
        active = client;
      });
      server.ws.on('mockup:result', (data: Result) => {
        const p = pending.get(data.id);
        if (!p) return;
        pending.delete(data.id);
        clearTimeout(p.timer);
        const blob = blobs.get(data.id);
        blobs.delete(data.id);
        p.resolve({ ...data, blob: blob ? { base64: blob.data.toString('base64'), type: blob.type } : undefined });
      });

      server.middlewares.use('/__mcp', async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://local');
        if (req.headers['x-mockup-mcp'] !== '1') return json(res, 403, { ok: false, error: 'Cabeçalho X-Mockup-MCP ausente' });
        const origin = req.headers.origin;

        // Arquivos gerados pela própria página do editor (mesma origem).
        if (url.pathname === '/blob' && req.method === 'POST') {
          if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { ok: false, error: 'Origem não permitida' });
          const id = url.searchParams.get('id') ?? '';
          blobs.set(id, { data: await readBody(req), type: url.searchParams.get('type') ?? 'application/octet-stream' });
          return json(res, 200, { ok: true });
        }

        // A página do editor baixa um arquivo liberado pelo MCP (o token é o segredo).
        if (url.pathname === '/file' && req.method === 'GET') {
          if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { ok: false, error: 'Origem não permitida' });
          const f = files.get(url.searchParams.get('token') ?? '');
          if (!f) return json(res, 404, { ok: false, error: 'Arquivo não encontrado' });
          res.statusCode = 200;
          res.setHeader('Content-Type', f.type);
          res.setHeader('Content-Length', String(statSync(f.path).size));
          createReadStream(f.path).pipe(res);
          return;
        }

        // Daqui para baixo, só processos locais (o servidor MCP), nunca uma página web.
        if (origin) return json(res, 403, { ok: false, error: 'Origem não permitida' });

        if (url.pathname === '/register-file' && req.method === 'POST') {
          let body: { path?: string };
          try {
            body = JSON.parse((await readBody(req)).toString('utf8'));
            if (!body.path || !statSync(body.path).isFile()) throw new Error();
          } catch {
            return json(res, 400, { ok: false, error: 'Arquivo inválido' });
          }
          const token = randomUUID();
          files.set(token, { path: body.path, type: TYPES[extname(body.path).toLowerCase()] ?? 'application/octet-stream' });
          return json(res, 200, { ok: true, token });
        }

        const clients = [...server.ws.clients] as Client[];
        if (url.pathname === '/status') {
          return json(res, 200, { ok: true, editorOpen: clients.length > 0, tabs: clients.length });
        }

        if (url.pathname === '/command' && req.method === 'POST') {
          let body: { cmd?: string; args?: unknown; timeoutMs?: number };
          try {
            body = JSON.parse((await readBody(req)).toString('utf8'));
          } catch {
            return json(res, 400, { ok: false, error: 'JSON inválido' });
          }
          if (!body.cmd) return json(res, 400, { ok: false, error: 'Comando ausente' });
          const target = active && (server.ws.clients as Set<unknown>).has(active) ? active : clients[clients.length - 1];
          if (!target) return json(res, 503, { ok: false, error: 'Nenhuma aba do editor aberta. Abra http://127.0.0.1:5199 no navegador.' });
          const id = randomUUID();
          const timeoutMs = Math.min(Math.max(body.timeoutMs ?? 60_000, 1_000), 15 * 60_000);
          const result = await new Promise<Result>((resolve) => {
            const timer = setTimeout(() => {
              pending.delete(id);
              blobs.delete(id);
              resolve({ id, ok: false, error: 'O editor não respondeu a tempo (a aba pode estar em segundo plano ou fechada).' });
            }, timeoutMs);
            pending.set(id, { resolve, timer });
            target.send('mockup:cmd', { id, cmd: body.cmd, args: body.args ?? {} });
          });
          return json(res, 200, result);
        }
        next();
      });
    },
  };
}
