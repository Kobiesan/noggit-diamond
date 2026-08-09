/**
 * MH2O water editing: add, remove and re-level liquid per chunk.
 */

import type { AdtDoc, WaterChunk, WaterInstance } from '../adt/types';
import { CHUNKS_PER_TILE } from '../constants';
import type { Terrain } from '../world/terrain';

/** Liquid ids treated as flat, depth-only ocean (LVF 2). */
const OCEAN_TYPES = new Set([2, 6, 14]);

/** Ensure doc.water exists; returns the 256-cell array. */
export function ensureWater(doc: AdtDoc): (WaterChunk | null)[] {
  if (!doc.water) doc.water = new Array<WaterChunk | null>(CHUNKS_PER_TILE).fill(null);
  return doc.water;
}

/** A full-chunk water instance at a uniform level. */
export function makeFullInstance(typeId: number, level: number): WaterInstance {
  const ocean = OCEAN_TYPES.has(typeId);
  return {
    liquidTypeId: typeId,
    liquidVertexFormat: ocean ? 2 : 0,
    minHeight: level,
    maxHeight: level,
    xOffset: 0,
    yOffset: 0,
    width: 8,
    height: 8,
    existsBitmap: null,
    heightMap: ocean ? null : new Float32Array(81).fill(level),
    depthMap: new Uint8Array(81).fill(ocean ? 250 : 40),
    uvMap: null,
  };
}

/** Water options for painting. */
export interface WaterOptions {
  typeId: number;
  level: number;
}

/** Replace a chunk's water with a single full-cover instance. */
export function setChunkWater(doc: AdtDoc, chunkIndex: number, opts: WaterOptions): void {
  const cells = ensureWater(doc);
  cells[chunkIndex] = {
    instances: [makeFullInstance(opts.typeId, opts.level)],
    attributes: { fishable: 0xffffffffffffffffn, deep: 0n },
  };
}

/** Remove water from a chunk; collapses doc.water to null when empty. */
export function removeChunkWater(doc: AdtDoc, chunkIndex: number): void {
  if (!doc.water) return;
  doc.water[chunkIndex] = null;
  if (doc.water.every((c) => c === null)) doc.water = null;
}

/** Whether a chunk has any water instance. */
export function hasWater(doc: AdtDoc, chunkIndex: number): boolean {
  return !!doc.water?.[chunkIndex]?.instances.length;
}

/** The level (maxHeight) of a chunk's first water instance, if any. */
export function getWaterLevel(doc: AdtDoc, chunkIndex: number): number | null {
  const cell = doc.water?.[chunkIndex];
  if (!cell || cell.instances.length === 0) return null;
  return cell.instances[0].maxHeight;
}

/** Set every instance of a chunk to a flat level. */
export function setWaterLevel(doc: AdtDoc, chunkIndex: number, level: number): void {
  const cell = doc.water?.[chunkIndex];
  if (!cell) return;
  for (const inst of cell.instances) {
    inst.minHeight = level;
    inst.maxHeight = level;
    inst.heightMap?.fill(level);
  }
}

/** Paint full-cover water on every chunk intersecting the brush circle. */
export function paintWater(
  terrain: Terrain,
  mx: number,
  mz: number,
  radius: number,
  opts: WaterOptions,
): number {
  let count = 0;
  for (const ref of terrain.chunksInRadius(mx, mz, radius)) {
    setChunkWater(ref.doc, ref.index, opts);
    terrain.markDirty(ref);
    count++;
  }
  return count;
}

/** Erase water from every chunk intersecting the brush circle. */
export function eraseWater(terrain: Terrain, mx: number, mz: number, radius: number): number {
  let count = 0;
  for (const ref of terrain.chunksInRadius(mx, mz, radius)) {
    if (hasWater(ref.doc, ref.index)) {
      removeChunkWater(ref.doc, ref.index);
      terrain.markDirty(ref);
      count++;
    }
  }
  return count;
}
