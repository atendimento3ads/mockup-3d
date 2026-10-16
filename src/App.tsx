import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { Engine, type Tool } from './engine/Engine';
import type { ScreenImage } from './engine/textures';
import { connectBridge } from './mcp/bridge';
import { loadVideo } from './engine/media';
import { createCommands } from './mcp/commands';
import {
  applyPatch,
  ASPECTS,
  CAMERA_PRESETS,
  DEFAULT_STATE,
  ANIM_PRESETS,
  BACKDROPS,
  DEVICES,
  DOF_PRESETS,
  FINISHES,
  LIGHT_PRESETS,
  LOOKS,
  type AspectKey,
  type BgMode,
  type CameraPresetKey,
  type DeviceKind,
  type Keyframe,
  type AnimPresetKey,
  type MotionKind,
  type SceneState,
  type ToneMode,
} from './state';
import { addScene, moveScene, patchScene, removeScene, resizeScene, sceneLength, setSceneKeys } from './scenes';
import { Card, ColorRow, Dropdown, Field, Note, Section, Seg, SelectRow, TextRow, ToggleRow } from './ui/controls';
import { Timeline } from './ui/Timeline';
import { FocusAreas, type Area } from './ui/FocusAreas';
import { CanvasTools } from './ui/CanvasTools';
import { useHistory } from './ui/useHistory';

const EXPORT_SIZES = [
  { value: 1920, label: 'Full HD' },
  { value: 2560, label: '2K' },
  { value: 3840, label: '4K' },
];

const ASPECT_NAMES: Record<AspectKey, string> = {
  '16:9': 'Paisagem · YouTube, sites',
  '4:3': 'Apresentações',
  '1:1': 'Quadrado · feed',
  '4:5': 'Retrato · feed',
  '9:16': 'Vertical · Reels, Stories',
};

interface MediaInfo {
  name: string;
  kind: 'image' | 'video';
  w: number;
  h: number;
  duration?: number;
}

function Chev() {
  return (
    <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden>
      <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Retângulo na proporção escolhida (ícone do menu de proporção).
function AspectIcon({ a }: { a: number }) {
  const w = a >= 1 ? 14 : 14 * a;
  const h = a >= 1 ? 14 / a : 14;
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <rect x={8 - w / 2} y={8 - h / 2} width={w} height={h} rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function readTheme(): 'light' | 'dark' {
  try {
    return localStorage.getItem('mockup3d.theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
const KEYS = { undo: IS_MAC ? '⌘Z' : 'Ctrl+Z', redo: IS_MAC ? '⇧⌘Z' : 'Ctrl+Y', paste: IS_MAC ? '⌘V' : 'Ctrl+V' };
const signedPct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;

const describe = (img: ScreenImage | null, name: string | null): MediaInfo | null =>
  img ? { name: name ?? 'mídia', kind: img.video ? 'video' : 'image', w: img.w, h: img.h, duration: img.video?.duration } : null;

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
const deg = (v: number) => `${Math.round(v)}°`;

function DeviceIcon({ kind }: { kind: DeviceKind }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'iphone':
      return (
        <svg viewBox="0 0 24 24" width="22" height="22">
          <rect x="7" y="2.5" width="10" height="19" rx="2.6" {...common} />
          <rect x="10.2" y="4.6" width="3.6" height="1.2" rx="0.6" fill="currentColor" />
        </svg>
      );
    case 'ipad':
      return (
        <svg viewBox="0 0 24 24" width="22" height="22">
          <rect x="4.5" y="2.5" width="15" height="19" rx="2" {...common} />
        </svg>
      );
    case 'macbook':
      return (
        <svg viewBox="0 0 24 24" width="22" height="22">
          <rect x="4.5" y="5" width="15" height="10.5" rx="1.2" {...common} />
          <path d="M2.5 18.5h19l-1.2-2.6H3.7z" {...common} />
        </svg>
      );
    case 'imac':
      return (
        <svg viewBox="0 0 24 24" width="22" height="22">
          <rect x="2.5" y="3.5" width="19" height="13" rx="1.6" {...common} />
          <path d="M2.5 13.5h19M10 16.5l-.8 4h5.6l-.8-4" {...common} />
        </svg>
      );
    case 'browser':
      return (
        <svg viewBox="0 0 24 24" width="22" height="22">
          <rect x="3" y="4.5" width="18" height="15" rx="2" {...common} />
          <path d="M3 8.5h18" {...common} />
          <circle cx="5.8" cy="6.5" r="0.7" fill="currentColor" />
          <circle cx="8" cy="6.5" r="0.7" fill="currentColor" />
        </svg>
      );
  }
}

export default function App() {
  const [state, setState] = useState<SceneState>(DEFAULT_STATE);
  const [frame, setFrame] = useState({ w: 800, h: 450 });
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(readTheme);
  const [toast, setToast] = useState<string | null>(null);
  const [exportSize, setExportSize] = useState(2560);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preset, setPreset] = useState<CameraPresetKey>('hero');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [areasPreview, setAreasPreview] = useState<{ url: string; aspect: number } | null>(null);
  const [video, setVideo] = useState<{ progress: number; abort: AbortController } | null>(null);
  const [activeScene, setActiveScene] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('orbit');
  const toolRef = useRef<Tool>('orbit');
  const engineRef = useRef<Engine | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const timeListeners = useRef(new Set<(t: number, playing: boolean) => void>());
  // Guardados fora do motor: se ele for recriado (recarga do código), a cena volta igual.
  const stateRef = useRef(state);
  stateRef.current = state;
  const imageRef = useRef<ScreenImage | null>(null);
  const backdropImageRef = useRef<ScreenImage | null>(null);
  const backdropFileRef = useRef<HTMLInputElement>(null);
  const [backdropName, setBackdropName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef(0);
  // Biblioteca de mídias: as cenas guardam só o id. A mídia sem cenas também entra aqui.
  const library = useRef(new Map<string, { img: ScreenImage; info: MediaInfo }>());
  const mainMediaRef = useRef<string | null>(null);

  const commit = useCallback((next: SceneState) => {
    stateRef.current = next;
    engineRef.current?.setState(next);
    setState(next);
  }, []);

  const history = useHistory(state, commit);

  const addMedia = useCallback((img: ScreenImage, name: string | null) => {
    const id = crypto.randomUUID();
    library.current.set(id, { img, info: describe(img, name)! });
    return id;
  }, []);

  // Coloca a mídia na cena sob a agulha (ou na tela, se não houver cenas).
  const placeMedia = useCallback(
    (img: ScreenImage | null, name: string | null) => {
      const s = stateRef.current;
      const scene = s.animation.scenes.find((x) => x.id === engineRef.current?.currentScene);
      const id = img ? addMedia(img, name) : null;
      if (scene) {
        commit(patchScene(s, scene.id, { media: id, screen: { ...scene.screen, scroll: 0 } }));
        return;
      }
      mainMediaRef.current = id;
      imageRef.current = img;
      engineRef.current?.setImage(img);
      setMedia(describe(img, name));
    },
    [addMedia, commit],
  );

  // Tema claro (padrão) ou escuro, lembrado entre sessões.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('mockup3d.theme', theme);
    } catch {
      /* sem armazenamento */
    }
  }, [theme]);
  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => {
    const engine = new Engine(hostRef.current!, stateRef.current);
    engineRef.current = engine;
    if (imageRef.current) engine.setImage(imageRef.current);
    if (backdropImageRef.current) engine.setBackdropImage(backdropImageRef.current);
    engine.mediaSource = (id) => library.current.get(id)?.img ?? null;
    engine.onScene = (id) => setActiveScene(id);
    engine.refreshMedia();
    setActiveScene(engine.currentScene);
    engine.setTool(toolRef.current);
    engine.onControlsStart = () => {
      if (spaceRef.current.held) spaceRef.current.used = true;
    };
    engine.onFocus = () => flash('Foco ajustado nesse ponto');
    engine.onTime = (t, playing) => timeListeners.current.forEach((fn) => fn(t, playing));
    if (import.meta.env.DEV) (window as unknown as { __engine: Engine }).__engine = engine;
    return () => engine.dispose();
  }, [flash]);

  useEffect(() => {
    // Só o estado mais recente vai para o motor: um efeito atrasado de um render antigo (o MCP aplica
    // mudanças direto no motor, antes do React) desfaria a mudança por alguns instantes.
    if (state !== stateRef.current) return;
    engineRef.current?.setState(state);
  }, [state]);

  // Ponte MCP: comandos do Claude alteram o mesmo estado dos painéis.
  useEffect(() => {
    const commands = createCommands({
      engine: () => engineRef.current,
      getState: () => stateRef.current,
      commit,
      hasScreenImage: () => {
        const scene = stateRef.current.animation.scenes.find((x) => x.id === engineRef.current?.currentScene);
        return scene ? !!scene.media : !!imageRef.current;
      },
      hasBackdropImage: () => !!backdropImageRef.current,
      setScreenImage: placeMedia,
      addMedia,
      mediaName: (id) => library.current.get(id)?.info.name ?? null,
      setBackdropImage: (img, name) => {
        backdropImageRef.current = img;
        engineRef.current?.setBackdropImage(img);
        setBackdropName(name);
      },
      setCameraPresetUI: (key) => setPreset(key),
    });
    return connectBridge(() => commands);
  }, [commit, placeMedia, addMedia]);

  // Encaixa o quadro na proporção escolhida dentro da área central.
  useEffect(() => {
    const el = viewRef.current!;
    const fit = () => {
      const W = el.clientWidth - 56;
      const H = el.clientHeight - 56;
      const a = ASPECTS[state.output.aspect];
      let w = W;
      let h = W / a;
      if (h > H) {
        h = H;
        w = H * a;
      }
      setFrame({ w: Math.max(2, Math.floor(w)), h: Math.max(2, Math.floor(h)) });
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [state.output.aspect]);

  useEffect(() => {
    engineRef.current?.resize(frame.w, frame.h);
  }, [frame]);

  const set = useCallback(<K extends keyof SceneState>(k: K, patch: Partial<SceneState[K]>) => {
    setState((s) => ({ ...s, [k]: { ...s[k], ...patch } }));
  }, []);

  const loadFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return;
      if (file.type.startsWith('video/')) {
        try {
          const vid = await loadVideo(URL.createObjectURL(file));
          placeMedia(vid, file.name);
          // Sem animação ainda: a linha do tempo passa a ter a duração do vídeo.
          setState((s) => (s.animation.keyframes.length || s.animation.scenes.length ? s : { ...s, animation: { ...s.animation, duration: Math.min(Math.round(vid.video!.duration * 10) / 10, 60), clips: [] } }));
          flash('Vídeo na tela: use ▶ na linha do tempo');
        } catch (err) {
          flash(err instanceof Error ? err.message : 'Não consegui abrir esse vídeo');
        }
        return;
      }
      if (!file.type.startsWith('image/')) {
        flash('Envie uma imagem (PNG, JPG, WebP) ou um vídeo (MP4)');
        return;
      }
      try {
        const bmp = await createImageBitmap(file);
        const img = { src: bmp, w: bmp.width, h: bmp.height };
        const inScene = stateRef.current.animation.scenes.length > 0;
        placeMedia(img, file.name || 'imagem colada');
        if (!inScene) set('screen', { scroll: 0 });
      } catch {
        flash('Não consegui abrir essa imagem');
      }
    },
    [flash, set, placeMedia],
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
      if (file) loadFile(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [loadFile]);

  // Atalhos de teclado, como nos editores de design e de vídeo. As ações chegam por ref (sempre a versão atual).
  const keyActions = useRef<{
    undo: () => boolean;
    redo: () => boolean;
    chooseTool: (t: Tool) => void;
    deleteSelected: () => boolean;
    deselect: () => void;
    flash: (msg: string) => void;
    duration: number;
    fps: number;
  }>({ undo: () => false, redo: () => false, chooseTool: () => undefined, deleteSelected: () => false, deselect: () => undefined, flash: () => undefined, duration: 6, fps: 30 });
  const spaceRef = useRef({ held: false, used: false });
  useEffect(() => {
    const typing = (el: HTMLElement) => !!el.closest('input, select, textarea, [contenteditable="true"]');
    const onDown = (e: KeyboardEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : document.body;
      const k = keyActions.current;
      const en = engineRef.current;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.code === 'KeyZ' || e.code === 'KeyY')) {
        if (typing(el)) return;
        e.preventDefault();
        const redo = e.code === 'KeyY' || e.shiftKey;
        if (redo ? k.redo() : k.undo()) k.flash(redo ? 'Refeito' : 'Desfeito');
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(el) || !en) return;
      switch (e.code) {
        case 'Space': {
          // Toque rápido toca ou pausa; segurar e arrastar no canvas usa a mãozinha.
          if (el.closest('[role="slider"], button')) return;
          e.preventDefault();
          const sp = spaceRef.current;
          if (e.repeat || sp.held) return;
          sp.held = true;
          sp.used = false;
          if (!en.playing) en.setTool('hand');
          return;
        }
        case 'KeyH':
          k.chooseTool('hand');
          return;
        case 'KeyV':
          k.chooseTool('orbit');
          return;
        case 'KeyF':
          en.frame();
          return;
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (el.closest('[role="slider"]')) return;
          e.preventDefault();
          const dt = (e.shiftKey ? 1 : 1 / k.fps) * (e.code === 'ArrowLeft' ? -1 : 1);
          en.pause();
          en.seek(Math.min(Math.max(en.time + dt, 0), k.duration));
          return;
        }
        case 'Home':
        case 'End':
          e.preventDefault();
          en.pause();
          en.seek(e.code === 'Home' ? 0 : k.duration);
          return;
        case 'Delete':
        case 'Backspace':
          if (k.deleteSelected()) e.preventDefault();
          return;
        case 'Escape':
          k.deselect();
          return;
      }
    };
    const releaseSpace = (toggle: boolean) => {
      const sp = spaceRef.current;
      if (!sp.held) return;
      sp.held = false;
      const en = engineRef.current;
      if (!en) return;
      en.setTool(toolRef.current);
      if (toggle && !sp.used) {
        if (en.playing) en.pause();
        else en.play();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') releaseSpace(true);
    };
    const onBlur = () => releaseSpace(false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    loadFile(e.dataTransfer.files[0]);
  };

  const clearImage = () => placeMedia(null, null);

  const choosePreset = (key: CameraPresetKey) => {
    setPreset(key);
    engineRef.current?.setCameraPreset(key);
  };

  // ---------- Cenas ----------
  const scenes = state.animation.scenes;
  const scene = scenes.find((x) => x.id === activeScene) ?? null;
  const sceneIndex = scene ? scenes.indexOf(scene) : -1;

  // Aparelho e tela: os da cena sob a agulha, quando há cenas.
  const setDevice = (patch: Partial<SceneState['device']>) => {
    if (!scene) return set('device', patch);
    const id = scene.id;
    setState((s) => {
      const sc = s.animation.scenes.find((x) => x.id === id);
      if (!sc) return s;
      const next = patchScene(s, id, { device: { ...sc.device, ...patch } });
      // Outro aparelho: o movimento antigo não serve; a cena reenquadra e espera um preset.
      if (patch.kind && patch.kind !== sc.device.kind && s.animation.keyframes.some((k) => k.scene === id)) {
        flash('Aparelho trocado: escolha um preset para animar esta cena');
        return { ...next, animation: { ...next.animation, keyframes: next.animation.keyframes.filter((k) => k.scene !== id) } };
      }
      return next;
    });
  };
  const setScreen = (patch: Partial<SceneState['screen']>) => {
    if (!scene) return set('screen', patch);
    const id = scene.id;
    setState((s) => {
      const sc = s.animation.scenes.find((x) => x.id === id);
      return sc ? patchScene(s, id, { screen: { ...sc.screen, ...patch } }) : s;
    });
  };

  const sceneLabel = (sc: { device: SceneState['device'] }, i: number) => `Cena ${i + 1} · ${DEVICES.find((x) => x.kind === sc.device.kind)?.label ?? ''}`;

  const newScene = () => {
    const e = engineRef.current;
    if (!e) return;
    e.pause();
    const { state: next, id } = addScene(stateRef.current, e.currentScene, mainMediaRef.current);
    commit(next);
    e.seek(next.animation.scenes.find((x) => x.id === id)!.t);
    flash('Cena nova: troque o aparelho, a mídia ou o movimento');
  };

  const selectScene = (id: string) => {
    const e = engineRef.current;
    const sc = scenes.find((x) => x.id === id);
    if (!e || !sc || id === activeScene) return;
    e.pause();
    e.seek(sc.t);
  };

  const chooseDevice = (kind: DeviceKind) => {
    if (kind === (scene?.device.kind ?? state.device.kind)) return;
    setDevice({ kind, finish: FINISHES[kind][0].key, orientation: 'portrait' });
  };

  const doExport = async () => {
    const engine = engineRef.current;
    if (!engine || busy) return;
    setBusy(true);
    try {
      const [w, h] = exportDims();
      const blob = await engine.exportImage(w, h);
      download(blob, `vidramock-${w}x${h}.png`);
      flash(`PNG exportado · ${w}×${h}`);
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Falha ao exportar');
    } finally {
      setBusy(false);
    }
  };

  // ---------- Animação ----------
  const anim = state.animation;
  const setAnim = useCallback((patch: Partial<SceneState['animation']>) => set('animation', patch), [set]);

  const subscribe = useCallback((fn: (t: number, playing: boolean) => void) => {
    timeListeners.current.add(fn);
    const e = engineRef.current;
    if (e) fn(e.time, e.playing);
    return () => {
      timeListeners.current.delete(fn);
    };
  }, []);

  const playPause = () => {
    const e = engineRef.current;
    if (!e) return;
    if (e.playing) e.pause();
    else e.play();
  };

  // Troca os quadros-chave e mostra o resultado tocando do começo.
  const applyKeys = (keyframes: Keyframe[], duration = anim.duration) => {
    setSelectedKey(null);
    setAnim({ keyframes, duration });
    // Depois do React aplicar o estado novo no motor (não depende do próximo quadro de tela).
    setTimeout(() => {
      const e = engineRef.current;
      if (!e) return;
      e.seek(0);
      e.play();
    }, 30);
  };

  const addKey = (t: number) => {
    const e = engineRef.current;
    if (!e) return;
    e.pause();
    const k = e.captureKeyframe(Math.round(t * 100) / 100);
    const near = anim.keyframes.find((x) => x.scene === k.scene && Math.abs(x.t - k.t) < 0.05);
    const keyframes = near ? anim.keyframes.map((x) => (x.id === near.id ? { ...k, id: near.id } : x)) : [...anim.keyframes, k];
    setAnim({ keyframes });
    setSelectedKey(near ? near.id : k.id);
    // Primeiro quadro no início (da animação ou da cena): leva a agulha para o fim, pronto para o próximo.
    const end = k.scene ? (scenes.find((x) => x.t > k.t + 1e-6)?.t ?? anim.duration) - 0.01 : anim.duration;
    if (!near && !anim.keyframes.some((x) => x.scene === k.scene) && k.t < end - 0.05) {
      flash('Quadro inicial salvo. Mova a câmera e adicione o quadro final.');
      setTimeout(() => engineRef.current?.seek(end), 30);
    } else {
      flash(near ? 'Quadro-chave atualizado' : 'Quadro-chave adicionado');
    }
  };

  const updateKey = (id: string) => {
    const e = engineRef.current;
    const old = anim.keyframes.find((k) => k.id === id);
    if (!e || !old) return;
    setAnim({ keyframes: anim.keyframes.map((k) => (k.id === id ? { ...e.captureKeyframe(old.t), id, scene: old.scene } : k)) });
    flash('Quadro-chave atualizado com a câmera atual');
  };

  const deleteKey = (id: string) => {
    setAnim({ keyframes: anim.keyframes.filter((k) => k.id !== id) });
    setSelectedKey(null);
  };

  const chooseTool = (t: Tool) => {
    toolRef.current = t;
    setTool(t);
    engineRef.current?.setTool(t);
  };
  const undo = () => history.undo() && (flash('Desfeito'), true);
  const redo = () => history.redo() && (flash('Refeito'), true);

  keyActions.current = {
    undo: history.undo,
    redo: history.redo,
    chooseTool,
    deleteSelected: () => {
      if (!selectedKey) return false;
      deleteKey(selectedKey);
      flash('Quadro-chave apagado');
      return true;
    },
    deselect: () => setSelectedKey(null),
    flash,
    duration: anim.duration,
    fps: anim.fps,
  };

  // Preset completo: troca câmera, desfoque, ritmo e flutuação de uma vez e já toca.
  const applyPreset = (key: AnimPresetKey) => {
    const e = engineRef.current;
    if (!e) return;
    e.pause();
    const p = e.buildPreset(key);
    if (!p) return;
    setSelectedKey(null);
    const label = ANIM_PRESETS.find((x) => x.key === key)?.label;
    if (scene) {
      // Numa cena: o movimento estica para a duração dela; luz e desfoque continuam os seus.
      const keys = p.keyframes.length >= 2 ? p.keyframes : [e.captureKeyframe(0), e.captureKeyframe(p.duration)];
      commit(setSceneKeys(stateRef.current, scene.id, keys, p.duration));
      e.seek(scene.t);
      e.play();
      flash(`${label} na cena ${sceneIndex + 1}`);
      return;
    }
    setState((s) => ({
      ...s,
      effects: { ...s.effects, ...(p.effects ?? {}) },
      animation: { ...s.animation, keyframes: p.keyframes, duration: p.duration, ease: p.ease, float: p.float, floatAmount: p.floatAmount ?? s.animation.floatAmount },
    }));
    setTimeout(() => {
      const en = engineRef.current;
      if (!en) return;
      en.seek(0);
      en.play();
    }, 30);
    flash(`Preset: ${label}`);
  };

  const loadBackdrop = async (file: File | undefined | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const bmp = await createImageBitmap(file);
      backdropImageRef.current = { src: bmp, w: bmp.width, h: bmp.height };
      engineRef.current?.setBackdropImage(backdropImageRef.current);
      setBackdropName(file.name);
      set('scene', { backdrop: 'photo' });
    } catch {
      flash('Não consegui abrir essa imagem');
    }
  };

  const applyMotion = (kind: MotionKind) => {
    const e = engineRef.current;
    if (!e) return;
    e.pause();
    if (scene) {
      const len = sceneLength(state, scene.id);
      commit(setSceneKeys(stateRef.current, scene.id, e.buildMotion(kind, len), len));
      e.seek(scene.t);
      e.play();
      return;
    }
    applyKeys(e.buildMotion(kind, anim.duration));
  };

  const openAreas = () => {
    const e = engineRef.current;
    if (!e) return;
    e.pause();
    const p = e.getScreenPreview();
    if (p) setAreasPreview(p);
  };

  const applyAreas = (areas: Area[], travel: number, hold: number) => {
    const e = engineRef.current;
    if (!e) return;
    setAreasPreview(null);
    const start = e.captureKeyframe(0);
    const keys: Keyframe[] = [start];
    let t = 0;
    for (const a of areas) {
      t = Math.round((t + travel) * 100) / 100;
      const k = e.keyframeForRegion(a.a0, a.b0, a.a1, a.b1, t);
      if (!k) continue;
      keys.push(k);
      if (hold > 0) {
        t = Math.round((t + hold) * 100) / 100;
        keys.push({ ...k, id: crypto.randomUUID(), t });
      }
    }
    t = Math.round((t + travel) * 100) / 100;
    keys.push({ ...start, id: crypto.randomUUID(), t });
    if (scene) {
      // A cena passa a durar o percurso pelas áreas.
      commit(setSceneKeys(resizeScene(stateRef.current, scene.id, t), scene.id, keys, t));
      e.seek(scene.t);
      e.play();
      return;
    }
    applyKeys(keys, Math.round(t * 10) / 10);
  };

  const exportDims = () => {
    const a = ASPECTS[state.output.aspect];
    return a >= 1 ? [exportSize, Math.round(exportSize / a)] : [Math.round(exportSize * a), exportSize];
  };

  const doExportVideo = async () => {
    const e = engineRef.current;
    if (!e || video) return;
    if (!e.canAnimate()) {
      flash('Crie pelo menos 2 quadros-chave (ou ligue "Flutuar") para gravar um vídeo');
      return;
    }
    const abort = new AbortController();
    setVideo({ progress: 0, abort });
    const [w, h] = exportDims();
    try {
      const blob = await e.exportVideo({
        width: w,
        height: h,
        fps: anim.fps,
        signal: abort.signal,
        onProgress: (progress) => setVideo((v) => (v ? { ...v, progress } : v)),
      });
      download(blob, `vidramock-${w}x${h}-${anim.fps}fps.mp4`);
      flash(`Vídeo exportado · ${w}×${h} · ${(blob.size / 1048576).toFixed(1)} MB`);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) flash(err instanceof Error ? err.message : 'Falha ao gravar o vídeo');
    } finally {
      setVideo(null);
    }
  };

  const d = scene ? scene.device : state.device;
  const screen = scene ? scene.screen : state.screen;
  const shown = scene ? (scene.media ? (library.current.get(scene.media)?.info ?? null) : null) : media;
  const sceneTag = scene ? `Cena ${sceneIndex + 1}` : undefined;
  const bg = state.background;
  const l = state.lighting;
  const fx = state.effects;
  const sc = state.scene;
  const hasOrientation = d.kind === 'iphone' || d.kind === 'ipad';
  const finish = FINISHES[d.kind].find((f) => f.key === d.finish) ?? FINISHES[d.kind][0];
  const backdrop = BACKDROPS.find((b) => b.key === sc.backdrop) ?? BACKDROPS[0];
  const showBackground = sc.backdrop === 'none' || sc.backdrop === 'rocks' || sc.backdrop === 'dunes';
  const dofLevel = DOF_PRESETS.find((x) => (x.dof ? fx.dof && Math.abs(fx.bokeh - x.bokeh) < 0.05 && Math.abs(fx.focusRange - x.focusRange) < 0.01 : !fx.dof))?.key ?? 'custom';
  const [ew, eh] = exportDims();
  const lens = (v: number) => `${Math.round(12 / Math.tan((v * Math.PI) / 360))} mm`;

  return (
    <div className="app">
      <header className="topbar">
        <div className="tb-left">
          <span className="logo" aria-hidden>
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path d="M12 2.5 21 7.5v9L12 21.5 3 16.5v-9z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
              <path d="M3 7.5 12 12.5l9-5M12 12.5v9" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="brand">VidraMock</span>
          <Dropdown label={<>Templates <Chev /></>} className="ghost">
            {(close) => (
              <div className="menu-grid">
                <div className="menu-list">
                  <div className="menu-head">Looks</div>
                  {LOOKS.map((look) => (
                    <button key={look.key} className="menu-item with-sw" onClick={() => (close(), setState((s) => applyPatch(s, look.patch)))}>
                      <span className="sw" style={{ background: look.swatch }} />
                      <strong>{look.label}</strong>
                    </button>
                  ))}
                </div>
                <div className="menu-list">
                  <div className="menu-head">Animações</div>
                  {ANIM_PRESETS.map((pr) => (
                    <button key={pr.key} className="menu-item" onClick={() => (close(), applyPreset(pr.key))}>
                      <strong>{pr.label}</strong>
                      <span>{pr.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Dropdown>
          <Dropdown label="Ajuda" className="ghost">
            {() => (
              <div className="menu-list help">
                <div className="menu-head">Câmera</div>
                <p><kbd>V</kbd> arrastar gira a câmera</p>
                <p><kbd>H</kbd> mãozinha: arrastar move o quadro</p>
                <p><kbd>Espaço + arrastar</kbd> mãozinha por um instante</p>
                <p><kbd>Botão direito</kbd> faz o contrário da ferramenta</p>
                <p><kbd>Scroll</kbd> aproxima e afasta</p>
                <p><kbd>F</kbd> enquadra o aparelho</p>
                <p><kbd>Duplo clique</kbd> define o ponto de foco</p>
                <div className="menu-head">Linha do tempo</div>
                <p><kbd>Espaço</kbd> toca ou pausa</p>
                <p><kbd>← →</kbd> anda quadro a quadro (⇧ 1 s)</p>
                <p><kbd>Home / End</kbd> vai ao início ou ao fim</p>
                <p><kbd>Delete</kbd> apaga o quadro-chave selecionado</p>
                <p><kbd>Arrastar uma cena</kbd> muda a ordem das cenas</p>
                <div className="menu-head">Edição</div>
                <p><kbd>{KEYS.undo}</kbd> desfaz</p>
                <p><kbd>{KEYS.redo}</kbd> refaz</p>
                <p><kbd>{KEYS.paste}</kbd> cola um print direto na tela</p>
              </div>
            )}
          </Dropdown>
        </div>

        <Dropdown label={<><AspectIcon a={ASPECTS[state.output.aspect]} /> {state.output.aspect} <Chev /></>} className="ghost" align="center">
          {(close) => (
            <div className="menu-list aspects">
              {(Object.keys(ASPECTS) as AspectKey[]).map((k) => (
                <button key={k} className={`menu-item row-item ${state.output.aspect === k ? 'on' : ''}`} onClick={() => (close(), set('output', { aspect: k }))}>
                  <AspectIcon a={ASPECTS[k]} />
                  <strong>{k}</strong>
                  <span>{ASPECT_NAMES[k]}</span>
                </button>
              ))}
            </div>
          )}
        </Dropdown>

        <div className="tb-right">
          <Dropdown label={<>{busy || video ? 'Exportando…' : 'Exportar'} <Chev /></>} className="ink" align="right">
            {(close) => (
              <div className="menu-list export">
                <div className="menu-head">Resolução</div>
                <Seg
                  label="Resolução"
                  value={String(exportSize)}
                  options={EXPORT_SIZES.map((x) => ({ value: String(x.value), label: x.label }))}
                  onChange={(v) => setExportSize(Number(v))}
                />
                <p className="export-meta">
                  {ew} × {eh} px · {anim.fps} fps
                </p>
                <button className="menu-action" disabled={busy || !!video} onClick={() => (close(), doExport())}>
                  <strong>Imagem PNG</strong>
                  <span>{bg.mode === 'transparent' && sc.backdrop === 'none' ? 'Fundo transparente' : 'Quadro atual'}</span>
                </button>
                <button className="menu-action" disabled={!!video} onClick={() => (close(), doExportVideo())}>
                  <strong>Vídeo MP4</strong>
                  <span>{anim.duration}s · H.264</span>
                </button>
              </div>
            )}
          </Dropdown>
        </div>
      </header>

      <main
        className="canvas"
        ref={stageRef}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={onDrop}
      >
        <div className="viewport" ref={viewRef}>
          <div className={`frame ${bg.mode === 'transparent' && sc.backdrop === 'none' ? 'checker' : ''}`} style={{ width: frame.w, height: frame.h }} ref={hostRef} />
        </div>
        {!shown && (
          <div className="empty-pill">
            <span>Envie um print ou uma gravação de tela — ou cole / arraste aqui.</span>
            <button className="mini-btn accent" onClick={() => fileRef.current?.click()}>Enviar</button>
          </div>
        )}
        <CanvasTools
          tool={tool}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          undoKey={KEYS.undo}
          redoKey={KEYS.redo}
          onTool={chooseTool}
          onUndo={undo}
          onRedo={redo}
          onFrame={() => engineRef.current?.frame()}
        />
        {dragging && <div className="drop-overlay">Solte para colocar na tela</div>}
        {toast && <div className="toast">{toast}</div>}
      </main>

      <Timeline
        anim={anim}
        selected={selectedKey}
        hasVideo={shown?.kind === 'video'}
        subscribe={subscribe}
        onPlayPause={playPause}
        onSeek={(t) => engineRef.current?.seek(t)}
        onChange={setAnim}
        onAddKey={addKey}
        onUpdateKey={updateKey}
        onDeleteKey={deleteKey}
        onSelect={setSelectedKey}
        onPreset={applyPreset}
        onMotion={applyMotion}
        onAreas={openAreas}
        activeScene={activeScene}
        sceneLabel={sceneLabel}
        onAddScene={newScene}
        onSelectScene={selectScene}
        onRemoveScene={(id) => setState((s) => removeScene(s, id))}
        onResizeScene={(id, len) => setState((s) => resizeScene(s, id, len))}
        onMoveScene={(id, to) => {
          // A agulha acompanha a cena movida, que continua selecionada.
          const next = moveScene(stateRef.current, id, to);
          if (next === stateRef.current) return;
          commit(next);
          const sc = next.animation.scenes.find((x) => x.id === id);
          if (sc) {
            engineRef.current?.pause();
            engineRef.current?.seek(sc.t);
          }
          flash(`Cena movida para a posição ${next.animation.scenes.findIndex((x) => x.id === id) + 1}`);
        }}
      />

      <aside className="inspector">
        <div className="insp-head">
          <span>Ajustes</span>
          <button className="icon-btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Tema claro' : 'Tema escuro'} title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}>
            {theme === 'dark' ? (
              <svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
            ) : (
              <svg viewBox="0 0 16 16" width="14" height="14"><path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
            )}
          </button>
        </div>
        <div className="insp-body">
          <Section title="Mídia" aside={sceneTag ?? (shown?.kind === 'video' ? 'Vídeo' : shown ? 'Imagem' : undefined)}>
            <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={(e) => loadFile(e.target.files?.[0])} />
            {shown ? (
              <div className="media-card">
                <span className="media-icon" aria-hidden>{shown.kind === 'video' ? '▶' : '▣'}</span>
                <span className="card-text">
                  <strong title={shown.name}>{shown.name}</strong>
                  <span>
                    {shown.w} × {shown.h}
                    {shown.duration ? ` · ${shown.duration.toFixed(1)}s` : ''}
                  </span>
                </span>
                <button className="mini-btn" onClick={() => fileRef.current?.click()}>Trocar</button>
                <button className="mini-btn quiet" onClick={clearImage} aria-label="Remover mídia">✕</button>
              </div>
            ) : (
              <button className="dropzone" onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
                <strong>Enviar imagem ou vídeo</strong>
                <span>arraste, cole (⌘V) ou clique</span>
              </button>
            )}
            {shown && (
              <>
                <Seg
                  label="Ajuste na tela"
                  value={screen.fit}
                  options={[
                    { value: 'cover', label: 'Preencher' },
                    { value: 'contain', label: 'Caber inteira' },
                  ]}
                  onChange={(fit) => setScreen({ fit })}
                />
                {screen.fit === 'cover' && shown.kind === 'image' && shown.h / shown.w > 0.9 && (
                  <Field label="Rolagem" value={screen.scroll} min={0} max={1} def={0} onChange={(scroll) => setScreen({ scroll })} format={pct} />
                )}
                {screen.fit === 'contain' && <ColorRow label="Cor ao redor" value={screen.fill} onChange={(fill) => setScreen({ fill })} />}
              </>
            )}
          </Section>

          <Section title="Aparelho" aside={sceneTag}>
            <Card thumb={<DeviceIcon kind={d.kind} />} title={DEVICES.find((x) => x.kind === d.kind)?.label ?? ''} subtitle={finish.label}>
              {(close) => (
                <div className="pick-grid devices">
                  {DEVICES.map((dev) => (
                    <button key={dev.kind} className={d.kind === dev.kind ? 'on' : ''} onClick={() => (close(), chooseDevice(dev.kind))}>
                      <DeviceIcon kind={dev.kind} />
                      <span>{dev.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </Card>
            <div className="row swatch-row">
              <span className="row-label">Acabamento</span>
              <span className="swatches" role="radiogroup" aria-label="Acabamento">
                {FINISHES[d.kind].map((f) => (
                  <button
                    key={f.key}
                    role="radio"
                    aria-checked={d.finish === f.key}
                    title={f.label}
                    className={d.finish === f.key ? 'on' : ''}
                    style={{ background: f.color2 && f.color2 !== f.color ? `linear-gradient(90deg, ${f.color} 50%, ${f.color2} 50%)` : f.color }}
                    onClick={() => setDevice({ finish: f.key })}
                  />
                ))}
              </span>
            </div>
            {hasOrientation && (
              <Seg
                label="Orientação"
                value={d.orientation}
                options={[
                  { value: 'portrait', label: 'Retrato' },
                  { value: 'landscape', label: 'Paisagem' },
                ]}
                onChange={(orientation) => setDevice({ orientation })}
              />
            )}
            {d.kind === 'iphone' && <ToggleRow label="Ilha dinâmica" checked={d.showIsland} onChange={(showIsland) => setDevice({ showIsland })} />}
            {d.kind !== 'browser' && <ToggleRow label="Logo da Apple" checked={d.logo !== false} onChange={(logo) => setDevice({ logo })} />}
            {d.kind === 'macbook' && <Field label="Tampa" value={d.lidAngle} min={60} max={150} step={1} def={108} onChange={(lidAngle) => setDevice({ lidAngle })} format={deg} />}
            {d.kind === 'browser' && <TextRow label="Endereço" value={d.browserUrl} onChange={(browserUrl) => setDevice({ browserUrl })} />}
            <Field label="Girar" value={d.rotY} min={-180} max={180} step={1} def={0} onChange={(rotY) => setDevice({ rotY })} format={deg} />
            <Field label="Inclinar" value={d.rotX} min={-90} max={90} step={1} def={0} onChange={(rotX) => setDevice({ rotX })} format={deg} />
            <Field label="Rolar" value={d.rotZ} min={-180} max={180} step={1} def={0} onChange={(rotZ) => setDevice({ rotZ })} format={deg} />
            <Field label="Posição ↔" value={d.offsetX} min={-0.5} max={0.5} step={0.01} def={0} onChange={(offsetX) => setDevice({ offsetX })} format={signedPct} />
            <Field label="Posição ↕" value={d.offsetY} min={-0.5} max={0.5} step={0.01} def={0} onChange={(offsetY) => setDevice({ offsetY })} format={signedPct} />
          </Section>

          <Section title="Cena">
            <input ref={backdropFileRef} type="file" accept="image/*" hidden onChange={(e) => loadBackdrop(e.target.files?.[0])} />
            <Card thumb={<span className="sw big" style={{ background: backdrop.swatch }} />} title={backdrop.label} subtitle={sc.backdrop === 'photo' && backdropName ? backdropName : 'Cenário'}>
              {(close) => (
                <div className="pick-grid scenes">
                  {BACKDROPS.map((b) => (
                    <button
                      key={b.key}
                      className={sc.backdrop === b.key ? 'on' : ''}
                      onClick={() => {
                        close();
                        if (b.key === 'photo' && !backdropImageRef.current) backdropFileRef.current?.click();
                        else set('scene', { backdrop: b.key });
                      }}
                    >
                      <span className="sw scene" style={{ background: b.swatch }} />
                      <span>{b.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </Card>
            {(sc.backdrop === 'cove' || sc.backdrop === 'podium') && <ColorRow label="Cor do estúdio" value={sc.color} onChange={(color) => set('scene', { color })} />}
            {sc.backdrop === 'photo' && (
              <button className="row link-row" onClick={() => backdropFileRef.current?.click()}>
                <span className="row-label">Foto</span>
                <span className="row-value">Trocar</span>
              </button>
            )}
            <SelectRow label="Luz" value={l.preset} options={LIGHT_PRESETS.map((x) => ({ value: x.key, label: x.label }))} onChange={(preset) => set('lighting', { preset })} />
            <Field label="Intensidade" value={l.intensity} min={0.2} max={2.5} def={1} onChange={(intensity) => set('lighting', { intensity })} format={pct} />
            <Field label="Direção da luz" value={l.rotation} min={-180} max={180} step={1} def={0} onChange={(rotation) => set('lighting', { rotation })} format={deg} />
            <Field label="Reflexo no vidro" value={l.glare} min={0} max={3} def={1} onChange={(glare) => set('lighting', { glare })} format={pct} />
            <ToggleRow label="Sombra" checked={l.shadow} onChange={(shadow) => set('lighting', { shadow })} />
            {l.shadow && (
              <>
                <Field label="Força da sombra" value={l.shadowOpacity} min={0} max={1} def={0.7} onChange={(shadowOpacity) => set('lighting', { shadowOpacity })} format={pct} />
                <Field label="Suavidade" value={l.shadowSoftness} min={0} max={1} def={0.45} onChange={(shadowSoftness) => set('lighting', { shadowSoftness })} format={pct} />
              </>
            )}
            {showBackground && (
              <>
                <SelectRow<BgMode>
                  label={sc.backdrop === 'none' ? 'Fundo' : 'Céu'}
                  value={bg.mode}
                  options={[
                    { value: 'solid', label: 'Sólido' },
                    { value: 'linear', label: 'Degradê' },
                    { value: 'radial', label: 'Radial' },
                    ...(sc.backdrop === 'none' ? [{ value: 'transparent' as BgMode, label: 'Transparente' }] : []),
                  ]}
                  onChange={(mode) => set('background', { mode })}
                />
                {bg.mode !== 'transparent' && <ColorRow label={bg.mode === 'solid' ? 'Cor' : 'Cor 1'} value={bg.color1} onChange={(color1) => set('background', { color1 })} />}
                {(bg.mode === 'linear' || bg.mode === 'radial') && <ColorRow label="Cor 2" value={bg.color2} onChange={(color2) => set('background', { color2 })} />}
                {bg.mode === 'linear' && <Field label="Ângulo" value={bg.angle} min={0} max={360} step={1} onChange={(angle) => set('background', { angle })} format={deg} />}
              </>
            )}
          </Section>

          <Section title="Câmera">
            <SelectRow<CameraPresetKey>
              label="Ângulo"
              value={preset}
              options={(Object.keys(CAMERA_PRESETS) as CameraPresetKey[]).map((k) => ({ value: k, label: CAMERA_PRESETS[k].label }))}
              onChange={choosePreset}
            />
            <Field label="Lente" value={state.camera.fov} min={12} max={60} step={1} def={30} onChange={(fov) => set('camera', { fov })} format={lens} />
          </Section>

          <Section title="Foco">
            <Seg
              label="Nível de desfoque"
              value={dofLevel}
              options={DOF_PRESETS.map((x) => ({ value: x.key, label: x.label }))}
              onChange={(k) => {
                const x = DOF_PRESETS.find((y) => y.key === k)!;
                set('effects', { dof: x.dof, bokeh: x.bokeh, focusRange: x.focusRange });
              }}
            />
            {fx.dof && (
              <>
                <Field label="Bokeh" value={fx.bokeh} min={0.5} max={14} step={0.1} def={5} onChange={(bokeh) => set('effects', { bokeh })} format={(v) => v.toFixed(1)} />
                <Field label="Área nítida" value={fx.focusRange} min={0.05} max={3} def={1} onChange={(focusRange) => set('effects', { focusRange })} format={(v) => v.toFixed(2)} />
                <Note>Duplo clique no aparelho escolhe o ponto de foco.</Note>
              </>
            )}
          </Section>

          <Section title="Efeitos" defaultOpen={false}>
            <ToggleRow label="Bloom" checked={fx.bloom} onChange={(bloom) => set('effects', { bloom })} />
            {fx.bloom && <Field label="Brilho" value={fx.bloomIntensity} min={0} max={2} def={0.25} onChange={(bloomIntensity) => set('effects', { bloomIntensity })} format={pct} />}
            <ToggleRow label="Grão" checked={fx.grain} onChange={(grain) => set('effects', { grain })} />
            {fx.grain && <Field label="Quantidade" value={fx.grainAmount} min={0} max={0.3} def={0.045} onChange={(grainAmount) => set('effects', { grainAmount })} format={pct} />}
            <ToggleRow label="Vinheta" checked={fx.vignette} onChange={(vignette) => set('effects', { vignette })} />
            {fx.vignette && <Field label="Escurecer" value={fx.vignetteAmount} min={0} max={1} def={0.18} onChange={(vignetteAmount) => set('effects', { vignetteAmount })} format={pct} />}
            <ToggleRow label="Nitidez" checked={fx.sharpen} onChange={(sharpen) => set('effects', { sharpen })} />
            {fx.sharpen && <Field label="Quantidade" value={fx.sharpenAmount} min={0} max={1} def={0.25} onChange={(sharpenAmount) => set('effects', { sharpenAmount })} format={pct} />}
            <div className="divider" />
            <Field label="Exposição" value={fx.exposure} min={-2} max={2} step={0.1} def={0} onChange={(exposure) => set('effects', { exposure })} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} EV`} />
            <Field label="Contraste" value={fx.contrast} min={-0.5} max={0.5} def={0} onChange={(contrast) => set('effects', { contrast })} format={pct} />
            <Field label="Saturação" value={fx.saturation} min={-1} max={1} def={0} onChange={(saturation) => set('effects', { saturation })} format={pct} />
            <Field label="Temperatura" value={fx.temperature} min={-1} max={1} def={0} onChange={(temperature) => set('effects', { temperature })} format={pct} />
            <SelectRow<ToneMode>
              label="Tons"
              value={l.tone}
              options={[
                { value: 'soft', label: 'Suave' },
                { value: 'linear', label: 'Fiel' },
                { value: 'neutral', label: 'Neutro' },
                { value: 'agx', label: 'Cinema' },
              ]}
              onChange={(tone) => set('lighting', { tone })}
            />
          </Section>
        </div>
      </aside>

      {areasPreview && <FocusAreas preview={areasPreview} onClose={() => setAreasPreview(null)} onApply={applyAreas} />}
      {video && (
        <div className="modal-back">
          <div className="modal progress-modal" role="dialog" aria-label="Gravando vídeo">
            <strong>Gravando vídeo…</strong>
            <span className="note">Cada quadro é renderizado na resolução final. Pode levar alguns segundos.</span>
            <div className="bar">
              <div style={{ width: `${Math.round(video.progress * 100)}%` }} />
            </div>
            <div className="progress-row">
              <span>{Math.round(video.progress * 100)}%</span>
              <button className="ghost-btn" onClick={() => video.abort.abort()}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
