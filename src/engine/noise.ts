// Ruído simplex 2D (algoritmo público de Ken Perlin / Stefan Gustavson), com semente fixa
// para os cenários saírem sempre iguais.

const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

export function createNoise2D(seed = 7) {
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;

  return (x: number, y: number): number => {
    const sk = (x + y) * F2;
    const i = Math.floor(x + sk);
    const j = Math.floor(y + sk);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    const corner = (gx: number, gy: number, g: number) => {
      let tt = 0.5 - gx * gx - gy * gy;
      if (tt < 0) return 0;
      tt *= tt;
      const gr = GRAD[g % 8];
      return tt * tt * (gr[0] * gx + gr[1] * gy);
    };
    const n0 = corner(x0, y0, perm[ii + perm[jj]]);
    const n1 = corner(x1, y1, perm[ii + i1 + perm[jj + j1]]);
    const n2 = corner(x2, y2, perm[ii + 1 + perm[jj + 1]]);
    return 70 * (n0 + n1 + n2);
  };
}

// Soma de oitavas (fBm) e versão "em crista" para picos de rocha.
export function fbm(noise: (x: number, y: number) => number, x: number, y: number, octaves = 5) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq, y * freq);
    freq *= 2;
    amp *= 0.5;
  }
  return sum;
}

export function ridged(noise: (x: number, y: number) => number, x: number, y: number, octaves = 5) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let prev = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(noise(x * freq, y * freq));
    n *= n;
    sum += n * amp * prev;
    prev = n;
    freq *= 2.1;
    amp *= 0.5;
  }
  return sum;
}
