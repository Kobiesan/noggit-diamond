/**
 * Area id painting and impassable flag editing (chunk-granular).
 */

import type { AdtDoc } from '../adt/types';
import { MCNK_FLAGS } from '../constants';
import type { Terrain } from '../world/terrain';

/** Paint an AreaTable id onto all chunks under the brush. Returns count. */
export function paintAreaId(
  terrain: Terrain,
  mx: number,
  mz: number,
  radius: number,
  areaId: number,
): number {
  let count = 0;
  for (const ref of terrain.chunksInRadius(mx, mz, radius)) {
    if (ref.chunk.areaId !== areaId) {
      ref.chunk.areaId = areaId;
      terrain.markDirty(ref);
    }
    count++;
  }
  return count;
}

/** Set or clear the impassable flag on chunks under the brush. */
export function setImpassable(
  terrain: Terrain,
  mx: number,
  mz: number,
  radius: number,
  value: boolean,
): number {
  let count = 0;
  for (const ref of terrain.chunksInRadius(mx, mz, radius)) {
    const had = (ref.chunk.flags & MCNK_FLAGS.IMPASS) !== 0;
    if (had !== value) {
      ref.chunk.flags = value
        ? ref.chunk.flags | MCNK_FLAGS.IMPASS
        : ref.chunk.flags & ~MCNK_FLAGS.IMPASS;
      terrain.markDirty(ref);
    }
    count++;
  }
  return count;
}

/** Histogram of area ids used across a tile: areaId -> chunk count. */
export function listAreaIds(doc: AdtDoc): Map<number, number> {
  const out = new Map<number, number>();
  for (const chunk of doc.chunks) {
    out.set(chunk.areaId, (out.get(chunk.areaId) ?? 0) + 1);
  }
  return out;
}
