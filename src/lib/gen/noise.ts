/**
 * Seeded procedural noise: mulberry32 PRNG, 2D simplex noise, fBm and
 * ridged fractal helpers. Fully deterministic per seed.
 */

/** Fast seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

const GRAD2: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

/** Classic 2D simplex noise with a seeded permutation table. */
export class SimplexNoise2D {
  private perm = new Uint8Array(512);

  constructor(seed: number) {
    const rand = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** Noise value at (x, y), in [-1, 1]. */
  sample(x: number, y: number): number {
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
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
    let n = 0;
    for (const [gx, gy, dx, dy] of [
      [this.perm[ii + this.perm[jj]], 0, x0, y0],
      [this.perm[ii + i1 + this.perm[jj + j1]], 0, x1, y1],
      [this.perm[ii + 1 + this.perm[jj + 1]], 0, x2, y2],
    ] as const) {
      const t0 = 0.5 - dx * dx - dy * dy;
      if (t0 > 0) {
        const g = GRAD2[gx % 8];
        n += t0 ** 4 * (g[0] * dx + g[1] * dy);
      }
    }
    // Scale to roughly [-1, 1].
    return Math.max(-1, Math.min(1, n * 70));
  }
}

/** Options for fractal noise accumulation. */
export interface FractalOptions {
  octaves?: number;
  lacunarity?: number;
  gain?: number;
  frequency?: number;
}

/** Fractal Brownian motion of a noise source, roughly [-1, 1]. */
export function fbm(
  noise: SimplexNoise2D,
  x: number,
  y: number,
  opts: FractalOptions = {},
): number {
  const { octaves = 4, lacunarity = 2, gain = 0.5, frequency = 1 } = opts;
  let amp = 1;
  let freq = frequency;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise.sample(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/** Ridged multifractal noise in [0, 1] (sharp mountain crests). */
export function ridged(
  noise: SimplexNoise2D,
  x: number,
  y: number,
  opts: FractalOptions = {},
): number {
  const { octaves = 4, lacunarity = 2, gain = 0.5, frequency = 1 } = opts;
  let amp = 1;
  let freq = frequency;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const v = 1 - Math.abs(noise.sample(x * freq, y * freq));
    sum += amp * v * v;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}
