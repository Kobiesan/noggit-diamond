/**
 * Terrain hole editing (low-res 16-bit hole masks).
 */

import type { AdtDoc, McnkChunk } from '../adt/types';
import { UNIT_SIZE } from '../constants';
import { setHole } from '../coords';
import type { Terrain } from '../world/terrain';

/**
 * Punch (value=true) or fill (value=false) the hole covering the quad
 * under a map-space point. Returns false when no chunk is loaded there.
 */
export function setHoleAtPoint(terrain: Terrain, mx: number, mz: number, value: boolean): boolean {
  const ref = terrain.chunkAtPoint(mx, mz);
  if (!ref) return false;
  let qc = Math.floor((mx - ref.originX) / UNIT_SIZE);
  let qr = Math.floor((mz - ref.originZ) / UNIT_SIZE);
  qc = Math.min(7, Math.max(0, qc));
  qr = Math.min(7, Math.max(0, qr));
  ref.chunk.holes = setHole(ref.chunk.holes, qr, qc, value);
  terrain.markDirty(ref);
  return true;
}

/** Remove every hole in a tile. */
export function clearAllHoles(doc: AdtDoc): void {
  for (const chunk of doc.chunks) chunk.holes = 0;
}

/** Number of set hole bits on a chunk (0..16). */
export function holeCount(chunk: McnkChunk): number {
  let n = 0;
  for (let i = 0; i < 16; i++) if (chunk.holes & (1 << i)) n++;
  return n;
}
