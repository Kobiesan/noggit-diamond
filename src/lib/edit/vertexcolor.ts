/**
 * MCCV vertex color painting (per-vertex terrain tinting).
 * Stored per vertex as 4 bytes (b, g, r, a); 0x7F is neutral.
 */

import type { AdtDoc, McnkChunk } from '../adt/types';
import { MCNK_FLAGS, VERTS_PER_CHUNK } from '../constants';
import type { Terrain } from '../world/terrain';
import { clampByte, falloff, type BrushShape } from './brush';

/** Ensure a chunk has an MCCV array, initializing to neutral gray. */
export function ensureVertexColors(chunk: McnkChunk): Uint8Array {
  if (!chunk.vertexColors) {
    const colors = new Uint8Array(VERTS_PER_CHUNK * 4);
    colors.fill(0x7f);
    chunk.vertexColors = colors;
    chunk.flags |= MCNK_FLAGS.HAS_MCCV;
  }
  return chunk.vertexColors;
}

/**
 * Blend vertex colors toward an RGB target under the brush.
 * `rgb` components are 0..255 where 127 is neutral.
 */
export function paintVertexColor(
  terrain: Terrain,
  mx: number,
  mz: number,
  radius: number,
  innerRadius: number,
  shape: BrushShape,
  strength: number,
  rgb: [number, number, number],
): void {
  terrain.forEachVertexInRadius(mx, mz, radius, (ref, vi, _vx, _vz, dist) => {
    const w = falloff(shape, dist, radius, innerRadius) * strength;
    if (w <= 0) return;
    const colors = ensureVertexColors(ref.chunk);
    const o = vi * 4;
    colors[o] = clampByte(colors[o] + (rgb[2] - colors[o]) * w); // b
    colors[o + 1] = clampByte(colors[o + 1] + (rgb[1] - colors[o + 1]) * w); // g
    colors[o + 2] = clampByte(colors[o + 2] + (rgb[0] - colors[o + 2]) * w); // r
    terrain.markDirty(ref);
  });
}

/** Remove all vertex coloring from a tile. */
export function resetVertexColors(doc: AdtDoc): void {
  for (const chunk of doc.chunks) {
    chunk.vertexColors = null;
    chunk.flags &= ~MCNK_FLAGS.HAS_MCCV;
  }
}
