import { describe, expect, it } from 'vitest';
import { createBlankAdt } from '../adt/builder';
import { outerIndex } from '../coords';
import { defaultProceduralParams, generateTerrain, smoothTerrain } from './procedural';

describe('generateTerrain', () => {
  it('is deterministic per seed', () => {
    const a = createBlankAdt('T', 0, 0);
    const b = createBlankAdt('T', 0, 0);
    const c = createBlankAdt('T', 0, 0);
    generateTerrain(a, defaultProceduralParams(1));
    generateTerrain(b, defaultProceduralParams(1));
    generateTerrain(c, defaultProceduralParams(2));
    expect(a.chunks[0].heights).toEqual(b.chunks[0].heights);
    expect(a.chunks[0].heights).not.toEqual(c.chunks[0].heights);
  });

  it('lines up seamlessly across tile borders', () => {
    const west = createBlankAdt('T', 0, 0);
    const east = createBlankAdt('T', 1, 0);
    const params = defaultProceduralParams(77);
    generateTerrain(west, params);
    generateTerrain(east, params);
    // West tile chunk column 15, vertex col 8 == east tile chunk col 0, vertex col 0.
    for (let cy = 0; cy < 16; cy++) {
      const wc = west.chunks[cy * 16 + 15];
      const ec = east.chunks[cy * 16 + 0];
      for (let row = 0; row < 9; row++) {
        expect(wc.heights[outerIndex(row, 8)]).toBeCloseTo(ec.heights[outerIndex(row, 0)], 9);
      }
    }
  });

  it('respects the amplitude bound around baseHeight', () => {
    const doc = createBlankAdt('T', 0, 0);
    const params = { ...defaultProceduralParams(3), amplitude: 40, baseHeight: 500 };
    generateTerrain(doc, params);
    for (const chunk of doc.chunks) {
      for (let i = 0; i < 145; i++) {
        expect(Math.abs(chunk.heights[i] - 500)).toBeLessThanOrEqual(40 * 1.5);
      }
    }
  });

  it('islands style pulls tile edges below the interior', () => {
    const doc = createBlankAdt('T', 0, 0);
    generateTerrain(doc, { ...defaultProceduralParams(11), style: 'islands', amplitude: 80 });
    const corner = doc.chunks[0].heights[outerIndex(0, 0)];
    let maxInterior = -Infinity;
    for (const chunk of doc.chunks) {
      for (let i = 0; i < 145; i++) maxInterior = Math.max(maxInterior, chunk.heights[i]);
    }
    expect(corner).toBeLessThan(0);
    expect(maxInterior).toBeGreaterThan(corner);
  });
});

describe('smoothTerrain', () => {
  it('reduces height variance', () => {
    const doc = createBlankAdt('T', 0, 0);
    generateTerrain(doc, { ...defaultProceduralParams(5), frequency: 0.02 });
    const varianceOf = (): number => {
      let sum = 0;
      let n = 0;
      for (const c of doc.chunks) for (const h of c.heights) { sum += h; n++; }
      const mean = sum / n;
      let acc = 0;
      for (const c of doc.chunks) for (const h of c.heights) acc += (h - mean) ** 2;
      return acc / n;
    };
    const before = varianceOf();
    smoothTerrain(doc, 3);
    expect(varianceOf()).toBeLessThan(before);
  });
});
