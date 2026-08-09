/**
 * Brush falloff curves — the classic Noggit brush set, cleaned up.
 *
 * A brush has an outer `radius` and an `innerRadius`; falloff is 1 inside
 * the inner radius, 0 outside the outer radius, and shaped in between.
 */

/** Available brush shapes. */
export type BrushShape =
  | 'flat'
  | 'linear'
  | 'smooth'
  | 'polynomial'
  | 'trigonometric'
  | 'quadratic'
  | 'gaussian';

/** All brush shapes, in UI order. */
export const BRUSH_SHAPES: BrushShape[] = [
  'flat',
  'linear',
  'smooth',
  'polynomial',
  'trigonometric',
  'quadratic',
  'gaussian',
];

/**
 * Brush weight for a point at `dist` from the brush center.
 * Returns a value in [0, 1]; 1 at/inside innerRadius, 0 at/outside radius.
 */
export function falloff(
  shape: BrushShape,
  dist: number,
  radius: number,
  innerRadius: number,
): number {
  if (radius <= 0 || dist >= radius) return 0;
  if (innerRadius >= radius) return dist <= radius ? 1 : 0;
  if (dist <= innerRadius) return 1;
  // t: 1 at inner edge, 0 at outer edge.
  const t = (radius - dist) / (radius - innerRadius);
  switch (shape) {
    case 'flat':
      return 1;
    case 'linear':
      return t;
    case 'smooth':
      return t * t * (3 - 2 * t);
    case 'polynomial':
      return t * t * t;
    case 'trigonometric':
      return Math.sin((t * Math.PI) / 2);
    case 'quadratic':
      return t * t;
    case 'gaussian': {
      // exp curve normalized to hit 1 at t=1 and ~0 at t=0.
      const g = Math.exp(-(((1 - t) * 3) ** 2) / 2);
      const g0 = Math.exp(-9 / 2);
      return (g - g0) / (1 - g0);
    }
  }
}

/** Brush parameters bundled for tool calls. */
export interface Brush {
  shape: BrushShape;
  radius: number;
  /** Inner radius as an absolute distance (not a ratio). */
  innerRadius: number;
}

/** Clamp helper shared by paint ops. */
export function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}
