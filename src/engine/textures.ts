import * as THREE from 'three';
import type { SceneState } from '../state';

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';

export interface ScreenImage {
  src: CanvasImageSource;
  w: number;
  h: number;
  // Gravação de tela: a mesma fonte, mas com tempo (sincronizado à linha do tempo).
  video?: HTMLVideoElement;
}

export interface ScreenLayout {
  pxW: number;
  pxH: number;
  landscape: boolean;
  chrome?: { theme: 'light' | 'dark'; url: string; frac: number };
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Monta a imagem da tela: barra do navegador (se houver), print ajustado e rotação de paisagem.
export function composeScreen(
  canvas: HTMLCanvasElement,
  layout: ScreenLayout,
  img: ScreenImage | null,
  opts: SceneState['screen'],
): void {
  if (canvas.width !== layout.pxW) canvas.width = layout.pxW;
  if (canvas.height !== layout.pxH) canvas.height = layout.pxH;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  let cw = layout.pxW;
  let ch = layout.pxH;
  if (layout.landscape) {
    // O aparelho gira 90° no sentido anti-horário; o conteúdo gira ao contrário para ficar em pé.
    ctx.translate(layout.pxW, 0);
    ctx.rotate(Math.PI / 2);
    cw = layout.pxH;
    ch = layout.pxW;
  }
  let top = 0;
  if (layout.chrome) {
    top = Math.round(ch * layout.chrome.frac);
    drawChrome(ctx, cw, top, layout.chrome.theme, layout.chrome.url);
  }
  const areaH = ch - top;
  ctx.fillStyle = opts.fill;
  ctx.fillRect(0, top, cw, areaH);
  if (img) drawFitted(ctx, img, 0, top, cw, areaH, opts.fit, opts.scroll);
  else drawPlaceholder(ctx, 0, top, cw, areaH);
  ctx.restore();
}

function drawFitted(
  ctx: CanvasRenderingContext2D,
  img: ScreenImage,
  x: number,
  y: number,
  w: number,
  h: number,
  fit: 'cover' | 'contain',
  scroll: number,
) {
  const s = fit === 'cover' ? Math.max(w / img.w, h / img.h) : Math.min(w / img.w, h / img.h);
  const dw = img.w * s;
  const dh = img.h * s;
  const dx = x + (w - dw) / 2;
  // Print mais alto que a tela (site inteiro, por exemplo): começa no topo e a rolagem desce.
  const dy = fit === 'cover' && dh > h + 0.5 ? y - (dh - h) * scroll : y + (h - dh) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img.src, dx, dy, dw, dh);
  ctx.restore();
}

function drawChrome(ctx: CanvasRenderingContext2D, w: number, h: number, theme: 'light' | 'dark', url: string) {
  const dark = theme === 'dark';
  ctx.fillStyle = dark ? '#202124' : '#eef0f3';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = dark ? '#000000' : '#d6d9de';
  const line = Math.max(1, Math.round(h * 0.02));
  ctx.fillRect(0, h - line, w, line);
  const r = h * 0.105;
  ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
    ctx.beginPath();
    ctx.arc(h * 0.5 + i * r * 3, h / 2, r, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  });
  const pw = w * 0.42;
  const ph = h * 0.56;
  ctx.fillStyle = dark ? '#2f3034' : '#ffffff';
  ctx.beginPath();
  ctx.roundRect((w - pw) / 2, (h - ph) / 2, pw, ph, ph / 2);
  ctx.fill();
  ctx.fillStyle = dark ? '#a1a1aa' : '#6b7280';
  ctx.font = `500 ${Math.round(ph * 0.42)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(url, w / 2, h / 2 + ph * 0.02, pw * 0.9);
}

// Tela de exemplo enquanto nenhum print foi enviado.
function drawPlaceholder(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#1e1b4b');
  g.addColorStop(0.55, '#4c1d95');
  g.addColorStop(1, '#0e7490');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  const glow = (cx: number, cy: number, r: number, c: string) => {
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    rg.addColorStop(0, c);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(x, y, w, h);
  };
  glow(x + w * 0.2, y + h * 0.15, Math.max(w, h) * 0.5, 'rgba(236,72,153,0.35)');
  glow(x + w * 0.85, y + h * 0.9, Math.max(w, h) * 0.55, 'rgba(34,211,238,0.30)');

  const u = Math.min(w, h) / 100;
  const card = (cx: number, cy: number, cw: number, chh: number, a = 0.1) => {
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.beginPath();
    ctx.roundRect(cx, cy, cw, chh, u * 3);
    ctx.fill();
  };
  ctx.textBaseline = 'alphabetic';
  if (h > w) {
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${u * 4.6}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText('9:41', x + u * 9, y + u * 10);
    ctx.font = `700 ${u * 9}px ${FONT}`;
    ctx.fillText('Seu app', x + u * 7, y + u * 30);
    card(x + u * 7, y + u * 38, w - u * 14, u * 55, 0.14);
    for (let i = 0; i < 4; i++) card(x + u * 7, y + u * 100 + i * u * 19, w - u * 14, u * 15);
  } else {
    card(x + u * 4, y + u * 4, u * 26, h - u * 8, 0.08);
    card(x + u * 34, y + u * 4, w - u * 38, u * 10, 0.1);
    const cols = 3;
    const gw = (w - u * 38 - u * 4 * (cols - 1)) / cols;
    for (let i = 0; i < cols; i++) card(x + u * 34 + i * (gw + u * 4), y + u * 18, gw, u * 34, 0.12);
    card(x + u * 34, y + u * 56, w - u * 38, h - u * 60, 0.08);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.textAlign = 'center';
  ctx.font = `600 ${u * 6.4}px ${FONT}`;
  ctx.fillText('Solte seu print aqui', x + w / 2, y + h * 0.5);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `400 ${u * 3.4}px ${FONT}`;
  ctx.fillText('arraste, cole (⌘V) ou use “Enviar imagem”', x + w / 2, y + h * 0.5 + u * 7);
}

export function drawBackground(canvas: HTMLCanvasElement, bg: SceneState['background'], w: number, h: number): void {
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  if (bg.mode === 'transparent') return;
  if (bg.mode === 'solid') {
    ctx.fillStyle = bg.color1;
  } else if (bg.mode === 'linear') {
    // Mesmo sentido do CSS: 0° aponta para cima, 90° para a direita.
    const a = (bg.angle * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const half = Math.abs((w / 2) * dx) + Math.abs((h / 2) * dy);
    const g = ctx.createLinearGradient(w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half);
    g.addColorStop(0, bg.color1);
    g.addColorStop(1, bg.color2);
    ctx.fillStyle = g;
  } else {
    const g = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.hypot(w, h) * 0.62);
    g.addColorStop(0, bg.color1);
    g.addColorStop(1, bg.color2);
    ctx.fillStyle = g;
  }
  ctx.fillRect(0, 0, w, h);
}

let grainCache: THREE.DataTexture | null = null;

// Relevo granulado que repete sem emenda: vidro fosco da traseira e alumínio jateado.
export function grainNormalMap(): THREE.DataTexture {
  if (grainCache) return grainCache;
  const size = 256;
  let seed = 1337;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let h: Float32Array<ArrayBuffer> = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = rand();
  // Desfoque em caixa com borda circular (mantém a textura repetível).
  const blur = (src: Float32Array<ArrayBuffer>, r: number): Float32Array<ArrayBuffer> => {
    const tmp = new Float32Array(src.length);
    const out = new Float32Array(src.length);
    const n = r * 2 + 1;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += src[y * size + ((x + k + size) % size)];
        tmp[y * size + x] = s / n;
      }
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += tmp[((y + k + size) % size) * size + x];
        out[y * size + x] = s / n;
      }
    return out;
  };
  h = blur(h, 1);
  const data = new Uint8Array(size * size * 4);
  const strength = 6;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = h[y * size + ((x + 1) % size)] - h[y * size + ((x - 1 + size) % size)];
      const dy = h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x];
      const nx = -dx * strength;
      const ny = -dy * strength;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      data[i] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  grainCache = tex;
  return tex;
}

// Cópia com repetição própria (cada peça usa uma escala de grão diferente).
export function grainAt(repeatX: number, repeatY: number): THREE.Texture {
  const t = grainNormalMap().clone();
  t.repeat.set(repeatX, repeatY);
  t.needsUpdate = true;
  return t;
}

// Tampo do MacBook Pro: teclado (fileira de funções em altura cheia e Touch ID, moldura preta),
// alto-falantes e trackpad, com mapa de rugosidade/metal no mesmo layout.
export function drawDeck(dark: boolean, W: number, D: number): { map: THREE.CanvasTexture; orm: THREE.CanvasTexture } {
  const cw = 2048;
  const ch = Math.round((cw * D) / W);
  const colorCanvas = makeCanvas(cw, ch);
  const ormCanvas = makeCanvas(cw, ch);
  const c = colorCanvas.getContext('2d')!;
  const o = ormCanvas.getContext('2d')!;
  // Canal G = rugosidade, B = metalicidade (convenção do three.js).
  const orm = (rough: number, metal: number) => `rgb(255, ${Math.round(rough * 255)}, ${Math.round(metal * 255)})`;

  c.fillStyle = dark ? '#2e2c2e' : '#e3e4e5';
  c.fillRect(0, 0, cw, ch);
  // Pontilhado leve de alumínio jateado, para o tampo não parecer plástico liso.
  const speckle = c.getImageData(0, 0, cw, ch);
  for (let i = 0; i < speckle.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 7;
    speckle.data[i] += n;
    speckle.data[i + 1] += n;
    speckle.data[i + 2] += n;
  }
  c.putImageData(speckle, 0, 0);
  o.fillStyle = orm(0.38, 1);
  o.fillRect(0, 0, cw, ch);

  const kx0 = cw * 0.15;
  const kx1 = cw * 0.85;
  const ky0 = ch * 0.075;
  const u = (kx1 - kx0) / 14.5;
  const gap = u * 0.12;
  const rows: { h: number; keys: number[]; labels: string[] }[] = [
    { h: 1, keys: [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], labels: ['esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', ''] },
    { h: 1, keys: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5], labels: ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'delete'] },
    { h: 1, keys: [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], labels: ['tab', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\'] },
    { h: 1, keys: [1.8, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.7], labels: ['caps lock', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'return'] },
    { h: 1, keys: [2.3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.2], labels: ['shift', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'shift'] },
    { h: 1, keys: [1, 1, 1, 1.25, 5, 1.25, 1, 1, 1, 1], labels: ['fn', 'control', 'option', 'command', '', 'command', 'option', '◀', '▲▼', '▶'] },
  ];
  const totalH = rows.reduce((s, r) => s + r.h, 0) * u;
  const pad = u * 0.25;
  // Moldura do teclado preta nas duas cores, como no MacBook Pro atual.
  c.fillStyle = '#0d0d0e';
  c.beginPath();
  c.roundRect(kx0 - pad, ky0 - pad, kx1 - kx0 + pad * 2, totalH + pad * 2, u * 0.3);
  c.fill();
  o.fillStyle = orm(0.5, 0.6);
  o.beginPath();
  o.roundRect(kx0 - pad, ky0 - pad, kx1 - kx0 + pad * 2, totalH + pad * 2, u * 0.3);
  o.fill();

  const key = (x: number, y: number, w: number, h: number) => {
    c.beginPath();
    c.roundRect(x + gap / 2, y + gap / 2, w - gap, h - gap, u * 0.12);
    c.fill();
    o.beginPath();
    o.roundRect(x + gap / 2, y + gap / 2, w - gap, h - gap, u * 0.12);
    o.fill();
  };
  const legend = (text: string, x: number, y: number, w: number, h: number, small: boolean) => {
    if (!text) return;
    c.save();
    c.fillStyle = 'rgba(232,232,236,0.86)';
    const single = text.length === 1 || /^F\d+$/.test(text);
    const arrow = '◀▶▲▼'.includes(text);
    c.font = `${single ? 500 : 400} ${Math.round(u * (small ? 0.17 : single ? 0.27 : 0.15))}px ${FONT}`;
    if ((single && !small) || arrow) {
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(text, x + w / 2, y + h * 0.5);
    } else {
      c.textAlign = text === 'delete' || text === 'return' || (text === 'shift' && x > kx0 + u * 7) ? 'right' : 'left';
      c.textBaseline = 'bottom';
      const px = c.textAlign === 'right' ? x + w - gap / 2 - u * 0.12 : x + gap / 2 + u * 0.12;
      c.fillText(text, px, y + h - gap / 2 - u * 0.1);
    }
    c.restore();
  };
  o.fillStyle = orm(0.72, 0);
  let y = ky0;
  rows.forEach((row, ri) => {
    let x = kx0;
    row.keys.forEach((k, ki) => {
      const kw = k * u;
      const kh = row.h * u;
      c.fillStyle = '#0c0c0d';
      // Setas ↑↓ dividem a mesma tecla na última fileira.
      if (ri === 5 && ki === 8) {
        key(x, y, kw, kh / 2);
        key(x, y + kh / 2, kw, kh / 2);
        legend('▲', x, y, kw, kh / 2, true);
        legend('▼', x, y + kh / 2, kw, kh / 2, true);
      } else if (ri === 5 && (ki === 7 || ki === 9)) {
        key(x, y + kh / 2, kw, kh / 2);
        legend(row.labels[ki], x, y + kh / 2, kw, kh / 2, true);
      } else if (ri === 0 && ki === row.keys.length - 1) {
        // Touch ID: tecla lisa e mais brilhante, com o anel do sensor.
        key(x, y, kw, kh);
        c.save();
        c.strokeStyle = 'rgba(150,150,156,0.55)';
        c.lineWidth = u * 0.025;
        c.beginPath();
        c.roundRect(x + gap / 2 + u * 0.05, y + gap / 2 + u * 0.05, kw - gap - u * 0.1, kh - gap - u * 0.1, u * 0.1);
        c.stroke();
        c.restore();
        o.save();
        o.fillStyle = orm(0.25, 0);
        o.beginPath();
        o.roundRect(x + gap / 2, y + gap / 2, kw - gap, kh - gap, u * 0.12);
        o.fill();
        o.restore();
      } else {
        key(x, y, kw, kh);
        legend(row.labels[ki], x, y, kw, kh, false);
      }
      x += kw;
    });
    y += row.h * u;
  });

  // Grades dos alto-falantes.
  const grille = (x0: number, x1: number) => {
    const step = 15;
    for (let gy = ky0; gy < ky0 + totalH; gy += step) {
      for (let gx = x0; gx < x1; gx += step) {
        c.fillStyle = dark ? '#121214' : '#7d7f84';
        c.beginPath();
        c.arc(gx, gy, 3.1, 0, Math.PI * 2);
        c.fill();
        o.fillStyle = orm(0.9, 0);
        o.beginPath();
        o.arc(gx, gy, 3.1, 0, Math.PI * 2);
        o.fill();
      }
    }
  };
  grille(cw * 0.04, cw * 0.125);
  grille(cw * 0.875, cw * 0.96);

  // Trackpad do 14": cerca de 14,6 × 9 cm.
  const tw = cw * 0.46;
  const th = ch * 0.39;
  const tx = (cw - tw) / 2;
  const ty = ch * 0.565;
  c.fillStyle = dark ? '#2a282a' : '#dcdddf';
  c.beginPath();
  c.roundRect(tx, ty, tw, th, cw * 0.012);
  c.fill();
  c.strokeStyle = dark ? '#3b393b' : '#c9cacd';
  c.lineWidth = 3;
  c.stroke();
  o.fillStyle = orm(0.22, 0.3);
  o.beginPath();
  o.roundRect(tx, ty, tw, th, cw * 0.012);
  o.fill();

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const ormTex = new THREE.CanvasTexture(ormCanvas);
  ormTex.colorSpace = THREE.NoColorSpace;
  ormTex.anisotropy = 8;
  return { map, orm: ormTex };
}
