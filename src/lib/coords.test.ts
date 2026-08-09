import { describe, expect, it } from 'vitest';
import {
  adtFileName,
  chunkTriangles,
  innerIndex,
  isHole,
  isOuterVertex,
  mapToChunkIndex,
  mapToTile,
  mapToWorld,
  outerIndex,
  parseAdtFileName,
  setHole,
  vertexOffset,
  VERTEX_OFFSETS,
  worldToMap,
} from './coords';
import { TILE_SIZE, UNIT_SIZE, HALF_UNIT, ZEROPOINT } from './constants';

describe('coordinate conversion', () => {
  it('world<->map round-trips', () => {
    const m = worldToMap(1234.5, -678.9);
    const w = mapToWorld(m.x, m.y);
    expect(w.x).toBeCloseTo(1234.5, 6);
    expect(w.y).toBeCloseTo(-678.9, 6);
  });

  it('map center is world origin', () => {
    const m = worldToMap(0, 0);
    expect(m.x).toBeCloseTo(ZEROPOINT);
    expect(m.y).toBeCloseTo(ZEROPOINT);
    expect(mapToTile(m.x, m.y)).toEqual({ x: 32, y: 32 });
  });

  it('locates chunks within tiles', () => {
    expect(mapToChunkIndex(0, 0, 0.5, 0.5)).toBe(0);
    expect(mapToChunkIndex(0, 0, TILE_SIZE - 0.5, TILE_SIZE - 0.5)).toBe(255);
    expect(mapToChunkIndex(0, 0, TILE_SIZE + 1, 0)).toBeNull();
  });
});

describe('vertex layout', () => {
  it('interleaves 9x9 outer and 8x8 inner stripes', () => {
    expect(outerIndex(0, 0)).toBe(0);
    expect(outerIndex(0, 8)).toBe(8);
    expect(innerIndex(0, 0)).toBe(9);
    expect(innerIndex(0, 7)).toBe(16);
    expect(outerIndex(1, 0)).toBe(17);
    expect(outerIndex(8, 8)).toBe(144);
    expect(isOuterVertex(0)).toBe(true);
    expect(isOuterVertex(9)).toBe(false);
    expect(isOuterVertex(17)).toBe(true);
  });

  it('positions outer vertices on the unit grid and inner at centers', () => {
    expect(vertexOffset(0)).toEqual({ x: 0, y: 0 });
    expect(vertexOffset(8)).toEqual({ x: 8 * UNIT_SIZE, y: 0 });
    expect(vertexOffset(9)).toEqual({ x: HALF_UNIT, y: HALF_UNIT });
    expect(vertexOffset(144)).toEqual({ x: 8 * UNIT_SIZE, y: 8 * UNIT_SIZE });
    expect(VERTEX_OFFSETS).toHaveLength(145);
  });
});

describe('holes', () => {
  it('sets and tests low-res hole bits (2x2 quads per bit)', () => {
    let holes = 0;
    holes = setHole(holes, 0, 0, true);
    expect(isHole(holes, 0, 0)).toBe(true);
    expect(isHole(holes, 1, 1)).toBe(true); // same 2x2 block
    expect(isHole(holes, 2, 0)).toBe(false);
    holes = setHole(holes, 7, 7, true);
    expect(holes & 0x8000).toBe(0x8000);
    holes = setHole(holes, 0, 1, false);
    expect(isHole(holes, 0, 0)).toBe(false);
  });

  it('respects high-res hole masks when provided', () => {
    const high = 1n << 9n; // quad (1,1)
    expect(isHole(0, 1, 1, high)).toBe(true);
    expect(isHole(0, 1, 2, high)).toBe(false);
  });
});

describe('triangulation', () => {
  it('emits 256 triangles for a hole-free chunk', () => {
    expect(chunkTriangles(0)).toHaveLength(768);
  });

  it('skips triangles inside holes', () => {
    const holes = setHole(0, 0, 0, true); // covers quads (0..1, 0..1)
    expect(chunkTriangles(holes)).toHaveLength(768 - 4 * 4 * 3);
  });
});

describe('ADT filenames', () => {
  it('formats and parses', () => {
    expect(adtFileName('Azeroth', 30, 48)).toBe('Azeroth_30_48.adt');
    expect(parseAdtFileName('Azeroth_30_48.adt')).toEqual({
      mapName: 'Azeroth',
      tileX: 30,
      tileY: 48,
    });
    expect(parseAdtFileName('My_Map_1_2.ADT')).toEqual({ mapName: 'My_Map', tileX: 1, tileY: 2 });
    expect(parseAdtFileName('nope.adt')).toBeNull();
    expect(parseAdtFileName('Azeroth_99_0.adt')).toBeNull();
  });
});
