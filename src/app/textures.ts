/**
 * Texture registry: maps WoW texture paths to display colors (and
 * optionally user-loaded images) for terrain compositing. Real BLPs live
 * inside MPQ archives; the editor renders stable, distinct stand-in
 * colors per path, or PNG/JPG images the user associates manually.
 */

export interface TextureEntry {
  path: string;
  /** Display color as [r, g, b] 0..255. */
  color: [number, number, number];
  /** Optional user-provided image (drawn instead of the flat color). */
  image: ImageBitmap | null;
  /** 64x64 RGBA pixels cache for compositing. */
  pixels: Uint8ClampedArray | null;
}

/** Deterministic, readable color for a texture path. */
export function hashColor(path: string): [number, number, number] {
  let h = 2166136261;
  const lower = path.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    h ^= lower.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = ((h >>> 0) % 360) / 360;
  const sat = 0.35 + (((h >>> 8) & 0xff) / 255) * 0.3;
  const val = 0.45 + (((h >>> 16) & 0xff) / 255) * 0.3;
  return hsvToRgb(hue, sat, val);
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [
    [v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q],
  ][i % 6];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** Well-known tileset paths get natural colors instead of hashes. */
const NATURAL_HINTS: [RegExp, [number, number, number]][] = [
  [/grass/i, [86, 125, 60]],
  [/dirt|mud/i, [121, 92, 62]],
  [/rock|stone|cliff/i, [110, 108, 106]],
  [/snow|ice/i, [225, 232, 240]],
  [/sand|desert|beach/i, [194, 170, 120]],
  [/lava|magma/i, [200, 80, 30]],
  [/water/i, [60, 110, 160]],
  [/leaf|forest|moss/i, [70, 105, 55]],
  [/crop|field|farm/i, [140, 130, 70]],
  [/road|path|cobble/i, [130, 115, 95]],
];

export class TextureRegistry {
  private entries = new Map<string, TextureEntry>();
  /** Bumped whenever an entry changes (renderer watches this). */
  version = 0;

  get(path: string): TextureEntry {
    const key = path.toLowerCase();
    let entry = this.entries.get(key);
    if (!entry) {
      let color = hashColor(path);
      for (const [re, c] of NATURAL_HINTS) {
        if (re.test(path)) {
          color = c;
          break;
        }
      }
      entry = { path, color, image: null, pixels: null };
      this.entries.set(key, entry);
      this.version++;
    }
    return entry;
  }

  /** Associate an image with a path; downsamples to 64x64 pixel cache. */
  async setImage(path: string, blob: Blob): Promise<void> {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, 64, 64);
    const entry = this.get(path);
    entry.image = bitmap;
    entry.pixels = ctx.getImageData(0, 0, 64, 64).data;
    // Refresh the flat color from the image average for distant LOD.
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < entry.pixels.length; i += 4) {
      r += entry.pixels[i];
      g += entry.pixels[i + 1];
      b += entry.pixels[i + 2];
    }
    const n = entry.pixels.length / 4;
    entry.color = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    this.version++;
  }

  /** 64x64 sample of a texture at texel (x, y): flat color or image. */
  sample(entry: TextureEntry, x: number, y: number): [number, number, number] {
    if (entry.pixels) {
      const i = (y * 64 + x) * 4;
      return [entry.pixels[i], entry.pixels[i + 1], entry.pixels[i + 2]];
    }
    return entry.color;
  }
}
