/**
 * Terrain normal recomputation (MCNR).
 *
 * Normals are derived from central height differences sampled across
 * chunk and tile borders, so lighting is continuous everywhere.
 * File byte order per vertex: (east, south, up) * 127.
 */

import { HALF_UNIT, UNIT_SIZE, VERTS_PER_CHUNK } from '../constants';
import { VERTEX_OFFSETS } from '../coords';
import type { ChunkRef, Terrain } from '../world/terrain';

function clampByte(v: number): number {
  const r = Math.round(v);
  return r < -127 ? -127 : r > 127 ? 127 : r;
}

/** Recompute normals for the given chunk keys (or the whole world). */
export function recomputeNormals(terrain: Terrain, keys?: Iterable<string>): void {
  const refs: ChunkRef[] = [];
  if (keys) {
    for (const key of keys) {
      const parts = key.split('_').map(Number);
      const ref = terrain.chunkAt(parts[0], parts[1], parts[2]);
      if (ref) refs.push(ref);
    }
  } else {
    for (const doc of terrain.tiles.values()) {
      for (let i = 0; i < doc.chunks.length; i++) {
        const ref = terrain.chunkAt(doc.tileX, doc.tileY, i);
        if (ref) refs.push(ref);
      }
    }
  }

  for (const ref of refs) {
    for (let vi = 0; vi < VERTS_PER_CHUNK; vi++) {
      const off = VERTEX_OFFSETS[vi];
      const vx = ref.originX + off.x;
      const vz = ref.originZ + off.y;
      const own = ref.chunk.heights[vi];
      const hEast = terrain.heightAt(vx + HALF_UNIT, vz) ?? own;
      const hWest = terrain.heightAt(vx - HALF_UNIT, vz) ?? own;
      const hSouth = terrain.heightAt(vx, vz + HALF_UNIT) ?? own;
      const hNorth = terrain.heightAt(vx, vz - HALF_UNIT) ?? own;
      // Slopes per yard.
      const dx = (hEast - hWest) / UNIT_SIZE;
      const dz = (hSouth - hNorth) / UNIT_SIZE;
      // Surface normal of y = f(x, z): (-df/dx, -df/dz, 1) normalized,
      // expressed as (east, south, up).
      const len = Math.sqrt(dx * dx + dz * dz + 1);
      const o = vi * 3;
      ref.chunk.normals[o] = clampByte((-dx / len) * 127);
      ref.chunk.normals[o + 1] = clampByte((-dz / len) * 127);
      ref.chunk.normals[o + 2] = clampByte((1 / len) * 127);
    }
    terrain.markDirty(ref);
  }
}
