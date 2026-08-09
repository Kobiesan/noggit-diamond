/**
 * Creation of fresh, valid ADT documents (the "new map" feature and the
 * fixture factory for tests).
 */

import type { AdtDoc, McnkChunk } from './types';
import {
  ADT_VERSION,
  CHUNKS_PER_TILE,
  CHUNKS_PER_TILE_SIDE,
  VERTS_PER_CHUNK,
} from '../constants';
import { chunkHeaderPosition } from '../coords';

export interface BlankAdtOptions {
  /** Uniform terrain height (default 0). */
  baseHeight?: number;
  /** Initial texture list; first entry becomes every chunk's base layer. */
  textures?: string[];
  /** Area id painted on all chunks (default 0). */
  areaId?: number;
  /** Serialize alpha maps as 8-bit uncompressed (big alpha). Default false. */
  bigAlpha?: boolean;
}

/** Flat "up" normal in MCNR file byte order (nx, nz, ny-up): (0, 0, 127). */
export function flatNormals(): Int8Array {
  const n = new Int8Array(VERTS_PER_CHUNK * 3);
  for (let i = 0; i < VERTS_PER_CHUNK; i++) n[i * 3 + 2] = 127;
  return n;
}

function blankChunk(
  tileX: number,
  tileY: number,
  ix: number,
  iy: number,
  baseHeight: number,
  areaId: number,
  hasBaseLayer: boolean,
): McnkChunk {
  const heights = new Float64Array(VERTS_PER_CHUNK);
  heights.fill(baseHeight);
  return {
    flags: 0,
    ix,
    iy,
    areaId,
    holes: 0,
    position: chunkHeaderPosition(tileX, tileY, ix, iy, baseHeight),
    heights,
    normals: flatNormals(),
    normalsPad: new Uint8Array(13),
    vertexColors: null,
    layers: hasBaseLayer ? [{ textureId: 0, flags: 0, effectId: 0, alpha: null }] : [],
    shadowMap: null,
    doodadRefs: [],
    wmoRefs: [],
    liquidLegacy: null,
    soundEmitters: null,
    soundEmitterCount: 0,
    lowQualityTextureMap: new Uint8Array(16),
    noEffectDoodad: new Uint8Array(8),
    pad0: 0,
    pad1: 0,
  };
}

/** Create a fully valid, flat ADT document. */
export function createBlankAdt(
  mapName: string,
  tileX: number,
  tileY: number,
  options: BlankAdtOptions = {},
): AdtDoc {
  const { textures = [], areaId = 0, bigAlpha = false } = options;
  const baseHeight = Math.fround(options.baseHeight ?? 0);
  const chunks: McnkChunk[] = [];
  for (let i = 0; i < CHUNKS_PER_TILE; i++) {
    const ix = i % CHUNKS_PER_TILE_SIDE;
    const iy = Math.floor(i / CHUNKS_PER_TILE_SIDE);
    chunks.push(blankChunk(tileX, tileY, ix, iy, baseHeight, areaId, textures.length > 0));
  }
  return {
    tileX,
    tileY,
    mapName,
    version: ADT_VERSION,
    mhdrFlags: 0,
    textures: [...textures],
    m2Models: [],
    wmoModels: [],
    doodads: [],
    wmos: [],
    water: null,
    chunks,
    mfbo: null,
    textureFlags: null,
    bigAlpha,
    extraChunks: [],
  };
}
