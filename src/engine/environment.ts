import * as THREE from 'three';
import type { LightPreset } from '../state';

// Estúdio virtual convertido em mapa de ambiente (reflexos e luz difusa).
// Uma cúpula em degradê faz o "ambiente" e softboxes com borda suave fazem as luzes.
// Nada é baixado: tudo é desenhado na hora.

interface Panel {
  w: number;
  h: number;
  color: string;
  intensity: number;
  pos: [number, number, number];
  strip?: boolean;
}

interface Preset {
  dome: { top: string; horizon: string; bottom: string; intensity: number };
  key: { color: string; intensity: number };
  panels: Panel[];
}

// Regra de estúdio de produto: o lado da câmera (horizonte) fica escuro para a tela continuar preta;
// a luz vem de cima, das laterais e de faixas de recorte atrás do aparelho.
export const ENV_PRESETS: Record<LightPreset, Preset> = {
  studio: {
    dome: { top: '#555861', horizon: '#18191c', bottom: '#09090b', intensity: 1 },
    key: { color: '#ffffff', intensity: 1.2 },
    panels: [
      { w: 9, h: 7, color: '#ffffff', intensity: 5, pos: [-7, 6, 5] },
      { w: 6, h: 8, color: '#f4f6ff', intensity: 1.6, pos: [8, 4, 3] },
      { w: 16, h: 6, color: '#ffffff', intensity: 3.4, pos: [0, 10, 0] },
      { w: 4.5, h: 10, color: '#ffffff', intensity: 4.5, pos: [-7, 1.5, -6] },
      { w: 4.5, h: 10, color: '#ffffff', intensity: 4.5, pos: [7, 1.5, -6] },
      { w: 1.4, h: 10, color: '#ffffff', intensity: 6, pos: [-3, 3, -8], strip: true },
      { w: 12, h: 1.4, color: '#ffffff', intensity: 1.2, pos: [0, 7.5, 7], strip: true },
    ],
  },
  soft: {
    dome: { top: '#cfd2d9', horizon: '#45474d', bottom: '#26272b', intensity: 1 },
    key: { color: '#ffffff', intensity: 0.9 },
    panels: [
      { w: 18, h: 18, color: '#ffffff', intensity: 2.8, pos: [0, 10, 0] },
      { w: 8, h: 8, color: '#ffffff', intensity: 1.8, pos: [-9, 5, 2] },
      { w: 8, h: 8, color: '#ffffff', intensity: 1.3, pos: [9, 5, 2] },
      { w: 5, h: 10, color: '#ffffff', intensity: 3.2, pos: [-7, 1.5, -6] },
      { w: 5, h: 10, color: '#ffffff', intensity: 3.2, pos: [7, 1.5, -6] },
      { w: 10, h: 1.6, color: '#ffffff', intensity: 1.4, pos: [0, 8, 6], strip: true },
    ],
  },
  dramatic: {
    dome: { top: '#1a1b1f', horizon: '#09090b', bottom: '#000000', intensity: 1 },
    key: { color: '#ffffff', intensity: 1.4 },
    panels: [
      { w: 1.8, h: 12, color: '#ffffff', intensity: 9, pos: [-5, 3, 5], strip: true },
      { w: 1.4, h: 11, color: '#ffffff', intensity: 6, pos: [6, 3, -5], strip: true },
      { w: 10, h: 1.2, color: '#ffffff', intensity: 2.5, pos: [0, 10, 1], strip: true },
    ],
  },
  warm: {
    dome: { top: '#5a4130', horizon: '#241710', bottom: '#0b0605', intensity: 1 },
    key: { color: '#ffd0a0', intensity: 1.2 },
    panels: [
      { w: 9, h: 8, color: '#ffb070', intensity: 5.5, pos: [-7, 6, 5] },
      { w: 5, h: 7, color: '#86b4ff', intensity: 2, pos: [8, 4, 3] },
      { w: 14, h: 3, color: '#fff3e6', intensity: 2.4, pos: [0, 10, 0] },
      { w: 1.6, h: 10, color: '#ffd9b0', intensity: 5, pos: [7, 2, -6], strip: true },
    ],
  },
  neon: {
    dome: { top: '#1d1233', horizon: '#0b0614', bottom: '#030206', intensity: 1 },
    key: { color: '#d9c8ff', intensity: 0.45 },
    panels: [
      { w: 1.8, h: 11, color: '#ff3d9a', intensity: 8, pos: [-6, 2, 4], strip: true },
      { w: 1.8, h: 11, color: '#3de0ff', intensity: 8, pos: [6, 2, 4], strip: true },
      { w: 14, h: 2, color: '#8a5cff', intensity: 3, pos: [0, 10, 0], strip: true },
    ],
  },
};

let softboxTex: THREE.CanvasTexture | null = null;
let stripTex: THREE.CanvasTexture | null = null;

// Softbox com centro mais forte e borda que se dissolve: dá degradês suaves no metal e no vidro.
function softbox(strip: boolean): THREE.CanvasTexture {
  const cached = strip ? stripTex : softboxTex;
  if (cached) return cached;
  const w = strip ? 96 : 256;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const pad = strip ? 18 : 30;
  ctx.filter = `blur(${strip ? 9 : 16}px)`;
  ctx.fillStyle = '#b8b8b8';
  ctx.beginPath();
  ctx.roundRect(pad, pad, w - pad * 2, h - pad * 2, strip ? 20 : 34);
  ctx.fill();
  ctx.filter = 'none';
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.45);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  if (strip) stripTex = tex;
  else softboxTex = tex;
  return tex;
}

const domeVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const domeFragment = /* glsl */ `
  uniform vec3 top;
  uniform vec3 horizon;
  uniform vec3 bottom;
  varying vec3 vDir;
  void main() {
    float y = normalize(vDir).y;
    vec3 c = y > 0.0 ? mix(horizon, top, pow(y, 0.55)) : mix(horizon, bottom, pow(-y, 0.35));
    gl_FragColor = vec4(c, 1.0);
  }`;

export function buildEnvironment(renderer: THREE.WebGLRenderer, preset: LightPreset): THREE.WebGLRenderTarget {
  const p = ENV_PRESETS[preset];
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];

  const domeGeo = new THREE.SphereGeometry(50, 48, 24);
  const domeMat = new THREE.ShaderMaterial({
    vertexShader: domeVertex,
    fragmentShader: domeFragment,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(p.dome.top).multiplyScalar(p.dome.intensity) },
      horizon: { value: new THREE.Color(p.dome.horizon).multiplyScalar(p.dome.intensity) },
      bottom: { value: new THREE.Color(p.dome.bottom).multiplyScalar(p.dome.intensity) },
    },
  });
  scene.add(new THREE.Mesh(domeGeo, domeMat));
  disposables.push(domeGeo, domeMat);

  for (const panel of p.panels) {
    const geo = new THREE.PlaneGeometry(panel.w, panel.h);
    const mat = new THREE.MeshBasicMaterial({
      map: softbox(!!panel.strip),
      color: new THREE.Color(panel.color).multiplyScalar(panel.intensity),
      side: THREE.DoubleSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...panel.pos);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
    disposables.push(geo, mat);
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.015, 0.1, 100, { size: 512 });
  pmrem.dispose();
  disposables.forEach((d) => d.dispose());
  return rt;
}
