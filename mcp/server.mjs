#!/usr/bin/env node
// Servidor MCP do VidraMock: deixa o Claude montar cenas, animar e exportar no editor aberto.
// Fala com a aba do editor pela ponte local do Vite (http://127.0.0.1:5199/__mcp).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const BASE = process.env.MOCKUP_URL ?? 'http://127.0.0.1:5199';
const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEADERS = { 'Content-Type': 'application/json', 'X-Mockup-MCP': '1' };
// O Claude Code pode iniciar este processo sem o Homebrew no PATH: usa o npm ao lado deste Node.
const NODE_BIN = path.dirname(process.execPath);
const NPM = existsSync(path.join(NODE_BIN, 'npm')) ? path.join(NODE_BIN, 'npm') : 'npm';
const CHILD_ENV = { ...process.env, PATH: `${NODE_BIN}:${process.env.PATH ?? '/usr/bin:/bin'}` };

const run = promisify(execFile);
const FFMPEG_DIRS = [NODE_BIN, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
const findBin = (name) => FFMPEG_DIRS.map((d) => path.join(d, name)).find((f) => existsSync(f));
const CACHE = path.join(os.tmpdir(), 'vidramock-cache');

// Gravações de iPhone vêm em HEVC e com quadros variáveis: o navegador salta mal entre quadros.
// Converte uma vez (com cache) para H.264 a 60 fps com quadro-chave a cada 0,25 s.
async function prepareVideo(file, mode) {
  const ffmpeg = findBin('ffmpeg');
  const ffprobe = findBin('ffprobe');
  let codec = 'desconhecido';
  if (ffprobe) {
    const { stdout } = await run(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file]);
    codec = stdout.trim();
  }
  if (mode === 'never' || (mode === 'auto' && codec === 'h264') || !ffmpeg) return { file, codec, converted: false };
  const st = statSync(file);
  const hash = createHash('sha1').update(`${file}:${st.size}:${st.mtimeMs}`).digest('hex').slice(0, 16);
  const out = path.join(CACHE, `${hash}.mp4`);
  if (!existsSync(out)) {
    await mkdir(CACHE, { recursive: true });
    await run(ffmpeg, ['-v', 'error', '-y', '-i', file, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-vf', 'fps=60', '-g', '15', '-movflags', '+faststart', out], { maxBuffer: 1 << 24 });
  }
  return { file: out, codec, converted: true };
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

function resolvePath(p) {
  if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(p);
}

async function status() {
  try {
    const res = await fetch(`${BASE}/__mcp/status`, { headers: HEADERS });
    const json = await res.json();
    return { server: true, editorOpen: !!json.editorOpen, tabs: json.tabs ?? 0 };
  } catch {
    return { server: false, editorOpen: false, tabs: 0 };
  }
}

async function call(cmd, args = {}, timeoutMs = 60_000) {
  let res;
  try {
    res = await fetch(`${BASE}/__mcp/command`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ cmd, args, timeoutMs }) });
  } catch {
    throw new Error(`O editor não está rodando em ${BASE}. Use a ferramenta open_editor (ou rode "npm run dev" em ${PROJECT}).`);
  }
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? 'Falha no editor');
  return json;
}

const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });
const tool = (fn) => async (args) => {
  try {
    return await fn(args ?? {});
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }] };
  }
};
const simple = (cmd) => tool(async (args) => text((await call(cmd, args)).data));

async function readImage(p) {
  const file = resolvePath(p);
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!mime) throw new Error('Formato não suportado. Use PNG, JPG, WebP ou GIF.');
  const data = await readFile(file);
  return { base64: data.toString('base64'), mime, name: path.basename(file) };
}

async function saveBlob(blob, target) {
  const file = resolvePath(target);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(blob.base64, 'base64'));
  return file;
}

const server = new McpServer({ name: 'vidramock', version: '0.4.0' });

const camPresets = ['front', 'hero', 'threeQuarter', 'side', 'top', 'low', 'close', 'back'];
const animPresets = ['cinematicClose', 'rackFocus', 'reveal360', 'slowOrbit', 'diveIn', 'topDown', 'tiltShowcase', 'websiteScroll', 'floatHero'];
const looks = ['studioLight', 'rocks', 'podium', 'dunes', 'dark', 'neon'];
const backdrops = ['none', 'cove', 'podium', 'rocks', 'dunes', 'photo'];

server.registerTool(
  'editor_status',
  { title: 'Status do editor', description: 'Check whether the VidraMock dev server is running and an editor tab is open (commands need an open tab).' },
  tool(async () => text({ url: BASE, project: PROJECT, ...(await status()) })),
);

server.registerTool(
  'open_editor',
  {
    title: 'Abrir o editor',
    description: 'Start the VidraMock dev server if needed and open the editor in the default browser. Call this first if other tools say the editor is not running or no tab is open.',
    inputSchema: { openBrowser: z.boolean().optional().describe('Open the default browser if no editor tab is connected (default true)') },
  },
  tool(async ({ openBrowser = true }) => {
    let st = await status();
    if (!st.server) {
      const child = spawn(NPM, ['run', 'dev'], { cwd: PROJECT, detached: true, stdio: 'ignore', env: CHILD_ENV });
      child.unref();
      for (let i = 0; i < 40 && !st.server; i++) {
        await new Promise((r) => setTimeout(r, 500));
        st = await status();
      }
      if (!st.server) throw new Error(`Não consegui iniciar o servidor em ${PROJECT}.`);
    }
    if (!st.editorOpen && openBrowser) {
      spawn('/usr/bin/open', [BASE], { detached: true, stdio: 'ignore' }).unref();
      for (let i = 0; i < 30 && !st.editorOpen; i++) {
        await new Promise((r) => setTimeout(r, 500));
        st = await status();
      }
    }
    return text({ url: BASE, ...st, note: st.editorOpen ? 'Editor pronto.' : 'Servidor rodando; abra a URL num navegador para conectar o editor.' });
  }),
);

server.registerTool(
  'get_state',
  { title: 'Estado da cena', description: 'Get the full current scene: device, screen, scene/backdrop, background, lighting, effects (depth of field etc.), camera angles, output aspect and animation.' },
  simple('get_state'),
);

server.registerTool(
  'list_options',
  { title: 'Opções disponíveis', description: 'List every valid value: devices and finishes, looks, backdrops, light presets, depth-of-field levels, animation presets, camera presets, aspects, eases.' },
  simple('list_options'),
);

server.registerTool(
  'set_device',
  {
    title: 'Aparelho',
    description: 'Choose the device and its pose. Rotations are in degrees around the device center.',
    inputSchema: {
      kind: z.enum(['iphone', 'ipad', 'macbook', 'imac', 'browser']).optional(),
      finish: z.string().optional().describe('iphone (iPhone 17): preto|branco|azul|salvia|lavanda; ipad (iPad 11): prata|azul|rosa|amarelo; macbook (MacBook Pro 14): preto|prata; imac (iMac 24): azul|roxo|rosa|laranja|amarelo|verde|prata; browser: claro|escuro'),
      orientation: z.enum(['portrait', 'landscape']).optional().describe('iphone/ipad only'),
      lidAngle: z.number().min(60).max(150).optional().describe('macbook lid opening in degrees'),
      rotX: z.number().optional().describe('tilt forward/back'),
      rotY: z.number().optional().describe('turn left/right'),
      rotZ: z.number().optional().describe('roll'),
      showIsland: z.boolean().optional(),
      browserUrl: z.string().optional().describe('text shown in the browser window address bar'),
      logo: z.boolean().optional().describe('Apple logo on the back (default true)'),
      offsetX: z.number().min(-0.5).max(0.5).optional().describe('move the device in the frame, fraction of frame width (positive = right)'),
      offsetY: z.number().min(-0.5).max(0.5).optional().describe('move the device in the frame, fraction of frame height (positive = up)'),
    },
  },
  simple('set_device'),
);

server.registerTool(
  'set_screen_image',
  {
    title: 'Print na tela',
    description: 'Put a local screenshot (PNG/JPG/WebP) on the device screen. Use an absolute path on this Mac.',
    inputSchema: {
      path: z.string().describe('Absolute path (or ~/...) to the image file'),
      fit: z.enum(['cover', 'contain']).optional().describe('cover fills the screen (default); contain shows the whole image'),
    },
  },
  tool(async ({ path: p, fit }) => {
    const img = await readImage(p);
    const out = await call('set_screen_image', img);
    if (fit) await call('set_screen', { fit });
    return text({ loaded: img.name, ...out.data });
  }),
);

server.registerTool(
  'set_screen_video',
  {
    title: 'Vídeo na tela',
    description:
      'Put a local screen recording (MP4/MOV) on the device screen. It plays in sync with the timeline and is exported frame-exact. HEVC/variable-frame-rate recordings are converted locally with ffmpeg (cached). If the timeline has no keyframes, its duration becomes the video length.',
    inputSchema: {
      path: z.string().describe('Absolute path (or ~/...) to the video file'),
      transcode: z.enum(['auto', 'always', 'never']).optional().describe('always (default) converts to constant 60 fps H.264 for exact seeking; auto converts only non-H.264; never uses the file as is'),
    },
  },
  tool(async ({ path: p, transcode = 'always' }) => {
    const src = resolvePath(p);
    if (!existsSync(src)) throw new Error(`Arquivo não encontrado: ${src}`);
    const prepared = await prepareVideo(src, transcode);
    const reg = await fetch(`${BASE}/__mcp/register-file`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ path: prepared.file }) }).then((r) => r.json());
    if (!reg.ok) throw new Error(reg.error ?? 'A ponte recusou o arquivo');
    const out = await call('set_screen_video', { token: reg.token, name: path.basename(src) }, 180_000);
    return text({ loaded: path.basename(src), originalCodec: prepared.codec, converted: prepared.converted, ...out.data });
  }),
);

server.registerTool(
  'set_shots',
  {
    title: 'Planos com cortes',
    description:
      'Build an edit made of shots with hard cuts between them. Each shot reuses the camera motion of an animation preset (stretched to its duration) and can show a different part of the screen video (videoStart, seconds into the recording). Example: two shots = one cut.',
    inputSchema: {
      shots: z
        .array(
          z.object({
            preset: z.enum(animPresets),
            duration: z.number().min(0.5).max(60),
            videoStart: z.number().min(0).optional().describe('seconds into the screen video where this shot starts'),
          }),
        )
        .min(1),
      dofLevel: z.enum(['off', 'subtle', 'medium', 'strong', 'macro']).optional(),
      ease: z.enum(['smooth', 'flow', 'snappy', 'linear', 'dynamic']).optional().describe('motion pacing inside each shot (default linear)'),
      play: z.boolean().optional(),
    },
  },
  simple('set_shots'),
);

const deviceShape = z
  .object({
    kind: z.enum(['iphone', 'ipad', 'macbook', 'imac', 'browser']).optional(),
    finish: z.string().optional(),
    orientation: z.enum(['portrait', 'landscape']).optional(),
    lidAngle: z.number().min(60).max(150).optional(),
    rotX: z.number().optional(),
    rotY: z.number().optional(),
    rotZ: z.number().optional(),
    showIsland: z.boolean().optional(),
    browserUrl: z.string().optional(),
    logo: z.boolean().optional(),
    offsetX: z.number().min(-0.5).max(0.5).optional(),
    offsetY: z.number().min(-0.5).max(0.5).optional(),
  })
  .optional();

server.registerTool(
  'set_scenes',
  {
    title: 'Cenas na linha do tempo',
    description:
      'Build a timeline of scenes, each with its own device, screen media and camera motion (hard cut between scenes). Lighting, backdrop, effects and aspect are shared. Device fields not given come from the current device. Motion per scene: keyframes by angle (t in seconds from the scene start; azimuth/elevation/zoom like set_camera; scroll 0–1 of a tall screenshot) or an animation preset stretched to the scene. The editor UI shows the scenes in the timeline and edits the one under the playhead.',
    inputSchema: {
      scenes: z
        .array(
          z.object({
            duration: z.number().min(0.5).max(60),
            device: deviceShape,
            image: z.string().optional().describe('absolute path of a screenshot for this scene'),
            video: z.string().optional().describe('absolute path of a screen recording for this scene'),
            videoStart: z.number().min(0).optional(),
            screen: z.object({ fit: z.enum(['cover', 'contain']).optional(), fill: z.string().optional() }).optional(),
            keyframes: z
              .array(
                z.object({
                  t: z.number().min(0),
                  azimuth: z.number().min(-180).max(180).optional(),
                  elevation: z.number().min(-80).max(85).optional(),
                  zoom: z.number().min(0.2).max(3).optional(),
                  scroll: z.number().min(0).max(1).optional(),
                }),
              )
              .optional(),
            preset: z.enum(animPresets).optional(),
          }),
        )
        .min(1),
      play: z.boolean().optional(),
    },
  },
  tool(async ({ scenes, play }) => {
    const out = [];
    for (const [i, sc] of scenes.entries()) {
      let media = null;
      if (sc.image) {
        media = (await call('add_media', await readImage(sc.image), 120_000)).data.id;
      } else if (sc.video) {
        const src = resolvePath(sc.video);
        if (!existsSync(src)) throw new Error(`Cena ${i + 1}: arquivo não encontrado: ${src}`);
        const prepared = await prepareVideo(src, 'always');
        const reg = await fetch(`${BASE}/__mcp/register-file`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ path: prepared.file }) }).then((r) => r.json());
        if (!reg.ok) throw new Error(reg.error ?? 'A ponte recusou o arquivo');
        media = (await call('add_media', { token: reg.token, name: path.basename(src) }, 180_000)).data.id;
      }
      const { image, video, ...rest } = sc;
      out.push({ ...rest, media });
    }
    return text((await call('set_scenes', { scenes: out, play }, 120_000)).data);
  }),
);

server.registerTool(
  'move_scene',
  {
    title: 'Mudar a ordem das cenas',
    description: 'Move a scene to another position in the timeline (positions start at 1). Each scene keeps its length and camera motion.',
    inputSchema: { scene: z.number().int().min(1).describe('current position of the scene'), to: z.number().int().min(1).describe('new position') },
  },
  simple('move_scene'),
);

server.registerTool(
  'set_screen',
  {
    title: 'Ajuste da tela',
    description: 'Screen image options. scroll (0–1) pans a tall screenshot (e.g. a full web page) from top to bottom.',
    inputSchema: { fit: z.enum(['cover', 'contain']).optional(), scroll: z.number().min(0).max(1).optional(), fill: z.string().optional().describe('hex color around the image in contain mode') },
  },
  simple('set_screen'),
);

server.registerTool(
  'set_scene',
  {
    title: 'Cenário',
    description: 'Set the 3D backdrop behind the device: cove (infinite studio), podium, rocks, dunes, photo (your own image, pass photoPath) or none (flat background only). Backdrops turn into bokeh with depth of field.',
    inputSchema: {
      backdrop: z.enum(backdrops).optional(),
      color: z.string().optional().describe('hex color for cove/podium'),
      photoPath: z.string().optional().describe('local image to use as the photo backdrop (sets backdrop to photo)'),
    },
  },
  tool(async ({ photoPath, ...rest }) => {
    if (photoPath) await call('set_backdrop_image', await readImage(photoPath));
    const out = Object.keys(rest).length ? await call('set_scene', rest) : await call('get_state');
    return text(out.data);
  }),
);

server.registerTool(
  'set_background',
  {
    title: 'Fundo',
    description: 'Flat background behind everything (visible when backdrop is none, and as the sky for rocks/dunes). mode transparent exports PNGs with alpha.',
    inputSchema: {
      mode: z.enum(['solid', 'linear', 'radial', 'transparent']).optional(),
      color1: z.string().optional(),
      color2: z.string().optional(),
      angle: z.number().optional().describe('linear gradient angle in degrees (CSS convention)'),
    },
  },
  simple('set_background'),
);

server.registerTool(
  'set_lighting',
  {
    title: 'Luz',
    description: 'Studio lighting and shadow.',
    inputSchema: {
      preset: z.enum(['studio', 'soft', 'dramatic', 'warm', 'neon']).optional(),
      intensity: z.number().min(0.2).max(2.5).optional(),
      rotation: z.number().min(-180).max(180).optional().describe('light direction in degrees'),
      glare: z.number().min(0).max(3).optional().describe('reflection strength on the screen glass'),
      shadow: z.boolean().optional(),
      shadowOpacity: z.number().min(0).max(1).optional(),
      shadowSoftness: z.number().min(0).max(1).optional(),
      tone: z.enum(['soft', 'linear', 'neutral', 'agx']).optional(),
    },
  },
  simple('set_lighting'),
);

server.registerTool(
  'set_effects',
  {
    title: 'Efeitos e desfoque',
    description: 'Depth of field and post effects. dofLevel applies a preset (off|subtle|medium|strong|macro); bokeh is blur strength (0.5–14), focusRange is how much stays sharp (smaller = shallower).',
    inputSchema: {
      dofLevel: z.enum(['off', 'subtle', 'medium', 'strong', 'macro']).optional(),
      dof: z.boolean().optional(),
      bokeh: z.number().min(0.5).max(14).optional(),
      focusRange: z.number().min(0.05).max(3).optional(),
      bloom: z.boolean().optional(),
      bloomIntensity: z.number().min(0).max(2).optional(),
      bloomThreshold: z.number().min(0.3).max(1).optional(),
      grain: z.boolean().optional(),
      grainAmount: z.number().min(0).max(0.3).optional(),
      vignette: z.boolean().optional(),
      vignetteAmount: z.number().min(0).max(1).optional(),
      sharpen: z.boolean().optional(),
      sharpenAmount: z.number().min(0).max(1).optional(),
      exposure: z.number().min(-2).max(2).optional(),
      contrast: z.number().min(-0.5).max(0.5).optional(),
      saturation: z.number().min(-1).max(1).optional(),
      temperature: z.number().min(-1).max(1).optional(),
    },
  },
  simple('set_effects'),
);

server.registerTool(
  'apply_look',
  {
    title: 'Look pronto',
    description: 'Apply a complete look (backdrop + background + light + effects): studioLight, rocks, podium, dunes, dark, neon.',
    inputSchema: { look: z.enum(looks) },
  },
  simple('apply_look'),
);

server.registerTool(
  'set_output',
  { title: 'Proporção', description: 'Frame aspect ratio for preview and exports.', inputSchema: { aspect: z.enum(['16:9', '4:3', '1:1', '4:5', '9:16']) } },
  simple('set_output'),
);

server.registerTool(
  'set_camera',
  {
    title: 'Câmera',
    description:
      'Move the camera. Either a preset (front, hero, threeQuarter, side, top, low, close, back) or free angles: azimuth (degrees, 0 = front, positive = to the right), elevation (degrees, positive = above), zoom (1 = auto-framed, smaller = closer). fov sets the lens (smaller = telephoto).',
    inputSchema: {
      preset: z.enum(camPresets).optional(),
      azimuth: z.number().min(-180).max(180).optional(),
      elevation: z.number().min(-80).max(85).optional(),
      zoom: z.number().min(0.2).max(3).optional(),
      fov: z.number().min(10).max(70).optional(),
      animate: z.boolean().optional().describe('smooth transition (default true)'),
    },
  },
  simple('set_camera'),
);

server.registerTool(
  'set_focus',
  {
    title: 'Ponto de foco',
    description: 'Focus the depth of field on a point of the screen image: x and y from 0 to 1 (0,0 = top-left of the screenshot), or center: true. Turns depth of field on.',
    inputSchema: { x: z.number().min(0).max(1).optional(), y: z.number().min(0).max(1).optional(), center: z.boolean().optional() },
  },
  simple('set_focus'),
);

server.registerTool(
  'apply_animation_preset',
  {
    title: 'Preset de animação',
    description:
      'Apply a full animation (camera motion + depth of field + pacing): cinematicClose (close-up drift with shallow focus), rackFocus (focus travels down a tilted screen), reveal360 (turn from back to front), slowOrbit (gentle orbit + float), diveIn (wide to close on the screen), topDown (from above down to eye level), tiltShowcase (low to high, close), websiteScroll (scrolls a tall screenshot), floatHero (static camera, floating device).',
    inputSchema: { preset: z.enum(animPresets), play: z.boolean().optional().describe('start playing in the editor (default true)') },
  },
  simple('apply_animation_preset'),
);

server.registerTool(
  'set_focus_areas',
  {
    title: 'Áreas de foco',
    description:
      'Generate camera motion that visits rectangles of the screenshot in order, like Ultramock focus areas. Coordinates 0–1 on the upright screenshot (x0,y0 = top-left of the area). The motion starts and ends at the current framing.',
    inputSchema: {
      areas: z.array(z.object({ x0: z.number().min(0).max(1), y0: z.number().min(0).max(1), x1: z.number().min(0).max(1), y1: z.number().min(0).max(1) })).min(1),
      travel: z.number().min(0.3).max(5).optional().describe('seconds moving between areas (default 1.4)'),
      hold: z.number().min(0).max(5).optional().describe('seconds paused on each area (default 1)'),
      play: z.boolean().optional(),
    },
  },
  simple('set_focus_areas'),
);

server.registerTool(
  'set_animation',
  {
    title: 'Animação',
    description: 'Timeline settings. Changing duration stretches existing keyframes. ease: smooth | flow (continuous) | snappy | linear | dynamic (starts fast, good right after a cut).',
    inputSchema: {
      duration: z.number().min(1).max(60).optional(),
      fps: z.union([z.literal(30), z.literal(60)]).optional(),
      ease: z.enum(['smooth', 'flow', 'snappy', 'linear', 'dynamic']).optional(),
      float: z.boolean().optional().describe('gentle floating motion of the device'),
      floatAmount: z.number().min(0.1).max(1.5).optional(),
      clearKeyframes: z.boolean().optional(),
    },
  },
  simple('set_animation'),
);

server.registerTool(
  'add_keyframe',
  {
    title: 'Quadro-chave',
    description: 'Save the current camera (position, focus, screen scroll) as a keyframe at time t (seconds). Set the camera first with set_camera / set_focus.',
    inputSchema: { t: z.number().min(0).describe('time in seconds') },
  },
  simple('add_keyframe'),
);

server.registerTool(
  'playback',
  {
    title: 'Reprodução',
    description: 'Play, pause or seek the animation in the editor.',
    inputSchema: { action: z.enum(['play', 'pause', 'seek']), t: z.number().min(0).optional().describe('seconds, for seek') },
  },
  simple('playback'),
);

server.registerTool(
  'render_preview',
  {
    title: 'Ver o resultado',
    description: 'Render the current frame and return it as an image so you can check the result. Optionally at animation time t (seconds). Use this after changes to verify.',
    inputSchema: {
      long: z.number().min(256).max(2048).optional().describe('long edge in pixels (default 1280)'),
      t: z.number().min(0).optional(),
    },
  },
  tool(async ({ long = 1280, t }) => {
    const out = await call('render_image', { long, t, format: 'jpeg' }, 120_000);
    if (!out.blob) throw new Error('O editor não devolveu a imagem');
    return {
      content: [
        { type: 'image', data: out.blob.base64, mimeType: out.blob.type || 'image/jpeg' },
        { type: 'text', text: `Prévia ${out.data.width}×${out.data.height}` },
      ],
    };
  }),
);

server.registerTool(
  'export_image',
  {
    title: 'Exportar PNG',
    description: 'Render a high-resolution PNG and save it to a local path (transparent if the background mode is transparent and backdrop is none).',
    inputSchema: {
      path: z.string().describe('Destination file, e.g. ~/Desktop/mockup.png'),
      long: z.number().min(512).max(5120).optional().describe('long edge in pixels (default 2560)'),
      t: z.number().min(0).optional().describe('animation time to render'),
    },
  },
  tool(async ({ path: p, long = 2560, t }) => {
    const out = await call('render_image', { long, t }, 180_000);
    const file = await saveBlob(out.blob, p.endsWith('.png') ? p : `${p}.png`);
    return text({ saved: file, ...out.data });
  }),
);

server.registerTool(
  'export_video',
  {
    title: 'Exportar vídeo',
    description: 'Record the timeline animation to an H.264 MP4 and save it to a local path. Needs an animation (preset, keyframes or float).',
    inputSchema: {
      path: z.string().describe('Destination file, e.g. ~/Desktop/mockup.mp4'),
      long: z.number().min(320).max(3840).optional().describe('long edge in pixels (default 1920)'),
      fps: z.union([z.literal(30), z.literal(60)]).optional(),
    },
  },
  tool(async ({ path: p, long = 1920, fps }) => {
    const out = await call('export_video', { long, fps }, 15 * 60_000);
    const file = await saveBlob(out.blob, p.endsWith('.mp4') ? p : `${p}.mp4`);
    return text({ saved: file, ...out.data });
  }),
);

await server.connect(new StdioServerTransport());
