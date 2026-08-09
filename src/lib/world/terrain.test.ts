import { describe, expect, it } from 'vitest';
import { Terrain, chunkKey } from './terrain';
import { createBlankAdt } from '../adt/builder';
import { CHUNK_SIZE, TILE_SIZE, UNIT_SIZE } from '../constants';
import { outerIndex, innerIndex, setHole } from '../coords';

function terrainWithTile(baseHeight = 0): Terrain {
  const t = new Terrain();
  t.addTile(createBlankAdt('T', 0, 0, { baseHeight }));
  return t;
}

describe('Terrain', () => {
  it('finds chunks by point and by radius', () => {
    const t = terrainWithTile();
    const ref = t.chunkAtPoint(CHUNK_SIZE * 1.5, CHUNK_SIZE * 2.5);
    expect(ref).not.toBeNull();
    expect(ref!.chunk.ix).toBe(1);
    expect(ref!.chunk.iy).toBe(2);

    const single = t.chunksInRadius(CHUNK_SIZE / 2, CHUNK_SIZE / 2, 1);
    expect(single).toHaveLength(1);
    const many = t.chunksInRadius(CHUNK_SIZE * 2, CHUNK_SIZE * 2, CHUNK_SIZE);
    expect(many.length).toBeGreaterThanOrEqual(4);
  });

  it('returns null outside loaded tiles', () => {
    const t = terrainWithTile();
    expect(t.chunkAtPoint(-1, 0)).toBeNull();
    expect(t.chunkAtPoint(TILE_SIZE + 1, 0)).toBeNull();
    expect(t.heightAt(TILE_SIZE + 1, 0)).toBeNull();
  });

  it('interpolates flat terrain exactly', () => {
    const t = terrainWithTile(77);
    expect(t.heightAt(10.3, 200.9)).toBeCloseTo(77, 10);
    expect(t.heightAt(0, 0)).toBeCloseTo(77, 10);
  });

  it('interpolates within a sloped quad', () => {
    const t = terrainWithTile(0);
    const ref = t.chunkAt(0, 0, 0)!;
    // Raise the NW corner vertex of quad (0,0) to 10.
    ref.chunk.heights[outerIndex(0, 0)] = 10;
    ref.chunk.heights[innerIndex(0, 0)] = 5;
    // At the corner itself: 10.
    expect(t.heightAt(0, 0)).toBeCloseTo(10, 6);
    // At the quad center: the center vertex value.
    expect(t.heightAt(UNIT_SIZE / 2, UNIT_SIZE / 2)).toBeCloseTo(5, 6);
    // Monotonic between: sample on the diagonal.
    const mid = t.heightAt(UNIT_SIZE / 4, UNIT_SIZE / 4)!;
    expect(mid).toBeGreaterThan(5);
    expect(mid).toBeLessThan(10);
  });

  it('reports null height inside holes', () => {
    const t = terrainWithTile(5);
    const ref = t.chunkAt(0, 0, 0)!;
    ref.chunk.holes = setHole(0, 0, 0, true);
    expect(t.heightAt(UNIT_SIZE, UNIT_SIZE)).toBeNull();
    expect(t.heightAt(CHUNK_SIZE - 0.1, CHUNK_SIZE - 0.1)).toBeCloseTo(5);
  });

  it('visits vertices within a radius on both sides of a chunk border', () => {
    const t = terrainWithTile();
    const visited = new Set<string>();
    t.forEachVertexInRadius(CHUNK_SIZE, CHUNK_SIZE / 2, UNIT_SIZE * 1.1, (ref, vi) => {
      visited.add(`${ref.key}:${vi}`);
    });
    const chunks = new Set([...visited].map((v) => v.split(':')[0]));
    expect(chunks.size).toBeGreaterThanOrEqual(2);
  });

  it('finds neighbors across tile borders', () => {
    const t = new Terrain();
    t.addTile(createBlankAdt('T', 0, 0));
    t.addTile(createBlankAdt('T', 1, 0));
    const eastEdge = t.chunkAt(0, 0, 15)!; // iy=0, ix=15
    const neighbor = t.neighborChunk(eastEdge, 1, 0);
    expect(neighbor).not.toBeNull();
    expect(neighbor!.doc.tileX).toBe(1);
    expect(neighbor!.chunk.ix).toBe(0);
  });

  it('stitches seams deterministically', () => {
    const t = new Terrain();
    t.addTile(createBlankAdt('T', 0, 0));
    t.addTile(createBlankAdt('T', 1, 0));
    const westChunk = t.chunkAt(0, 0, 15)!;
    for (let row = 0; row < 9; row++) westChunk.chunk.heights[outerIndex(row, 8)] = 42;
    t.stitchSeams([westChunk.key]);
    const eastChunk = t.chunkAt(1, 0, 0)!;
    for (let row = 0; row < 9; row++) {
      expect(eastChunk.chunk.heights[outerIndex(row, 0)]).toBe(42);
    }
  });

  it('tracks and drains dirty chunks', () => {
    const t = terrainWithTile();
    t.takeDirty();
    const ref = t.chunkAt(0, 0, 3)!;
    t.markDirty(ref);
    expect(t.takeDirty()).toEqual([chunkKey(0, 0, 3)]);
    expect(t.takeDirty()).toEqual([]);
  });

  it('allocates unique ids above existing placements', () => {
    const t = new Terrain();
    const doc = createBlankAdt('T', 0, 0);
    doc.doodads.push({
      nameId: 0,
      uniqueId: 500,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
      flags: 0,
    });
    t.addTile(doc);
    expect(t.allocUniqueId()).toBe(501);
  });
});
