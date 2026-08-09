/**
 * Coordinate systems and terrain vertex layout.
 *
 * Two coordinate systems are used throughout Noggit Diamond:
 *
 * 1. "World" (WoW server) coordinates — X points north, Y points west,
 *    Z is up. ADT MCNK headers store chunk positions in this system.
 *
 * 2. "Map" (editor/render) coordinates — mx points east (increases with
 *    tile X index), mz points south (increases with tile Y index), my is
 *    up. Map (0, 0) is the north-west corner of the 64x64 tile grid.
 *    MDDF/MODF placements are stored in this system already
 *    (pos[0] = mx, pos[1] = height, pos[2] = mz).
 *
 * Conversion:  mx = ZEROPOINT - worldY,   mz = ZEROPOINT - worldX,
 *              worldX = ZEROPOINT - mz,   worldY = ZEROPOINT - mx.
 */

import {
  TILE_SIZE,
  CHUNK_SIZE,
  UNIT_SIZE,
  HALF_UNIT,
  OUTER_SIDE,
  INNER_SIDE,
  ZEROPOINT,
  CHUNKS_PER_TILE_SIDE,
} from './constants';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Convert world (server) coords to map (editor) coords. */
export function worldToMap(worldX: number, worldY: number): Vec2 {
  return { x: ZEROPOINT - worldY, y: ZEROPOINT - worldX };
}

/** Convert map (editor) coords to world (server) coords. */
export function mapToWorld(mx: number, mz: number): Vec2 {
  return { x: ZEROPOINT - mz, y: ZEROPOINT - mx };
}

/** Tile indices (0..63) containing a map-space point. */
export function mapToTile(mx: number, mz: number): Vec2 {
  return { x: Math.floor(mx / TILE_SIZE), y: Math.floor(mz / TILE_SIZE) };
}

/** Map-space origin (NW corner) of a tile. */
export function tileOrigin(tileX: number, tileY: number): Vec2 {
  return { x: tileX * TILE_SIZE, y: tileY * TILE_SIZE };
}

/** Map-space origin (NW corner) of chunk (ix, iy) of a tile. */
export function chunkOrigin(tileX: number, tileY: number, ix: number, iy: number): Vec2 {
  return {
    x: tileX * TILE_SIZE + ix * CHUNK_SIZE,
    y: tileY * TILE_SIZE + iy * CHUNK_SIZE,
  };
}

/**
 * MCNK header `position` value for a chunk, in world coordinates:
 * [worldX, worldY, baseHeight].
 */
export function chunkHeaderPosition(
  tileX: number,
  tileY: number,
  ix: number,
  iy: number,
  baseHeight = 0,
): [number, number, number] {
  // Quantized to float32 so a freshly built document matches its own
  // serialized round trip exactly.
  return [
    Math.fround(ZEROPOINT - (tileY * TILE_SIZE + iy * CHUNK_SIZE)),
    Math.fround(ZEROPOINT - (tileX * TILE_SIZE + ix * CHUNK_SIZE)),
    Math.fround(baseHeight),
  ];
}

/** Chunk index (0..255, row-major iy*16+ix) within a tile for a map point. */
export function mapToChunkIndex(
  tileX: number,
  tileY: number,
  mx: number,
  mz: number,
): number | null {
  const lx = mx - tileX * TILE_SIZE;
  const lz = mz - tileY * TILE_SIZE;
  const ix = Math.floor(lx / CHUNK_SIZE);
  const iy = Math.floor(lz / CHUNK_SIZE);
  if (ix < 0 || ix >= CHUNKS_PER_TILE_SIDE || iy < 0 || iy >= CHUNKS_PER_TILE_SIDE) return null;
  return iy * CHUNKS_PER_TILE_SIDE + ix;
}

/**
 * Terrain vertex layout within a chunk (145 vertices).
 *
 * MCVT stores heights in 17-value stripes: 9 "outer" vertices on the
 * chunk grid line, then 8 "inner" vertices at quad centers, repeated;
 * the final stripe has only the 9 outer values:
 *
 *   row 0 outer: indices 0..8
 *   row 0 inner: indices 9..16
 *   row 1 outer: indices 17..25 ... etc.
 */

/** Index of outer vertex (row 0..8, col 0..8). */
export function outerIndex(row: number, col: number): number {
  return row * 17 + col;
}

/** Index of inner (center) vertex (row 0..7, col 0..7). */
export function innerIndex(row: number, col: number): number {
  return row * 17 + OUTER_SIDE + col;
}

/** True if a vertex index (0..144) lies on the outer 9x9 grid. */
export function isOuterVertex(index: number): boolean {
  return index % 17 < OUTER_SIDE;
}

/**
 * Map-space position of a vertex relative to the chunk origin.
 * Returns {x, y} offsets in yards (x east, y south).
 */
export function vertexOffset(index: number): Vec2 {
  const stripe = Math.floor(index / 17);
  const within = index % 17;
  if (within < OUTER_SIDE) {
    return { x: within * UNIT_SIZE, y: stripe * UNIT_SIZE };
  }
  const col = within - OUTER_SIDE;
  return { x: col * UNIT_SIZE + HALF_UNIT, y: stripe * UNIT_SIZE + HALF_UNIT };
}

/** All 145 vertex offsets, precomputed (x east, y south, in yards). */
export const VERTEX_OFFSETS: ReadonlyArray<Vec2> = (() => {
  const out: Vec2[] = [];
  for (let i = 0; i < 145; i++) out.push(vertexOffset(i));
  return out;
})();

/**
 * Triangle indices for one chunk as 256 triangles over the 145-vertex
 * layout (4 triangles per quad, fanned around the quad's center vertex).
 * Winding is counter-clockwise when viewed from above (+my up) in map
 * space (x east, z south).
 */
export function chunkTriangles(holes = 0, highResHoles?: bigint): Uint16Array {
  const out = new Uint16Array(256 * 3);
  let n = 0;
  for (let qr = 0; qr < INNER_SIDE; qr++) {
    for (let qc = 0; qc < INNER_SIDE; qc++) {
      if (isHole(holes, qr, qc, highResHoles)) continue;
      const tl = outerIndex(qr, qc);
      const tr = outerIndex(qr, qc + 1);
      const bl = outerIndex(qr + 1, qc);
      const br = outerIndex(qr + 1, qc + 1);
      const c = innerIndex(qr, qc);
      // CCW seen from above in map space (x east, z south, y up):
      // above = -z ... use order (a, c, b) so normals face +y.
      out[n++] = tl; out[n++] = c; out[n++] = tr;
      out[n++] = tr; out[n++] = c; out[n++] = br;
      out[n++] = br; out[n++] = c; out[n++] = bl;
      out[n++] = bl; out[n++] = c; out[n++] = tl;
    }
  }
  return out.subarray(0, n) as Uint16Array;
}

/**
 * Test whether quad (row, col) of a chunk is a hole.
 * Low-res holes: 16-bit mask, one bit per 2x2 quad block (4x4 grid).
 * High-res holes: 64-bit mask, one bit per quad (8x8 grid).
 */
export function isHole(holes: number, quadRow: number, quadCol: number, highRes?: bigint): boolean {
  if (highRes !== undefined) {
    const bit = BigInt(quadRow * 8 + quadCol);
    return ((highRes >> bit) & 1n) === 1n;
  }
  const hr = quadRow >> 1;
  const hc = quadCol >> 1;
  return ((holes >> (hr * 4 + hc)) & 1) === 1;
}

/** Set or clear the low-res hole bit covering quad (row, col). */
export function setHole(holes: number, quadRow: number, quadCol: number, value: boolean): number {
  const bit = (quadRow >> 1) * 4 + (quadCol >> 1);
  return value ? holes | (1 << bit) : holes & ~(1 << bit);
}

/** ADT filename for a map name and tile indices. */
export function adtFileName(mapName: string, tileX: number, tileY: number): string {
  return `${mapName}_${tileX}_${tileY}.adt`;
}

/** Parse "<map>_<x>_<y>.adt" (case-insensitive extension). Null if not matching. */
export function parseAdtFileName(name: string): { mapName: string; tileX: number; tileY: number } | null {
  const m = /^(.*)_(\d{1,2})_(\d{1,2})\.adt$/i.exec(name.trim());
  if (!m) return null;
  const tileX = parseInt(m[2], 10);
  const tileY = parseInt(m[3], 10);
  if (tileX > 63 || tileY > 63) return null;
  return { mapName: m[1], tileX, tileY };
}
