// Operações com cenas na linha do tempo. Funções puras: recebem o estado e devolvem o novo.
// Cada cena tem aparelho, tela e mídia próprios; os quadros-chave dizem a qual cena pertencem.
import { sceneSpan, type Keyframe, type SceneClip, type SceneState } from './state';

const round = (v: number) => Math.round(v * 1000) / 1000;
const DEFAULT_LENGTH = 5;

type Anim = SceneState['animation'];
const withAnim = (s: SceneState, patch: Partial<Anim>): SceneState => ({ ...s, animation: { ...s.animation, ...patch } });

// A primeira cena nasce da montagem atual (aparelho, tela, mídia e animação).
export function ensureScenes(s: SceneState, media: string | null): SceneState {
  if (s.animation.scenes.length) return s;
  const id = crypto.randomUUID();
  return withAnim(s, {
    scenes: [{ id, t: 0, device: s.device, screen: s.screen, media }],
    keyframes: s.animation.keyframes.map((k) => ({ ...k, scene: id })),
    clips: [],
  });
}

// Nova cena no fim: cópia da cena `fromId` (mesmo aparelho, mídia e movimento), para trocar o que quiser.
export function addScene(s: SceneState, fromId: string | null, media: string | null): { state: SceneState; id: string } {
  const base = ensureScenes(s, media);
  const { scenes, keyframes, duration } = base.animation;
  const from = scenes.find((x) => x.id === fromId) ?? scenes[scenes.length - 1];
  const [t0, t1] = sceneSpan(scenes, from.id, duration);
  const length = t1 - t0 >= 1 ? t1 - t0 : DEFAULT_LENGTH;
  const id = crypto.randomUUID();
  const start = round(duration);
  const copied = keyframes
    .filter((k) => k.scene === from.id)
    .map((k) => ({ ...k, id: crypto.randomUUID(), scene: id, t: round(start + Math.min(k.t - t0, length)) }));
  const scene: SceneClip = { ...from, id, t: start, device: { ...from.device }, screen: { ...from.screen } };
  return {
    state: withAnim(base, { scenes: [...scenes, scene], keyframes: [...keyframes, ...copied], duration: round(start + length) }),
    id,
  };
}

// Tira a cena e o trecho dela; as seguintes andam para trás.
export function removeScene(s: SceneState, id: string): SceneState {
  const { scenes, keyframes, duration } = s.animation;
  if (scenes.length <= 1) return s;
  const [t0, t1] = sceneSpan(scenes, id, duration);
  const len = t1 - t0;
  const later = new Set(scenes.filter((x) => x.t > t0).map((x) => x.id));
  return withAnim(s, {
    scenes: scenes.filter((x) => x.id !== id).map((x) => (later.has(x.id) ? { ...x, t: round(x.t - len) } : x)),
    keyframes: keyframes.filter((k) => k.scene !== id).map((k) => (k.scene && later.has(k.scene) ? { ...k, t: round(k.t - len) } : k)),
    duration: round(Math.max(duration - len, 1)),
  });
}

// Muda a duração de uma cena: o movimento dela estica e as seguintes se deslocam.
export function resizeScene(s: SceneState, id: string, length: number): SceneState {
  const { scenes, keyframes, duration } = s.animation;
  const [t0, t1] = sceneSpan(scenes, id, duration);
  const len = Math.max(t1 - t0, 1e-3);
  const next = Math.min(Math.max(length, 0.5), 60);
  const k = next / len;
  const delta = next - len;
  const later = new Set(scenes.filter((x) => x.t > t0).map((x) => x.id));
  return withAnim(s, {
    scenes: scenes.map((x) => (later.has(x.id) ? { ...x, t: round(x.t + delta) } : x)),
    keyframes: keyframes.map((kf) =>
      kf.scene === id ? { ...kf, t: round(t0 + (kf.t - t0) * k) } : kf.scene && later.has(kf.scene) ? { ...kf, t: round(kf.t + delta) } : kf,
    ),
    duration: round(duration + delta),
  });
}

// Muda a duração total: cenas e quadros-chave esticam juntos.
export function scaleTimeline(anim: Anim, duration: number): Partial<Anim> {
  const k = duration / anim.duration;
  return {
    duration,
    keyframes: anim.keyframes.map((x) => ({ ...x, t: Math.round(x.t * k * 100) / 100 })),
    scenes: anim.scenes.map((x) => ({ ...x, t: Math.round(x.t * k * 100) / 100 })),
  };
}

export function patchScene(s: SceneState, id: string, patch: Partial<Omit<SceneClip, 'id' | 't'>>): SceneState {
  return withAnim(s, { scenes: s.animation.scenes.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
}

// Coloca um movimento (tempos a partir de 0, com `srcDuration`) dentro da cena, esticado para caber nela.
export function setSceneKeys(s: SceneState, id: string, keys: Keyframe[], srcDuration: number): SceneState {
  const { scenes, keyframes, duration } = s.animation;
  const [t0, t1] = sceneSpan(scenes, id, duration);
  const k = (t1 - t0) / Math.max(srcDuration, 1e-3);
  const mine = keys.map((x) => ({ ...x, id: crypto.randomUUID(), scene: id, t: round(t0 + x.t * k) }));
  return withAnim(s, { keyframes: [...keyframes.filter((x) => x.scene !== id), ...mine] });
}

// Duração de uma cena.
export function sceneLength(s: SceneState, id: string): number {
  const [t0, t1] = sceneSpan(s.animation.scenes, id, s.animation.duration);
  return round(t1 - t0);
}
