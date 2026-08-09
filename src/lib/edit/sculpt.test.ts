import { describe, expect, it } from 'vitest';
import { Terrain } from '../world/terrain';
import { createBlankAdt } from '../adt/builder';
import { CHUNK_SIZE, UNIT_SIZE } from '../constants';
import { outerIndex } from '../coords';
import { flattenTo, raiseLower, smoothHeights } from './sculpt';
import { mulberry32 } from '../gen/noise';

function blank(baseHeight = 0): Terrain {
  const t = new Terrain();
  t.addTile(createBlankAdt('T', 0, 0, { baseHeight }));
  return t;
}

describe('raiseLower', () => {
  it('raises the center by exactly amount and leaves far vertices alone', () => {
    const t = blank();
    // Center on an outer vertex of chunk (2,2): its NW corner.
    const cx = 2 * CHUNK_SIZE;
    const cz = 2 * CHUNK_SIZE;
    raiseLower(t, cx, cz, 30, 5, 'linear', 4);
    expect(t.heightAt(cx, cz)).toBeCloseTo(4, 10);
    expect(t.heightAt(cx + 100, cz)).toBeCloseTo(0, 10);
  });

  it('keeps shared border vertices identical across chunks', () => {
    const t = blank();
    // Brush centered on the border between chunk (0,0) and (1,0).
    raiseLower(t, CHUNK_SIZE, CHUNK_SIZE / 2, 25, 0, 'smooth', 7);
    const west = t.chunkAt(0, 0, 0)!.chunk;
    const east = t.chunkAt(0, 0, 1)!.chunk;
    for (let row = 0; row < 9; row++) {
      expect(west.heights[outerIndex(row, 8)]).toBeCloseTo(east.heights[outerIndex(row, 0)], 12);
    }
  });

  it('marks touched chunks dirty', () => {
    const t = blank();
    t.takeDirty();
    raiseLower(t, CHUNK_SIZE, CHUNK_SIZE, 20, 0, 'linear', 1);
    expect(t.takeDirty().length).toBeGreaterThanOrEqual(4);
  });
});

describe('flattenTo', () => {
  it('snaps vertices inside the inner radius at strength 1', () => {
    const t = blank(10);
    flattenTo(t, CHUNK_SIZE, CHUNK_SIZE, 40, 20, 'linear', 55, 1);
    expect(t.heightAt(CHUNK_SIZE, CHUNK_SIZE)).toBeCloseTo(55, 10);
    expect(t.heightAt(CHUNK_SIZE + 10, CHUNK_SIZE)).toBeCloseTo(55, 10);
  });

  it('respects raise-only and lower-only modes', () => {
    const t = blank(10);
    flattenTo(t, 100, 100, 30, 30, 'flat', 5, 1, 'raise');
    expect(t.heightAt(100, 100)).toBeCloseTo(10, 10); // already above target
    flattenTo(t, 100, 100, 30, 30, 'flat', 5, 1, 'lower');
    expect(t.heightAt(100, 100)).toBeCloseTo(5, 10);
    flattenTo(t, 100, 100, 30, 30, 'flat', 50, 1, 'lower');
    expect(t.heightAt(100, 100)).toBeCloseTo(5, 10); // below target, lower-only
  });
});

describe('smoothHeights', () => {
  it('leaves perfectly flat terrain unchanged', () => {
    const t = blank(33);
    smoothHeights(t, CHUNK_SIZE, CHUNK_SIZE, 40, 0, 'flat', 1);
    expect(t.heightAt(CHUNK_SIZE, CHUNK_SIZE)).toBeCloseTo(33, 6);
    expect(t.heightAt(CHUNK_SIZE + UNIT_SIZE, CHUNK_SIZE)).toBeCloseTo(33, 6);
  });

  it('reduces variance of noisy terrain', () => {
    const t = blank();
    const chunk = t.chunkAt(0, 0, 0)!.chunk;
    const rand = mulberry32(42);
    for (let i = 0; i < 145; i++) chunk.heights[i] = rand() * 20 - 10;
    const varianceOf = (): number => {
      const mean = chunk.heights.reduce((a, b) => a + b, 0) / 145;
      return chunk.heights.reduce((a, b) => a + (b - mean) ** 2, 0) / 145;
    };
    const before = varianceOf();
    smoothHeights(t, CHUNK_SIZE / 2, CHUNK_SIZE / 2, CHUNK_SIZE, 0, 'flat', 1);
    expect(varianceOf()).toBeLessThan(before);
  });
});
