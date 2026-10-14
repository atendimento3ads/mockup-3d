import * as THREE from 'three';
import type { EaseKey, Keyframe, Vec3 } from '../state';

export interface Pose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
  focus: THREE.Vector3;
  scroll: number;
}

const smoothCurve = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

export const EASES: Record<EaseKey, (u: number) => number> = {
  smooth: smoothCurve,
  // "Contínuo": a curva vale para a animação inteira (ver samplePose), cada trecho é linear.
  flow: (u) => u,
  linear: (u) => u,
  snappy: (u) => (u < 0.5 ? 16 * Math.pow(u, 5) : 1 - Math.pow(-2 * u + 2, 5) / 2),
};

const vec = (a: Vec3) => new THREE.Vector3(a[0], a[1], a[2]);
const lerp = THREE.MathUtils.lerp;

function toPose(k: Keyframe): Pose {
  return { pos: vec(k.pos), target: vec(k.target), fov: k.fov, focus: vec(k.focus), scroll: k.scroll };
}

// Câmera entre dois quadros-chave: o alvo anda em linha reta e a câmera gira em arco em volta dele
// (distância interpolada em escala logarítmica, para aproximações parecerem constantes).
export function samplePose(keys: Keyframe[], t: number, ease: EaseKey): Pose | null {
  if (!keys.length) return null;
  // No mesmo instante, o quadro de corte vem depois (ele inicia o plano seguinte).
  const ks = [...keys].sort((a, b) => a.t - b.t || Number(!!a.cut) - Number(!!b.cut));
  if (ks.length === 1 || t < ks[0].t) return toPose(ks[0]);
  const last = ks[ks.length - 1];
  if (t >= last.t) return toPose(last);
  if (ease === 'flow') {
    // A curva vale para cada plano inteiro (entre cortes), sem parar nos quadros intermediários.
    let s0 = 0;
    for (let k = 1; k < ks.length; k++) if (ks[k].cut && ks[k].t <= t) s0 = k;
    let s1 = ks.length - 1;
    for (let k = s0 + 1; k < ks.length; k++) if (ks[k].cut) { s1 = k - 1; break; }
    const t0 = ks[s0].t;
    const t1 = ks[s1].t;
    if (t1 > t0 && t <= t1) t = t0 + smoothCurve((t - t0) / (t1 - t0)) * (t1 - t0);
  }
  let i = 0;
  while (i < ks.length - 2 && t >= ks[i + 1].t) i++;
  const a = ks[i];
  const b = ks[i + 1];
  if (b.cut) return toPose(a);
  const e = EASES[ease]((t - a.t) / Math.max(b.t - a.t, 1e-6));
  const ta = vec(a.target);
  const tb = vec(b.target);
  const target = ta.clone().lerp(tb, e);
  const sa = new THREE.Spherical().setFromVector3(vec(a.pos).sub(ta));
  const sb = new THREE.Spherical().setFromVector3(vec(b.pos).sub(tb));
  const dTheta = Math.atan2(Math.sin(sb.theta - sa.theta), Math.cos(sb.theta - sa.theta));
  const radius = Math.exp(lerp(Math.log(Math.max(sa.radius, 1e-4)), Math.log(Math.max(sb.radius, 1e-4)), e));
  const s = new THREE.Spherical(radius, lerp(sa.phi, sb.phi, e), sa.theta + dTheta * e);
  return {
    pos: new THREE.Vector3().setFromSpherical(s).add(target),
    target,
    fov: lerp(a.fov, b.fov, e),
    focus: vec(a.focus).lerp(vec(b.focus), e),
    scroll: lerp(a.scroll, b.scroll, e),
  };
}

// Flutuação suave do aparelho; o número de ciclos é inteiro para o vídeo fechar em loop.
export function floatOffset(t: number, duration: number, amount: number, size: number) {
  const cycles = Math.max(1, Math.round(duration / 4));
  const w = (2 * Math.PI * cycles) / Math.max(duration, 0.1);
  return {
    y: Math.sin(w * t) * 0.035 * size * amount,
    rotX: Math.sin(w * t + 1.1) * 3 * amount,
    rotY: Math.sin(w * t + 0.4) * 6 * amount,
    rotZ: Math.cos(w * t) * 1.5 * amount,
  };
}

// Tempo do vídeo da tela no instante `t` da animação (trechos definidos por clips).
export function videoTimeAt(clips: { t: number; src: number }[], t: number, duration: number): number {
  let vt = t;
  for (const c of [...clips].sort((a, b) => a.t - b.t)) if (c.t <= t + 1e-6) vt = c.src + (t - c.t);
  return Math.min(Math.max(vt, 0), Math.max(duration - 0.02, 0));
}
