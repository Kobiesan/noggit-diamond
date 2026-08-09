/**
 * Terrain — the editable world: a set of loaded ADT tiles plus spatial
 * queries used by every editing tool.
 *
 * All positions are in map (editor) coordinates: x east, z south, y up.
 * See coords.ts for the mapping to WoW world coordinates.
 */

import type { AdtDoc, McnkChunk } from '../adt/types';
import {
  TILE_SIZE,
  CHUNK_SIZE,
  UNIT_SIZE,
  CHUNKS_PER_TILE_SIDE,
  VERTS_PER_CHUNK,
} from '../constants';
import { VERTEX_OFFSETS, chunkOrigin, isHole, outerIndex, innerIndex } from '../coords';

/** Key for a tile: "x_y". */
export function tileKey(tileX: number, tileY: number): string {
  return `${tileX}_${tileY}`;
}

/** Key for a chunk: "tx_ty_index". */
export function chunkKey(tileX: number, tileY: number, index: number): string {
  return `${tileX}_${tileY}_${index}`;
}

/** A chunk plus enough context to edit and re-render it. */
export interface ChunkRef {
  doc: AdtDoc;
  chunk: McnkChunk;
  /** Chunk index within its tile (iy*16+ix). */
  index: number;
  /** Map-space origin (NW corner) of the chunk. */
  originX: number;
  originZ: number;
  /** Unique key "tx_ty_index" (for dirty tracking, undo capture...). */
  key: string;
}

/** Callback for per-vertex iteration. */
export type VertexVisitor = (
  ref: ChunkRef,
  vertIndex: number,
  vx: number,
  vz: number,
  distance: number,
) => void;

export class Terrain {
  /** Loaded tiles by "x_y" key. */
  readonly tiles = new Map<string, AdtDoc>();

  /** Chunk keys touched since the renderer last consumed them. */
  readonly dirtyChunks = new Set<string>();

  /** Monotonic source for MDDF/MODF unique ids. */
  private nextUniqueId = 1;

  addTile(doc: AdtDoc): void {
    this.tiles.set(tileKey(doc.tileX, doc.tileY), doc);
    for (const d of doc.doodads) {
      if (d.uniqueId >= this.nextUniqueId) this.nextUniqueId = d.uniqueId + 1;
    }
    for (const w of doc.wmos) {
      if (w.uniqueId >= this.nextUniqueId) this.nextUniqueId = w.uniqueId + 1;
    }
    this.markTileDirty(doc);
  }

  removeTile(tileX: number, tileY: number): void {
    const key = tileKey(tileX, tileY);
    const doc = this.tiles.get(key);
    if (!doc) return;
    this.tiles.delete(key);
    for (let i = 0; i < doc.chunks.length; i++) this.dirtyChunks.add(chunkKey(tileX, tileY, i));
  }

  getTile(tileX: number, tileY: number): AdtDoc | undefined {
    return this.tiles.get(tileKey(tileX, tileY));
  }

  allocUniqueId(): number {
    return this.nextUniqueId++;
  }

  markDirty(ref: ChunkRef): void {
    this.dirtyChunks.add(ref.key);
  }

  markTileDirty(doc: AdtDoc): void {
    for (let i = 0; i < doc.chunks.length; i++) {
      this.dirtyChunks.add(chunkKey(doc.tileX, doc.tileY, i));
    }
  }

  /** Drain the dirty set (renderer calls this once per frame). */
  takeDirty(): string[] {
    const out = [...this.dirtyChunks];
    this.dirtyChunks.clear();
    return out;
  }

  /** ChunkRef for an absolute chunk address, if the tile is loaded. */
  chunkAt(tileX: number, tileY: number, index: number): ChunkRef | null {
    const doc = this.tiles.get(tileKey(tileX, tileY));
    if (!doc) return null;
    const chunk = doc.chunks[index];
    if (!chunk) return null;
    const o = chunkOrigin(tileX, tileY, chunk.ix, chunk.iy);
    return { doc, chunk, index, originX: o.x, originZ: o.y, key: chunkKey(tileX, tileY, index) };
  }

  /** The chunk containing a map-space point, if loaded. */
  chunkAtPoint(mx: number, mz: number): ChunkRef | null {
    const tileX = Math.floor(mx / TILE_SIZE);
    const tileY = Math.floor(mz / TILE_SIZE);
    const doc = this.tiles.get(tileKey(tileX, tileY));
    if (!doc) return null;
    const ix = Math.floor((mx - tileX * TILE_SIZE) / CHUNK_SIZE);
    const iy = Math.floor((mz - tileY * TILE_SIZE) / CHUNK_SIZE);
    if (ix < 0 || ix > 15 || iy < 0 || iy > 15) return null;
    return this.chunkAt(tileX, tileY, iy * CHUNKS_PER_TILE_SIDE + ix);
  }

  /** All loaded chunks whose bounds intersect a map-space circle. */
  chunksInRadius(mx: number, mz: number, radius: number): ChunkRef[] {
    const out: ChunkRef[] = [];
    const minTX = Math.floor((mx - radius) / TILE_SIZE);
    const maxTX = Math.floor((mx + radius) / TILE_SIZE);
    const minTZ = Math.floor((mz - radius) / TILE_SIZE);
    const maxTZ = Math.floor((mz + radius) / TILE_SIZE);
    for (let ty = minTZ; ty <= maxTZ; ty++) {
      for (let tx = minTX; tx <= maxTX; tx++) {
        const doc = this.tiles.get(tileKey(tx, ty));
        if (!doc) continue;
        const minIX = Math.max(0, Math.floor((mx - radius - tx * TILE_SIZE) / CHUNK_SIZE));
        const maxIX = Math.min(15, Math.floor((mx + radius - tx * TILE_SIZE) / CHUNK_SIZE));
        const minIY = Math.max(0, Math.floor((mz - radius - ty * TILE_SIZE) / CHUNK_SIZE));
        const maxIY = Math.min(15, Math.floor((mz + radius - ty * TILE_SIZE) / CHUNK_SIZE));
        for (let iy = minIY; iy <= maxIY; iy++) {
          for (let ix = minIX; ix <= maxIX; ix++) {
            const ref = this.chunkAt(tx, ty, iy * CHUNKS_PER_TILE_SIDE + ix);
            if (ref) out.push(ref);
          }
        }
      }
    }
    return out;
  }

  /**
   * Visit every terrain vertex within `radius` of (mx, mz).
   * Distance passed to the visitor is the 2D map-space distance.
   */
  forEachVertexInRadius(mx: number, mz: number, radius: number, visit: VertexVisitor): void {
    const r2 = radius * radius;
    for (const ref of this.chunksInRadius(mx, mz, radius)) {
      for (let vi = 0; vi < VERTS_PER_CHUNK; vi++) {
        const off = VERTEX_OFFSETS[vi];
        const vx = ref.originX + off.x;
        const vz = ref.originZ + off.y;
        const dx = vx - mx;
        const dz = vz - mz;
        const d2 = dx * dx + dz * dz;
        if (d2 <= r2) visit(ref, vi, vx, vz, Math.sqrt(d2));
      }
    }
  }

  /**
   * Interpolated terrain height at a map-space point, or null when the
   * point is over an unloaded tile or a terrain hole.
   *
   * Uses the actual render triangulation: each quad is 4 triangles
   * fanned around its center vertex.
   */
  heightAt(mx: number, mz: number): number | null {
    const ref = this.chunkAtPoint(mx, mz);
    if (!ref) return null;
    const lx = mx - ref.originX;
    const lz = mz - ref.originZ;
    let qc = Math.floor(lx / UNIT_SIZE);
    let qr = Math.floor(lz / UNIT_SIZE);
    if (qc > 7) qc = 7;
    if (qr > 7) qr = 7;
    if (isHole(ref.chunk.holes, qr, qc)) return null;
    const h = ref.chunk.heights;
    const tl = h[outerIndex(qr, qc)];
    const tr = h[outerIndex(qr, qc + 1)];
    const bl = h[outerIndex(qr + 1, qc)];
    const br = h[outerIndex(qr + 1, qc + 1)];
    const c = h[innerIndex(qr, qc)];
    // Local coords within the quad in [0,1].
    const fx = lx / UNIT_SIZE - qc;
    const fz = lz / UNIT_SIZE - qr;
    // Determine which of the 4 fan triangles contains the point.
    // Triangle regions (relative to center at 0.5,0.5):
    //   north: fz <= fx and fz <= 1-fx ; south: fz >= fx and fz >= 1-fx
    //   west:  fx <= fz and fx <= 1-fz ; east:  fx >= fz and fx >= 1-fz
    const cx = 0.5;
    const cz = 0.5;
    let ax: number, az: number, ah: number, bx: number, bz: number, bh: number;
    if (fz <= fx && fz <= 1 - fx) {
      ax = 0; az = 0; ah = tl; bx = 1; bz = 0; bh = tr; // north
    } else if (fz >= fx && fz >= 1 - fx) {
      ax = 0; az = 1; ah = bl; bx = 1; bz = 1; bh = br; // south
    } else if (fx <= fz) {
      ax = 0; az = 0; ah = tl; bx = 0; bz = 1; bh = bl; // west
    } else {
      ax = 1; az = 0; ah = tr; bx = 1; bz = 1; bh = br; // east
    }
    // Barycentric interpolation over triangle (a, b, center).
    const v0x = bx - ax, v0z = bz - az;
    const v1x = cx - ax, v1z = cz - az;
    const v2x = fx - ax, v2z = fz - az;
    const den = v0x * v1z - v1x * v0z;
    if (den === 0) return c;
    const u = (v2x * v1z - v1x * v2z) / den;
    const v = (v0x * v2z - v2x * v0z) / den;
    return ah + u * (bh - ah) + v * (c - ah);
  }

  /**
   * Equalize heights of vertices shared between adjacent chunks (and
   * adjacent tiles) so no seams appear. Operates on the given chunk keys
   * plus their neighbors; pass nothing to stitch the whole world.
   *
   * Shared outer-edge vertices are averaged... precisely: the value of
   * the chunk that owns the vertex "first" (lowest tile/chunk order) wins,
   * which is deterministic and keeps flat edits flat.
   */
  stitchSeams(keys?: Iterable<string>): void {
    const chunkRefs: ChunkRef[] = [];
    if (keys) {
      for (const key of keys) {
        const [tx, ty, idx] = key.split('_').map(Number);
        const ref = this.chunkAt(tx, ty, idx);
        if (ref) chunkRefs.push(ref);
      }
    } else {
      for (const doc of this.tiles.values()) {
        for (let i = 0; i < doc.chunks.length; i++) {
          const ref = this.chunkAt(doc.tileX, doc.tileY, i);
          if (ref) chunkRefs.push(ref);
        }
      }
    }
    for (const ref of chunkRefs) {
      // Copy our east edge onto the west edge of the east neighbor,
      // and our south edge onto the north edge of the south neighbor.
      const east = this.neighborChunk(ref, 1, 0);
      if (east) {
        for (let row = 0; row < 9; row++) {
          east.chunk.heights[outerIndex(row, 0)] = ref.chunk.heights[outerIndex(row, 8)];
        }
        this.markDirty(east);
      }
      const south = this.neighborChunk(ref, 0, 1);
      if (south) {
        for (let col = 0; col < 9; col++) {
          south.chunk.heights[outerIndex(0, col)] = ref.chunk.heights[outerIndex(8, col)];
        }
        this.markDirty(south);
      }
      const se = this.neighborChunk(ref, 1, 1);
      if (se) {
        se.chunk.heights[outerIndex(0, 0)] = ref.chunk.heights[outerIndex(8, 8)];
        this.markDirty(se);
      }
    }
  }

  /** The chunk `dx` columns east and `dz` rows south of `ref`, if loaded. */
  neighborChunk(ref: ChunkRef, dx: number, dz: number): ChunkRef | null {
    let ix = ref.chunk.ix + dx;
    let iy = ref.chunk.iy + dz;
    let tx = ref.doc.tileX;
    let ty = ref.doc.tileY;
    while (ix < 0) { ix += CHUNKS_PER_TILE_SIDE; tx--; }
    while (ix >= CHUNKS_PER_TILE_SIDE) { ix -= CHUNKS_PER_TILE_SIDE; tx++; }
    while (iy < 0) { iy += CHUNKS_PER_TILE_SIDE; ty--; }
    while (iy >= CHUNKS_PER_TILE_SIDE) { iy -= CHUNKS_PER_TILE_SIDE; ty++; }
    return this.chunkAt(tx, ty, iy * CHUNKS_PER_TILE_SIDE + ix);
  }
}
