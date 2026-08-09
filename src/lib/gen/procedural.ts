/**
 * Procedural terrain generation over ADT documents.
 *
 * Heights are sampled at absolute map-space vertex positions, so
 * adjacent chunks and adjacent tiles generated with the same parameters
 * line up with zero seams.
 */

import type { AdtDoc } from '../adt/types';
import { TILE_SIZE, VERTS_PER_CHUNK } from '../constants';
import { chunkOrigin, VERTEX_OFFSETS, outerIndex, innerIndex } from '../coords';
import { SimplexNoise2D, fbm, ridged } from './noise';

/** Terrain generation styles. */
export type ProceduralStyle = 'rolling' | 'ridged' | 'islands';

/** Parameters for generateTerrain. */
export interface ProceduralParams {
  seed: number;
  /** Peak height above/below baseHeight, in yards. */
  amplitude: number;
  /** Base noise frequency in cycles per yard (0.002 ~ gentle hills). */
  frequency: number;
  octaves: number;
  lacunarity: number;
  gain: number;
  style: ProceduralStyle;
  baseHeight: number;
}

/** Sensible defaults for a rolling-hills tile. */
export function defaultProceduralParams(seed = 1337): ProceduralParams {
  return {
    seed,
    amplitude: 60,
    frequency: 0.003,
    octaves: 5,
    lacunarity: 2,
    gain: 0.5,
    style: 'rolling',
    baseHeight: 0,
  };
}

/** Overwrite a tile's terrain heights from seeded noise. */
export function generateTerrain(doc: AdtDoc, params: ProceduralParams): void {
  const noise = new SimplexNoise2D(params.seed);
  const opts = {
    octaves: params.octaves,
    lacunarity: params.lacunarity,
    gain: params.gain,
    frequency: 1,
  };
  const tileCenterX = (doc.tileX + 0.5) * TILE_SIZE;
  const tileCenterZ = (doc.tileY + 0.5) * TILE_SIZE;

  for (const chunk of doc.chunks) {
    const origin = chunkOrigin(doc.tileX, doc.tileY, chunk.ix, chunk.iy);
    for (let vi = 0; vi < VERTS_PER_CHUNK; vi++) {
      const off = VERTEX_OFFSETS[vi];
      const mx = (origin.x + off.x) * params.frequency;
      const mz = (origin.y + off.y) * params.frequency;
      let h: number;
      switch (params.style) {
        case 'rolling':
          h = fbm(noise, mx, mz, opts) * params.amplitude;
          break;
        case 'ridged':
          h = ridged(noise, mx, mz, opts) * params.amplitude;
          break;
        case 'islands': {
          const dx = (origin.x + off.x - tileCenterX) / (TILE_SIZE / 2);
          const dz = (origin.y + off.y - tileCenterZ) / (TILE_SIZE / 2);
          const d = Math.sqrt(dx * dx + dz * dz);
          const mask = Math.max(0, 1 - d * d);
          h = (fbm(noise, mx, mz, opts) * 0.5 + 0.5) * params.amplitude * mask
            - params.amplitude * 0.25;
          break;
        }
      }
      chunk.heights[vi] = params.baseHeight + h;
    }
    chunk.position[2] = 0;
  }
}

/** Box-blur a tile's heights toward local averages, `iterations` times. */
export function smoothTerrain(doc: AdtDoc, iterations: number): void {
  for (let iter = 0; iter < iterations; iter++) {
    for (const chunk of doc.chunks) {
      const src = chunk.heights.slice();
      // Outer vertices average their outer neighbors.
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          let sum = 0;
          let n = 0;
          for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || rr > 8 || cc < 0 || cc > 8) continue;
            sum += src[outerIndex(rr, cc)];
            n++;
          }
          if (n > 0) {
            const i = outerIndex(r, c);
            chunk.heights[i] = (src[i] + sum / n) / 2;
          }
        }
      }
      // Inner vertices average their 4 surrounding outer corners.
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const avg =
            (src[outerIndex(r, c)] +
              src[outerIndex(r, c + 1)] +
              src[outerIndex(r + 1, c)] +
              src[outerIndex(r + 1, c + 1)]) /
            4;
          const i = innerIndex(r, c);
          chunk.heights[i] = (src[i] + avg) / 2;
        }
      }
    }
  }
}
