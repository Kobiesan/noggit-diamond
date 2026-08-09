/**
 * Texture layer management and alpha-map painting.
 */

import type { AdtDoc, McnkChunk } from '../adt/types';
import { ALPHA_SIDE, ALPHA_SIZE, CHUNK_SIZE, MAX_LAYERS, MCLY_FLAGS } from '../constants';
import type { Terrain } from '../world/terrain';
import { clampByte, falloff, type BrushShape } from './brush';

/** Index of `path` in doc.textures, appending it when new. */
export function ensureTexture(doc: AdtDoc, path: string): number {
  const needle = path.toLowerCase();
  for (let i = 0; i < doc.textures.length; i++) {
    if (doc.textures[i].toLowerCase() === needle) return i;
  }
  doc.textures.push(path);
  if (doc.textureFlags) doc.textureFlags.push(0);
  return doc.textures.length - 1;
}

/**
 * Layer index for `textureIndex` on a chunk, creating the layer when
 * absent. Returns -1 when the chunk already has 4 other layers.
 */
export function ensureLayer(doc: AdtDoc, chunk: McnkChunk, textureIndex: number): number {
  for (let i = 0; i < chunk.layers.length; i++) {
    if (chunk.layers[i].textureId === textureIndex) return i;
  }
  if (chunk.layers.length >= MAX_LAYERS) return -1;
  const isBase = chunk.layers.length === 0;
  chunk.layers.push({
    textureId: textureIndex,
    flags: isBase ? 0 : MCLY_FLAGS.USE_ALPHA_MAP,
    effectId: 0,
    alpha: isBase ? null : new Uint8Array(ALPHA_SIZE),
  });
  return chunk.layers.length - 1;
}

/** Remove a layer; promotes the next layer to base when layer 0 goes. */
export function removeLayer(chunk: McnkChunk, layerIndex: number): void {
  if (layerIndex < 0 || layerIndex >= chunk.layers.length) return;
  chunk.layers.splice(layerIndex, 1);
  if (layerIndex === 0 && chunk.layers.length > 0) {
    const base = chunk.layers[0];
    base.alpha = null;
    base.flags &= ~(MCLY_FLAGS.USE_ALPHA_MAP | MCLY_FLAGS.ALPHA_MAP_COMPRESSED);
  }
}

/** Point every layer using texture `fromIndex` at `toIndex` instead. */
export function swapTexture(doc: AdtDoc, fromIndex: number, toIndex: number): void {
  for (const chunk of doc.chunks) {
    for (const layer of chunk.layers) {
      if (layer.textureId === fromIndex) layer.textureId = toIndex;
    }
  }
}

/** Result of a paint stroke step. */
export interface PaintResult {
  /** Chunks that received paint. */
  paintedChunks: number;
  /** Chunks skipped because their 4 layer slots are taken. */
  skippedFull: number;
}

/**
 * Paint `texturePath` onto the terrain with a round brush.
 *
 * strength in [0,1] scales how fast alpha approaches `targetOpacity`
 * (0..255). Painting the base layer of a chunk is a no-op that still
 * counts as painted (it is already fully visible underneath).
 */
export function paintTexture(
  terrain: Terrain,
  mx: number,
  mz: number,
  radius: number,
  innerRadius: number,
  shape: BrushShape,
  strength: number,
  targetOpacity: number,
  texturePath: string,
): PaintResult {
  const result: PaintResult = { paintedChunks: 0, skippedFull: 0 };
  const texel = CHUNK_SIZE / ALPHA_SIDE;
  for (const ref of terrain.chunksInRadius(mx, mz, radius)) {
    const textureIndex = ensureTexture(ref.doc, texturePath);
    const layerIndex = ensureLayer(ref.doc, ref.chunk, textureIndex);
    if (layerIndex === -1) {
      result.skippedFull++;
      continue;
    }
    const layer = ref.chunk.layers[layerIndex];
    if (layerIndex === 0 || !layer.alpha) {
      result.paintedChunks++;
      terrain.markDirty(ref);
      continue;
    }
    let touched = false;
    for (let tz = 0; tz < ALPHA_SIDE; tz++) {
      const cz = ref.originZ + (tz + 0.5) * texel;
      const dz = cz - mz;
      for (let tx = 0; tx < ALPHA_SIDE; tx++) {
        const cx = ref.originX + (tx + 0.5) * texel;
        const dx = cx - mx;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist >= radius) continue;
        const w = falloff(shape, dist, radius, innerRadius) * strength;
        if (w <= 0) continue;
        const i = tz * ALPHA_SIDE + tx;
        layer.alpha[i] = clampByte(layer.alpha[i] + (targetOpacity - layer.alpha[i]) * w);
        touched = true;
      }
    }
    if (touched) {
      result.paintedChunks++;
      terrain.markDirty(ref);
    }
  }
  return result;
}

/**
 * Remove layers whose alpha maps are entirely zero (dead paint) across
 * a document. Returns the number of layers removed.
 */
export function pruneEmptyLayers(doc: AdtDoc): number {
  let removed = 0;
  for (const chunk of doc.chunks) {
    for (let i = chunk.layers.length - 1; i > 0; i--) {
      const alpha = chunk.layers[i].alpha;
      if (alpha && alpha.every((v) => v === 0)) {
        chunk.layers.splice(i, 1);
        removed++;
      }
    }
  }
  return removed;
}
