import * as THREE from 'three';
import { createNoise2D, fbm, ridged } from './noise';
import type { ScreenImage } from './textures';

// Cenários 3D atrás do aparelho. Como fazem parte da cena, o desfoque (DoF) os transforma em bokeh,
// que é o que dá cara de fotografia. Medidas em função do tamanho do aparelho.

export type BackdropKind = 'none' | 'cove' | 'podium' | 'rocks' | 'dunes' | 'photo';

export interface BackdropBuild {
  group: THREE.Group;
  fog?: { color: THREE.Color; density: number };
  // Pódio: a sombra só pode aparecer em cima dele.
  shadowClip?: number;
  // Foto: o painel acompanha a câmera.
  follow?: (camera: THREE.PerspectiveCamera, target: THREE.Vector3) => void;
  dispose: () => void;
}

interface Opts {
  color: string;
  size: number;
  footprint: number;
  photo: ScreenImage | null;
  sky: string;
}

type Disposable = { dispose(): void };

// Fundo infinito de estúdio: chão que sobe numa curva suave até virar parede (sem quina visível).
function coveGeometry(width: number, front: number, back: number, radius: number, height: number) {
  const profile: [number, number][] = [];
  const floorSteps = 16;
  for (let i = 0; i <= floorSteps; i++) profile.push([front - (front + back) * (i / floorSteps), 0]);
  const arcSteps = 40;
  for (let i = 1; i <= arcSteps; i++) {
    const a = (i / arcSteps) * (Math.PI / 2);
    profile.push([-back - radius * Math.sin(a), radius * (1 - Math.cos(a))]);
  }
  const wallSteps = 10;
  for (let i = 1; i <= wallSteps; i++) profile.push([-back - radius, radius + (height - radius) * (i / wallSteps)]);
  const cols = 24;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < profile.length; i++) {
    for (let c = 0; c <= cols; c++) {
      const x = -width / 2 + (width * c) / cols;
      pos.push(x, profile[i][1], profile[i][0]);
    }
  }
  const row = cols + 1;
  for (let i = 0; i < profile.length - 1; i++) {
    for (let c = 0; c < cols; c++) {
      const a = i * row + c;
      const b = a + row;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildCove(o: Opts, list: Disposable[], podium: boolean): BackdropBuild {
  const group = new THREE.Group();
  const s = o.size;
  const lift = podium ? s * 0.26 : 0;
  const geo = coveGeometry(s * 40, s * 18, s * 2.6, s * 3.2, s * 16);
  const mat = new THREE.MeshStandardMaterial({ color: o.color, roughness: 0.92, metalness: 0 });
  mat.userData.envBase = 0.5;
  const cove = new THREE.Mesh(geo, mat);
  cove.position.y = -lift - 0.003;
  group.add(cove);
  list.push(geo, mat);
  let shadowClip: number | undefined;
  if (podium) {
    const radius = o.footprint * 0.62 + s * 0.18;
    const pg = new THREE.CylinderGeometry(radius, radius, lift, 128, 1);
    const pm = new THREE.MeshStandardMaterial({ color: new THREE.Color(o.color).multiplyScalar(0.92), roughness: 0.6, metalness: 0 });
    pm.userData.envBase = 0.58;
    const pod = new THREE.Mesh(pg, pm);
    pod.position.y = -lift / 2 - 0.0015;
    group.add(pod);
    list.push(pg, pm);
    shadowClip = radius * 0.985;
  }
  return { group, shadowClip, dispose: () => list.forEach((d) => d.dispose()) };
}

function buildTerrain(o: Opts, list: Disposable[], kind: 'rocks' | 'dunes'): BackdropBuild {
  const group = new THREE.Group();
  const s = o.size;
  const span = s * 70;
  const n = 260;
  const geo = new THREE.PlaneGeometry(span, span, n, n).rotateX(-Math.PI / 2);
  const noise = createNoise2D(kind === 'rocks' ? 11 : 23);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const base = new THREE.Color(kind === 'rocks' ? '#3a3b3f' : '#c9925e');
  const dark = new THREE.Color(kind === 'rocks' ? '#121214' : '#8d5a35');
  const light = new THREE.Color(kind === 'rocks' ? '#6c6d72' : '#e6b585');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / s;
    const z = pos.getZ(i) / s;
    const dist = Math.hypot(x, z);
    // Perto do aparelho o chão é quase plano; o relevo cresce com a distância.
    const mask = THREE.MathUtils.smoothstep(dist, 2.5, kind === 'rocks' ? 13 : 9);
    let hgt: number;
    let shade: number;
    if (kind === 'rocks') {
      const r = ridged(noise, x * 0.085, z * 0.085, 6);
      const detail = fbm(noise, x * 0.6 + 40, z * 0.6, 4);
      hgt = mask * (Math.pow(r, 2.2) * 9 + detail * 0.6) + detail * 0.06;
      shade = THREE.MathUtils.clamp(0.35 + r * 0.5 + detail * 0.4, 0, 1);
    } else {
      const warp = fbm(noise, x * 0.05, z * 0.05, 3) * 6;
      const dune = Math.sin((x + warp) * 0.42 + z * 0.12) * 0.5 + 0.5;
      hgt = mask * (Math.pow(dune, 1.6) * 2.4 + fbm(noise, x * 0.12, z * 0.12, 4) * 1.4);
      shade = THREE.MathUtils.clamp(0.45 + dune * 0.45 + fbm(noise, x * 2, z * 2, 2) * 0.15, 0, 1);
    }
    pos.setY(i, hgt * s);
    c.copy(dark).lerp(base, Math.min(shade * 1.6, 1)).lerp(light, Math.max(shade - 0.62, 0) * 1.8);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: kind === 'rocks' ? 0.95 : 0.85, metalness: 0 });
  mat.userData.envBase = kind === 'rocks' ? 0.45 : 0.7;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -0.004;
  group.add(mesh);
  list.push(geo, mat);
  const fogColor = new THREE.Color(o.sky);
  return { group, fog: { color: fogColor, density: (kind === 'rocks' ? 0.03 : 0.035) / s }, dispose: () => list.forEach((d) => d.dispose()) };
}

function buildPhoto(o: Opts, list: Disposable[]): BackdropBuild | null {
  if (!o.photo) return null;
  const group = new THREE.Group();
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 4096 / Math.max(o.photo.w, o.photo.h));
  canvas.width = Math.max(2, Math.round(o.photo.w * scale));
  canvas.height = Math.max(2, Math.round(o.photo.h * scale));
  canvas.getContext('2d')!.drawImage(o.photo.src, 0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({ map: tex, fog: false, depthWrite: true });
  const plane = new THREE.Mesh(geo, mat);
  plane.frustumCulled = false;
  group.add(plane);
  list.push(geo, mat, tex);
  const aspect = canvas.width / canvas.height;
  const dir = new THREE.Vector3();
  // Painel sempre atrás do aparelho, de frente para a câmera e cobrindo o quadro inteiro.
  const follow = (camera: THREE.PerspectiveCamera, target: THREE.Vector3) => {
    dir.copy(target).sub(camera.position);
    const camDist = dir.length();
    dir.normalize();
    const behind = Math.max(camDist * 2.2, o.size * 6);
    // Posição calculada no mundo; o grupo do cenário fica na altura do chão, então converte.
    plane.position.copy(target).addScaledVector(dir, behind);
    group.updateMatrixWorld();
    group.worldToLocal(plane.position);
    plane.quaternion.copy(camera.quaternion);
    const d = camDist + behind;
    const hgt = 2 * Math.tan((camera.fov * Math.PI) / 360) * d * 1.08;
    const wid = hgt * camera.aspect;
    if (wid / hgt > aspect) plane.scale.set(wid, wid / aspect, 1);
    else plane.scale.set(hgt * aspect, hgt, 1);
    plane.updateMatrixWorld();
  };
  return { group, follow, dispose: () => list.forEach((d) => d.dispose()) };
}

export function buildBackdrop(kind: BackdropKind, o: Opts): BackdropBuild | null {
  const list: Disposable[] = [];
  switch (kind) {
    case 'none':
      return null;
    case 'cove':
      return buildCove(o, list, false);
    case 'podium':
      return buildCove(o, list, true);
    case 'rocks':
    case 'dunes':
      return buildTerrain(o, list, kind);
    case 'photo':
      return buildPhoto(o, list);
  }
}
