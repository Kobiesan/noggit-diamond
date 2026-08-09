/**
 * WDL low-resolution world heightmaps (the distant-terrain mesh).
 *
 * Noggit classic never updated these, causing far-terrain mismatches on
 * edited maps; Noggit Diamond regenerates them from tiles on save.
 */

import { BinaryReader, readChunkHeader } from '../binary/reader';
import { BinaryWriter } from '../binary/writer';
import type { AdtDoc } from '../adt/types';
import { ADT_VERSION, TILE_SIZE, TILES_PER_MAP } from '../constants';
import { Terrain } from '../world/terrain';

const TILE_COUNT = TILES_PER_MAP * TILES_PER_MAP;
/** 17x17 outer + 16x16 inner low-res height samples per tile. */
const MARE_VALUES = 17 * 17 + 16 * 16;

/** Parsed WDL document. */
export interface WdlDoc {
  version: number;
  /** Per tile: 545 int16 heights, or null when absent. */
  tiles: (Int16Array | null)[];
  /** Per tile: 16 uint16 hole masks (MAHO), or null when absent. */
  holes: (Uint16Array | null)[];
  /** Preserved raw payloads for chunks we don't model. */
  mwmo: Uint8Array | null;
  mwid: Uint8Array | null;
  modf: Uint8Array | null;
}

/** An empty WDL (no tiles). */
export function emptyWdl(): WdlDoc {
  return {
    version: ADT_VERSION,
    tiles: new Array<Int16Array | null>(TILE_COUNT).fill(null),
    holes: new Array<Uint16Array | null>(TILE_COUNT).fill(null),
    mwmo: null,
    mwid: null,
    modf: null,
  };
}

/** Parse a WDL file. */
export function parseWdl(bytes: Uint8Array): WdlDoc {
  const doc = emptyWdl();
  const r = new BinaryReader(bytes);
  let maof: Uint32Array | null = null;
  while (r.remaining >= 8) {
    const header = readChunkHeader(r);
    const data = bytes.subarray(header.dataOffset, header.dataOffset + header.size);
    switch (header.magic) {
      case 'MVER':
        doc.version = new BinaryReader(data).uint32();
        break;
      case 'MAOF':
        maof = new BinaryReader(data).uint32Array(Math.min(TILE_COUNT, data.length >> 2));
        break;
      case 'MWMO':
        doc.mwmo = data.slice();
        break;
      case 'MWID':
        doc.mwid = data.slice();
        break;
      case 'MODF':
        doc.modf = data.slice();
        break;
      default:
        break; // MARE/MAHO handled via MAOF below
    }
  }
  if (maof) {
    for (let i = 0; i < maof.length; i++) {
      const ofs = maof[i];
      if (ofs === 0) continue;
      const mr = new BinaryReader(bytes);
      mr.seek(ofs);
      const magic = mr.magic();
      const size = mr.uint32();
      if (magic !== 'MARE') continue;
      const heights = new Int16Array(MARE_VALUES);
      for (let v = 0; v < MARE_VALUES && v * 2 + 1 < size; v++) heights[v] = mr.int16();
      doc.tiles[i] = heights;
      // Optional MAHO directly after.
      if (mr.remaining >= 8) {
        const nextMagic = mr.magic();
        const nextSize = mr.uint32();
        if (nextMagic === 'MAHO' && nextSize >= 32) {
          const holes = new Uint16Array(16);
          for (let h = 0; h < 16; h++) holes[h] = mr.uint16();
          doc.holes[i] = holes;
        }
      }
    }
  }
  return doc;
}

/** Serialize a WDL file with correct MAOF offsets. */
export function serializeWdl(doc: WdlDoc): Uint8Array {
  const w = new BinaryWriter(256 * 1024);
  {
    const s = w.beginChunk('MVER');
    w.uint32(doc.version);
    w.endChunk(s);
  }
  if (doc.mwmo) w.chunk('MWMO', doc.mwmo);
  if (doc.mwid) w.chunk('MWID', doc.mwid);
  if (doc.modf) w.chunk('MODF', doc.modf);
  const maofSize = w.beginChunk('MAOF');
  const maofStart = w.offset;
  w.zeros(TILE_COUNT * 4);
  w.endChunk(maofSize);
  for (let i = 0; i < TILE_COUNT; i++) {
    const tile = doc.tiles[i];
    if (!tile) continue;
    w.patchUint32(maofStart + i * 4, w.offset);
    const s = w.beginChunk('MARE');
    for (let v = 0; v < MARE_VALUES; v++) w.int16(tile[v] ?? 0);
    w.endChunk(s);
    const holes = doc.holes[i];
    if (holes) {
      const hs = w.beginChunk('MAHO');
      for (let h = 0; h < 16; h++) w.uint16(holes[h] ?? 0);
      w.endChunk(hs);
    }
  }
  return w.toUint8Array();
}

/** Regenerate a tile's low-res heights (and hole masks) from an ADT. */
export function updateWdlFromAdt(wdl: WdlDoc, doc: AdtDoc): void {
  const terrain = new Terrain();
  terrain.addTile(doc);
  const x0 = doc.tileX * TILE_SIZE;
  const z0 = doc.tileY * TILE_SIZE;
  const step = TILE_SIZE / 16;
  const eps = 1e-3;
  const heights = new Int16Array(MARE_VALUES);
  const clampI16 = (v: number): number =>
    Math.max(-32768, Math.min(32767, Math.round(v)));
  // 17x17 outer grid on cell corners.
  for (let row = 0; row < 17; row++) {
    for (let col = 0; col < 17; col++) {
      const mx = x0 + Math.min(col * step, TILE_SIZE - eps);
      const mz = z0 + Math.min(row * step, TILE_SIZE - eps);
      heights[row * 17 + col] = clampI16(terrain.heightAt(mx, mz) ?? 0);
    }
  }
  // 16x16 inner grid on cell centers.
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 16; col++) {
      const mx = x0 + (col + 0.5) * step;
      const mz = z0 + (row + 0.5) * step;
      heights[17 * 17 + row * 16 + col] = clampI16(terrain.heightAt(mx, mz) ?? 0);
    }
  }
  const index = doc.tileY * TILES_PER_MAP + doc.tileX;
  wdl.tiles[index] = heights;
  // Hole masks: bit x of word y set when chunk (ix=x, iy=y) has holes.
  const holes = new Uint16Array(16);
  for (const chunk of doc.chunks) {
    if (chunk.holes !== 0) holes[chunk.iy] |= 1 << chunk.ix;
  }
  wdl.holes[index] = holes.some((h) => h !== 0) ? holes : new Uint16Array(16);
}
