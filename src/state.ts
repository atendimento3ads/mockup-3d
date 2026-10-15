// Estado da cena em JSON puro: a interface edita isso e o motor aplica.
// Ficar tudo aqui facilita salvar projetos e, mais tarde, controlar por MCP.

export type DeviceKind = 'iphone' | 'ipad' | 'macbook' | 'browser';
export type Orientation = 'portrait' | 'landscape';
export type BgMode = 'solid' | 'linear' | 'radial' | 'transparent';
export type LightPreset = 'studio' | 'soft' | 'dramatic' | 'warm' | 'neon';
export type ToneMode = 'soft' | 'linear' | 'neutral' | 'agx';
export type EaseKey = 'smooth' | 'flow' | 'linear' | 'snappy' | 'dynamic';
export type BackdropKind = 'none' | 'cove' | 'podium' | 'rocks' | 'dunes' | 'photo';
export type AnimPresetKey = 'cinematicClose' | 'rackFocus' | 'reveal360' | 'slowOrbit' | 'diveIn' | 'topDown' | 'tiltShowcase' | 'websiteScroll' | 'floatHero';
export type MotionKind = 'orbit' | 'pushIn' | 'pullBack' | 'reveal' | 'sweep' | 'scroll';
export type Vec3 = [number, number, number];

export interface Keyframe {
  id: string;
  t: number;
  pos: Vec3;
  target: Vec3;
  fov: number;
  focus: Vec3;
  scroll: number;
  // Corte seco: a câmera pula para este quadro, sem transição a partir do anterior.
  cut?: boolean;
  // Cena dona do quadro (quando a linha do tempo tem cenas): cada cena anima só com os seus.
  scene?: string;
}

// Cena: um trecho da linha do tempo com aparelho, tela e mídia próprios. Luz, cenário e efeitos
// são comuns a todas. A cena vai do seu `t` até o início da próxima (ou o fim da animação).
export interface SceneClip {
  id: string;
  t: number;
  device: SceneState['device'];
  screen: SceneState['screen'];
  // Mídia na biblioteca do editor (imagens e vídeos não cabem no estado em JSON).
  media: string | null;
  // Para vídeos: segundo da gravação em que a cena começa.
  videoStart?: number;
}

// Trecho do vídeo da tela: a partir do tempo `t` da animação, a tela mostra o vídeo desde `src` segundos.
export interface VideoClip {
  t: number;
  src: number;
}
export type AspectKey = '16:9' | '4:3' | '1:1' | '4:5' | '9:16';
export type CameraPresetKey = 'front' | 'hero' | 'threeQuarter' | 'side' | 'top' | 'low' | 'close' | 'back';

export interface SceneState {
  device: {
    kind: DeviceKind;
    finish: string;
    orientation: Orientation;
    lidAngle: number;
    rotX: number;
    rotY: number;
    rotZ: number;
    showIsland: boolean;
    browserUrl: string;
    // Posição do aparelho no quadro (fração da largura/altura), sem mudar a perspectiva.
    offsetX: number;
    offsetY: number;
  };
  screen: { fit: 'cover' | 'contain'; scroll: number; fill: string };
  background: { mode: BgMode; color1: string; color2: string; angle: number };
  scene: { backdrop: BackdropKind; color: string };
  lighting: {
    preset: LightPreset;
    intensity: number;
    rotation: number;
    glare: number;
    shadow: boolean;
    shadowOpacity: number;
    shadowSoftness: number;
    tone: ToneMode;
  };
  camera: { fov: number };
  effects: {
    dof: boolean;
    bokeh: number;
    focusRange: number;
    bloom: boolean;
    bloomIntensity: number;
    bloomThreshold: number;
    grain: boolean;
    grainAmount: number;
    vignette: boolean;
    vignetteAmount: number;
    sharpen: boolean;
    sharpenAmount: number;
    exposure: number;
    contrast: number;
    saturation: number;
    temperature: number;
  };
  output: { aspect: AspectKey };
  animation: {
    duration: number;
    fps: 30 | 60;
    ease: EaseKey;
    keyframes: Keyframe[];
    float: boolean;
    floatAmount: number;
    clips: VideoClip[];
    scenes: SceneClip[];
  };
}

export const DEFAULT_STATE: SceneState = {
  device: {
    kind: 'iphone',
    finish: 'natural',
    orientation: 'portrait',
    lidAngle: 108,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    showIsland: true,
    browserUrl: 'seusite.com.br',
    offsetX: 0,
    offsetY: 0,
  },
  screen: { fit: 'cover', scroll: 0, fill: '#000000' },
  background: { mode: 'radial', color1: '#f3f3f5', color2: '#d9dadf', angle: 160 },
  scene: { backdrop: 'cove', color: '#e3e3e6' },
  lighting: { preset: 'soft', intensity: 1, rotation: 0, glare: 1, shadow: true, shadowOpacity: 0.65, shadowSoftness: 0.5, tone: 'soft' },
  camera: { fov: 30 },
  effects: {
    dof: true,
    bokeh: 5,
    focusRange: 1,
    bloom: true,
    bloomIntensity: 0.25,
    bloomThreshold: 0.9,
    grain: true,
    grainAmount: 0.045,
    vignette: true,
    vignetteAmount: 0.18,
    sharpen: false,
    sharpenAmount: 0.25,
    exposure: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
  },
  output: { aspect: '16:9' },
  animation: { duration: 6, fps: 30, ease: 'smooth', keyframes: [], float: false, floatAmount: 0.6, clips: [], scenes: [] },
};

// Cena ativa no instante t (as cenas ficam em ordem de início; a primeira começa em 0).
export function sceneAt(scenes: SceneClip[] | undefined, t: number): SceneClip | null {
  if (!scenes?.length) return null;
  let out = scenes[0];
  for (const s of scenes) if (s.t <= t + 1e-6) out = s;
  return out;
}

// Início e fim de uma cena.
export function sceneSpan(scenes: SceneClip[], id: string, duration: number): [number, number] {
  const i = scenes.findIndex((s) => s.id === id);
  if (i < 0) return [0, duration];
  return [scenes[i].t, i + 1 < scenes.length ? scenes[i + 1].t : duration];
}

export const DEVICES: { kind: DeviceKind; label: string }[] = [
  { kind: 'iphone', label: 'iPhone' },
  { kind: 'ipad', label: 'iPad' },
  { kind: 'macbook', label: 'MacBook' },
  { kind: 'browser', label: 'Navegador' },
];

export const FINISHES: Record<DeviceKind, { key: string; label: string; color: string }[]> = {
  iphone: [
    { key: 'natural', label: 'Titânio natural', color: '#b3aea5' },
    { key: 'preto', label: 'Titânio preto', color: '#3a393b' },
    { key: 'branco', label: 'Titânio branco', color: '#e4e3df' },
    { key: 'deserto', label: 'Titânio deserto', color: '#c2a68d' },
    { key: 'azul', label: 'Titânio azul', color: '#3f4859' },
  ],
  ipad: [
    { key: 'prata', label: 'Prateado', color: '#d5d6d8' },
    { key: 'preto', label: 'Preto espacial', color: '#3a3b3e' },
  ],
  macbook: [
    { key: 'prata', label: 'Prateado', color: '#cfd1d4' },
    { key: 'preto', label: 'Preto espacial', color: '#2d2e31' },
  ],
  browser: [
    { key: 'claro', label: 'Claro', color: '#eef0f3' },
    { key: 'escuro', label: 'Escuro', color: '#202124' },
  ],
};

export function finishColor(kind: DeviceKind, finish: string): string {
  const list = FINISHES[kind];
  return (list.find((f) => f.key === finish) ?? list[0]).color;
}

export const ASPECTS: Record<AspectKey, number> = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '4:5': 4 / 5,
  '9:16': 9 / 16,
};

export const CAMERA_PRESETS: Record<CameraPresetKey, { label: string; az: number; el: number; zoom: number }> = {
  front: { label: 'Frente', az: 0, el: 0, zoom: 1 },
  hero: { label: 'Herói', az: -24, el: 10, zoom: 1 },
  threeQuarter: { label: '3/4', az: 38, el: 18, zoom: 1 },
  side: { label: 'Perfil', az: 72, el: 4, zoom: 1 },
  top: { label: 'De cima', az: 0, el: 62, zoom: 1 },
  low: { label: 'De baixo', az: -18, el: -14, zoom: 1 },
  close: { label: 'Close', az: -14, el: 6, zoom: 0.55 },
  back: { label: 'Traseira', az: 160, el: 12, zoom: 1 },
};

export const LIGHT_PRESETS: { key: LightPreset; label: string }[] = [
  { key: 'studio', label: 'Estúdio' },
  { key: 'soft', label: 'Suave' },
  { key: 'dramatic', label: 'Dramática' },
  { key: 'warm', label: 'Quente' },
  { key: 'neon', label: 'Neon' },
];

type Patch = { [K in keyof SceneState]?: Partial<SceneState[K]> };

// "Looks" prontos: mexem só em fundo, luz e efeitos, nunca no aparelho.
export const LOOKS: { key: string; label: string; swatch: string; patch: Patch }[] = [
  {
    key: 'studioLight',
    label: 'Estúdio claro',
    swatch: 'linear-gradient(180deg, #f4f4f6, #d4d5da)',
    patch: {
      scene: { backdrop: 'cove', color: '#e3e3e6' },
      background: { mode: 'radial', color1: '#f3f3f5', color2: '#d9dadf' },
      lighting: { preset: 'soft', intensity: 1, shadowOpacity: 0.65 },
      effects: { dof: true, bokeh: 5, focusRange: 1, bloom: true, bloomIntensity: 0.2, bloomThreshold: 0.92, vignette: true, vignetteAmount: 0.15, grain: true, grainAmount: 0.04 },
    },
  },
  {
    key: 'rocks',
    label: 'Rochas à noite',
    swatch: 'linear-gradient(180deg, #3a3b40, #0c0c0e)',
    patch: {
      scene: { backdrop: 'rocks', color: '#e3e3e6' },
      background: { mode: 'linear', color1: '#1b1c20', color2: '#3a3c43', angle: 0 },
      lighting: { preset: 'studio', intensity: 1, shadowOpacity: 0.8 },
      effects: { dof: true, bokeh: 9, focusRange: 0.9, bloom: true, bloomIntensity: 0.35, bloomThreshold: 0.85, vignette: true, vignetteAmount: 0.35, grain: true, grainAmount: 0.06 },
    },
  },
  {
    key: 'podium',
    label: 'Pódio',
    swatch: 'radial-gradient(circle at 50% 70%, #ffffff, #c9cbd1)',
    patch: {
      scene: { backdrop: 'podium', color: '#e8e6e2' },
      background: { mode: 'radial', color1: '#f3f3f5', color2: '#d9dadf' },
      lighting: { preset: 'soft', intensity: 1.05, shadowOpacity: 0.7 },
      effects: { dof: true, bokeh: 3.5, focusRange: 0.9, bloom: true, bloomIntensity: 0.2, bloomThreshold: 0.92, vignette: true, vignetteAmount: 0.2, grain: true, grainAmount: 0.04 },
    },
  },
  {
    key: 'dunes',
    label: 'Dunas',
    swatch: 'linear-gradient(180deg, #f6c08d, #a8653a)',
    patch: {
      scene: { backdrop: 'dunes', color: '#e3e3e6' },
      background: { mode: 'linear', color1: '#f2b07a', color2: '#8f6aa8', angle: 0 },
      lighting: { preset: 'warm', intensity: 1, shadowOpacity: 0.7 },
      effects: { dof: true, bokeh: 8, focusRange: 0.9, bloom: true, bloomIntensity: 0.4, bloomThreshold: 0.82, vignette: true, vignetteAmount: 0.25, grain: true, grainAmount: 0.05 },
    },
  },
  {
    key: 'dark',
    label: 'Estúdio escuro',
    swatch: 'radial-gradient(circle at 50% 40%, #2c3140, #0b0c10)',
    patch: {
      scene: { backdrop: 'cove', color: '#2a2b30' },
      background: { mode: 'radial', color1: '#2c3140', color2: '#0b0c10' },
      lighting: { preset: 'studio', intensity: 1, shadowOpacity: 0.8 },
      effects: { dof: true, bokeh: 3, focusRange: 1, bloom: true, bloomIntensity: 0.35, bloomThreshold: 0.85, vignette: true, vignetteAmount: 0.3, grain: true, grainAmount: 0.06 },
    },
  },
  {
    key: 'neon',
    label: 'Neon',
    swatch: 'radial-gradient(circle at 50% 40%, #2a1050, #05030a)',
    patch: {
      scene: { backdrop: 'none', color: '#e3e3e6' },
      background: { mode: 'radial', color1: '#2a1050', color2: '#05030a' },
      lighting: { preset: 'neon', intensity: 1.1, shadowOpacity: 0.75 },
      effects: { dof: true, bokeh: 3, focusRange: 1, bloom: true, bloomIntensity: 0.55, bloomThreshold: 0.85, vignette: true, vignetteAmount: 0.45, grain: true, grainAmount: 0.08 },
    },
  },
];

export function applyPatch(s: SceneState, p: Patch): SceneState {
  const out: Record<string, unknown> = { ...s };
  for (const k of Object.keys(p) as (keyof SceneState)[]) {
    out[k] = { ...s[k], ...p[k] };
  }
  return out as unknown as SceneState;
}

export const EASE_OPTIONS: { value: EaseKey; label: string }[] = [
  { value: 'smooth', label: 'Suave' },
  { value: 'flow', label: 'Contínuo' },
  { value: 'snappy', label: 'Marcado' },
  { value: 'dynamic', label: 'Dinâmico' },
  { value: 'linear', label: 'Constante' },
];

export const MOTIONS: { key: MotionKind; label: string; hint: string }[] = [
  { key: 'orbit', label: 'Órbita', hint: 'Gira em volta do aparelho' },
  { key: 'pushIn', label: 'Aproximar', hint: 'A câmera chega perto' },
  { key: 'pullBack', label: 'Afastar', hint: 'Começa perto e abre o quadro' },
  { key: 'reveal', label: 'Revelar', hint: 'Sobe de baixo até o ângulo atual' },
  { key: 'sweep', label: 'Passeio', hint: 'Atravessa de um lado ao outro' },
  { key: 'scroll', label: 'Rolar o print', hint: 'Desce pelo print longo (sites)' },
];

export const BACKDROPS: { key: BackdropKind; label: string; swatch: string }[] = [
  { key: 'cove', label: 'Estúdio infinito', swatch: 'linear-gradient(180deg, #f2f2f4 0%, #e3e3e6 55%, #cfd0d5 100%)' },
  { key: 'podium', label: 'Pódio', swatch: 'radial-gradient(ellipse at 50% 85%, #ffffff 0 22%, #d9d8d4 23% 30%, #ecebe8 31%)' },
  { key: 'rocks', label: 'Rochas', swatch: 'linear-gradient(170deg, #4a4b50 0%, #1d1e22 60%, #0a0a0c 100%)' },
  { key: 'dunes', label: 'Dunas', swatch: 'linear-gradient(180deg, #f3b47e 0%, #c98952 60%, #8d5a35 100%)' },
  { key: 'photo', label: 'Sua foto', swatch: 'repeating-linear-gradient(45deg, #34363d 0 6px, #2a2c31 6px 12px)' },
  { key: 'none', label: 'Só fundo', swatch: 'linear-gradient(180deg, #2c3140, #0b0c10)' },
];

// Níveis de desfoque. A "área nítida" é relativa ao tamanho do aparelho.
export const DOF_PRESETS: { key: string; label: string; dof: boolean; bokeh: number; focusRange: number }[] = [
  { key: 'off', label: 'Nenhum', dof: false, bokeh: 3, focusRange: 1 },
  { key: 'subtle', label: 'Sutil', dof: true, bokeh: 2.5, focusRange: 1.4 },
  { key: 'medium', label: 'Médio', dof: true, bokeh: 5, focusRange: 1 },
  { key: 'strong', label: 'Forte', dof: true, bokeh: 9, focusRange: 0.6 },
  { key: 'macro', label: 'Macro', dof: true, bokeh: 12, focusRange: 0.2 },
];

export const ANIM_PRESETS: { key: AnimPresetKey; label: string; hint: string }[] = [
  { key: 'cinematicClose', label: 'Close cinematográfico', hint: 'Bem perto da tela, desce do topo à base com foco raso' },
  { key: 'rackFocus', label: 'Foco que passeia', hint: 'Tela inclinada; o foco corre de cima a baixo' },
  { key: 'reveal360', label: 'Revelação 360', hint: 'Gira de costas até ficar de frente' },
  { key: 'slowOrbit', label: 'Órbita lenta', hint: 'Giro suave com o aparelho flutuando' },
  { key: 'diveIn', label: 'Mergulho na tela', hint: 'Do plano aberto até o meio da tela' },
  { key: 'topDown', label: 'Descida', hint: 'Começa de cima e desce até a altura dos olhos' },
  { key: 'tiltShowcase', label: 'Inclinação dramática', hint: 'Passa de baixo para cima, bem perto' },
  { key: 'websiteScroll', label: 'Rolagem de site', hint: 'Desce por um print longo (sites)' },
  { key: 'floatHero', label: 'Flutuação', hint: 'Câmera parada, aparelho flutuando' },
];
