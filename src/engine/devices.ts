import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { roundedPlane, roundedSlab } from './geometry';
import { drawDeck, grainAt, type ScreenLayout } from './textures';
import { finishOf, type SceneState } from '../state';

// Unidade de cena: 1 = 10 cm. Aparelhos modelados do zero em código, com as medidas, cores e
// detalhes das fichas técnicas oficiais (apple.com/br): iPhone 17, iPad 11", MacBook Pro 14" e iMac 24".

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

// Alumínio anodizado jateado: meio metálico e bem fosco. Em superfícies grandes viradas para a câmera,
// metal puro refletiria o fundo escuro do estúdio e a cor oficial sumiria (azul virando marinho).
function anodized(track: Track, color: THREE.ColorRepresentation, extra: THREE.MeshPhysicalMaterialParameters = {}) {
  return track(new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.44, ...extra }));
}

// Logo da Apple (traçado do projeto Simple Icons, CC0), numa caixa de 24 × 24 com y para baixo.
const APPLE_LOGO =
  'M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701';
let logoShapes: THREE.Shape[] | null = null;

// Logo com a altura pedida, centrado na origem, colado no verso (lado -z) e legível de quem olha por trás:
// x e y invertidos (o SVG tem y para baixo e, visto de trás, a direita é o -x). Dupla face porque a
// inversão troca a ordem dos vértices.
function appleLogo(g: THREE.Object3D, track: Track, mat: THREE.Material, height: number, x: number, y: number, z: number) {
  logoShapes ??= new SVGLoader()
    .parse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${APPLE_LOGO}"/></svg>`)
    .paths.flatMap((p) => SVGLoader.createShapes(p));
  const geo = track(new THREE.ShapeGeometry(logoShapes, 12));
  geo.scale(-1, -1, 1);
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const c = box.getCenter(new THREE.Vector3());
  const k = height / (box.max.y - box.min.y);
  geo.translate(-c.x, -c.y, 0);
  geo.scale(k, k, 1);
  mat.side = THREE.DoubleSide;
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  g.add(m);
}

// Lente de câmera traseira (olhando para -z): anel de metal saliente, vidro de safira com
// película antirreflexo e os elementos internos.
interface LensMats {
  ring: THREE.Material;
  cover: THREE.Material;
  inner: THREE.Material;
  core: THREE.Material;
}

function lensMaterials(track: Track, ringColor: THREE.ColorRepresentation): LensMats {
  return {
    ring: track(new THREE.MeshPhysicalMaterial({ color: ringColor, metalness: 1, roughness: 0.14 })),
    cover: track(
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
    ),
    inner: track(new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.35, metalness: 0.6 })),
    core: track(new THREE.MeshPhysicalMaterial({ color: 0x0b0f24, roughness: 0.05, metalness: 0.2, iridescence: 0.8, iridescenceIOR: 1.6 })),
  };
}

function addLens(g: THREE.Group, track: Track, mats: LensMats, x: number, y: number, zTop: number, r: number, h: number) {
  const ring = new THREE.Mesh(track(new THREE.CylinderGeometry(r, r * 1.02, h, 64)), mats.ring);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(x, y, zTop - h / 2);
  const disc = (radius: number, inner: number, mat: THREE.Material, dz: number) => {
    const geo = inner > 0 ? new THREE.RingGeometry(inner, radius, 56) : new THREE.CircleGeometry(radius, 56);
    const m = new THREE.Mesh(track(geo), mat);
    m.rotation.y = Math.PI;
    m.position.set(x, y, zTop - h - dz);
    g.add(m);
  };
  g.add(ring);
  disc(r * 0.82, 0, mats.cover, 0.0004);
  disc(r * 0.5, r * 0.36, mats.inner, 0.0008);
  disc(r * 0.3, 0, mats.core, 0.001);
}

interface PhoneSpec {
  w: number;
  h: number;
  d: number;
  r: number;
  edge: number;
  lip: number;
  bezel: number;
  screenR: number | null;
  glassT: number;
  island: boolean;
  tablet: boolean;
}

// iPhone 17: 71,5 × 149,6 × 7,95 mm; tela de 2622 × 1206 a 460 ppp (66,6 × 144,8 mm).
const IPHONE: PhoneSpec = { w: 0.715, h: 1.496, d: 0.0795, r: 0.118, edge: 0.021, lip: 0.005, bezel: 0.0192, screenR: null, glassT: 0.009, island: true, tablet: false };
// iPad 11" (A16): 179,5 × 248,6 × 7 mm; tela de 2360 × 1640 (159,4 × 229,4 mm).
const IPAD: PhoneSpec = { w: 1.795, h: 2.486, d: 0.07, r: 0.1, edge: 0.007, lip: 0.005, bezel: 0.093, screenR: 0.055, glassT: 0.006, island: false, tablet: true };

function buildPhone(spec: PhoneSpec, color: string, landscape: boolean, showIsland: boolean, logo: boolean): DeviceBuild {
  const { track, dispose } = tracker();
  const outer = new THREE.Group();
  const g = new THREE.Group();
  outer.add(g);
  const { w, h, d, r, edge, lip, bezel, glassT } = spec;
  const zf = d / 2;
  const base = new THREE.Color(color);

  // Estrutura de alumínio acetinado. No iPhone 17 o aro é anodizado num tom próximo ao do vidro
  // traseiro; no iPad o corpo inteiro é do mesmo alumínio colorido.
  const frameColor = spec.tablet ? base.clone() : base.clone().lerp(new THREE.Color('#c4c5c8'), 0.18);
  const frameMat = spec.tablet ? anodized(track, frameColor) : track(new THREE.MeshPhysicalMaterial({ color: frameColor, metalness: 1, roughness: 0.34 }));
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
  const sr = spec.screenR ?? Math.max(gr - bezel * 0.85, 0.012);
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
    // Câmera frontal na borda longa (à direita da tela, em retrato).
    const cam = new THREE.Mesh(track(new THREE.CircleGeometry(0.011, 24)), cutout);
    cam.position.set(sw / 2 + bezel / 2, 0, glassTop + 0.0003);
    g.add(cam);
  }

  // Reflexo só sobre a tela (o vidro da borda já reflete sozinho, com a mesma intensidade).
  const glareMat = track(glareMaterial());
  const glare = new THREE.Mesh(track(roundedPlane(sw, sh, sr, true)), glareMat);
  glare.position.z = glassTop + 0.0007;
  glare.renderOrder = 5;
  g.add(glare);

  // Traseira. iPhone 17: vidro colorido fosco com um fio polido na borda. iPad: alumínio jateado.
  const backT = 0.006;
  if (!spec.tablet) {
    const rimMat = track(new THREE.MeshPhysicalMaterial({ color: base, metalness: 0, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 }));
    const backGlass = new THREE.Mesh(track(roundedSlab(gw, gh, backT, gr, backT * 0.45, { smooth: true })), rimMat);
    backGlass.position.z = -zf - 0.0008 + backT / 2;
    g.add(backGlass);
  }
  const backMat = spec.tablet
    ? anodized(track, base, { normalMap: track(grainAt(26, 36)), normalScale: new THREE.Vector2(0.12, 0.12) })
    : track(new THREE.MeshPhysicalMaterial({ color: base, metalness: 0, roughness: 0.46, normalMap: track(grainAt(10, 20)), normalScale: new THREE.Vector2(0.3, 0.3) }));
  const inset = spec.tablet ? 0 : backT * 0.6;
  const back = new THREE.Mesh(track(roundedPlane(gw - inset * 2, gh - inset * 2, gr - inset, true)), backMat);
  back.position.z = -zf - 0.0012;
  back.rotation.y = Math.PI;
  g.add(back);

  if (logo) {
    // iPhone: vidro polido sobre o fosco. iPad: aço polido embutido no alumínio.
    const logoMat = spec.tablet
      ? track(layer(new THREE.MeshPhysicalMaterial({ color: base.clone().lerp(new THREE.Color('#ffffff'), 0.2), metalness: 0.4, roughness: 0.1, clearcoat: 1 }), 1))
      : track(layer(new THREE.MeshPhysicalMaterial({ color: base, metalness: 0, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03 }), 1));
    appleLogo(g, track, logoMat, spec.tablet ? 0.27 : 0.135, 0, spec.tablet ? 0 : 0.02, -zf - 0.0015);
  }

  if (spec.tablet) {
    addTabletCamera(g, spec, frameColor, hole, track);
    addTabletDetails(g, spec, frameMat, hole, track);
  } else {
    addPhoneCamera(g, spec, base, frameColor, hole, track);
    addPhoneDetails(g, spec, base, frameMat, hole, track);
  }
  if (landscape) g.rotation.z = Math.PI / 2;

  const [pxW, pxH] = pxFor(sw / sh);
  return { group: outer, screen, screenSize: { w: sw, h: sh }, screenMat, glareMat, layout: { pxW, pxH, landscape }, dispose };
}

// iPhone 17: duas câmeras empilhadas numa pílula de vidro no canto superior esquerdo do verso,
// com o flash ao lado. Visto de trás, o +x local fica à esquerda.
function addPhoneCamera(g: THREE.Group, spec: PhoneSpec, base: THREE.Color, frame: THREE.Color, hole: THREE.Material, track: Track) {
  const zb = -spec.d / 2 - 0.0012;
  const pw = 0.152;
  const ph = 0.31;
  const pd = 0.009;
  const margin = 0.062;
  const cx = spec.w / 2 - margin - pw / 2;
  const cy = spec.h / 2 - margin - ph / 2;
  const pillMat = track(new THREE.MeshPhysicalMaterial({ color: base, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04 }));
  // Cápsula de arcos perfeitos (o canto "suave" deixaria a pílula com cara de quadrado).
  const pill = new THREE.Mesh(track(roundedSlab(pw, ph, pd, pw / 2, pd * 0.45)), pillMat);
  pill.position.set(cx, cy, zb - pd / 2);
  g.add(pill);

  const mats = lensMaterials(track, frame);
  const zTop = zb - pd;
  for (const sy of [1, -1]) addLens(g, track, mats, cx, cy + sy * ph * 0.25, zTop, 0.064, 0.013);

  // Flash True Tone e microfone, ao lado da pílula, voltados para o centro do aparelho.
  const flashMat = track(new THREE.MeshPhysicalMaterial({ color: 0xf6edd5, roughness: 0.3, clearcoat: 1 }));
  const flash = new THREE.Mesh(track(new THREE.CircleGeometry(0.021, 32)), flashMat);
  flash.rotation.y = Math.PI;
  const fx = cx - pw / 2 - 0.042;
  flash.position.set(fx, cy, zb - 0.0004);
  const mic = new THREE.Mesh(track(new THREE.CircleGeometry(0.0055, 20)), hole);
  mic.rotation.y = Math.PI;
  mic.position.set(fx, cy - 0.06, zb - 0.0004);
  g.add(flash, mic);
}

// iPad 11": câmera única, redonda e levemente saliente no canto, mais o microfone.
function addTabletCamera(g: THREE.Group, spec: PhoneSpec, frame: THREE.Color, hole: THREE.Material, track: Track) {
  const zb = -spec.d / 2 - 0.0012;
  const cx = spec.w / 2 - 0.13;
  const cy = spec.h / 2 - 0.13;
  addLens(g, track, lensMaterials(track, frame), cx, cy, zb, 0.052, 0.011);
  const mic = new THREE.Mesh(track(new THREE.CircleGeometry(0.006, 20)), hole);
  mic.rotation.y = Math.PI;
  mic.position.set(cx - 0.1, cy, zb - 0.0004);
  g.add(mic);
}

function addPhoneDetails(g: THREE.Group, spec: PhoneSpec, base: THREE.Color, frameMat: THREE.Material, hole: THREE.Material, track: Track) {
  const { w, h, d } = spec;
  const bt = 0.008;
  const bd = 0.032;
  const button = (len: number, side: 1 | -1, y: number) => {
    const m = new THREE.Mesh(track(roundedSlab(bt * 2, len, bd, bt * 0.9, 0.003)), frameMat);
    m.position.set((side * w) / 2, y, 0);
    g.add(m);
  };
  // Esquerda (vista de frente): botão de Ação e volume. Direita: botão lateral.
  button(0.068, -1, 0.43);
  button(0.105, -1, 0.29);
  button(0.105, -1, 0.155);
  button(0.165, 1, 0.255);

  // Controle da Câmera: cristal de safira rente ao aro, com borda de aço polido, abaixo do botão lateral.
  const ccBorder = track(layer(new THREE.MeshPhysicalMaterial({ color: base.clone().lerp(new THREE.Color('#d8d8dc'), 0.4), metalness: 1, roughness: 0.12 }), 1));
  const ccGlass = track(layer(new THREE.MeshPhysicalMaterial({ color: 0x0d0e10, roughness: 0.05, metalness: 0, clearcoat: 1 }), 2));
  // Na face lateral, a largura do plano corre ao longo de z e a altura ao longo de y.
  g.add(onFace(new THREE.Mesh(track(roundedPlane(0.034, 0.17, 0.017)), ccBorder), '+x', w / 2 + 0.0004, -0.215, 0));
  g.add(onFace(new THREE.Mesh(track(roundedPlane(0.026, 0.162, 0.013)), ccGlass), '+x', w / 2 + 0.0007, -0.215, 0));

  // Linhas de antena: faixas de plástico no aro.
  const bandMat = track(layer(new THREE.MeshStandardMaterial({ color: base.clone().lerp(new THREE.Color('#5d5d60'), 0.6), roughness: 0.55 }), 1));
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
  g.add(onFace(new THREE.Mesh(track(roundedPlane(0.088, 0.03, 0.015)), hole), '-y', 0, yb, 0));
  holeRow(g, track, hole, '-y', 6, new THREE.Vector3(0.08, yb, 0), new THREE.Vector3(0.019, 0, 0), 0.0058);
  holeRow(g, track, hole, '-y', 4, new THREE.Vector3(-0.08, yb, 0), new THREE.Vector3(-0.019, 0, 0), 0.0058);
  const screwMat = track(layer(new THREE.MeshStandardMaterial({ color: 0x6f6f72, metalness: 1, roughness: 0.4 }), 1));
  holeRow(g, track, screwMat, '-y', 2, new THREE.Vector3(-0.058, yb, 0), new THREE.Vector3(0.116, 0, 0), 0.005);
}

function addTabletDetails(g: THREE.Group, spec: PhoneSpec, frameMat: THREE.Material, hole: THREE.Material, track: Track) {
  const { w, h } = spec;
  const bt = 0.007;
  const bd = 0.03;
  // Botão superior com Touch ID (em cima, perto do canto direito) e volume no lado direito.
  const top = new THREE.Mesh(track(roundedSlab(0.22, bt * 2, bd, bt * 0.9, 0.003)), frameMat);
  top.position.set(w / 2 - 0.3, h / 2, 0);
  g.add(top);
  for (const y of [h / 2 - 0.32, h / 2 - 0.47]) {
    const vol = new THREE.Mesh(track(roundedSlab(bt * 2, 0.12, bd, bt * 0.9, 0.003)), frameMat);
    vol.position.set(w / 2, y, 0);
    g.add(vol);
  }
  // Smart Connector: três contatos no lado esquerdo.
  const contact = track(layer(new THREE.MeshStandardMaterial({ color: 0x8c8c90, metalness: 1, roughness: 0.3 }), 1));
  holeRow(g, track, contact, '-x', 3, new THREE.Vector3(-w / 2 - 0.0005, 0.02, 0), new THREE.Vector3(0, -0.02, 0), 0.0045);
  // Alto-falantes em cima e embaixo, e USB-C.
  for (const sy of [1, -1]) {
    const y = sy * (h / 2 + 0.0005);
    const face: Face = sy > 0 ? '+y' : '-y';
    for (const sx of [1, -1]) {
      holeRow(g, track, hole, face, 9, new THREE.Vector3(sx * (w / 2 - 0.42), y, 0), new THREE.Vector3(sx * 0.022, 0, 0), 0.0055);
    }
  }
  g.add(onFace(new THREE.Mesh(track(roundedPlane(0.09, 0.028, 0.014)), hole), '-y', 0, -h / 2 - 0.0005, 0));
}

// MacBook Pro 14": 31,26 × 22,12 × 1,55 cm; tela de 14,2" (3024 × 1964, 302,5 × 196,4 mm).
function buildMacbook(color: string, dark: boolean, lidAngle: number, logo: boolean): DeviceBuild {
  const { track, dispose } = tracker();
  const g = new THREE.Group();
  const W = 3.126;
  const D = 2.212;
  const T = 0.104;
  const LT = 0.048;
  const LH = 2.15;
  const R = 0.08;

  const metal = anodized(track, color, { metalness: 0.65, roughness: 0.42 });
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
      metalness: 0.75,
      normalMap: track(grainAt(60, 42)),
      normalScale: new THREE.Vector2(0.08, 0.08),
    }),
  );
  const deckMesh = new THREE.Mesh(track(roundedPlane(W - 0.05, D - 0.05, R - 0.025)), deckMat);
  deckMesh.rotation.x = -Math.PI / 2;
  deckMesh.position.y = T + 0.0005;
  g.add(deckMesh);

  // Portas nas laterais: MagSafe 3, dois Thunderbolt e fone (esquerda); HDMI, Thunderbolt e SDXC (direita).
  const hole = track(holeMaterial());
  const port = (face: '+x' | '-x', z: number, pw: number, ph: number, radius: number) => {
    const x = face === '+x' ? W / 2 + 0.0005 : -W / 2 - 0.0005;
    g.add(onFace(new THREE.Mesh(track(roundedPlane(pw, ph, radius)), hole), face, x, T * 0.5, z));
  };
  port('-x', -0.62, 0.12, 0.028, 0.012);
  port('-x', -0.36, 0.088, 0.028, 0.014);
  port('-x', -0.2, 0.088, 0.028, 0.014);
  port('-x', 0.35, 0.034, 0.034, 0.017);
  port('+x', -0.55, 0.15, 0.03, 0.006);
  port('+x', -0.3, 0.088, 0.028, 0.014);
  port('+x', 0.1, 0.24, 0.016, 0.003);

  // Rebaixo na borda da frente, para abrir a tampa com um dedo.
  const scoopMat = track(layer(new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color).multiplyScalar(0.55), metalness: 1, roughness: 0.45 }), 1));
  const scoop = new THREE.Mesh(track(roundedPlane(0.42, 0.03, [0, 0, 0.015, 0.015])), scoopMat);
  scoop.position.set(0, T - 0.015, D / 2 + 0.0006);
  g.add(scoop);

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
  const backMat = anodized(track, color, { metalness: 0.6, normalMap: track(grainAt(60, 42)), normalScale: new THREE.Vector2(0.1, 0.1) });
  const lidBack = new THREE.Mesh(track(roundedPlane(W - 0.04, LH - 0.04, R - 0.02)), backMat);
  lidBack.position.set(0, LH / 2, -LT - 0.0004);
  lidBack.rotation.y = Math.PI;
  pivot.add(lidBack);
  if (logo) {
    // Logo espelhado (aço polido) no centro da tampa, de pé para quem olha a tampa aberta por trás.
    const logoMat = track(layer(new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), dark ? 0.22 : 0.12), metalness: 0.5, roughness: 0.05, clearcoat: 1 }), 1));
    appleLogo(pivot, track, logoMat, 0.5, 0, LH / 2, -LT - 0.0008);
  }

  const lip = 0.006;
  const glassW = W - 2 * lip;
  const glassH = LH - 2 * lip;
  const bezelMat = track(new THREE.MeshStandardMaterial({ color: 0x040405, roughness: 0.3, metalness: 0 }));
  const glass = new THREE.Mesh(track(roundedPlane(glassW, glassH, R - lip)), bezelMat);
  glass.position.set(0, LH / 2, 0.0004);
  pivot.add(glass);

  const side = 0.0505;
  const top = 0.06;
  const bottom = 0.126;
  const sw = W - 2 * side;
  const sh = LH - top - bottom;
  const screenMat = track(screenMaterial());
  const screen = new THREE.Mesh(track(roundedPlane(sw, sh, [0.03, 0.03, 0.006, 0.006])), screenMat);
  screen.position.set(0, bottom + sh / 2, 0.0008);
  pivot.add(screen);

  // Recorte da câmera de 12 MP no topo da tela.
  const nw = 0.3;
  const nh = 0.062;
  const cutout = track(cutoutMaterial());
  const notch = new THREE.Mesh(track(roundedPlane(nw, nh, [0, 0, 0.02, 0.02])), cutout);
  notch.position.set(0, bottom + sh - nh / 2 + 0.0001, 0.0011);
  pivot.add(notch);
  const camMat = track(layer(new THREE.MeshPhysicalMaterial({ color: 0x0c1226, roughness: 0.08, clearcoat: 1, iridescence: 0.6 }), 3));
  const cam = new THREE.Mesh(track(new THREE.CircleGeometry(0.009, 24)), camMat);
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

// iMac 24": painel de 54,7 cm × ~37,4 cm e 11,5 mm de espessura; tela de 23,5" 16:9 (520 × 292,7 mm);
// 46,1 cm de altura com o pé e base de 14,7 cm de profundidade. Traseira no tom forte da cor;
// "queixo", pé e base no tom claro; moldura da tela branca.
function buildImac(back: string, front: string, logo: boolean): DeviceBuild {
  const { track, dispose } = tracker();
  const g = new THREE.Group();
  const W = 5.47;
  const H = 3.74;
  const T = 0.115;
  const R = 0.11;
  const sw = 5.203;
  const sh = 2.927;
  const topB = 0.135;
  const chin = H - topB - sh;
  const lip = 0.006;
  const tilt = 6 * DEG;

  const backMat = anodized(track, back, { metalness: 0.5 });
  // O tom claro (queixo e pé) fica de frente para a câmera: quase fosco, para a cor clara aparecer.
  const frontMetal = anodized(track, front, { metalness: 0.25, roughness: 0.46 });

  // Painel montado com a base no y = 0 e a dobradiça (nas costas, a 8,5 cm da borda de baixo) no pivô.
  const hingeY = 0.85;
  const panel = new THREE.Group();
  panel.position.set(0, -hingeY, T / 2);
  const pivot = new THREE.Group();
  pivot.add(panel);
  g.add(pivot);

  const body = new THREE.Mesh(track(roundedSlab(W, H, T, R, 0.012)), backMat);
  body.position.y = H / 2;
  panel.add(body);
  const backPlate = new THREE.Mesh(
    track(roundedPlane(W - 0.03, H - 0.03, R - 0.015)),
    anodized(track, back, { metalness: 0.5, normalMap: track(grainAt(70, 48)), normalScale: new THREE.Vector2(0.08, 0.08) }),
  );
  backPlate.position.set(0, H / 2, -T / 2 - 0.0004);
  backPlate.rotation.y = Math.PI;
  panel.add(backPlate);
  if (logo) {
    const logoMat = track(layer(new THREE.MeshPhysicalMaterial({ color: new THREE.Color(back).lerp(new THREE.Color('#ffffff'), 0.12), metalness: 0.4, roughness: 0.08, clearcoat: 1 }), 1));
    appleLogo(panel, track, logoMat, 0.62, 0, H * 0.56, -T / 2 - 0.0008);
  }

  // Frente: vidro com moldura branca em cima e nas laterais; "queixo" de alumínio no tom claro.
  const zf = T / 2;
  const glassH = H - chin - lip;
  const bezelMat = track(new THREE.MeshPhysicalMaterial({ color: '#efefee', roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04 }));
  const glass = new THREE.Mesh(track(roundedPlane(W - 2 * lip, glassH, [R - lip, R - lip, 0, 0])), bezelMat);
  glass.position.set(0, chin + glassH / 2, zf + 0.0004);
  panel.add(glass);
  const chinPlate = new THREE.Mesh(
    track(roundedPlane(W - 2 * lip, chin - lip, [0, 0, R - lip, R - lip])),
    anodized(track, front, { metalness: 0.25, roughness: 0.46, normalMap: track(grainAt(60, 8)), normalScale: new THREE.Vector2(0.06, 0.06) }),
  );
  chinPlate.position.set(0, lip + (chin - lip) / 2, zf + 0.0004);
  panel.add(chinPlate);

  const screenMat = track(screenMaterial());
  const screen = new THREE.Mesh(track(roundedPlane(sw, sh, 0.008)), screenMat);
  screen.position.set(0, chin + sh / 2, zf + 0.0008);
  panel.add(screen);
  const cam = new THREE.Mesh(track(new THREE.CircleGeometry(0.014, 24)), track(cutoutMaterial()));
  cam.position.set(0, H - topB / 2, zf + 0.0008);
  panel.add(cam);
  const glareMat = track(glareMaterial());
  const glare = new THREE.Mesh(track(roundedPlane(W - 2 * lip, glassH, [R - lip, R - lip, 0, 0])), glareMat);
  glare.position.set(0, chin + glassH / 2, zf + 0.0014);
  glare.renderOrder = 5;
  panel.add(glare);
  // Entrada de fone na lateral esquerda, perto da base.
  const hole = track(holeMaterial());
  panel.add(onFace(new THREE.Mesh(track(new THREE.CircleGeometry(0.018, 20)), hole), '-x', -W / 2 - 0.0005, 0.3, 0));

  // O painel inclina alguns graus para trás em volta da dobradiça.
  const hingeH = 0.87 + hingeY * Math.cos(tilt);
  pivot.position.set(0, hingeH, 0);
  pivot.rotation.x = -tilt;

  // Pé: braço inclinado que sai da base e sobe até a dobradiça, e a base fina.
  const SW = 1.3;
  const armBottom = new THREE.Vector3(0, 0.05, -0.43);
  const armTop = new THREE.Vector3(0, hingeH, -0.03);
  const armDir = armTop.clone().sub(armBottom);
  const armLen = armDir.length();
  const arm = new THREE.Mesh(track(roundedSlab(SW, armLen, 0.06, 0.03, 0.012)), frontMetal);
  arm.position.copy(armBottom).add(armTop).multiplyScalar(0.5);
  arm.rotation.x = Math.atan2(armDir.z, armDir.y);
  g.add(arm);
  const hinge = new THREE.Mesh(track(new THREE.CylinderGeometry(0.05, 0.05, SW, 40)), frontMetal);
  hinge.rotation.z = Math.PI / 2;
  hinge.position.copy(armTop);
  g.add(hinge);
  const baseD = 1.47;
  const plate = new THREE.Mesh(track(roundedSlab(SW, baseD, 0.05, 0.08, 0.012)), frontMetal);
  plate.rotation.x = -Math.PI / 2;
  plate.position.set(0, 0.025, armBottom.z - 0.37 + baseD / 2);
  g.add(plate);

  const [pxW, pxH] = pxFor(sw / sh);
  return { group: g, screen, screenSize: { w: sw, h: sh }, screenMat, glareMat, layout: { pxW, pxH, landscape: false }, dispose };
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
  const f = finishOf(d.kind, d.finish);
  const logo = d.logo !== false;
  switch (d.kind) {
    case 'iphone':
      return buildPhone(IPHONE, f.color, d.orientation === 'landscape', d.showIsland, logo);
    case 'ipad':
      return buildPhone(IPAD, f.color, d.orientation === 'landscape', false, logo);
    case 'macbook':
      return buildMacbook(f.color, d.finish === 'preto', d.lidAngle, logo);
    case 'imac':
      return buildImac(f.color, f.color2 ?? f.color, logo);
    case 'browser':
      return buildBrowser(d.finish === 'escuro' ? 'dark' : 'light', d.browserUrl || 'seusite.com.br');
  }
}
