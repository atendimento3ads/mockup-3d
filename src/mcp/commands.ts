import type { Engine } from '../engine/Engine';
import type { ScreenImage } from '../engine/textures';
import { loadVideo } from '../engine/media';
import {
  ANIM_PRESETS,
  applyPatch,
  ASPECTS,
  BACKDROPS,
  CAMERA_PRESETS,
  DEVICES,
  DOF_PRESETS,
  EASE_OPTIONS,
  FINISHES,
  LIGHT_PRESETS,
  LOOKS,
  MOTIONS,
  sceneSpan,
  type AnimPresetKey,
  type AspectKey,
  type BackdropKind,
  type CameraPresetKey,
  type DeviceKind,
  type Keyframe,
  type SceneClip,
  type SceneState,
  type VideoClip,
} from '../state';
import { patchScene, scaleTimeline, setSceneKeys } from '../scenes';
import type { BlobResult, Handlers } from './bridge';

// Comandos que o MCP pode executar no editor. Cada um altera o mesmo estado da interface
// (o que o Claude muda aparece nos painéis) e devolve um resumo do resultado.

export interface CommandContext {
  engine: () => Engine | null;
  getState: () => SceneState;
  commit: (next: SceneState) => void;
  hasScreenImage: () => boolean;
  hasBackdropImage: () => boolean;
  setScreenImage: (img: ScreenImage | null, name: string | null) => void;
  // Biblioteca de mídias das cenas.
  addMedia: (img: ScreenImage, name: string | null) => string;
  mediaName: (id: string) => string | null;
  setBackdropImage: (img: ScreenImage | null, name: string | null) => void;
  setCameraPresetUI: (key: CameraPresetKey) => void;
}

type Args = Record<string, unknown>;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);

// Só aceita as chaves conhecidas de uma seção e descarta o que vier indefinido.
function pick<T extends object>(base: T, args: Args): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(base) as (keyof T)[]) {
    const v = args[k as string];
    if (v === undefined || v === null) continue;
    if (typeof v !== typeof base[k]) throw new Error(`Valor inválido para "${String(k)}": esperado ${typeof base[k]}`);
    out[k] = v as T[keyof T];
  }
  return out;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`${label} inválido: "${String(value)}". Opções: ${allowed.join(', ')}`);
  return value as T;
}

async function decodeImage(base64: string, mime: string): Promise<ScreenImage> {
  const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bin], { type: mime }));
  return { src: bmp, w: bmp.width, h: bmp.height };
}

async function toJpeg(blob: Blob, quality = 0.9): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  return c.convertToBlob({ type: 'image/jpeg', quality });
}

// Valores de aparelho validados (troca de tipo sem acabamento usa o primeiro acabamento do tipo).
function deviceValues(base: SceneState['device'], a: Args): Partial<SceneState['device']> {
  const kind = oneOf<DeviceKind>(a.kind, DEVICES.map((d) => d.kind), 'Aparelho');
  const values = pick(base, a);
  const target = kind ?? base.kind;
  if (kind && kind !== base.kind && values.finish === undefined) values.finish = FINISHES[kind][0].key;
  if (values.finish !== undefined) oneOf(values.finish, FINISHES[target].map((f) => f.key), 'Acabamento');
  if (values.orientation !== undefined) oneOf(values.orientation, ['portrait', 'landscape'], 'Orientação');
  return values;
}

export function createCommands(ctx: CommandContext): Handlers {
  const eng = () => {
    const e = ctx.engine();
    if (!e) throw new Error('O editor ainda está carregando');
    return e;
  };
  const state = () => ctx.getState();
  const patch = <K extends keyof SceneState>(key: K, values: Partial<SceneState[K]>) => {
    const s = state();
    ctx.commit({ ...s, [key]: { ...s[key], ...values } });
  };
  const dims = (long: number): [number, number] => {
    const a = ASPECTS[state().output.aspect];
    const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
    return a >= 1 ? [even(long), even(long / a)] : [even(long * a), even(long)];
  };
  // Cena sob a agulha (quando há cenas): set_device e set_screen editam ela.
  const activeScene = () => state().animation.scenes.find((x) => x.id === ctx.engine()?.currentScene) ?? null;
  const editDevice = (values: Partial<SceneState['device']>) => {
    const sc = activeScene();
    if (sc) ctx.commit(patchScene(state(), sc.id, { device: { ...sc.device, ...values } }));
    else patch('device', values);
    return activeScene()?.device ?? state().device;
  };
  const editScreen = (values: Partial<SceneState['screen']>) => {
    const sc = activeScene();
    if (sc) ctx.commit(patchScene(state(), sc.id, { screen: { ...sc.screen, ...values } }));
    else patch('screen', values);
    return activeScene()?.screen ?? state().screen;
  };
  const playFromStart = (play: boolean) => {
    const e = eng();
    e.seek(0);
    if (play) e.play();
  };

  const summary = () => {
    const s = state();
    const e = ctx.engine();
    const sc = activeScene();
    return {
      device: sc?.device ?? s.device,
      screen: { ...(sc?.screen ?? s.screen), hasImage: ctx.hasScreenImage(), videoSeconds: e?.videoDuration ? Math.round(e.videoDuration * 100) / 100 : null },
      scene: { ...s.scene, hasPhoto: ctx.hasBackdropImage() },
      background: s.background,
      lighting: s.lighting,
      effects: s.effects,
      camera: { ...s.camera, ...(e?.getCameraInfo() ?? {}) },
      output: s.output,
      animation: {
        duration: s.animation.duration,
        fps: s.animation.fps,
        ease: s.animation.ease,
        float: s.animation.float,
        floatAmount: s.animation.floatAmount,
        keyframes: s.animation.keyframes.map((k) => (k.cut ? `${k.t} (corte)` : k.t)),
        clips: s.animation.clips ?? [],
        scenes: s.animation.scenes.map((x, i) => ({
          scene: i + 1,
          start: x.t,
          device: `${x.device.kind} ${x.device.finish}`,
          media: x.media ? ctx.mediaName(x.media) : null,
          keyframes: s.animation.keyframes.filter((k) => k.scene === x.id).length,
          active: x.id === sc?.id,
        })),
        playing: e?.playing ?? false,
        time: Math.round((e?.time ?? 0) * 100) / 100,
      },
    };
  };

  return {
    get_state: () => summary(),

    list_options: () => ({
      devices: DEVICES.map((d) => ({ kind: d.kind, label: d.label, finishes: FINISHES[d.kind].map((f) => ({ key: f.key, label: f.label })) })),
      looks: LOOKS.map((l) => ({ key: l.key, label: l.label })),
      backdrops: BACKDROPS.map((b) => ({ key: b.key, label: b.label })),
      lightPresets: LIGHT_PRESETS,
      dofLevels: DOF_PRESETS.map((d) => ({ key: d.key, label: d.label })),
      animationPresets: ANIM_PRESETS,
      cameraPresets: Object.entries(CAMERA_PRESETS).map(([key, v]) => ({ key, label: v.label, azimuth: v.az, elevation: v.el })),
      motions: MOTIONS,
      aspects: Object.keys(ASPECTS),
      eases: EASE_OPTIONS,
      toneModes: ['soft', 'linear', 'neutral', 'agx'],
      backgroundModes: ['solid', 'linear', 'radial', 'transparent'],
    }),

    set_device: (a) => editDevice(deviceValues(activeScene()?.device ?? state().device, a)),

    set_screen_image: async (a) => {
      const base64 = str(a.base64);
      if (!base64) throw new Error('Imagem ausente');
      const img = await decodeImage(base64, str(a.mime) ?? 'image/png');
      ctx.setScreenImage(img, str(a.name) ?? 'imagem do Claude');
      patch('screen', { scroll: 0 });
      return { width: img.w, height: img.h };
    },

    // Gravação de tela: a página baixa o arquivo liberado pelo MCP (token) e toca na tela do aparelho.
    set_screen_video: async (a) => {
      const token = str(a.token);
      if (!token) throw new Error('Token do vídeo ausente');
      const res = await fetch(`/__mcp/file?token=${encodeURIComponent(token)}`, { headers: { 'X-Mockup-MCP': '1' } });
      if (!res.ok) throw new Error('Não consegui baixar o vídeo da ponte local');
      const img = await loadVideo(URL.createObjectURL(await res.blob()));
      ctx.setScreenImage(img, str(a.name) ?? 'vídeo do Claude');
      const duration = img.video!.duration;
      const s = state();
      if (!s.animation.keyframes.length) ctx.commit({ ...s, animation: { ...s.animation, duration: Math.min(Math.round(duration * 10) / 10, 60), clips: [] } });
      return { width: img.w, height: img.h, duration: Math.round(duration * 100) / 100 };
    },

    // Planos com corte seco entre eles. Cada plano usa o movimento de um preset (esticado para a
    // duração pedida) e pode mostrar um trecho diferente do vídeo da tela (videoStart).
    set_shots: (a) => {
      const shots = Array.isArray(a.shots) ? (a.shots as Args[]) : [];
      if (!shots.length) throw new Error('Informe pelo menos um plano');
      const e = eng();
      e.pause();
      const round = (v: number) => Math.round(v * 1000) / 1000;
      const keys: Keyframe[] = [];
      const clips: VideoClip[] = [];
      let effects: Partial<SceneState['effects']> | undefined;
      let float = false;
      let t = 0;
      shots.forEach((shot, i) => {
        const key = oneOf<AnimPresetKey>(shot.preset, ANIM_PRESETS.map((p) => p.key), `Preset do plano ${i + 1}`);
        if (!key) throw new Error(`Plano ${i + 1}: informe o preset`);
        const dur = Math.min(Math.max(num(shot.duration) ?? 4, 0.5), 60);
        const p = e.buildPreset(key);
        if (!p) throw new Error('Não foi possível montar o plano');
        effects ??= p.effects;
        float = float || p.float;
        let ks = p.keyframes;
        if (ks.length < 2) {
          const k = e.captureKeyframe(0);
          ks = [k, { ...k, id: crypto.randomUUID(), t: p.duration }];
        }
        const scale = dur / p.duration;
        ks.forEach((k, j) => keys.push({ ...k, id: crypto.randomUUID(), t: round(t + k.t * scale), cut: i > 0 && j === 0 ? true : undefined }));
        const vs = num(shot.videoStart);
        if (vs !== undefined) clips.push({ t: round(t), src: Math.max(vs, 0) });
        t += dur;
      });
      const level = str(a.dofLevel);
      const dofPreset = level ? DOF_PRESETS.find((d) => d.key === level) : undefined;
      if (level && !dofPreset) throw new Error(`Nível de desfoque inválido: ${level}`);
      const ease = oneOf(a.ease, EASE_OPTIONS.map((x) => x.value), 'Ritmo') ?? 'linear';
      const s = state();
      ctx.commit({
        ...s,
        effects: { ...s.effects, ...(dofPreset ? { dof: dofPreset.dof, bokeh: dofPreset.bokeh, focusRange: dofPreset.focusRange } : (effects ?? {})) },
        animation: { ...s.animation, keyframes: keys, clips, duration: round(t), ease, float, scenes: [] },
      });
      playFromStart(bool(a.play) ?? true);
      return { shots: shots.length, duration: round(t), cuts: shots.length - 1, keyframes: keys.length };
    },

    clear_screen_image: () => {
      ctx.setScreenImage(null, null);
      return { ok: true };
    },

    set_screen: (a) => {
      const values = pick(state().screen, a);
      if (values.fit !== undefined) oneOf(values.fit, ['cover', 'contain'], 'Ajuste');
      return editScreen(values);
    },

    // Guarda uma imagem (base64) ou um vídeo (token da ponte) na biblioteca, para usar em cenas.
    add_media: async (a) => {
      const token = str(a.token);
      let img: ScreenImage;
      if (token) {
        const res = await fetch(`/__mcp/file?token=${encodeURIComponent(token)}`, { headers: { 'X-Mockup-MCP': '1' } });
        if (!res.ok) throw new Error('Não consegui baixar o vídeo da ponte local');
        img = await loadVideo(URL.createObjectURL(await res.blob()));
      } else {
        const base64 = str(a.base64);
        if (!base64) throw new Error('Mídia ausente');
        img = await decodeImage(base64, str(a.mime) ?? 'image/png');
      }
      const id = ctx.addMedia(img, str(a.name) ?? 'mídia do Claude');
      return { id, width: img.w, height: img.h, duration: img.video ? Math.round(img.video.duration * 100) / 100 : undefined };
    },

    // Linha do tempo com cenas: cada uma com aparelho, mídia (id de add_media) e movimento próprios.
    // O movimento vem de quadros por ângulo (t relativo à cena, azimuth/elevation/zoom/scroll) ou de um preset.
    set_scenes: (a) => {
      const list = Array.isArray(a.scenes) ? (a.scenes as Args[]) : [];
      if (!list.length) throw new Error('Informe pelo menos uma cena');
      const e = eng();
      e.pause();
      const round = (v: number) => Math.round(v * 1000) / 1000;
      const s0 = state();
      let t = 0;
      const scenes: SceneClip[] = list.map((sc, i) => {
        const device = { ...s0.device, ...deviceValues(s0.device, (sc.device as Args) ?? {}) };
        const screenArgs = (sc.screen as Args) ?? {};
        const screen = { ...s0.screen, scroll: 0, ...pick(s0.screen, screenArgs) };
        if (screen.fit !== 'cover' && screen.fit !== 'contain') throw new Error(`Cena ${i + 1}: ajuste inválido`);
        const clip: SceneClip = { id: crypto.randomUUID(), t: round(t), device, screen, media: str(sc.media) ?? null, videoStart: num(sc.videoStart) };
        t += Math.min(Math.max(num(sc.duration) ?? 5, 0.5), 60);
        return clip;
      });
      const duration = round(t);
      ctx.commit({ ...s0, animation: { ...s0.animation, scenes, keyframes: [], clips: [], duration } });
      const keys: Keyframe[] = [];
      list.forEach((sc, i) => {
        const clip = scenes[i];
        const [t0, t1] = sceneSpan(scenes, clip.id, duration);
        e.seek(t0);
        const spec = Array.isArray(sc.keyframes) ? (sc.keyframes as Args[]) : [];
        if (spec.length) {
          for (const k of spec) {
            const kt = round(t0 + Math.min(Math.max(num(k.t) ?? 0, 0), t1 - t0));
            keys.push(e.orbitKeyframe(kt, num(k.azimuth) ?? CAMERA_PRESETS.hero.az, num(k.elevation) ?? CAMERA_PRESETS.hero.el, num(k.zoom) ?? 1, num(k.scroll) ?? clip.screen.scroll));
          }
          return;
        }
        const key = oneOf<AnimPresetKey>(sc.preset, ANIM_PRESETS.map((p) => p.key), `Preset da cena ${i + 1}`);
        if (!key) return;
        const p = e.buildPreset(key);
        if (!p) return;
        const ks = p.keyframes.length >= 2 ? p.keyframes : [e.captureKeyframe(0), e.captureKeyframe(p.duration)];
        const scale = (t1 - t0) / p.duration;
        ks.forEach((k) => keys.push({ ...k, id: crypto.randomUUID(), scene: clip.id, t: round(t0 + k.t * scale) }));
      });
      ctx.commit({ ...state(), animation: { ...state().animation, keyframes: keys } });
      playFromStart(bool(a.play) ?? false);
      return summary().animation;
    },

    set_backdrop_image: async (a) => {
      const base64 = str(a.base64);
      if (!base64) throw new Error('Imagem ausente');
      const img = await decodeImage(base64, str(a.mime) ?? 'image/jpeg');
      ctx.setBackdropImage(img, str(a.name) ?? 'foto do Claude');
      patch('scene', { backdrop: 'photo' });
      return { width: img.w, height: img.h };
    },

    set_scene: (a) => {
      const backdrop = oneOf<BackdropKind>(a.backdrop, BACKDROPS.map((b) => b.key), 'Cenário');
      if (backdrop === 'photo' && !ctx.hasBackdropImage()) throw new Error('Envie uma foto primeiro (photoPath)');
      patch('scene', { ...pick(state().scene, a), ...(backdrop ? { backdrop } : {}) });
      return state().scene;
    },

    set_background: (a) => {
      const values = pick(state().background, a);
      if (values.mode !== undefined) oneOf(values.mode, ['solid', 'linear', 'radial', 'transparent'], 'Modo de fundo');
      patch('background', values);
      return state().background;
    },

    set_lighting: (a) => {
      const values = pick(state().lighting, a);
      if (values.preset !== undefined) oneOf(values.preset, LIGHT_PRESETS.map((l) => l.key), 'Luz');
      if (values.tone !== undefined) oneOf(values.tone, ['soft', 'linear', 'neutral', 'agx'], 'Tons');
      patch('lighting', values);
      return state().lighting;
    },

    set_effects: (a) => {
      const level = str(a.dofLevel);
      const preset = level ? DOF_PRESETS.find((d) => d.key === level) : undefined;
      if (level && !preset) throw new Error(`Nível de desfoque inválido: ${level}. Opções: ${DOF_PRESETS.map((d) => d.key).join(', ')}`);
      const values = pick(state().effects, a);
      patch('effects', { ...(preset ? { dof: preset.dof, bokeh: preset.bokeh, focusRange: preset.focusRange } : {}), ...values });
      return state().effects;
    },

    apply_look: (a) => {
      const look = LOOKS.find((l) => l.key === a.look);
      if (!look) throw new Error(`Look inválido. Opções: ${LOOKS.map((l) => l.key).join(', ')}`);
      ctx.commit(applyPatch(state(), look.patch));
      return { look: look.label };
    },

    set_output: (a) => {
      const aspect = oneOf<AspectKey>(a.aspect, Object.keys(ASPECTS) as AspectKey[], 'Proporção');
      if (aspect) patch('output', { aspect });
      return state().output;
    },

    set_camera: (a) => {
      const e = eng();
      e.pause();
      const fov = num(a.fov);
      if (fov !== undefined) patch('camera', { fov: Math.min(Math.max(fov, 10), 70) });
      const animate = bool(a.animate) ?? true;
      const preset = oneOf<CameraPresetKey>(a.preset, Object.keys(CAMERA_PRESETS) as CameraPresetKey[], 'Ângulo');
      if (preset) {
        e.setCameraPreset(preset, animate);
        ctx.setCameraPresetUI(preset);
      } else if (num(a.azimuth) !== undefined || num(a.elevation) !== undefined || num(a.zoom) !== undefined) {
        const cur = e.getCameraInfo();
        e.setCameraOrbit(num(a.azimuth) ?? cur.azimuth, num(a.elevation) ?? cur.elevation, num(a.zoom) ?? 1, animate);
      }
      return e.getCameraInfo();
    },

    set_focus: (a) => {
      const e = eng();
      if (bool(a.center)) e.resetFocus();
      else {
        const x = num(a.x);
        const y = num(a.y);
        if (x === undefined || y === undefined) throw new Error('Informe x e y (0 a 1) ou center: true');
        e.setFocusScreen(Math.min(Math.max(x, 0), 1), Math.min(Math.max(y, 0), 1));
      }
      if (!state().effects.dof) patch('effects', { dof: true });
      return { ok: true };
    },

    apply_animation_preset: (a) => {
      const key = oneOf<AnimPresetKey>(a.preset, ANIM_PRESETS.map((p) => p.key), 'Preset de animação');
      if (!key) throw new Error('Informe o preset');
      const e = eng();
      e.pause();
      const p = e.buildPreset(key);
      if (!p) throw new Error('Não foi possível montar o preset');
      const s = state();
      const sc = activeScene();
      if (sc) {
        // Numa cena: o movimento estica para a duração dela e a luz/desfoque ficam como estão.
        const ks = p.keyframes.length >= 2 ? p.keyframes : [e.captureKeyframe(0), e.captureKeyframe(p.duration)];
        ctx.commit(setSceneKeys(s, sc.id, ks, p.duration));
        e.seek(sc.t);
        if (bool(a.play) ?? true) e.play();
        return { preset: key, scene: s.animation.scenes.indexOf(sc) + 1, keyframes: ks.length };
      }
      ctx.commit({
        ...s,
        effects: { ...s.effects, ...(p.effects ?? {}) },
        animation: { ...s.animation, keyframes: p.keyframes, duration: p.duration, ease: p.ease, float: p.float, floatAmount: p.floatAmount ?? s.animation.floatAmount, clips: [] },
      });
      playFromStart(bool(a.play) ?? true);
      return { preset: key, duration: p.duration, keyframes: p.keyframes.length };
    },

    set_focus_areas: (a) => {
      const areas = Array.isArray(a.areas) ? (a.areas as Args[]) : [];
      if (!areas.length) throw new Error('Informe pelo menos uma área');
      if (state().animation.scenes.length) throw new Error('Com cenas, use as áreas de foco pela interface (elas valem para a cena ativa)');
      const travel = num(a.travel) ?? 1.4;
      const hold = num(a.hold) ?? 1;
      const e = eng();
      e.pause();
      const round = (t: number) => Math.round(t * 100) / 100;
      const start = e.captureKeyframe(0);
      const keys: Keyframe[] = [start];
      let t = 0;
      for (const r of areas) {
        const [x0, y0, x1, y1] = [num(r.x0), num(r.y0), num(r.x1), num(r.y1)];
        if ([x0, y0, x1, y1].some((v) => v === undefined)) throw new Error('Cada área precisa de x0, y0, x1, y1 (0 a 1)');
        t = round(t + travel);
        const k = e.keyframeForRegion(Math.min(x0!, x1!), Math.min(y0!, y1!), Math.max(x0!, x1!), Math.max(y0!, y1!), t);
        if (!k) continue;
        keys.push(k);
        if (hold > 0) {
          t = round(t + hold);
          keys.push({ ...k, id: crypto.randomUUID(), t });
        }
      }
      t = round(t + travel);
      keys.push({ ...start, id: crypto.randomUUID(), t });
      const s = state();
      ctx.commit({ ...s, animation: { ...s.animation, keyframes: keys, duration: t, clips: [] } });
      playFromStart(bool(a.play) ?? true);
      return { keyframes: keys.length, duration: t };
    },

    set_animation: (a) => {
      const s = state();
      const values = pick({ duration: 0, fps: 0, ease: '', float: false, floatAmount: 0 }, a) as Partial<SceneState['animation']>;
      if (values.ease !== undefined) oneOf(values.ease, EASE_OPTIONS.map((x) => x.value), 'Ritmo');
      if (values.fps !== undefined && values.fps !== 30 && values.fps !== 60) throw new Error('fps deve ser 30 ou 60');
      const next = { ...s.animation, ...values };
      if (bool(a.clearKeyframes)) next.keyframes = [];
      if (values.duration !== undefined && values.duration !== s.animation.duration) {
        Object.assign(next, scaleTimeline({ ...s.animation, keyframes: next.keyframes }, values.duration));
      }
      ctx.commit({ ...s, animation: next });
      return summary().animation;
    },

    add_keyframe: (a) => {
      const e = eng();
      e.pause();
      const s = state();
      const t = Math.min(Math.max(num(a.t) ?? e.time, 0), s.animation.duration);
      const k = e.captureKeyframe(Math.round(t * 100) / 100);
      const near = s.animation.keyframes.find((x) => Math.abs(x.t - k.t) < 0.05);
      const keyframes = near ? s.animation.keyframes.map((x) => (x.id === near.id ? { ...k, id: near.id } : x)) : [...s.animation.keyframes, k];
      ctx.commit({ ...s, animation: { ...s.animation, keyframes } });
      return { t: k.t, keyframes: keyframes.map((x) => x.t).sort((p, q) => p - q) };
    },

    playback: (a) => {
      const e = eng();
      const action = oneOf(a.action, ['play', 'pause', 'seek'] as const, 'Ação');
      if (action === 'play') {
        if (!e.canAnimate()) throw new Error('Crie pelo menos 2 quadros-chave, um preset ou ligue a flutuação');
        e.play();
      }
      if (action === 'pause') e.pause();
      if (action === 'seek') e.seek(num(a.t) ?? 0);
      return { playing: e.playing, time: e.time };
    },

    render_image: async (a): Promise<BlobResult> => {
      const e = eng();
      const t = num(a.t);
      if (t !== undefined) {
        e.pause();
        e.seek(t);
      }
      await e.settleVideo();
      const [w, h] = dims(Math.min(Math.max(num(a.long) ?? 1280, 256), 5120));
      let blob = await e.exportImage(w, h);
      if (a.format === 'jpeg') blob = await toJpeg(blob);
      return { blob, data: { width: w, height: h } };
    },

    export_video: async (a): Promise<BlobResult> => {
      const e = eng();
      if (!e.canAnimate()) throw new Error('Não há animação: aplique um preset, crie quadros-chave ou ligue a flutuação');
      const fps = num(a.fps) ?? state().animation.fps;
      const [w, h] = dims(Math.min(Math.max(num(a.long) ?? 1920, 320), 3840));
      const blob = await e.exportVideo({ width: w, height: h, fps });
      return { blob, data: { width: w, height: h, fps, duration: state().animation.duration } };
    },
  };
}
