import { describe, expect, it } from 'vitest';
import { createBlankAdt } from '../adt/builder';
import { TILE_SIZE } from '../constants';
import { outerIndex } from '../coords';
import {
  decodePgm16,
  encodePgm16,
  exportHeightmap,
  gridMinMax,
  importHeightmap,
  sampleGrid,
  type HeightGrid,
} from './heightmap';

function gradientGrid(size: number): HeightGrid {
  const data = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) data[y * size + x] = x / (size - 1);
  }
  return { width: size, height: size, data };
}

describe('sampleGrid', () => {
  it('interpolates bilinearly with edge clamping', () => {
    const grid: HeightGrid = { width: 2, height: 2, data: Float32Array.from([0, 1, 2, 3]) };
    expect(sampleGrid(grid, 0, 0)).toBe(0);
    expect(sampleGrid(grid, 1, 1)).toBe(3);
    expect(sampleGrid(grid, 0.5, 0.5)).toBeCloseTo(1.5);
    expect(sampleGrid(grid, -1, 2)).toBe(2); // clamped to (0, 1)
  });
});

describe('importHeightmap', () => {
  it('maps a west-east gradient onto monotonically rising terrain', () => {
    const doc = createBlankAdt('T', 0, 0);
    importHeightmap(doc, gradientGrid(129), { minHeight: 0, maxHeight: 100 });
    // Row 0 of chunk row 0: heights rise strictly west to east across chunks.
    let prev = -1;
    for (let cx = 0; cx < 16; cx++) {
      const h = doc.chunks[cx].heights[outerIndex(0, 0)];
      expect(h).toBeGreaterThan(prev);
      prev = h;
    }
    // Analytic check: chunk 8's west edge sits at u = 0.5 -> height 50.
    expect(doc.chunks[8].heights[outerIndex(0, 0)]).toBeCloseTo(50, 0);
    // Full range endpoints.
    expect(doc.chunks[0].heights[outerIndex(0, 0)]).toBeCloseTo(0, 5);
    expect(doc.chunks[15].heights[outerIndex(0, 8)]).toBeCloseTo(100, 5);
  });
});

describe('exportHeightmap', () => {
  it('exports flat terrain at the base height', () => {
    const doc = createBlankAdt('T', 2, 3, { baseHeight: 42 });
    const grid = exportHeightmap(doc, 65);
    expect(grid.width).toBe(65);
    for (const v of grid.data) expect(v).toBeCloseTo(42, 5);
  });

  it('round-trips an import (within interpolation error)', () => {
    const doc = createBlankAdt('T', 0, 0);
    importHeightmap(doc, gradientGrid(257), { minHeight: -50, maxHeight: 150 });
    const grid = exportHeightmap(doc, 257);
    // Center row should recover the gradient closely.
    const row = 128;
    for (let col = 4; col < 253; col += 16) {
      const expected = -50 + (col / 256) * 200;
      expect(grid.data[row * 257 + col]).toBeCloseTo(expected, 0);
    }
  });
});

describe('PGM16 codec', () => {
  it('round-trips within quantization error', () => {
    const grid = gradientGrid(64);
    const { min, max } = gridMinMax(grid);
    const decoded = decodePgm16(encodePgm16(grid), min, max);
    expect(decoded.width).toBe(64);
    for (let i = 0; i < grid.data.length; i += 17) {
      expect(decoded.data[i]).toBeCloseTo(grid.data[i], 3);
    }
  });

  it('handles flat grids without NaN', () => {
    const grid: HeightGrid = { width: 4, height: 4, data: new Float32Array(16).fill(5) };
    const bytes = encodePgm16(grid);
    const decoded = decodePgm16(bytes, 5, 5);
    for (const v of decoded.data) expect(Number.isNaN(v)).toBe(false);
  });

  it('rejects non-PGM data', () => {
    expect(() => decodePgm16(new Uint8Array([80, 51, 10]), 0, 1)).toThrow(/not a binary PGM/);
  });

  it('reads 8-bit PGMs too', () => {
    const header = 'P5\n2 2\n255\n';
    const bytes = new Uint8Array(header.length + 4);
    for (let i = 0; i < header.length; i++) bytes[i] = header.charCodeAt(i);
    bytes.set([0, 128, 255, 64], header.length);
    const grid = decodePgm16(bytes, 0, 255);
    expect(grid.data[0]).toBeCloseTo(0);
    expect(grid.data[2]).toBeCloseTo(255);
  });
});

describe('tile size sanity', () => {
  it('TILE_SIZE is 533.33...', () => {
    expect(TILE_SIZE).toBeCloseTo(533.33333, 4);
  });
});
