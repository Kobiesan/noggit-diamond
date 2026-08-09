/**
 * Terrain sculpting: raise/lower, flatten, smooth.
 *
 * All operations work in map coordinates on a Terrain and mark touched
 * chunks dirty. Vertices shared between adjacent chunks are visited once
 * per owning chunk at identical positions, so copies receive identical
 * values and no seams appear.
 */

import type { Terrain } from '../world/terrain';
import { HALF_UNIT } from '../constants';
import { falloff, type BrushShape } from './brush';

/** Raise (amount > 0) or lower (amount < 0) terrain under the brush. */
export function raiseLower(
  terrain: Terrain,
  mx: number,
  mz: number,
  radius: number,
  innerRadius: number,
  shape: BrushShape,
  amount: number,
): void {
  terrain.forEachVertexInRadius(mx, mz, radius, (ref, vi, _vx, _vz, dist) => {
    const w = falloff(shape, dist, radius, innerRadius);
    if (w <= 0) return;
    ref.chunk.heights[vi] += amount * w;
    terrain.markDirty(ref);
  });
}

/** Flatten mode: which side of the target plane is affected. */
export type FlattenMode = 'both' | 'raise' | 'lower';

/**
 * Pull terrain toward a target height. `strength` in [0, 1] is the
 * blend factor at full falloff (1 = snap to target).
 */
export function flattenTo(
  terrain: Terrain,
  mx: number,
  mz: number,
  radius: number,
  innerRadius: number,
  shape: BrushShape,
  targetHeight: number,
  strength: number,
  mode: FlattenMode = 'both',
): void {
  terrain.forEachVertexInRadius(mx, mz, radius, (ref, vi, _vx, _vz, dist) => {
    const w = falloff(shape, dist, radius, innerRadius) * strength;
    if (w <= 0) return;
    const h = ref.chunk.heights[vi];
    if (mode === 'raise' && h >= targetHeight) return;
    if (mode === 'lower' && h <= targetHeight) return;
    ref.chunk.heights[vi] = h + (targetHeight - h) * w;
    terrain.markDirty(ref);
  });
}

/**
 * Smooth (blur) terrain: blend each vertex toward the average of the
 * surrounding terrain sampled a half-unit away in the four cardinal
 * directions. Order-independent: all targets are computed before any
 * write.
 */
export function smoothHeights(
  terrain: Terrain,
  mx: number,
  mz: number,
  radius: number,
  innerRadius: number,
  shape: BrushShape,
  strength: number,
): void {
  interface Pending {
    heights: Float64Array;
    vi: number;
    target: number;
    w: number;
  }
  const pending: Pending[] = [];
  const dirty = new Set<Parameters<Terrain['markDirty']>[0]>();
  terrain.forEachVertexInRadius(mx, mz, radius, (ref, vi, vx, vz, dist) => {
    const w = falloff(shape, dist, radius, innerRadius) * strength;
    if (w <= 0) return;
    const own = ref.chunk.heights[vi];
    let sum = 0;
    let n = 0;
    for (const [dx, dz] of [
      [HALF_UNIT, 0],
      [-HALF_UNIT, 0],
      [0, HALF_UNIT],
      [0, -HALF_UNIT],
    ]) {
      const h = terrain.heightAt(vx + dx, vz + dz);
      sum += h ?? own;
      n++;
    }
    pending.push({ heights: ref.chunk.heights, vi, target: sum / n, w });
    dirty.add(ref);
  });
  for (const p of pending) {
    p.heights[p.vi] += (p.target - p.heights[p.vi]) * p.w;
  }
  for (const ref of dirty) terrain.markDirty(ref);
}
