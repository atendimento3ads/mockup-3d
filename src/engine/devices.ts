import * as THREE from 'three';
import { roundedPlane, roundedSlab } from './geometry';
import { drawDeck, grainAt, type ScreenLayout } from './textures';
import { finishColor, type SceneState } from '../state';

// Unidade de cena: 1 = 10 cm. Medidas aproximadas dos aparelhos reais, modeladas do zero.

export interface DeviceBuild {
  group: THREE.Group;
  screen: THREE.Mesh;
  screenSize: { w: number; h: number };
  screenMat: THREE.MeshBasicMaterial;
  glareMat: THREE.MeshStandardMaterial;
  layout: ScreenLayout;
  setLid?: (deg: number) => void;
  dispose: () => void;
}

const MAX_PX = 3072;
const DEG = Math.PI / 180;

function pxFor(aspect: number): [number, number] {
  return aspect >= 1 ? [MAX_PX, Math.round(MAX_PX / aspect)] : [Math.round(MAX_PX * aspect), MAX_PX];
}

type Disposable = { dispose(): void };
type Track = <T extends Disposable>(x: T) => T;

function tracker() {
  const list: Disposable[] = [];
  const track: Track = (x) => {
    list.push(x);
    return x;
  };
  return { track, dispose: () => list.forEach((x) => x.dispose()) };
}

// Vidro, tela, ilha/notch e reflexo ficam a frações de milímetro uns dos outros. O polygon offset
// garante a ordem na profundidade mesmo com a câmera longe, sem "z-fighting" (blocos piscando).
function layer<T extends THREE.Material>(mat: T, level: number): T {
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -level;
  mat.polygonOffsetUnits = -level * 2;
  return mat;
}

// A tela é sem iluminação (cores exatas do print); o vidro por cima soma só os reflexos.
function screenMaterial() {
  return layer(new THREE.MeshBasicMaterial({ color: 0xffffff }), 1);
}

// Ilha dinâmica e notch: preto puro, sem reflexo próprio (o vidro por cima já reflete).
function cutoutMaterial() {
  return layer(new THREE.MeshBasicMaterial({ color: 0x000000 }), 2);
}

// Furos, portas e frestas: quase pretos e foscos, colados na superfície.
function holeMaterial() {
  return layer(new THREE.MeshStandardMaterial({ color: 0x060607, roughness: 0.75, metalness: 0 }), 1);
}

// Soma só a cor do reflexo e deixa o alfa como está: com AdditiveBlending o alfa passaria de 1
// no buffer de ponto flutuante e a composição do fundo escureceria a tela.
function glareMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x000000,
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  return layer(mat, 3);
}

type Face = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

// Coloca um plano (que olha para +z) voltado para a face indicada.
function onFace(mesh: THREE.Mesh, face: Face, x: number, y: number, z: number) {
  mesh.position.set(x, y, z);
  if (face === '-z') mesh.rotation.y = Math.PI;
  if (face === '+x') mesh.rotation.y = Math.PI / 2;
  if (face === '-x') mesh.rotation.y = -Math.PI / 2;
  if (face === '+y') mesh.rotation.x = -Math.PI / 2;
  if (face === '-y') mesh.rotation.x = Math.PI / 2;
  return mesh;
}

// Fileira de furinhos (alto-falantes, microfones) numa face.
function holeRow(g: THREE.Group, track: Track, mat: THREE.Material, face: Face, count: number, start: THREE.Vector3, step: THREE.Vector3, r: number) {
  const geo = track(new THREE.CircleGeometry(r, 20));
  for (let i = 0; i < count; i++) {
    const p = start.clone().addScaledVector(step, i);
    g.add(onFace(new THREE.Mesh(geo, mat), face, p.x, p.y, p.z));
  }
}

interface PhoneSpec {
  w: number;
  h: number;
  d: number;
  r: number;
  edge: number;
  lip: number;
  bezel: number;
  glassT: number;
  island: boolean;
  tablet: boolean;
}

// iPhone 16 Pro: 71,5 × 149,6 × 8,25 mm, borda preta de ~1,25 mm. iPad Pro 11": 177,5 × 249,7 × 5,3 mm.
const IPHONE: PhoneSpec = { w: 0.715, h: 1.496, d: 0.0825, r: 0.118, edge: 0.018, lip: 0.005, bezel: 0.0128, glassT: 0.009, island: true, tablet: false };
const IPAD: PhoneSpec = { w: 1.775, h: 2.497, d: 0.053, r: 0.1, edge: 0.008, lip: 0.006, bezel: 0.082, glassT: 0.006, island: false, tablet: true };

function buildPhone(spec: PhoneSpec, color: string, landscape: boolean, showIsland: boolean): DeviceBuild {
  const { track, dispose } = tracker();
  const outer = new THREE.Group();
  const g = new THREE.Group();
  outer.add(g);
  const { w, h, d, r, edge, lip, bezel, glassT } = spec;
  const zf = d / 2;

  // Aro: titânio acetinado (iPhone) ou alumínio jateado (iPad), com contorno bem arredondado.
  const frameMat = track(new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: spec.tablet ? 0.4 : 0.3 }));
  g.add(new THREE.Mesh(track(roundedSlab(w, h, d, r, edge, { smooth: true, bevelSegments: 18 })), frameMat));

  // Vidro frontal com espessura própria: a borda curva dele é o fio de luz em volta da tela.
  const gw = w - 2 * lip;
  const gh = h - 2 * lip;
  const gr = r - lip;
  const glassTop = zf + 0.0012;
  const glassMat = track(new THREE.MeshPhysicalMaterial({ color: 0x030304, roughness: 0.035, metalness: 0, ior: 1.52, specularIntensity: 1 }));
  const glass = new THREE.Mesh(track(roundedSlab(gw, gh, glassT, gr, glassT * 0.48, { smooth: true, bevelSegments: 10 })), glassMat);
  glass.position.z = glassTop - glassT / 2;
  g.add(glass);

  const sw = gw - 2 * bezel;
  const sh = gh - 2 * bezel;
  const sr = Math.max(gr - bezel * 0.85, 0.012);
  const screenMat = track(screenMaterial());
  const screen = new THREE.Mesh(track(roundedPlane(sw, sh, sr, true)), screenMat);
  screen.position.z = glassTop + 0.0002;
  g.add(screen);

  const hole = track(holeMaterial());
  const cutout = track(cutoutMaterial());
  if (spec.island && showIsland) {
    // Ilha dinâmica: 126 × 37 pt numa tela de 402 pt, a 11 pt do topo.
    const iw = sw * 0.313;
    const ih = sw * 0.092;
    const island = new THREE.Mesh(track(roundedPlane(iw, ih, ih / 2)), cutout);
    island.position.set(0, sh / 2 - sw * 0.027 - ih / 2, glassTop + 0.0004);
    g.add(island);
  }
  if (spec.tablet) {
    // Câmera frontal na borda longa, como no iPad Pro atual.
    const cam = new THREE.Mesh(track(new THREE.CircleGeometry(0.009, 24)), cutout);
    cam.position.set(sw / 2 + bezel / 2, 0, glassTop + 0.0003);
    g.add(cam);
  }

  // Reflexo só sobre a tela (o vidro da borda já reflete sozinho, com a mesma intensidade).
  const glareMat = track(glareMaterial());
  const glare = new THREE.Mesh(track(roundedPlane(sw, sh, sr, true)), glareMat);
  glare.position.z = glassTop + 0.0007;
  glare.renderOrder = 5;
  g.add(glare);

  // Traseira: borda de vidro polido e, por cima, a área fosca texturizada (iPhone) ou alumínio (iPad).
  const tint = new THREE.Color(color).lerp(new THREE.Color('#d9d9d9'), 0.12);
  const backT = 0.006;
  const backEdgeMat = spec.tablet ? frameMat : track(new THREE.MeshPhysicalMaterial({ color: tint, metalness: 0, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 }));
  if (!spec.tablet) {
    const backGlass = new THREE.Mesh(track(roundedSlab(gw, gh, backT, gr, backT * 0.45, { smooth: true })), backEdgeMat);
    backGlass.position.z = -zf - 0.0008 + backT / 2;
    g.add(backGlass);
  }
  const backMat = spec.tablet
    ? track(new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: 0.42, normalMap: track(grainAt(26, 36)), normalScale: new THREE.Vector2(0.12, 0.12) }))
    : track(new THREE.MeshPhysicalMaterial({ color: tint, metalness: 0, roughness: 0.42, normalMap: track(grainAt(10, 20)), normalScale: new THREE.Vector2(0.3, 0.3) }));
  const inset = spec.tablet ? 0 : backT * 0.6;
  const back = new THREE.Mesh(track(roundedPlane(gw - inset * 2, gh - inset * 2, gr - inset, true)), backMat);
  back.position.z = -zf - 0.0012;
  back.rotation.y = Math.PI;
  g.add(back);

  addCameraModule(g, spec, color, track);
  if (spec.tablet) addTabletDetails(g, spec, frameMat, hole, track);
  else addPhoneDetails(g, spec, color, frameMat, hole, track);
  if (landscape) g.rotation.z = Math.PI / 2;

  const [pxW, pxH] = pxFor(sw / sh);
  return { group: outer, screen, screenSize: { w: sw, h: sh }, screenMat, glareMat, layout: { pxW, pxH, landscape }, dispose };
}

function addCameraModule(g: THREE.Group, spec: PhoneSpec, color: string, track: Track) {
  const zb = -spec.d / 2;
  const size = spec.tablet ? 0.26 : 0.36;
  const margin = spec.tablet ? 0.045 : 0.035;
  // Visto de trás, o +x local fica à esquerda: módulo no canto superior esquerdo da traseira.
  const cx = spec.w / 2 - margin - size / 2;
  const cy = spec.h / 2 - margin - size / 2;
  const pd = spec.tablet ? 0.008 : 0.012;
  // Platô de vidro polido (contrasta com a traseira fosca).
  const plateMat = track(new THREE.MeshPhysicalMaterial({ color, roughness: 0.14, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04 }));
  const plate = new THREE.Mesh(track(roundedSlab(size, size, pd, size * 0.22, pd * 0.45, { smooth: true })), plateMat);
  plate.position.set(cx, cy, zb - pd / 2);
  g.add(plate);

  const zTop = zb - pd;
  const s = size / 0.36;
  const lensR = 0.068 * s;
  const lensH = 0.014 * s;
  const lenses: [number, number][] = spec.tablet ? [[0.07, 0.07]] : [[0.082, 0.082], [0.082, -0.082], [-0.085, 0]];
  const ringMat = track(new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: 0.16 }));
  // Vidro de safira com película antirreflexo: o reflexo muda de cor conforme o ângulo.
  const coverMat = track(
    new THREE.MeshPhysicalMaterial({
      color: 0x030406,
      roughness: 0.04,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      iridescence: 1,
      iridescenceIOR: 1.9,
      iridescenceThicknessRange: [250, 650],
    }),
  );
  const innerRingMat = track(new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.35, metalness: 0.6 }));
  const coreMat = track(new THREE.MeshPhysicalMaterial({ color: 0x0b0f24, roughness: 0.05, metalness: 0.2, iridescence: 0.8, iridescenceIOR: 1.6 }));
  const ringGeo = track(new THREE.CylinderGeometry(lensR, lensR * 1.02, lensH, 56));
  const coverGeo = track(new THREE.CircleGeometry(lensR * 0.84, 56));
  const innerRingGeo = track(new THREE.RingGeometry(lensR * 0.36, lensR * 0.5, 48));
  const coreGeo = track(new THREE.CircleGeometry(lensR * 0.3, 40));
  for (const [lx, ly] of lenses) {
    const x = cx + lx * s;
    const y = cy + ly * s;
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, y, zTop - lensH / 2);
    const cover = new THREE.Mesh(coverGeo, coverMat);
    cover.rotation.y = Math.PI;
    cover.position.set(x, y, zTop - lensH - 0.0004);
    const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
    innerRing.rotation.y = Math.PI;
    innerRing.position.set(x, y, zTop - lensH - 0.0008);
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.rotation.y = Math.PI;
    core.position.set(x, y, zTop - lensH - 0.001);
    g.add(ring, cover, innerRing, core);
  }
  const dot = (x: number, y: number, radius: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(track(new THREE.CircleGeometry(radius, 32)), mat);
    m.rotation.y = Math.PI;
    m.position.set(cx + x * s, cy + y * s, zTop - 0.0005);
    g.add(m);
  };
  const flashMat = track(new THREE.MeshPhysicalMaterial({ color: 0xf6edd5, roughness: 0.3, clearcoat: 1 }));
  const lidarMat = track(new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.1, clearcoat: 1 }));
  dot(spec.tablet ? -0.07 : -0.085, 0.105, 0.022 * (spec.tablet ? 0.8 : 1), flashMat);
  dot(spec.tablet ? -0.07 : -0.085, -0.105, 0.016, lidarMat);
}

function addPhoneDetails(g: THREE.Group, spec: PhoneSpec, color: string, frameMat: THREE.Material, hole: THREE.Material, track: Track) {
  const { w, h, d } = spec;
  // Botões laterais.
  const bt = 0.008;
  const bd = 0.034;
  const button = (len: number, side: 1 | -1, y: number) => {
    const m = new THREE.Mesh(track(roundedSlab(bt * 2, len, bd, bt * 0.9, 0.003)), frameMat);
    m.position.set((side * w) / 2, y, 0);
    g.add(m);
  };
  button(0.07, -1, 0.43);
  button(0.12, -1, 0.3);
  button(0.12, -1, 0.15);
  button(0.18, 1, 0.25);

  // Linhas de antena: faixas de plástico no aro.
  const bandMat = track(layer(new THREE.MeshStandardMaterial({ color: new THREE.Color(color).lerp(new THREE.Color('#5d5d60'), 0.65), roughness: 0.55 }), 1));
  // Nas laterais (±x) a largura do plano corre ao longo de z; no topo e na base (±y), ao longo de x.
  const flat = d - 2 * spec.edge;
  const side = track(new THREE.PlaneGeometry(flat * 0.92, 0.011));
  const cap = track(new THREE.PlaneGeometry(0.011, flat * 0.92));
  for (const sy of [1, -1]) {
    g.add(onFace(new THREE.Mesh(side, bandMat), '+x', w / 2 + 0.0004, sy * (h / 2 - 0.19), 0));
    g.add(onFace(new THREE.Mesh(side, bandMat), '-x', -w / 2 - 0.0004, sy * (h / 2 - 0.19), 0));
  }
  for (const sx of [1, -1]) {
    g.add(onFace(new THREE.Mesh(cap, bandMat), '+y', sx * 0.15, h / 2 + 0.0004, 0));
    g.add(onFace(new THREE.Mesh(cap, bandMat), '-y', sx * 0.15, -h / 2 - 0.0004, 0));
  }

  // Base: USB-C, alto-falante, microfone e parafusos.
  const yb = -h / 2 - 0.0005;
  const port = onFace(new THREE.Mesh(track(roundedPlane(0.088, 0.03, 0.015)), hole), '-y', 0, yb, 0);
  g.add(port);
  holeRow(g, track, hole, '-y', 6, new THREE.Vector3(0.08, yb, 0), new THREE.Vector3(0.019, 0, 0), 0.0058);
  holeRow(g, track, hole, '-y', 4, new THREE.Vector3(-0.08, yb, 0), new THREE.Vector3(-0.019, 0, 0), 0.0058);
  const screwMat = track(layer(new THREE.MeshStandardMaterial({ color: 0x6f6f72, metalness: 1, roughness: 0.4 }), 1));
  holeRow(g, track, screwMat, '-y', 2, new THREE.Vector3(-0.058, yb, 0), new THREE.Vector3(0.116, 0, 0), 0.005);
}

function addTabletDetails(g: THREE.Group, spec: PhoneSpec, frameMat: THREE.Material, hole: THREE.Material, track: Track) {
  const { w, h } = spec;
  const bt = 0.007;
  const bd = 0.026;
  // Botão superior e volume na lateral.
  const top = new THREE.Mesh(track(roundedSlab(0.2, bt * 2, bd, bt * 0.9, 0.003)), frameMat);
  top.position.set(w / 2 - 0.32, h / 2, 0);
  g.add(top);
  for (const y of [h / 2 - 0.32, h / 2 - 0.5]) {
    const vol = new THREE.Mesh(track(roundedSlab(bt * 2, 0.13, bd, bt * 0.9, 0.003)), frameMat);
    vol.position.set(w / 2, y, 0);
    g.add(vol);
  }
  // Quatro alto-falantes (dois em cima, dois embaixo) e USB-C.
  for (const sy of [1, -1]) {
    const y = sy * (h / 2 + 0.0005);
    const face: Face = sy > 0 ? '+y' : '-y';
    for (const sx of [1, -1]) {
      holeRow(g, track, hole, face, 9, new THREE.Vector3(sx * (w / 2 - 0.42), y, 0), new THREE.Vector3(sx * 0.022, 0, 0), 0.0055);
    }
  }
  g.add(onFace(new THREE.Mesh(track(roundedPlane(0.09, 0.028, 0.014)), hole), '-y', 0, -h / 2 - 0.0005, 0));
}

function buildMacbook(color: string, dark: boolean, lidAngle: number): DeviceBuild {
  const { track, dispose } = tracker();
  const g = new THREE.Group();
  const W = 3.126;
  const D = 2.212;
  const T = 0.1;
  const LT = 0.05;
  const LH = 2.15;
  const R = 0.08;

  // Alumínio anodizado jateado.
  const metal = track(new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: 0.4 }));
  const base = new THREE.Mesh(track(roundedSlab(W, D, T, R, 0.018)), metal);
  base.rotation.x = -Math.PI / 2;
  base.position.y = T / 2;
  g.add(base);

  const deck = drawDeck(dark, W, D);
  track(deck.map);
  track(deck.orm);
  const deckMat = track(
    new THREE.MeshPhysicalMaterial({
      map: deck.map,
      roughnessMap: deck.orm,
      metalnessMap: deck.orm,
      roughness: 1,
      metalness: 1,
      normalMap: track(grainAt(60, 42)),
      normalScale: new THREE.Vector2(0.08, 0.08),
    }),
  );
  const deckMesh = new THREE.Mesh(track(roundedPlane(W - 0.05, D - 0.05, R - 0.025)), deckMat);
  deckMesh.rotation.x = -Math.PI / 2;
  deckMesh.position.y = T + 0.0005;
  g.add(deckMesh);

  // Portas nas laterais: MagSafe, USB-C e fone (esquerda); HDMI, USB-C e SD (direita).
  const hole = track(holeMaterial());
  const port = (face: '+x' | '-x', z: number, pw: number, ph: number, radius: number) => {
    const x = face === '+x' ? W / 2 + 0.0005 : -W / 2 - 0.0005;
    g.add(onFace(new THREE.Mesh(track(roundedPlane(pw, ph, radius)), hole), face, x, T * 0.5, z));
  };
  // A face lateral olha para ±x; no plano dela, a largura corre ao longo de z.
  port('-x', -0.62, 0.12, 0.028, 0.012);
  port('-x', -0.36, 0.088, 0.028, 0.014);
  port('-x', -0.2, 0.088, 0.028, 0.014);
  port('-x', 0.35, 0.034, 0.034, 0.017);
  port('+x', -0.55, 0.15, 0.03, 0.006);
  port('+x', -0.3, 0.088, 0.028, 0.014);
  port('+x', 0.1, 0.24, 0.016, 0.003);

  const hingeMat = track(new THREE.MeshStandardMaterial({ color: 0x18181a, metalness: 0.5, roughness: 0.45 }));
  const hinge = new THREE.Mesh(track(new THREE.CylinderGeometry(0.03, 0.03, W * 0.78, 32)), hingeMat);
  hinge.rotation.z = Math.PI / 2;
  hinge.position.set(0, T + 0.005, -D / 2 + 0.03);
  g.add(hinge);

  const pivot = new THREE.Group();
  pivot.position.set(0, T + 0.01, -D / 2 + 0.03);
  g.add(pivot);

  // Tampa em pé quando a rotação é zero; a tela olha para +z.
  const lidBody = new THREE.Mesh(track(roundedSlab(W, LH, LT, R, 0.014)), metal);
  lidBody.position.set(0, LH / 2, -LT / 2);
  pivot.add(lidBody);
  // Costas da tampa com o mesmo alumínio jateado, agora com grão visível de perto.
  const backMat = track(new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: 0.4, normalMap: track(grainAt(60, 42)), normalScale: new THREE.Vector2(0.1, 0.1) }));
  const lidBack = new THREE.Mesh(track(roundedPlane(W - 0.04, LH - 0.04, R - 0.02)), backMat);
  lidBack.position.set(0, LH / 2, -LT - 0.0004);
  lidBack.rotation.y = Math.PI;
  pivot.add(lidBack);

  const lip = 0.006;
  const glassW = W - 2 * lip;
  const glassH = LH - 2 * lip;
  const bezelMat = track(new THREE.MeshStandardMaterial({ color: 0x040405, roughness: 0.3, metalness: 0 }));
  const glass = new THREE.Mesh(track(roundedPlane(glassW, glassH, R - lip)), bezelMat);
  glass.position.set(0, LH / 2, 0.0004);
  pivot.add(glass);

  const side = 0.055;
  const top = 0.07;
  const bottom = 0.12;
  const sw = W - 2 * side;
  const sh = LH - top - bottom;
  const screenMat = track(screenMaterial());
  const screen = new THREE.Mesh(track(roundedPlane(sw, sh, [0.03, 0.03, 0.006, 0.006])), screenMat);
  screen.position.set(0, bottom + sh / 2, 0.0008);
  pivot.add(screen);

  const nw = 0.24;
  const nh = 0.04;
  const cutout = track(cutoutMaterial());
  const notch = new THREE.Mesh(track(roundedPlane(nw, nh, [0, 0, 0.015, 0.015])), cutout);
  notch.position.set(0, bottom + sh - nh / 2 + 0.0001, 0.0011);
  pivot.add(notch);
  const camMat = track(layer(new THREE.MeshPhysicalMaterial({ color: 0x0c1226, roughness: 0.08, clearcoat: 1, iridescence: 0.6 }), 3));
  const cam = new THREE.Mesh(track(new THREE.CircleGeometry(0.008, 24)), camMat);
  cam.position.set(0, bottom + sh - nh / 2, 0.0013);
  pivot.add(cam);

  const glareMat = track(glareMaterial());
  const glare = new THREE.Mesh(track(roundedPlane(glassW, glassH, R - lip)), glareMat);
  glare.position.set(0, LH / 2, 0.0016);
  glare.renderOrder = 5;
  pivot.add(glare);

  const setLid = (deg: number) => {
    pivot.rotation.x = -(deg - 90) * DEG;
  };
  setLid(lidAngle);

  const [pxW, pxH] = pxFor(sw / sh);
  return { group: g, screen, screenSize: { w: sw, h: sh }, screenMat, glareMat, layout: { pxW, pxH, landscape: false }, setLid, dispose };
}

function buildBrowser(theme: 'light' | 'dark', url: string): DeviceBuild {
  const { track, dispose } = tracker();
  const g = new THREE.Group();
  const W = 3.2;
  const contentH = W / 1.6;
  const TB = 0.17;
  const H = contentH + TB;
  const D = 0.03;
  const R = 0.07;
  const frameMat = track(new THREE.MeshPhysicalMaterial({ color: theme === 'dark' ? 0x2a2b2f : 0xe9eaee, roughness: 0.4, metalness: 0, clearcoat: 0.4 }));
  g.add(new THREE.Mesh(track(roundedSlab(W, H, D, R, 0.01)), frameMat));

  const lip = 0.006;
  const fw = W - 2 * lip;
  const fh = H - 2 * lip;
  const screenMat = track(screenMaterial());
  const screen = new THREE.Mesh(track(roundedPlane(fw, fh, R - lip)), screenMat);
  screen.position.z = D / 2 + 0.0005;
  g.add(screen);

  const glareMat = track(glareMaterial());
  const glare = new THREE.Mesh(track(roundedPlane(fw, fh, R - lip)), glareMat);
  glare.position.z = D / 2 + 0.0012;
  glare.renderOrder = 5;
  g.add(glare);

  const [pxW, pxH] = pxFor(fw / fh);
  return {
    group: g,
    screen,
    screenSize: { w: fw, h: fh },
    screenMat,
    glareMat,
    layout: { pxW, pxH, landscape: false, chrome: { theme, url, frac: (TB - lip) / fh } },
    dispose,
  };
}

export function buildDevice(d: SceneState['device']): DeviceBuild {
  const color = finishColor(d.kind, d.finish);
  switch (d.kind) {
    case 'iphone':
      return buildPhone(IPHONE, color, d.orientation === 'landscape', d.showIsland);
    case 'ipad':
      return buildPhone(IPAD, color, d.orientation === 'landscape', false);
    case 'macbook':
      return buildMacbook(color, d.finish === 'preto', d.lidAngle);
    case 'browser':
      return buildBrowser(d.finish === 'escuro' ? 'dark' : 'light', d.browserUrl || 'seusite.com.br');
  }
}
