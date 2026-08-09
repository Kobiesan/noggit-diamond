/**
 * WDT map index files (WotLK): which tiles of the 64x64 grid exist,
 * plus map-wide flags (big alpha!) and the optional global WMO.
 */

import { BinaryReader, readChunkHeader } from '../binary/reader';
import { BinaryWriter } from '../binary/writer';
import { ADT_VERSION, MPHD_FLAGS, TILES_PER_MAP } from '../constants';
import type { WdtDoc, WmoPlacement } from '../adt/types';

const TILE_COUNT = TILES_PER_MAP * TILES_PER_MAP;

/** Create an empty WDT (no tiles). */
export function createWdt(flags = 0): WdtDoc {
  return {
    version: ADT_VERSION,
    flags,
    mphdRest: new Uint32Array(7),
    tiles: new Uint32Array(TILE_COUNT),
    tilesAsync: new Uint32Array(TILE_COUNT),
    mwmoPresent: true,
    globalWmo: '',
    globalWmoPlacement: null,
  };
}

/** Whether a tile is marked present. */
export function wdtHasTile(wdt: WdtDoc, tileX: number, tileY: number): boolean {
  return (wdt.tiles[tileY * TILES_PER_MAP + tileX] & 0x1) !== 0;
}

/** Mark a tile present or absent. */
export function wdtSetTile(wdt: WdtDoc, tileX: number, tileY: number, present: boolean): void {
  const i = tileY * TILES_PER_MAP + tileX;
  wdt.tiles[i] = present ? wdt.tiles[i] | 0x1 : wdt.tiles[i] & ~0x1;
}

/** Parse a WDT file. */
export function parseWdt(bytes: Uint8Array): WdtDoc {
  const r = new BinaryReader(bytes);
  const doc = createWdt();
  doc.mwmoPresent = false;
  while (r.remaining >= 8) {
    const header = readChunkHeader(r);
    const data = bytes.subarray(header.dataOffset, header.dataOffset + header.size);
    const dr = new BinaryReader(data);
    switch (header.magic) {
      case 'MVER':
        doc.version = dr.uint32();
        break;
      case 'MPHD': {
        doc.flags = dr.uint32();
        const rest = new Uint32Array(7);
        for (let i = 0; i < 7 && dr.remaining >= 4; i++) rest[i] = dr.uint32();
        doc.mphdRest = rest;
        break;
      }
      case 'MAIN': {
        for (let i = 0; i < TILE_COUNT && dr.remaining >= 8; i++) {
          doc.tiles[i] = dr.uint32();
          doc.tilesAsync[i] = dr.uint32();
        }
        break;
      }
      case 'MWMO': {
        doc.mwmoPresent = true;
        doc.globalWmo = data.length > 1 ? dr.cstring() : '';
        break;
      }
      case 'MODF': {
        if (data.length >= 64) {
          doc.globalWmoPlacement = {
            nameId: dr.uint32(),
            uniqueId: dr.uint32(),
            position: [dr.float32(), dr.float32(), dr.float32()],
            rotation: [dr.float32(), dr.float32(), dr.float32()],
            extentsMin: [dr.float32(), dr.float32(), dr.float32()],
            extentsMax: [dr.float32(), dr.float32(), dr.float32()],
            flags: dr.uint16(),
            doodadSet: dr.uint16(),
            nameSet: dr.uint16(),
            scale: dr.uint16(),
          } satisfies WmoPlacement;
        }
        break;
      }
      default:
        break;
    }
  }
  return doc;
}

/** Serialize a WDT file. */
export function serializeWdt(doc: WdtDoc): Uint8Array {
  const w = new BinaryWriter(64 * 1024);
  {
    const s = w.beginChunk('MVER');
    w.uint32(doc.version);
    w.endChunk(s);
  }
  {
    const s = w.beginChunk('MPHD');
    w.uint32(doc.flags);
    for (let i = 0; i < 7; i++) w.uint32(doc.mphdRest[i] ?? 0);
    w.endChunk(s);
  }
  {
    const s = w.beginChunk('MAIN');
    for (let i = 0; i < TILE_COUNT; i++) {
      w.uint32(doc.tiles[i]);
      w.uint32(doc.tilesAsync[i]);
    }
    w.endChunk(s);
  }
  if (doc.mwmoPresent || doc.globalWmo) {
    const s = w.beginChunk('MWMO');
    if (doc.globalWmo) w.cstring(doc.globalWmo);
    w.endChunk(s);
  }
  if (doc.globalWmoPlacement) {
    const m = doc.globalWmoPlacement;
    const s = w.beginChunk('MODF');
    w.uint32(m.nameId);
    w.uint32(m.uniqueId);
    for (const v of [...m.position, ...m.rotation, ...m.extentsMin, ...m.extentsMax]) w.float32(v);
    w.uint16(m.flags);
    w.uint16(m.doodadSet);
    w.uint16(m.nameSet);
    w.uint16(m.scale);
    w.endChunk(s);
  }
  return w.toUint8Array();
}

/** Does this WDT declare 8-bit ("big") alpha maps for its ADTs? */
export function wdtBigAlpha(doc: WdtDoc): boolean {
  return (
    (doc.flags & MPHD_FLAGS.ADT_HAS_BIG_ALPHA) !== 0 ||
    (doc.flags & MPHD_FLAGS.ADT_HAS_HEIGHT_TEXTURING) !== 0
  );
}
