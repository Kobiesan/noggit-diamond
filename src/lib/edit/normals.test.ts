import { describe, expect, it } from 'vitest';
import { Terrain } from '../world/terrain';
import { createBlankAdt } from '../adt/builder';
import { CHUNK_SIZE, TILE_SIZE, VERTS_PER_CHUNK } from '../constants';
import { recomputeNormals } from './normals';
import { raiseLower } from './sculpt';

describe('recomputeNormals', () => {
  it('produces straight-up normals on flat terrain', () => {
    const doc = createBlankAdt('T', 0, 0, { baseHeight: 55 });
    const t = new Terrain();
    t.addTile(doc);
    recomputeNormals(t, [t.chunkAt(0, 0, 0)!.key]);
    const n = doc.chunks[0].normals;
    for (let vi = 0; vi < VERTS_PER_CHUNK; vi++) {
      expect(n[vi * 3]).toBe(0);
      expect(n[vi * 3 + 1]).toBe(0);
      expect(n[vi * 3 + 2]).toBe(127);
    }
  });

  it('tilts against an eastward upslope with a positive up component', () => {
    const doc = createBlankAdt('T', 0, 0);
    const t = new Terrain();
    t.addTile(doc);
    // Raise a big smooth bump and check normals around it point away
    // from the peak with a positive up component.
    raiseLower(t, TILE_SIZE / 2, TILE_SIZE / 2, 100, 10, 'smooth', 40);
    recomputeNormals(t);
    // Sample a chunk on the western flank of the bump.
    const ref = t.chunkAtPoint(TILE_SIZE / 2 - 50, TILE_SIZE / 2)!;
    let sawTilt = false;
    for (let vi = 0; vi < VERTS_PER_CHUNK; vi++) {
      const east = ref.chunk.normals[vi * 3];
      const up = ref.chunk.normals[vi * 3 + 2];
      expect(up).toBeGreaterThan(0);
      if (east < -5) sawTilt = true; // west flank rises to the east -> normal tilts west
    }
    expect(sawTilt).toBe(true);
  });

  it('keeps normals continuous across chunk borders', () => {
    const doc = createBlankAdt('T', 0, 0);
    const t = new Terrain();
    t.addTile(doc);
    raiseLower(t, CHUNK_SIZE, CHUNK_SIZE, 60, 5, 'smooth', 25);
    recomputeNormals(t);
    // Shared corner vertex of chunks (0,0) and (1,0): last col of chunk 0
    // row r equals first col of chunk 1 row r.
    const west = t.chunkAt(0, 0, 0)!.chunk;
    const east = t.chunkAt(0, 0, 1)!.chunk;
    for (let row = 0; row < 9; row++) {
      const wIdx = (row * 17 + 8) * 3;
      const eIdx = (row * 17 + 0) * 3;
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(west.normals[wIdx + c] - east.normals[eIdx + c])).toBeLessThanOrEqual(1);
      }
    }
  });
});
