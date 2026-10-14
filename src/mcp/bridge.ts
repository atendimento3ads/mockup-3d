// Lado da página da ponte MCP: recebe comandos pelo WebSocket do Vite e responde.
// Resultados com arquivo (imagem, vídeo) sobem por POST antes da resposta.

export type Handler = (args: Record<string, unknown>) => unknown | Promise<unknown>;
export type Handlers = Record<string, Handler>;
export interface BlobResult {
  blob: Blob;
  data?: unknown;
}

const isBlobResult = (v: unknown): v is BlobResult => !!v && typeof v === 'object' && (v as BlobResult).blob instanceof Blob;

export function connectBridge(getHandlers: () => Handlers): () => void {
  const hot = import.meta.hot;
  if (!hot) return () => undefined;

  const onCmd = async (msg: { id: string; cmd: string; args?: Record<string, unknown> }) => {
    const handler = getHandlers()[msg.cmd];
    if (!handler) {
      hot.send('mockup:result', { id: msg.id, ok: false, error: `Comando desconhecido: ${msg.cmd}` });
      return;
    }
    try {
      const out = await handler(msg.args ?? {});
      if (isBlobResult(out)) {
        await fetch(`/__mcp/blob?id=${encodeURIComponent(msg.id)}&type=${encodeURIComponent(out.blob.type)}`, {
          method: 'POST',
          body: out.blob,
          headers: { 'X-Mockup-MCP': '1' },
        });
        hot.send('mockup:result', { id: msg.id, ok: true, data: out.data ?? null });
      } else {
        hot.send('mockup:result', { id: msg.id, ok: true, data: out ?? null });
      }
    } catch (err) {
      hot.send('mockup:result', { id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  const hello = () => hot.send('mockup:hello', {});
  const onVisible = () => {
    if (document.visibilityState === 'visible') hello();
  };
  hot.on('mockup:cmd', onCmd);
  hello();
  window.addEventListener('focus', hello);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    hot.off('mockup:cmd', onCmd);
    window.removeEventListener('focus', hello);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
