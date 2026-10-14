import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Raios por canto: superior esquerdo, superior direito, inferior direito, inferior esquerdo.
export type Radii = number | [number, number, number, number];

// Cantos "contínuos" no estilo Apple: em vez de um arco de círculo (que muda de curvatura de repente
// ao encostar na reta), usa um quarto de superelipse, que nasce da reta sem degrau de curvatura.
// O raio efetivo é maior para o canto parecer do mesmo tamanho que o arco equivalente.
const SMOOTH_SCALE = 1.3;
const SMOOTH_N = 5;
const CORNER_STEPS = 28;

// Começa no passo 1 (o ponto inicial já veio da reta) e, no último canto, para antes de fechar
// no ponto de partida: pontos repetidos estragam as normais da extrusão.
function smoothCorner(s: THREE.Path, cx: number, cy: number, r: number, from: number, skipLast = false) {
  for (let i = 1; i <= CORNER_STEPS - (skipLast ? 1 : 0); i++) {
    const t = from + (i / CORNER_STEPS) * (Math.PI / 2);
    const c = Math.cos(t);
    const sn = Math.sin(t);
    const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / SMOOTH_N);
    const y = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / SMOOTH_N);
    s.lineTo(cx + r * x, cy + r * y);
  }
}

export function roundedRectShape(w: number, h: number, radii: Radii, smooth = false): THREE.Shape {
  const max = Math.min(w, h) / 2;
  const list = Array.isArray(radii) ? radii : [radii, radii, radii, radii];
  const [tl, tr, br, bl] = list.map((r) => Math.min(Math.max(r * (smooth ? SMOOTH_SCALE : 1), 0), max));
  const x = -w / 2;
  const y = -h / 2;
  const s = new THREE.Shape();
  s.moveTo(x + bl, y);
  s.lineTo(x + w - br, y);
  if (br > 0) smooth ? smoothCorner(s, x + w - br, y + br, br, -Math.PI / 2) : s.absarc(x + w - br, y + br, br, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - tr);
  if (tr > 0) smooth ? smoothCorner(s, x + w - tr, y + h - tr, tr, 0) : s.absarc(x + w - tr, y + h - tr, tr, 0, Math.PI / 2, false);
  s.lineTo(x + tl, y + h);
  if (tl > 0) smooth ? smoothCorner(s, x + tl, y + h - tl, tl, Math.PI / 2) : s.absarc(x + tl, y + h - tl, tl, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + bl);
  if (bl > 0) smooth ? smoothCorner(s, x + bl, y + bl, bl, Math.PI, true) : s.absarc(x + bl, y + bl, bl, Math.PI, Math.PI * 1.5, false);
  return s;
}

// Plano com cantos arredondados e UV de 0 a 1 no retângulo inteiro (para telas).
export function roundedPlane(w: number, h: number, radii: Radii, smooth = false, segments = 24): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(roundedRectShape(w, h, radii, smooth), segments);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
  uv.needsUpdate = true;
  return g;
}

// Bloco arredondado (corpo de aparelho): cantos em planta com raio r e bordas com chanfro suave.
export function roundedSlab(
  w: number,
  h: number,
  d: number,
  r: number,
  bevel = Math.min(d * 0.45, r * 0.9),
  opts: { smooth?: boolean; bevelSegments?: number } = {},
): THREE.BufferGeometry {
  const b = Math.min(bevel, d / 2 - 1e-4, Math.min(w, h) / 2 - 1e-4);
  const shape = roundedRectShape(w - 2 * b, h - 2 * b, Math.max(r - b, 1e-4), opts.smooth);
  let g: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(d - 2 * b, 1e-4),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: opts.bevelSegments ?? 10,
    curveSegments: 48,
  });
  g.translate(0, 0, -(d - 2 * b) / 2);
  // O Extrude sai com normais facetadas; fundir vértices deixa os reflexos do metal lisos.
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-6);
  g.computeVertexNormals();
  return g;
}
