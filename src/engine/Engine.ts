import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  BlendFunction,
  BloomEffect,
  DepthOfFieldEffect,
  Effect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { CAMERA_PRESETS, sceneAt, type AnimPresetKey, type CameraPresetKey, type EaseKey, type Keyframe, type MotionKind, type SceneState, type ToneMode, type Vec3 } from '../state';
import { buildBackdrop, type BackdropBuild } from './backdrops';
import { buildDevice, type DeviceBuild } from './devices';
import { composeScreen, drawBackground, type ScreenImage } from './textures';
import { buildEnvironment, ENV_PRESETS } from './environment';
import { ColorGradeEffect, SceneCompositeEffect, SharpenEffect } from './effects';
import { ContactShadow } from './contactShadow';

export interface AnimPreset {
  keyframes: Keyframe[];
  duration: number;
  ease: EaseKey;
  float: boolean;
  floatAmount?: number;
  effects?: Partial<SceneState['effects']>;
}
import { floatOffset, samplePose, videoTimeAt } from './animation';

const DEG = Math.PI / 180;
// A luz principal dos estúdios vem da frente-esquerda; a sombra cai para trás e para a direita.
const KEY_AZIMUTH = -45;
// "Suave" e "Fiel" não usam operador de tom: a curva suave fica no efeito de composição.
const TONE: Record<ToneMode, ToneMappingMode> = {
  soft: ToneMappingMode.LINEAR,
  linear: ToneMappingMode.LINEAR,
  neutral: ToneMappingMode.NEUTRAL,
  agx: ToneMappingMode.AGX,
};

interface Effects {
  tone: ToneMappingEffect;
  composite: SceneCompositeEffect;
  grade: ColorGradeEffect;
  dof?: DepthOfFieldEffect;
  bloom?: BloomEffect;
  vignette?: VignetteEffect;
  sharpen?: SharpenEffect;
  noise?: NoiseEffect;
}

interface Tween {
  from: THREE.Spherical;
  to: THREE.Spherical;
  t0: THREE.Vector3;
  t1: THREE.Vector3;
  start: number;
  dur: number;
}

export interface VideoOptions {
  width: number;
  height: number;
  fps: number;
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
}

const toVec3 = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.05, 200);
  readonly controls: OrbitControls;
  onFocus?: () => void;
  onTime?: (t: number, playing: boolean) => void;
  // Cena sob a agulha mudou (null = linha do tempo sem cenas).
  onScene?: (id: string | null) => void;
  // Biblioteca de mídias do editor: as cenas guardam só o id.
  mediaSource?: (id: string) => ScreenImage | null;

  private composer: EffectComposer;
  private renderPass: RenderPass;
  private passes: EffectPass[] = [];
  private fx: Effects | null = null;
  private root = new THREE.Group();
  private device: DeviceBuild | null = null;
  private screenCanvas = document.createElement('canvas');
  private screenTex: THREE.CanvasTexture | null = null;
  private bgCanvas = document.createElement('canvas');
  private bgTex: THREE.CanvasTexture | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private key = new THREE.DirectionalLight(0xffffff, 1);
  private shadow = new ContactShadow();
  private backdrop: BackdropBuild | null = null;
  private backdropImage: ScreenImage | null = null;
  private sizeFactor = 1;
  private shadowDirty = true;
  private bounds = new THREE.Box3();
  private center = new THREE.Vector3();
  private focusPoint = new THREE.Vector3();
  private focusIsCustom = false;
  private image: ScreenImage | null = null;
  private mainImage: ScreenImage | null = null;
  private scrollOverride: number | null = null;
  // `raw` é o estado do editor; `state` é o que vale agora (com o aparelho e a tela da cena ativa).
  private raw: SceneState;
  private state: SceneState;
  private activeScene: string | null = null;
  private activeMedia: string | null | undefined = undefined;
  private prev: SceneState | null = null;
  private dirty = true;
  private raf = 0;
  private tween: Tween | null = null;
  private size = { w: 800, h: 450 };
  private preset: CameraPresetKey = 'hero';
  private raycaster = new THREE.Raycaster();
  private anim = { playing: false, t: 0, start: 0 };
  private video: HTMLVideoElement | null = null;
  private lastVideoTime = -1;
  private exporting = false;

  constructor(host: HTMLElement, state: SceneState) {
    this.state = state;
    this.raw = state;
    const r = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.setClearColor(0x000000, 0);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    host.appendChild(r.domElement);
    this.renderer = r;

    this.scene.add(this.root);
    this.scene.add(this.key, this.key.target);
    this.scene.add(this.shadow.mesh);

    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 40;
    this.controls.addEventListener('change', () => (this.dirty = true));
    this.controls.addEventListener('start', () => (this.tween = null));

    this.composer = new EffectComposer(r, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: Math.min(4, r.capabilities.maxSamples),
    });
    this.renderPass = new RenderPass(this.scene, this.camera);

    r.domElement.addEventListener('dblclick', this.onDblClick);

    this.setState(state);
    this.setCameraPreset('hero', false);
    this.loop();
  }

  // ---------- Cena ----------

  setState(next: SceneState) {
    this.raw = next;
    this.syncScene(this.anim.t, true);
  }

  // Aplica a cena do instante t: aparelho, tela e mídia dela; o resto do estado é comum.
  private syncScene(t: number, force: boolean) {
    const scene = sceneAt(this.raw.animation.scenes, t);
    const id = scene?.id ?? null;
    const switched = id !== this.activeScene;
    if (!force && !switched) return;
    this.activeScene = id;
    const still = !!scene && !this.raw.animation.keyframes.some((k) => k.scene === scene.id);
    this.applyState(scene ? { ...this.raw, device: scene.device, screen: scene.screen } : this.raw, !scene || still);
    if (scene) {
      if (scene.media !== this.activeMedia) {
        this.activeMedia = scene.media;
        this.showImage(scene.media ? (this.mediaSource?.(scene.media) ?? null) : null);
      }
    } else if (this.activeMedia !== undefined) {
      this.activeMedia = undefined;
      this.showImage(this.mainImage);
    }
    if (!switched) return;
    // Cena sem quadros-chave: enquadra o aparelho novo em vez de herdar a câmera da anterior.
    if (still) this.setCameraPreset(this.preset, false);
    this.onScene?.(id);
  }

  // `allowReframe`: trocar de aparelho reenquadra a câmera (não quando a cena tem movimento próprio).
  private applyState(next: SceneState, allowReframe: boolean) {
    const p = this.prev;
    this.state = next;
    const changed = (k: keyof SceneState) => !p || JSON.stringify(p[k]) !== JSON.stringify(next[k]);
    const d = next.device;
    const pd = p?.device;

    const rebuild =
      !pd ||
      pd.kind !== d.kind ||
      pd.finish !== d.finish ||
      pd.orientation !== d.orientation ||
      pd.showIsland !== d.showIsland ||
      pd.browserUrl !== d.browserUrl;
    const reframe = allowReframe && !!pd && (pd.kind !== d.kind || pd.orientation !== d.orientation);
    let boundsDirty = false;

    if (rebuild) {
      this.rebuildDevice();
      boundsDirty = true;
    } else if (pd && pd.lidAngle !== d.lidAngle) {
      this.device?.setLid?.(d.lidAngle);
      boundsDirty = true;
    }
    if (!pd || rebuild || pd.rotX !== d.rotX || pd.rotY !== d.rotY || pd.rotZ !== d.rotZ) boundsDirty = true;
    if (boundsDirty) {
      this.applyFloat(0, true);
      this.updateBounds();
      this.applyFloat(this.anim.t);
    }
    if (!pd || pd.offsetX !== d.offsetX || pd.offsetY !== d.offsetY) this.applyOffset();
    if (p && changed('screen')) this.scrollOverride = null;
    if (rebuild || changed('screen')) this.updateScreen();
    if (changed('background') || changed('output')) this.updateBackground();
    if (rebuild || changed('lighting')) this.updateLighting(p?.lighting);
    if (rebuild || changed('scene') || (this.backdrop?.fog && changed('background'))) this.updateBackdrop();
    if (changed('camera')) {
      this.camera.fov = next.camera.fov;
      this.camera.updateProjectionMatrix();
    }
    if (!p || changed('effects') || p.lighting.tone !== next.lighting.tone) this.updateEffects(p);
    if (p && changed('animation') && !this.anim.playing) {
      this.anim.t = Math.min(this.anim.t, next.animation.duration);
      this.applyFloat(this.anim.t);
    }

    this.prev = next;
    if (reframe) {
      this.focusIsCustom = false;
      this.setCameraPreset(this.preset, true);
    }
    this.dirty = true;
  }

  // Mídia da tela quando a linha do tempo não tem cenas.
  setImage(img: ScreenImage | null) {
    this.mainImage = img;
    if (this.activeScene === null) this.showImage(img);
  }

  // A mídia de uma cena foi trocada na biblioteca: mostra de novo se ela estiver na tela.
  refreshMedia() {
    this.activeMedia = undefined;
    this.syncScene(this.anim.t, true);
  }

  private showImage(img: ScreenImage | null) {
    if (this.video && this.video !== img?.video) {
      this.video.pause();
      this.video.removeEventListener('seeked', this.onVideoSeeked);
    }
    this.image = img;
    this.video = img?.video ?? null;
    this.lastVideoTime = -1;
    if (this.video) {
      this.video.addEventListener('seeked', this.onVideoSeeked);
      this.syncVideo(this.anim.t, false);
    }
    this.updateScreen();
    this.dirty = true;
  }

  // Garante que a tela mostra o quadro exato do vídeo no instante atual (antes de renderizar uma imagem).
  async settleVideo() {
    if (!this.video || !Number.isFinite(this.video.duration)) return;
    await this.seekVideo(this.videoTime(this.anim.t));
    this.updateScreen();
  }

  // Tempo do vídeo da tela no instante t: relativo ao início da cena, ou pelos trechos (clips).
  private videoTime(t: number) {
    const v = this.video;
    if (!v) return 0;
    const scene = sceneAt(this.raw.animation.scenes, t);
    if (!scene) return videoTimeAt(this.state.animation.clips ?? [], t, v.duration);
    return Math.min(Math.max(t - scene.t + (scene.videoStart ?? 0), 0), Math.max(v.duration - 0.02, 0));
  }

  get videoDuration() {
    return this.video?.duration ?? 0;
  }

  // Depois de um salto no vídeo, o quadro novo só existe quando o evento chega: redesenha a tela.
  private onVideoSeeked = () => {
    this.lastVideoTime = this.video?.currentTime ?? -1;
    this.updateScreen();
  };

  // Leva o vídeo da tela ao instante certo da animação (tocando junto ou parado num quadro).
  private syncVideo(t: number, playing: boolean) {
    const v = this.video;
    if (!v || !Number.isFinite(v.duration)) return;
    const vt = this.videoTime(t);
    if (playing) {
      if (v.paused) v.play().catch(() => undefined);
      if (Math.abs(v.currentTime - vt) > 0.15) v.currentTime = vt;
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - vt) > 1 / 240) v.currentTime = vt;
    }
  }

  private seekVideo(vt: number): Promise<void> {
    const v = this.video;
    if (!v) return Promise.resolve();
    if (!v.paused) v.pause();
    if (Math.abs(v.currentTime - vt) < 1e-4 && !v.seeking) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        v.removeEventListener('seeked', done);
        resolve();
      };
      const timer = setTimeout(done, 4000);
      v.addEventListener('seeked', done);
      v.currentTime = vt;
    });
  }

  // Foco num ponto do print (0–1, "em pé"); usado pelo MCP.
  setFocusScreen(a: number, b: number) {
    const f = this.screenFrame();
    if (!f) return;
    this.focusPoint.copy(f.toWorld(a, b));
    this.focusIsCustom = true;
    this.dirty = true;
  }

  resetFocus() {
    this.focusIsCustom = false;
    this.focusPoint.copy(this.screenCenter());
    this.dirty = true;
  }

  getCameraInfo() {
    const s = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    const r = (v: number) => Math.round(v * 10) / 10;
    return { azimuth: r(THREE.MathUtils.radToDeg(s.theta)), elevation: r(90 - THREE.MathUtils.radToDeg(s.phi)), distance: r(s.radius), fov: r(this.camera.fov), preset: this.preset };
  }

  setBackdropImage(img: ScreenImage | null) {
    this.backdropImage = img;
    if (this.state.scene.backdrop === 'photo') this.updateBackdrop();
  }

  setCameraPreset(key: CameraPresetKey, animate = true) {
    this.preset = key;
    const preset = CAMERA_PRESETS[key];
    this.setCameraOrbit(preset.az, preset.el, preset.zoom, animate);
  }

  // Câmera em volta do aparelho por ângulos livres (graus), com o mesmo enquadramento automático dos presets.
  setCameraOrbit(az: number, el: number, zoom = 1, animate = true) {
    const target = this.bounds.getCenter(new THREE.Vector3());
    const dist = this.fitDistance(az, el) * zoom;
    const to = new THREE.Spherical(dist, (90 - el) * DEG, az * DEG);
    if (!animate) {
      this.camera.position.setFromSpherical(to).add(target);
      this.controls.target.copy(target);
      this.controls.update();
      this.tween = null;
      this.dirty = true;
      return;
    }
    const from = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    // Gira pelo caminho mais curto em volta do aparelho.
    let dTheta = to.theta - from.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    to.theta = from.theta + dTheta;
    this.tween = { from, to, t0: this.controls.target.clone(), t1: target, start: performance.now(), dur: 700 };
  }

  resize(w: number, h: number) {
    if (w < 2 || h < 2) return;
    this.size = { w, h };
    if (this.exporting) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.updateBackground();
    this.applyEffectParams();
    this.dirty = true;
  }

  // ---------- Animação ----------

  get time() {
    return this.anim.t;
  }

  get playing() {
    return this.anim.playing;
  }

  canAnimate() {
    const a = this.raw.animation;
    return a.keyframes.length >= 2 || a.float || !!this.video || a.scenes.length > 1;
  }

  get currentScene() {
    return this.activeScene;
  }

  play() {
    if (this.anim.playing || !this.canAnimate()) return;
    if (this.anim.t >= this.state.animation.duration - 1e-3) this.anim.t = 0;
    this.anim.playing = true;
    this.anim.start = performance.now() - this.anim.t * 1000;
    this.controls.enabled = false;
    this.tween = null;
    this.syncVideo(this.anim.t, true);
    this.emitTime();
  }

  pause() {
    if (!this.anim.playing) return;
    this.anim.playing = false;
    this.controls.enabled = true;
    this.syncVideo(this.anim.t, false);
    this.emitTime();
  }

  seek(t: number) {
    this.anim.t = THREE.MathUtils.clamp(t, 0, this.state.animation.duration);
    this.tween = null;
    this.applyTime(this.anim.t);
    this.dirty = true;
    this.emitTime();
  }

  // Quadro-chave com a câmera como está agora.
  captureKeyframe(t: number): Keyframe {
    // Sem foco escolhido, focusPoint já é o centro da tela (no MacBook o alvo da órbita fica à frente dela).
    const focus = this.focusPoint;
    return {
      id: crypto.randomUUID(),
      t,
      pos: toVec3(this.camera.position),
      target: toVec3(this.controls.target),
      fov: this.camera.fov,
      focus: toVec3(focus),
      scroll: this.currentScroll(),
      scene: this.activeScene ?? undefined,
    };
  }

  // Quadro-chave por ângulos (como setCameraOrbit), sem mexer na câmera; usado ao montar cenas pelo MCP.
  orbitKeyframe(t: number, az: number, el: number, zoom = 1, scroll?: number): Keyframe {
    this.applyFloat(0, true);
    this.root.updateMatrixWorld(true);
    const target = this.bounds.getCenter(new THREE.Vector3());
    const pos = new THREE.Vector3().setFromSphericalCoords(this.fitDistance(az, el) * zoom, (90 - el) * DEG, az * DEG).add(target);
    const k: Keyframe = {
      id: crypto.randomUUID(),
      t,
      pos: toVec3(pos),
      target: toVec3(target),
      fov: this.camera.fov,
      focus: toVec3(this.screenCenter()),
      scroll: scroll ?? this.currentScroll(),
      scene: this.activeScene ?? undefined,
    };
    this.applyFloat(this.anim.t);
    return k;
  }

  // Movimentos prontos, sempre a partir do enquadramento atual.
  buildMotion(kind: MotionKind, duration: number): Keyframe[] {
    const target = this.controls.target.clone();
    const s = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(target));
    const fov = this.camera.fov;
    const scroll = this.currentScroll();
    const key = (t: number, dTheta: number, dPhi: number, rMul: number, sc = scroll): Keyframe => {
      const sp = new THREE.Spherical(s.radius * rMul, THREE.MathUtils.clamp(s.phi + dPhi * DEG, 0.08, Math.PI - 0.08), s.theta + dTheta * DEG);
      const pos = new THREE.Vector3().setFromSpherical(sp).add(target);
      return { id: crypto.randomUUID(), t, pos: toVec3(pos), target: toVec3(target), fov, focus: toVec3(target), scroll: sc };
    };
    switch (kind) {
      case 'orbit':
        return [key(0, -40, 0, 1), key(duration, 40, 0, 1)];
      case 'pushIn':
        return [key(0, 10, -2, 1.18), key(duration, -6, 2, 0.7)];
      case 'pullBack':
        return [key(0, -8, 2, 0.6), key(duration, 8, -2, 1.08)];
      case 'reveal':
        return [key(0, -38, 18, 1.25), key(duration, 0, 0, 1)];
      case 'sweep':
        return [key(0, -60, -4, 0.95), key(duration, 60, -4, 0.95)];
      case 'scroll':
        return [key(0, -6, 0, 1, 0), key(duration, 6, 0, 0.96, 1)];
    }
  }

  // Presets completos: movimento de câmera + nível de desfoque + ritmo (e flutuação, quando faz sentido).
  buildPreset(kind: AnimPresetKey): AnimPreset | null {
    if (!this.device) return null;
    // Mede a tela sem a flutuação aplicada.
    this.applyFloat(0, true);
    this.root.updateMatrixWorld(true);
    const target = this.bounds.getCenter(new THREE.Vector3());
    const hero = CAMERA_PRESETS.hero;
    const orbitKey = (t: number, az: number, el: number, zoom: number, fov = this.camera.fov): Keyframe => {
      const dist = this.fitDistance(az, el) * zoom;
      const pos = new THREE.Vector3().setFromSphericalCoords(dist, (90 - el) * DEG, az * DEG).add(target);
      return { id: crypto.randomUUID(), t, pos: toVec3(pos), target: toVec3(target), fov, focus: toVec3(this.screenCenter()), scroll: this.currentScroll() };
    };
    const sp = (t: number, a: number, b: number, span: number, yaw: number, pitch: number, opts: { fa?: number; fb?: number; fov?: number; scroll?: number } = {}) =>
      this.screenPose(t, a, b, span, yaw, pitch, opts);
    let out: AnimPreset;
    switch (kind) {
      case 'cinematicClose':
        out = {
          duration: 8,
          ease: 'smooth',
          float: false,
          keyframes: [sp(0, 0.5, 0.24, 0.5, 34, 20, { fov: 24 }), sp(8, 0.5, 0.7, 0.46, 20, 12, { fov: 24 })],
          effects: { dof: true, bokeh: 6, focusRange: 0.22 },
        };
        break;
      case 'rackFocus':
        out = {
          duration: 6,
          ease: 'smooth',
          float: false,
          keyframes: [
            sp(0, 0.5, 0.5, 0.95, 38, 28, { fa: 0.5, fb: 0.14, fov: 26 }),
            sp(3, 0.5, 0.5, 0.9, 36, 27, { fa: 0.5, fb: 0.5, fov: 26 }),
            sp(6, 0.5, 0.5, 0.86, 34, 26, { fa: 0.5, fb: 0.86, fov: 26 }),
          ],
          effects: { dof: true, bokeh: 8, focusRange: 0.16 },
        };
        break;
      case 'reveal360':
        out = {
          duration: 6,
          ease: 'flow',
          float: false,
          keyframes: [orbitKey(0, hero.az + 175, 8, 1.08), orbitKey(3, hero.az + 85, 9, 1.02), orbitKey(6, hero.az, 10, 0.96)],
          effects: { dof: true, bokeh: 2.5, focusRange: 1.1 },
        };
        break;
      case 'slowOrbit':
        out = {
          duration: 8,
          ease: 'flow',
          float: true,
          floatAmount: 0.45,
          keyframes: [orbitKey(0, hero.az - 38, 12, 1.04), orbitKey(8, hero.az + 38, 6, 0.96)],
          effects: { dof: true, bokeh: 3.5, focusRange: 0.8 },
        };
        break;
      case 'diveIn':
        out = {
          duration: 5,
          ease: 'smooth',
          float: false,
          keyframes: [orbitKey(0, hero.az, hero.el, 1.12), sp(5, 0.5, 0.42, 0.42, 12, 6, { fov: 26 })],
          effects: { dof: true, bokeh: 4.5, focusRange: 0.4 },
        };
        break;
      case 'topDown':
        out = {
          duration: 6,
          ease: 'smooth',
          float: false,
          keyframes: [orbitKey(0, hero.az + 20, 58, 1.05), orbitKey(6, hero.az - 12, 8, 0.95)],
          effects: { dof: true, bokeh: 3, focusRange: 0.9 },
        };
        break;
      case 'tiltShowcase':
        out = {
          duration: 6,
          ease: 'smooth',
          float: false,
          keyframes: [sp(0, 0.5, 0.62, 0.62, -28, -24, { fov: 26 }), sp(6, 0.5, 0.38, 0.62, 30, 22, { fov: 26 })],
          effects: { dof: true, bokeh: 6, focusRange: 0.3 },
        };
        break;
      case 'websiteScroll':
        out = {
          duration: 10,
          ease: 'smooth',
          float: false,
          keyframes: [sp(0, 0.5, 0.5, 1.12, 22, 10, { scroll: 0 }), sp(10, 0.5, 0.5, 1.08, 12, 6, { scroll: 1 })],
          effects: { dof: true, bokeh: 2.5, focusRange: 1 },
        };
        break;
      case 'floatHero':
        out = {
          duration: 6,
          ease: 'smooth',
          float: true,
          floatAmount: 0.8,
          keyframes: [],
          effects: { dof: true, bokeh: 2.5, focusRange: 1.1 },
        };
        break;
    }
    this.applyFloat(this.anim.t);
    return out;
  }

  // Câmera olhando para o ponto (a, b) do print (0–1, "em pé"), mostrando `span` da altura da tela,
  // girada `yaw` graus para o lado e `pitch` graus para cima em relação à frente da tela.
  private screenPose(t: number, a: number, b: number, span: number, yaw: number, pitch: number, opts: { fa?: number; fb?: number; fov?: number; scroll?: number }): Keyframe {
    const f = this.screenFrame()!;
    const p = f.toWorld(a, b);
    const dir = f.normal.clone().applyAxisAngle(f.up, yaw * DEG).applyAxisAngle(f.right, -pitch * DEG).normalize();
    const fov = opts.fov ?? this.camera.fov;
    const dist = Math.max((span * f.height) / (2 * Math.tan((fov * DEG) / 2)), 0.15);
    const pos = p.clone().addScaledVector(dir, dist);
    const focus = f.toWorld(opts.fa ?? a, opts.fb ?? b);
    return { id: crypto.randomUUID(), t, pos: toVec3(pos), target: toVec3(p), fov, focus: toVec3(focus), scroll: opts.scroll ?? this.currentScroll() };
  }

  // Eixos da tela no mundo: normal, "cima" e "direita" do conteúdo, e conversão de coordenadas do print.
  private screenFrame() {
    const dev = this.device;
    if (!dev) return null;
    dev.screen.updateWorldMatrix(true, false);
    const { w, h } = dev.screenSize;
    const landscape = dev.layout.landscape;
    const toWorld = (a: number, b: number) => {
      const u = landscape ? 1 - b : a;
      const v = landscape ? 1 - a : 1 - b;
      return dev.screen.localToWorld(new THREE.Vector3((u - 0.5) * w, (v - 0.5) * h, 0));
    };
    const top = toWorld(0.5, 0);
    const bottom = toWorld(0.5, 1);
    const up = top.clone().sub(bottom);
    const height = up.length();
    up.normalize();
    const right = toWorld(1, 0.5).sub(toWorld(0, 0.5)).normalize();
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(dev.screen.matrixWorld);
    return { toWorld, up, right, normal, height };
  }

  // Imagem da tela "em pé" (sem a rotação do modo paisagem), para desenhar as áreas de foco.
  getScreenPreview(max = 720): { url: string; aspect: number } | null {
    if (!this.device) return null;
    const src = this.screenCanvas;
    const landscape = this.device.layout.landscape;
    const cw = landscape ? src.height : src.width;
    const ch = landscape ? src.width : src.height;
    const scale = Math.min(1, max / Math.max(cw, ch));
    const out = document.createElement('canvas');
    out.width = Math.round(cw * scale);
    out.height = Math.round(ch * scale);
    const ctx = out.getContext('2d')!;
    ctx.scale(scale, scale);
    if (landscape) {
      ctx.rotate(-Math.PI / 2);
      ctx.translate(-src.width, 0);
    }
    ctx.drawImage(src, 0, 0);
    return { url: out.toDataURL('image/jpeg', 0.86), aspect: cw / ch };
  }

  // Quadro-chave que enquadra um retângulo do print (coordenadas 0–1 da tela "em pé").
  keyframeForRegion(a0: number, b0: number, a1: number, b1: number, t: number): Keyframe | null {
    const dev = this.device;
    if (!dev) return null;
    this.root.updateMatrixWorld(true);
    const { w, h } = dev.screenSize;
    const landscape = dev.layout.landscape;
    const toWorld = (a: number, b: number) => {
      const u = landscape ? 1 - b : a;
      const v = landscape ? 1 - a : 1 - b;
      return dev.screen.localToWorld(new THREE.Vector3((u - 0.5) * w, (v - 0.5) * h, 0));
    };
    const am = (a0 + a1) / 2;
    const bm = (b0 + b1) / 2;
    const center = toWorld(am, bm);
    const rw = toWorld(a0, bm).distanceTo(toWorld(a1, bm));
    const rh = toWorld(am, b0).distanceTo(toWorld(am, b1));
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(dev.screen.matrixWorld);
    const view = this.camera.position.clone().sub(this.controls.target).normalize();
    // Quase de frente para a tela, com um pouco do ângulo atual para manter a sensação de 3D.
    const dir = view.dot(normal) > 0 ? normal.clone().multiplyScalar(0.7).addScaledVector(view, 0.3).normalize() : normal.clone();
    // A área ocupa ~70% do quadro: sobra borda para ainda se perceber o aparelho.
    const tanV = Math.tan((this.camera.fov * DEG) / 2) * 0.7;
    const dist = Math.max(rh / (2 * tanV), rw / (2 * tanV * this.camera.aspect), 0.2);
    const pos = center.clone().addScaledVector(dir, dist);
    return { id: crypto.randomUUID(), t, pos: toVec3(pos), target: toVec3(center), fov: this.camera.fov, focus: toVec3(center), scroll: this.currentScroll() };
  }

  // Grava o vídeo quadro a quadro (H.264/MP4) e devolve o arquivo.
  async exportVideo(opts: VideoOptions): Promise<Blob> {
    const { Output, Mp4OutputFormat, BufferTarget, VideoSampleSource, VideoSample, canEncodeVideo } = await import('mediabunny');
    const width = even(opts.width);
    const height = even(opts.height);
    // Bitrate alto e proporcional ao tamanho (≈12 Mbps em 1080p30, ≈45 Mbps em 4K30): mockup pede nitidez.
    const bitrate = Math.round(Math.min(Math.max(width * height * opts.fps * 0.19, 6e6), 80e6));
    if (!(await canEncodeVideo('avc', { width, height, bitrate }))) {
      throw new Error(`Este navegador não grava H.264 em ${width}×${height}. Tente uma resolução menor.`);
    }
    const wasPlaying = this.anim.playing;
    this.pause();
    const savedT = this.anim.t;
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const source = new VideoSampleSource({ codec: 'avc', bitrate, keyFrameInterval: 2 });
    output.addVideoTrack(source, { frameRate: opts.fps });
    await output.start();

    this.beginOffscreen(width, height);
    const frames = Math.max(1, Math.round(this.state.animation.duration * opts.fps));
    const dt = 1 / opts.fps;
    try {
      for (let i = 0; i < frames; i++) {
        if (opts.signal?.aborted) throw new DOMException('Exportação cancelada', 'AbortError');
        const t = i * dt;
        this.applyTime(t);
        if (this.video) {
          await this.seekVideo(this.videoTime(t));
          this.updateScreen();
        }
        this.renderFrame(dt);
        // O VideoSample copia o canvas na hora: tem que ser logo depois de desenhar.
        const sample = new VideoSample(this.renderer.domElement, { timestamp: t, duration: dt });
        await source.add(sample);
        sample.close();
        opts.onProgress?.((i + 1) / frames);
      }
      await output.finalize();
    } catch (err) {
      await output.cancel().catch(() => undefined);
      throw err;
    } finally {
      this.endOffscreen();
      this.anim.t = savedT;
      this.applyTime(savedT);
      if (wasPlaying) this.play();
      this.dirty = true;
    }
    const buffer = (output.target as InstanceType<typeof BufferTarget>).buffer;
    if (!buffer) throw new Error('O vídeo saiu vazio');
    return new Blob([buffer], { type: 'video/mp4' });
  }

  async exportImage(width: number, height: number): Promise<Blob> {
    if (this.tween) this.finishTween();
    this.beginOffscreen(width, height);
    this.renderFrame();
    // O canvas é copiado no momento da chamada; dá para restaurar o tamanho logo em seguida.
    const blob = new Promise<Blob>((resolve, reject) =>
      this.renderer.domElement.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar o PNG'))), 'image/png'),
    );
    this.endOffscreen();
    this.composer.render();
    return blob;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.video?.pause();
    this.video?.removeEventListener('seeked', this.onVideoSeeked);
    this.renderer.domElement.removeEventListener('dblclick', this.onDblClick);
    this.controls.dispose();
    this.passes.forEach((p) => p.dispose());
    this.composer.dispose();
    this.device?.dispose();
    this.envRT?.dispose();
    this.screenTex?.dispose();
    this.bgTex?.dispose();
    this.shadow.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------- Interno ----------

  private beginOffscreen(width: number, height: number) {
    this.exporting = true;
    this.renderer.setPixelRatio(1);
    this.composer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.updateBackground(width, height);
    this.applyEffectParams(height);
  }

  private endOffscreen() {
    this.exporting = false;
    this.resize(this.size.w, this.size.h);
  }

  private renderFrame(delta?: number) {
    this.updateClip();
    this.backdrop?.follow?.(this.camera, this.controls.target);
    if (this.shadowDirty) this.renderShadow();
    this.composer.render(delta);
  }

  private emitTime() {
    this.onTime?.(this.anim.t, this.anim.playing);
  }

  private currentScroll() {
    return this.scrollOverride ?? this.state.screen.scroll;
  }

  private applyTime(t: number) {
    this.syncScene(t, false);
    const a = this.state.animation;
    const keys = this.activeScene ? a.keyframes.filter((k) => k.scene === this.activeScene) : a.keyframes;
    const pose = samplePose(keys, t, a.ease);
    if (pose) {
      this.camera.position.copy(pose.pos);
      this.controls.target.copy(pose.target);
      if (Math.abs(this.camera.fov - pose.fov) > 1e-4) {
        this.camera.fov = pose.fov;
        this.camera.updateProjectionMatrix();
      }
      this.camera.lookAt(pose.target);
      this.focusPoint.copy(pose.focus);
      this.focusIsCustom = true;
      if (this.scrollOverride === null || Math.abs(this.scrollOverride - pose.scroll) > 1e-4) {
        this.scrollOverride = pose.scroll;
        this.updateScreen();
      }
    }
    this.applyFloat(t);
    if (!this.exporting) this.syncVideo(t, this.anim.playing);
  }

  // Rotação do usuário + flutuação (quando ligada). `base` ignora a flutuação para medir o aparelho.
  private applyFloat(t: number, base = false) {
    const d = this.state.device;
    const a = this.state.animation;
    let rx = d.rotX;
    let ry = d.rotY;
    let rz = d.rotZ;
    let y = 0;
    if (a.float && !base) {
      const size = this.bounds.isEmpty() ? 1.5 : this.bounds.getSize(new THREE.Vector3()).length();
      const o = floatOffset(t, a.duration, a.floatAmount, size);
      rx += o.rotX;
      ry += o.rotY;
      rz += o.rotZ;
      y = o.y;
    }
    this.root.rotation.set(rx * DEG, ry * DEG, rz * DEG, 'YXZ');
    this.root.position.y = y;
    this.shadowDirty = true;
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (this.exporting) return;
    if (this.anim.playing) {
      const dur = this.state.animation.duration;
      let t = (performance.now() - this.anim.start) / 1000;
      if (t > dur) {
        t = t % dur;
        this.anim.start = performance.now() - t * 1000;
      }
      this.anim.t = t;
      this.applyTime(t);
      this.dirty = true;
      this.emitTime();
    }
    if (this.tween) {
      this.stepTween(performance.now());
      this.dirty = true;
    }
    if (this.controls.enabled && this.controls.update()) this.dirty = true;
    if (this.video && !this.video.paused && this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      this.updateScreen();
    }
    if (this.dirty) {
      this.dirty = false;
      this.renderFrame();
    }
  };

  // Desloca o aparelho no quadro sem mudar a perspectiva (deslocamento da lente, como numa câmera técnica).
  private applyOffset() {
    const { offsetX = 0, offsetY = 0 } = this.state.device;
    const cam = this.camera;
    if (!offsetX && !offsetY) {
      if (cam.view?.enabled) cam.clearViewOffset();
    } else {
      // As frações valem para qualquer proporção: o three.js usa offset/fullWidth.
      const fw = cam.aspect * 1000;
      cam.setViewOffset(fw, 1000, -offsetX * fw, offsetY * 1000, fw, 1000);
    }
    this.dirty = true;
  }

  // Planos de corte proporcionais à distância: mais precisão de profundidade de perto e de longe.
  private updateClip() {
    const d = this.camera.position.distanceTo(this.controls.target);
    const near = Math.max(0.02, d * 0.04);
    const far = d * 20 + 20;
    if (Math.abs(this.camera.near - near) > 1e-4 || Math.abs(this.camera.far - far) > 1e-3) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
    // O desfoque lineariza a profundidade com near/far: precisa receber os valores atuais.
    const coc = this.fx?.dof?.cocMaterial;
    if (coc && (coc.uniforms.cameraNear.value !== this.camera.near || coc.uniforms.cameraFar.value !== this.camera.far)) {
      coc.adoptCameraSettings(this.camera);
    }
  }

  private renderShadow() {
    this.shadowDirty = false;
    const l = this.state.lighting;
    this.shadow.mesh.visible = l.shadow && !this.bounds.isEmpty();
    if (!this.shadow.mesh.visible) return;
    this.shadow.setOpacity(l.shadowOpacity);
    this.shadow.update(this.renderer, this.scene, this.bounds, l.shadowSoftness, (l.rotation + KEY_AZIMUTH) * DEG, this.backdrop ? [this.backdrop.group] : []);
  }

  // Distância em que os 8 cantos da caixa do aparelho cabem em ~82% do quadro, vista da direção pedida.
  private fitDistance(az: number, el: number): number {
    const FILL = 0.82;
    const dir = new THREE.Vector3().setFromSphericalCoords(1, (90 - el) * DEG, az * DEG);
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const tanV = Math.tan((this.camera.fov * DEG) / 2) * FILL;
    const tanH = tanV * this.camera.aspect;
    const center = this.bounds.getCenter(new THREE.Vector3());
    const { min, max } = this.bounds;
    let dist = 0;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).sub(center);
      const depth = p.dot(dir);
      dist = Math.max(dist, depth + Math.abs(p.dot(right)) / tanH, depth + Math.abs(p.dot(up)) / tanV);
    }
    return Math.max(dist, 0.5);
  }

  private stepTween(now: number) {
    const t = this.tween!;
    const k = Math.min((now - t.start) / t.dur, 1);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    const s = new THREE.Spherical(
      THREE.MathUtils.lerp(t.from.radius, t.to.radius, e),
      THREE.MathUtils.lerp(t.from.phi, t.to.phi, e),
      THREE.MathUtils.lerp(t.from.theta, t.to.theta, e),
    );
    this.controls.target.lerpVectors(t.t0, t.t1, e);
    this.camera.position.setFromSpherical(s).add(this.controls.target);
    this.camera.lookAt(this.controls.target);
    if (k >= 1) this.tween = null;
  }

  private finishTween() {
    if (!this.tween) return;
    this.tween.start = -Infinity;
    this.stepTween(performance.now());
    this.controls.update();
  }

  private onDblClick = (ev: MouseEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.root, true).find((h) => h.object.visible);
    if (hit) {
      this.focusPoint.copy(hit.point);
      this.focusIsCustom = true;
    } else {
      this.focusPoint.copy(this.screenCenter());
      this.focusIsCustom = false;
    }
    this.dirty = true;
    this.onFocus?.();
  };

  private rebuildDevice() {
    if (this.device) {
      this.root.remove(this.device.group);
      this.device.dispose();
    }
    this.device = buildDevice(this.state.device);
    this.root.add(this.device.group);
    // O aparelho fica sempre nítido de cor: a névoa dos cenários só atinge o fundo.
    this.device.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && 'fog' in m) (m as THREE.MeshStandardMaterial).fog = false;
    });
    // Centraliza o aparelho no pivô de rotação.
    const rot = this.root.rotation.clone();
    const posY = this.root.position.y;
    this.root.rotation.set(0, 0, 0);
    this.root.position.y = 0;
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.device.group, true);
    this.device.group.position.sub(box.getCenter(new THREE.Vector3()));
    this.root.rotation.copy(rot);
    this.root.position.y = posY;
    this.syncEnvMaps();
    if (this.screenTex) {
      this.device.screenMat.map = this.screenTex;
      this.device.screenMat.needsUpdate = true;
    }
    this.focusIsCustom = false;
  }

  private updateBounds() {
    this.root.updateMatrixWorld(true);
    this.bounds.setFromObject(this.root, true);
    this.bounds.getCenter(this.center);
    this.sizeFactor = this.bounds.getSize(new THREE.Vector3()).length() / 1.67;
    if (!this.focusIsCustom) this.focusPoint.copy(this.screenCenter());
    this.shadowDirty = true;
    this.placeKeyLight();
    this.placeBackdrop();
    this.applyEffectParams();
  }

  // Centro da tela em coordenadas do mundo: o ponto de foco natural de um mockup.
  private screenCenter(): THREE.Vector3 {
    if (!this.device) return this.center.clone();
    this.device.screen.updateWorldMatrix(true, false);
    return this.device.screen.getWorldPosition(new THREE.Vector3());
  }

  // O three.js ignora o envMapIntensity de cada material quando o reflexo vem de scene.environment.
  // Para o reflexo do vidro e o cenário terem intensidade própria, o mapa vai direto no material.
  private syncEnvMaps() {
    const env = this.envRT?.texture ?? null;
    const l = this.state.lighting;
    const apply = (m: THREE.MeshStandardMaterial, intensity: number) => {
      m.envMap = env;
      m.envMapRotation.copy(this.scene.environmentRotation);
      m.envMapIntensity = intensity;
      m.needsUpdate = true;
    };
    if (this.device) apply(this.device.glareMat, l.glare * l.intensity);
    this.backdrop?.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && m.isMeshStandardMaterial && m.userData.envBase !== undefined) apply(m, m.userData.envBase * l.intensity);
    });
    this.dirty = true;
  }

  private updateBackdrop() {
    if (this.backdrop) {
      this.scene.remove(this.backdrop.group);
      this.backdrop.dispose();
      this.backdrop = null;
    }
    const sc = this.state.scene;
    const size = this.bounds.isEmpty() ? 1.6 : this.bounds.getSize(new THREE.Vector3());
    const v = size instanceof THREE.Vector3 ? size : new THREE.Vector3(1, 1.6, 0.1);
    this.backdrop = buildBackdrop(sc.backdrop, {
      color: sc.color,
      size: Math.max(v.length(), 1.2),
      footprint: Math.max(v.x, v.z),
      photo: this.backdropImage,
      sky: this.state.background.color1,
    });
    if (this.backdrop) this.scene.add(this.backdrop.group);
    this.syncEnvMaps();
    const fog = this.backdrop?.fog;
    this.scene.fog = fog ? new THREE.FogExp2(fog.color, fog.density) : null;
    this.placeBackdrop();
    this.dirty = true;
  }

  private placeBackdrop() {
    const b = this.backdrop;
    this.shadow.setClip(0, 0, 0);
    if (!b || this.bounds.isEmpty()) return;
    b.group.position.set(this.center.x, this.bounds.min.y, this.center.z);
    if (b.shadowClip) this.shadow.setClip(b.shadowClip, this.center.x, this.center.z);
    this.shadowDirty = true;
  }

  private placeKeyLight() {
    const a = (this.state.lighting.rotation + KEY_AZIMUTH) * DEG;
    const dir = new THREE.Vector3(Math.sin(a) * 0.45, 1, Math.cos(a) * 0.45).normalize();
    this.key.position.copy(this.center).addScaledVector(dir, 12);
    this.key.target.position.copy(this.center);
    this.key.target.updateMatrixWorld();
  }

  private updateScreen() {
    if (!this.device) return;
    const layout = this.device.layout;
    composeScreen(this.screenCanvas, layout, this.image, { ...this.state.screen, scroll: this.currentScroll() });
    const tex = this.screenTex;
    // Textura nova quando o tamanho muda (trocar de aparelho); senão só reenvia os pixels.
    if (!tex || tex.userData.w !== layout.pxW || tex.userData.h !== layout.pxH) {
      tex?.dispose();
      const t = new THREE.CanvasTexture(this.screenCanvas);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      t.userData = { w: layout.pxW, h: layout.pxH };
      this.screenTex = t;
    }
    this.screenTex!.needsUpdate = true;
    this.device.screenMat.map = this.screenTex;
    this.device.screenMat.needsUpdate = true;
    this.dirty = true;
  }

  private updateBackground(w?: number, h?: number) {
    const bw = w ?? Math.round(this.size.w * this.renderer.getPixelRatio());
    const bh = h ?? Math.round(this.size.h * this.renderer.getPixelRatio());
    const scale = Math.min(1, 4096 / Math.max(bw, bh));
    const cw = Math.max(2, Math.round(bw * scale));
    const ch = Math.max(2, Math.round(bh * scale));
    drawBackground(this.bgCanvas, this.state.background, cw, ch);
    if (!this.bgTex || this.bgTex.userData.w !== cw || this.bgTex.userData.h !== ch) {
      this.bgTex?.dispose();
      const t = new THREE.CanvasTexture(this.bgCanvas);
      t.colorSpace = THREE.SRGBColorSpace;
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
      t.userData = { w: cw, h: ch };
      this.bgTex = t;
    }
    this.bgTex.needsUpdate = true;
    if (this.fx) {
      this.fx.composite.uniforms.get('bgMap')!.value = this.bgTex;
      this.fx.composite.uniforms.get('bgOn')!.value = this.state.background.mode === 'transparent' ? 0 : 1;
    }
    this.dirty = true;
  }

  private updateLighting(prev?: SceneState['lighting']) {
    const l = this.state.lighting;
    if (!prev || prev.preset !== l.preset || !this.envRT) {
      this.envRT?.dispose();
      this.envRT = buildEnvironment(this.renderer, l.preset);
      this.scene.environment = this.envRT.texture;
    }
    const preset = ENV_PRESETS[l.preset];
    this.scene.environmentIntensity = l.intensity;
    this.scene.environmentRotation.set(0, l.rotation * DEG, 0);
    this.key.color.set(preset.key.color);
    this.key.intensity = preset.key.intensity * l.intensity;
    this.syncEnvMaps();
    this.shadowDirty = true;
    this.placeKeyLight();
  }

  private updateEffects(prev: SceneState | null) {
    const e = this.state.effects;
    const pe = prev?.effects;
    const structural =
      !this.fx ||
      !pe ||
      pe.dof !== e.dof ||
      pe.bloom !== e.bloom ||
      pe.vignette !== e.vignette ||
      pe.sharpen !== e.sharpen ||
      pe.grain !== e.grain;
    if (structural) this.rebuildPasses();
    this.applyEffectParams();
  }

  // Ordem: cena → foco → tom + fundo → bloom, cor, vinheta → nitidez, grão.
  private rebuildPasses() {
    this.composer.removeAllPasses();
    this.passes.forEach((p) => p.dispose());
    this.passes = [];
    const e = this.state.effects;
    const fx: Effects = {
      tone: new ToneMappingEffect({ mode: TONE[this.state.lighting.tone] }),
      composite: new SceneCompositeEffect(),
      grade: new ColorGradeEffect(),
    };
    if (e.dof) fx.dof = new DepthOfFieldEffect(this.camera, { focusDistance: 5, focusRange: e.focusRange, bokehScale: e.bokeh, resolutionScale: 0.75 });
    if (e.bloom) fx.bloom = new BloomEffect({ intensity: e.bloomIntensity, luminanceThreshold: e.bloomThreshold, luminanceSmoothing: 0.2, mipmapBlur: true, radius: 0.72 });
    if (e.vignette) fx.vignette = new VignetteEffect({ offset: 0.32, darkness: e.vignetteAmount });
    if (e.sharpen) fx.sharpen = new SharpenEffect();
    if (e.grain) fx.noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    this.fx = fx;

    const add = (...effects: (Effect | undefined)[]) => {
      const list = effects.filter((x): x is Effect => !!x);
      if (!list.length) return;
      const pass = new EffectPass(this.camera, ...list);
      this.passes.push(pass);
      this.composer.addPass(pass);
    };
    this.composer.addPass(this.renderPass);
    add(fx.dof);
    add(fx.tone, fx.composite);
    if (fx.sharpen) {
      add(fx.bloom, fx.grade, fx.vignette);
      add(fx.sharpen, fx.noise);
    } else {
      add(fx.bloom, fx.grade, fx.vignette, fx.noise);
    }
    const last = this.passes[this.passes.length - 1];
    if (last) last.dithering = true;
    this.updateBackground();
  }

  // bufferHeight: altura em pixels reais da imagem; o desfoque escala junto para a exportação bater com a prévia.
  private applyEffectParams(bufferHeight?: number) {
    const fx = this.fx;
    if (!fx) return;
    const e = this.state.effects;
    const h = bufferHeight ?? this.size.h * this.renderer.getPixelRatio();
    fx.tone.mode = TONE[this.state.lighting.tone];
    fx.composite.uniforms.get('exposure')!.value = Math.pow(2, e.exposure);
    fx.composite.uniforms.get('softClip')!.value = this.state.lighting.tone === 'soft' ? 1 : 0;
    fx.grade.uniforms.get('contrast')!.value = e.contrast;
    fx.grade.uniforms.get('saturation')!.value = e.saturation;
    fx.grade.uniforms.get('temperature')!.value = e.temperature;
    if (fx.dof) {
      fx.dof.target = this.focusPoint;
      fx.dof.cocMaterial.focusRange = e.focusRange * this.sizeFactor;
      fx.dof.bokehScale = e.bokeh * (h / 1000);
    }
    if (fx.bloom) {
      fx.bloom.intensity = e.bloomIntensity;
      fx.bloom.luminanceMaterial.threshold = e.bloomThreshold;
    }
    if (fx.vignette) fx.vignette.darkness = e.vignetteAmount;
    if (fx.sharpen) fx.sharpen.uniforms.get('amount')!.value = e.sharpenAmount;
    if (fx.noise) fx.noise.blendMode.opacity.value = e.grainAmount;
    this.dirty = true;
  }
}
