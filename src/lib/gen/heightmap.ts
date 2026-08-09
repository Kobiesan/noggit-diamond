/**
 * Heightmap import/export: sample external raster heightmaps onto ADT
 * vertex layouts and back, plus 16-bit PGM encode/decode for lossless
 * grayscale interchange with image tools.
 */

import type { AdtDoc } from '../adt/types';
import { CHUNK_SIZE, TILE_SIZE, VERTS_PER_CHUNK } from '../constants';
import { VERTEX_OFFSETS } from '../coords';
import { Terrain } from '../world/terrain';

/** A raster height grid. */
export interface HeightGrid {
  width: number;
  height: number;
  /** Row-major samples, arbitrary units. */
  data: Float32Array;
}

/** Bilinear sample of a grid at normalized (u, v) in [0, 1]. */
export function sampleGrid(grid: HeightGrid, u: number, v: number): number {
  const x = Math.min(Math.max(u, 0), 1) * (grid.width - 1);
  const y = Math.min(Math.max(v, 0), 1) * (grid.height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, grid.width - 1);
  const y1 = Math.min(y0 + 1, grid.height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const a = grid.data[y0 * grid.width + x0];
  const b = grid.data[y0 * grid.width + x1];
  const c = grid.data[y1 * grid.width + x0];
  const d = grid.data[y1 * grid.width + x1];
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

/** Options for importHeightmap. */
export interface ImportOptions {
  /** Height mapped to sample value 0. */
  minHeight: number;
  /** Height mapped to sample value 1 (or grid max when normalizing). */
  maxHeight: number;
  /** Treat grid values as raw heights instead of normalized [0,1]. */
  raw?: boolean;
}

/**
 * Sample a grid across the whole tile onto every chunk vertex.
 * Grid (0,0) maps to the tile's NW corner, (1,1) to its SE corner.
 */
export function importHeightmap(doc: AdtDoc, grid: HeightGrid, opts: ImportOptions): void {
  for (const chunk of doc.chunks) {
    const baseX = chunk.ix * CHUNK_SIZE;
    const baseZ = chunk.iy * CHUNK_SIZE;
    for (let vi = 0; vi < VERTS_PER_CHUNK; vi++) {
      const off = VERTEX_OFFSETS[vi];
      const u = (baseX + off.x) / TILE_SIZE;
      const v = (baseZ + off.y) / TILE_SIZE;
      const s = sampleGrid(grid, u, v);
      chunk.heights[vi] = opts.raw ? s : opts.minHeight + s * (opts.maxHeight - opts.minHeight);
    }
    chunk.position[2] = 0;
  }
}

/**
 * Rasterize a tile's terrain into a square grid of raw heights.
 * Samples are clamped slightly inside the tile so edge rows stay on it.
 */
export function exportHeightmap(doc: AdtDoc, resolution = 257): HeightGrid {
  const terrain = new Terrain();
  terrain.addTile(doc);
  const data = new Float32Array(resolution * resolution);
  const x0 = doc.tileX * TILE_SIZE;
  const z0 = doc.tileY * TILE_SIZE;
  const eps = 1e-3;
  let last = 0;
  for (let row = 0; row < resolution; row++) {
    const mz = z0 + Math.min((row / (resolution - 1)) * TILE_SIZE, TILE_SIZE - eps);
    for (let col = 0; col < resolution; col++) {
      const mx = x0 + Math.min((col / (resolution - 1)) * TILE_SIZE, TILE_SIZE - eps);
      const h = terrain.heightAt(mx, mz);
      if (h !== null) last = h;
      data[row * resolution + col] = h ?? last;
    }
  }
  return { width: resolution, height: resolution, data };
}

/** Minimum and maximum of a grid. */
export function gridMinMax(grid: HeightGrid): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const v of grid.data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/**
 * Encode a grid as binary 16-bit PGM (P5, maxval 65535, big-endian
 * samples per the netpbm spec), normalizing [min, max] -> [0, 65535].
 */
export function encodePgm16(grid: HeightGrid, min?: number, max?: number): Uint8Array {
  const mm = gridMinMax(grid);
  const lo = min ?? mm.min;
  const hi = max ?? mm.max;
  const range = hi - lo || 1;
  const header = `P5\n# noggit-diamond heightmap ${lo} ${hi}\n${grid.width} ${grid.height}\n65535\n`;
  const out = new Uint8Array(header.length + grid.width * grid.height * 2);
  for (let i = 0; i < header.length; i++) out[i] = header.charCodeAt(i);
  let o = header.length;
  for (let i = 0; i < grid.data.length; i++) {
    const n = Math.max(0, Math.min(65535, Math.round(((grid.data[i] - lo) / range) * 65535)));
    out[o++] = n >> 8;
    out[o++] = n & 0xff;
  }
  return out;
}

/**
 * Decode a binary PGM (P5, 8- or 16-bit) into a grid of heights mapped
 * to [minHeight, maxHeight].
 */
export function decodePgm16(bytes: Uint8Array, minHeight: number, maxHeight: number): HeightGrid {
  let pos = 0;
  const readToken = (): string => {
    // Skip whitespace and comments.
    for (;;) {
      while (pos < bytes.length && /\s/.test(String.fromCharCode(bytes[pos]))) pos++;
      if (pos < bytes.length && bytes[pos] === 0x23 /* # */) {
        while (pos < bytes.length && bytes[pos] !== 0x0a) pos++;
      } else {
        break;
      }
    }
    let token = '';
    while (pos < bytes.length && !/\s/.test(String.fromCharCode(bytes[pos]))) {
      token += String.fromCharCode(bytes[pos++]);
    }
    return token;
  };
  const magic = readToken();
  if (magic !== 'P5') throw new Error(`not a binary PGM (magic ${magic})`);
  const width = parseInt(readToken(), 10);
  const height = parseInt(readToken(), 10);
  const maxval = parseInt(readToken(), 10);
  if (!width || !height || !maxval) throw new Error('malformed PGM header');
  pos++; // single whitespace after maxval
  const wide = maxval > 255;
  const data = new Float32Array(width * height);
  const range = maxHeight - minHeight;
  for (let i = 0; i < width * height; i++) {
    let v: number;
    if (wide) {
      v = (bytes[pos] << 8) | bytes[pos + 1];
      pos += 2;
    } else {
      v = bytes[pos++];
    }
    data[i] = minHeight + (v / maxval) * range;
  }
  return { width, height, data };
}
