import { describe, expect, it } from 'vitest';
import { SimplexNoise2D, fbm, mulberry32, ridged } from './noise';

describe('mulberry32', () => {
  it('is deterministic per seed and uniform-ish', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const c = mulberry32(8);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    const seqC = Array.from({ length: 10 }, () => c());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('SimplexNoise2D', () => {
  it('is deterministic per seed', () => {
    const n1 = new SimplexNoise2D(42);
    const n2 = new SimplexNoise2D(42);
    const n3 = new SimplexNoise2D(43);
    let differs = false;
    for (let i = 0; i < 50; i++) {
      const x = i * 0.37;
      const y = i * 0.71;
      expect(n1.sample(x, y)).toBe(n2.sample(x, y));
      if (n1.sample(x, y) !== n3.sample(x, y)) differs = true;
    }
    expect(differs).toBe(true);
  });

  it('stays within [-1, 1] and actually varies', () => {
    const n = new SimplexNoise2D(1);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 2000; i++) {
      const v = n.sample(i * 0.13, i * 0.29);
      min = Math.min(min, v);
      max = Math.max(max, v);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(max - min).toBeGreaterThan(0.5);
  });

  it('is continuous (small steps -> small changes)', () => {
    const n = new SimplexNoise2D(5);
    for (let i = 0; i < 200; i++) {
      const x = i * 0.31;
      const y = i * 0.17;
      const d = Math.abs(n.sample(x, y) - n.sample(x + 1e-4, y));
      expect(d).toBeLessThan(0.01);
    }
  });
});

describe('fractals', () => {
  it('fbm stays roughly in [-1, 1], ridged in [0, 1]', () => {
    const n = new SimplexNoise2D(9);
    for (let i = 0; i < 500; i++) {
      const x = i * 0.11;
      const y = i * 0.07;
      const f = fbm(n, x, y, { octaves: 5 });
      const r = ridged(n, x, y, { octaves: 5 });
      expect(f).toBeGreaterThanOrEqual(-1.01);
      expect(f).toBeLessThanOrEqual(1.01);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1.01);
    }
  });
});
