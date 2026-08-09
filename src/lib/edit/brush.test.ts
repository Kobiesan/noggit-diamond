import { describe, expect, it } from 'vitest';
import { BRUSH_SHAPES, falloff } from './brush';

describe('brush falloff', () => {
  it('is 1 at the inner radius and 0 at the outer radius for every shape', () => {
    for (const shape of BRUSH_SHAPES) {
      expect(falloff(shape, 10, 50, 10), shape).toBeCloseTo(1, 10);
      expect(falloff(shape, 5, 50, 10), shape).toBe(1);
      expect(falloff(shape, 50, 50, 10), shape).toBe(0);
      expect(falloff(shape, 80, 50, 10), shape).toBe(0);
    }
  });

  it('is non-increasing outward for every shape', () => {
    for (const shape of BRUSH_SHAPES) {
      let prev = Infinity;
      for (let d = 0; d <= 50; d += 0.5) {
        const v = falloff(shape, d, 50, 10);
        expect(v, `${shape} at ${d}`).toBeLessThanOrEqual(prev + 1e-12);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        prev = v;
      }
    }
  });

  it('shapes differ in the transition zone', () => {
    const d = 30;
    const linear = falloff('linear', d, 50, 10);
    const quadratic = falloff('quadratic', d, 50, 10);
    const trig = falloff('trigonometric', d, 50, 10);
    expect(quadratic).toBeLessThan(linear);
    expect(trig).toBeGreaterThan(linear);
    expect(falloff('flat', d, 50, 10)).toBe(1);
  });

  it('degenerates safely when innerRadius >= radius', () => {
    expect(falloff('smooth', 5, 10, 10)).toBe(1);
    expect(falloff('smooth', 10, 10, 20)).toBe(0);
    expect(falloff('smooth', 5, 0, 0)).toBe(0);
  });
});
