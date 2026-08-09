/**
 * WotLK (3.3.5a) ADT serializer: AdtDoc -> binary tile.
 *
 * Emits the standard Blizzard chunk order:
 *   MVER MHDR MCIN MTEX MMDX MMID MWMO MWID MDDF MODF [MH2O]
 *   MCNK x256 [MFBO] [MTXF] extras...
 * with all header offsets (MHDR, MCIN, MCNK sub-chunks) patched to match.
 */

import { BinaryWriter } from '../binary/writer';
import {
  ADT_VERSION,
  CHUNKS_PER_TILE,
  MCNK_FLAGS,
  MCLY_FLAGS,
  VERTS_PER_CHUNK,
  ALPHA_SIZE,
} from '../constants';
import { encodeAlpha4, encodeAlphaCompressed, fixAlphaEdges } from './alpha';
import type { AdtDoc, McnkChunk, WaterChunk } from './types';

export interface SerializeAdtOptions {
  /** RLE-compress alpha maps (MCLY flag 0x200). Default false. */
  compressAlpha?: boolean;
}

/** Build the NUL-separated string block + offset table for a name list. */
function buildStringBlock(names: string[]): { block: Uint8Array; offsets: Uint32Array } {
  const w = new BinaryWriter(1024);
  const offsets = new Uint32Array(names.length);
  for (let i = 0; i < names.length; i++) {
    offsets[i] = w.length;
    w.cstring(names[i]);
  }
  return { block: w.toUint8Array(), offsets };
}

function writeMh2o(w: BinaryWriter, cells: (WaterChunk | null)[]): void {
  const sizeOfs = w.beginChunk('MH2O');
  const dataStart = w.offset;
  // Reserve 256 * 12-byte headers.
  w.zeros(CHUNKS_PER_TILE * 12);

  for (let i = 0; i < CHUNKS_PER_TILE; i++) {
    const cell = cells[i];
    const headerAt = dataStart + i * 12;
    if (!cell || cell.instances.length === 0) continue;

    let ofsAttributes = 0;
    if (cell.attributes) {
      ofsAttributes = w.offset - dataStart;
      w.uint64(cell.attributes.fishable);
      w.uint64(cell.attributes.deep);
    }

    const ofsInstances = w.offset - dataStart;
    // Instance records first (patch data offsets after payloads land).
    const instancePatch: number[] = [];
    for (const inst of cell.instances) {
      w.uint16(inst.liquidTypeId);
      w.uint16(inst.liquidVertexFormat);
      w.float32(inst.minHeight);
      w.float32(inst.maxHeight);
      w.uint8(inst.xOffset);
      w.uint8(inst.yOffset);
      w.uint8(inst.width);
      w.uint8(inst.height);
      instancePatch.push(w.offset);
      w.uint32(0); // ofsExistsBitmap
      w.uint32(0); // ofsVertexData
    }
    for (let li = 0; li < cell.instances.length; li++) {
      const inst = cell.instances[li];
      if (inst.existsBitmap) {
        w.patchUint32(instancePatch[li], w.offset - dataStart);
        w.bytesArray(inst.existsBitmap);
      }
      const hasVertexData = inst.heightMap || inst.depthMap || inst.uvMap;
      if (hasVertexData) {
        w.patchUint32(instancePatch[li] + 4, w.offset - dataStart);
        const vertCount = (inst.width + 1) * (inst.height + 1);
        switch (inst.liquidVertexFormat) {
          case 0:
            w.float32Array(inst.heightMap ?? new Float32Array(vertCount));
            w.bytesArray(inst.depthMap ?? new Uint8Array(vertCount));
            break;
          case 1: {
            w.float32Array(inst.heightMap ?? new Float32Array(vertCount));
            const uv = inst.uvMap ?? new Uint16Array(vertCount * 2);
            for (let v = 0; v < uv.length; v++) w.uint16(uv[v]);
            break;
          }
          case 2:
            w.bytesArray(inst.depthMap ?? new Uint8Array(vertCount));
            break;
          case 3: {
            w.float32Array(inst.heightMap ?? new Float32Array(vertCount));
            const uv = inst.uvMap ?? new Uint16Array(vertCount * 2);
            for (let v = 0; v < uv.length; v++) w.uint16(uv[v]);
            w.bytesArray(inst.depthMap ?? new Uint8Array(vertCount));
            break;
          }
        }
      }
    }
    w.patchUint32(headerAt, ofsInstances);
    w.patchUint32(headerAt + 4, cell.instances.length);
    w.patchUint32(headerAt + 8, ofsAttributes);
  }
  w.endChunk(sizeOfs);
}

function writeMcnk(
  w: BinaryWriter,
  doc: AdtDoc,
  chunk: McnkChunk,
  options: SerializeAdtOptions,
): void {
  const chunkStart = w.offset;
  const sizeOfs = w.beginChunk('MCNK');
  const headerStart = w.offset;

  // Reconcile flags with actual content.
  let flags = chunk.flags;
  flags = chunk.shadowMap ? flags | MCNK_FLAGS.HAS_MCSH : flags & ~MCNK_FLAGS.HAS_MCSH;
  flags = chunk.vertexColors ? flags | MCNK_FLAGS.HAS_MCCV : flags & ~MCNK_FLAGS.HAS_MCCV;

  // Header — offsets patched as sub-chunks are emitted.
  w.uint32(flags);
  w.uint32(chunk.ix);
  w.uint32(chunk.iy);
  const nLayersOfs = w.offset;
  w.uint32(chunk.layers.length);
  w.uint32(chunk.doodadRefs.length);
  const ofsPatch = w.offset;
  w.uint32(0); // ofsHeight
  w.uint32(0); // ofsNormal
  w.uint32(0); // ofsLayer
  w.uint32(0); // ofsRefs
  w.uint32(0); // ofsAlpha
  w.uint32(0); // sizeAlpha
  w.uint32(0); // ofsShadow
  w.uint32(0); // sizeShadow
  w.uint32(chunk.areaId);
  w.uint32(chunk.wmoRefs.length);
  w.uint32(chunk.holes & 0xffff);
  w.bytesArray(chunk.lowQualityTextureMap.length === 16 ? chunk.lowQualityTextureMap : new Uint8Array(16));
  w.bytesArray(chunk.noEffectDoodad.length === 8 ? chunk.noEffectDoodad : new Uint8Array(8));
  const sndPatch = w.offset;
  w.uint32(0); // ofsSndEmitters
  w.uint32(chunk.soundEmitters ? chunk.soundEmitterCount : 0);
  const liquidPatch = w.offset;
  w.uint32(0); // ofsLiquid
  w.uint32(8); // sizeLiquid (8 = "no liquid")
  w.float32(chunk.position[0]);
  w.float32(chunk.position[1]);
  w.float32(chunk.position[2]);
  const mccvPatch = w.offset;
  w.uint32(0); // ofsMCCV
  w.uint32(chunk.pad0);
  w.uint32(chunk.pad1);
  if (w.offset - headerStart !== 128) {
    throw new Error(`MCNK header must be 128 bytes, wrote ${w.offset - headerStart}`);
  }

  const rel = (absolute: number): number => absolute - chunkStart;

  // MCVT — heights relative to position[2].
  w.patchUint32(ofsPatch, rel(w.offset));
  {
    const s = w.beginChunk('MCVT');
    const base = chunk.position[2];
    for (let i = 0; i < VERTS_PER_CHUNK; i++) w.float32(chunk.heights[i] - base);
    w.endChunk(s);
  }

  // MCCV — vertex colors (optional; lives between MCVT and MCNR in retail).
  if (chunk.vertexColors) {
    w.patchUint32(mccvPatch, rel(w.offset));
    const s = w.beginChunk('MCCV');
    w.bytesArray(chunk.vertexColors);
    w.endChunk(s);
  }

  // MCNR — the size field lies by convention: says 435, payload 448.
  w.patchUint32(ofsPatch + 4, rel(w.offset));
  {
    w.magic('MCNR');
    w.uint32(435);
    w.bytesArray(new Uint8Array(chunk.normals.buffer, chunk.normals.byteOffset, 435));
    w.bytesArray(chunk.normalsPad.length === 13 ? chunk.normalsPad : new Uint8Array(13));
  }

  // MCLY + MCAL — layer table and alpha payloads, built together.
  const alphaPayload = new BinaryWriter(4096);
  const layerRecords: { textureId: number; flags: number; ofs: number; effectId: number }[] = [];
  for (let i = 0; i < chunk.layers.length; i++) {
    const layer = chunk.layers[i];
    let lflags = layer.flags;
    let ofs = 0;
    if (i > 0 && layer.alpha) {
      lflags |= MCLY_FLAGS.USE_ALPHA_MAP;
      ofs = alphaPayload.length;
      const alpha = layer.alpha.slice();
      if ((flags & MCNK_FLAGS.DO_NOT_FIX_ALPHA_MAP) === 0) fixAlphaEdges(alpha);
      if (options.compressAlpha) {
        lflags |= MCLY_FLAGS.ALPHA_MAP_COMPRESSED;
        alphaPayload.bytesArray(encodeAlphaCompressed(alpha));
      } else {
        lflags &= ~MCLY_FLAGS.ALPHA_MAP_COMPRESSED;
        if (doc.bigAlpha) {
          alphaPayload.bytesArray(alpha.length === ALPHA_SIZE ? alpha : alpha.slice(0, ALPHA_SIZE));
        } else {
          alphaPayload.bytesArray(encodeAlpha4(alpha));
        }
      }
    } else {
      lflags &= ~(MCLY_FLAGS.USE_ALPHA_MAP | MCLY_FLAGS.ALPHA_MAP_COMPRESSED);
    }
    layerRecords.push({ textureId: layer.textureId, flags: lflags, ofs, effectId: layer.effectId });
  }

  w.patchUint32(ofsPatch + 8, rel(w.offset));
  {
    const s = w.beginChunk('MCLY');
    for (const rec of layerRecords) {
      w.uint32(rec.textureId);
      w.uint32(rec.flags);
      w.uint32(rec.ofs);
      w.uint32(rec.effectId);
    }
    w.endChunk(s);
  }
  w.patchUint32(nLayersOfs, layerRecords.length);

  // MCRF — references.
  w.patchUint32(ofsPatch + 12, rel(w.offset));
  {
    const s = w.beginChunk('MCRF');
    for (const ref of chunk.doodadRefs) w.uint32(ref);
    for (const ref of chunk.wmoRefs) w.uint32(ref);
    w.endChunk(s);
  }

  // MCSH — packed shadow bitmap.
  if (chunk.shadowMap) {
    w.patchUint32(ofsPatch + 24, rel(w.offset));
    w.patchUint32(ofsPatch + 28, 512 + 8);
    const s = w.beginChunk('MCSH');
    const packed = new Uint8Array(512);
    for (let i = 0; i < 4096; i++) {
      if (chunk.shadowMap[i]) packed[i >> 3] |= 1 << (i & 7);
    }
    w.bytesArray(packed);
    w.endChunk(s);
  }

  // MCAL — alpha payloads.
  {
    const payload = alphaPayload.toUint8Array();
    w.patchUint32(ofsPatch + 16, rel(w.offset));
    w.patchUint32(ofsPatch + 20, payload.length + 8);
    const s = w.beginChunk('MCAL');
    w.bytesArray(payload);
    w.endChunk(s);
  }

  // MCLQ — legacy liquid preserved verbatim (raw includes its own header).
  if (chunk.liquidLegacy && chunk.liquidLegacy.length > 8) {
    w.patchUint32(liquidPatch, rel(w.offset));
    w.patchUint32(liquidPatch + 4, chunk.liquidLegacy.length);
    w.bytesArray(chunk.liquidLegacy);
  } else {
    // Convention: point past the end of the chunk with sizeLiquid = 8.
    w.patchUint32(liquidPatch, rel(w.offset));
  }

  // MCSE — sound emitters preserved verbatim.
  if (chunk.soundEmitters && chunk.soundEmitters.length > 0) {
    w.patchUint32(sndPatch, rel(w.offset));
    const s = w.beginChunk('MCSE');
    w.bytesArray(chunk.soundEmitters);
    w.endChunk(s);
  }

  w.endChunk(sizeOfs);
}

/** Serialize an ADT document to bytes. */
export function serializeAdt(doc: AdtDoc, options: SerializeAdtOptions = {}): Uint8Array {
  if (doc.chunks.length !== CHUNKS_PER_TILE) {
    throw new Error(`AdtDoc must have 256 chunks, has ${doc.chunks.length}`);
  }
  const w = new BinaryWriter(4 * 1024 * 1024);

  // MVER
  {
    const s = w.beginChunk('MVER');
    w.uint32(ADT_VERSION);
    w.endChunk(s);
  }

  // MHDR — 64 bytes, offsets patched at the end.
  const mhdrData = (() => {
    const s = w.beginChunk('MHDR');
    const start = w.offset;
    let flags = doc.mhdrFlags;
    flags = doc.mfbo ? flags | 0x1 : flags & ~0x1;
    w.uint32(flags);
    w.zeros(60);
    w.endChunk(s);
    return start;
  })();
  // Offset slots within MHDR data (after flags), in file order.
  const mhdrSlots = {
    mcin: mhdrData + 4,
    mtex: mhdrData + 8,
    mmdx: mhdrData + 12,
    mmid: mhdrData + 16,
    mwmo: mhdrData + 20,
    mwid: mhdrData + 24,
    mddf: mhdrData + 28,
    modf: mhdrData + 32,
    mfbo: mhdrData + 36,
    mh2o: mhdrData + 40,
    mtxf: mhdrData + 44,
  };
  const mhdrRel = (absolute: number): number => absolute - mhdrData;

  // MCIN — 256 * 16 bytes, patched after MCNKs are written.
  w.patchUint32(mhdrSlots.mcin, mhdrRel(w.offset));
  const mcinStart = (() => {
    const s = w.beginChunk('MCIN');
    const start = w.offset;
    w.zeros(CHUNKS_PER_TILE * 16);
    w.endChunk(s);
    return start;
  })();

  // MTEX
  w.patchUint32(mhdrSlots.mtex, mhdrRel(w.offset));
  {
    const s = w.beginChunk('MTEX');
    for (const t of doc.textures) w.cstring(t);
    w.endChunk(s);
  }

  // MMDX / MMID
  {
    const { block, offsets } = buildStringBlock(doc.m2Models);
    w.patchUint32(mhdrSlots.mmdx, mhdrRel(w.offset));
    w.chunk('MMDX', block);
    w.patchUint32(mhdrSlots.mmid, mhdrRel(w.offset));
    const s = w.beginChunk('MMID');
    w.uint32Array(offsets);
    w.endChunk(s);
  }

  // MWMO / MWID
  {
    const { block, offsets } = buildStringBlock(doc.wmoModels);
    w.patchUint32(mhdrSlots.mwmo, mhdrRel(w.offset));
    w.chunk('MWMO', block);
    w.patchUint32(mhdrSlots.mwid, mhdrRel(w.offset));
    const s = w.beginChunk('MWID');
    w.uint32Array(offsets);
    w.endChunk(s);
  }

  // MDDF
  w.patchUint32(mhdrSlots.mddf, mhdrRel(w.offset));
  {
    const s = w.beginChunk('MDDF');
    for (const d of doc.doodads) {
      w.uint32(d.nameId);
      w.uint32(d.uniqueId);
      w.float32(d.position[0]);
      w.float32(d.position[1]);
      w.float32(d.position[2]);
      w.float32(d.rotation[0]);
      w.float32(d.rotation[1]);
      w.float32(d.rotation[2]);
      w.uint16(Math.round(d.scale * 1024));
      w.uint16(d.flags);
    }
    w.endChunk(s);
  }

  // MODF
  w.patchUint32(mhdrSlots.modf, mhdrRel(w.offset));
  {
    const s = w.beginChunk('MODF');
    for (const m of doc.wmos) {
      w.uint32(m.nameId);
      w.uint32(m.uniqueId);
      w.float32(m.position[0]);
      w.float32(m.position[1]);
      w.float32(m.position[2]);
      w.float32(m.rotation[0]);
      w.float32(m.rotation[1]);
      w.float32(m.rotation[2]);
      w.float32(m.extentsMin[0]);
      w.float32(m.extentsMin[1]);
      w.float32(m.extentsMin[2]);
      w.float32(m.extentsMax[0]);
      w.float32(m.extentsMax[1]);
      w.float32(m.extentsMax[2]);
      w.uint16(m.flags);
      w.uint16(m.doodadSet);
      w.uint16(m.nameSet);
      w.uint16(m.scale);
    }
    w.endChunk(s);
  }

  // MH2O — only when any cell has water.
  if (doc.water && doc.water.some((c) => c && c.instances.length > 0)) {
    w.patchUint32(mhdrSlots.mh2o, mhdrRel(w.offset));
    writeMh2o(w, doc.water);
  }

  // MCNK x 256 — record MCIN entries as we go.
  for (let i = 0; i < CHUNKS_PER_TILE; i++) {
    const chunkOffset = w.offset;
    writeMcnk(w, doc, doc.chunks[i], options);
    const chunkSize = w.offset - chunkOffset;
    w.patchUint32(mcinStart + i * 16, chunkOffset);
    w.patchUint32(mcinStart + i * 16 + 4, chunkSize);
  }

  // MFBO
  if (doc.mfbo) {
    w.patchUint32(mhdrSlots.mfbo, mhdrRel(w.offset));
    const s = w.beginChunk('MFBO');
    for (let i = 0; i < 9; i++) w.int16(doc.mfbo.maximum[i]);
    for (let i = 0; i < 9; i++) w.int16(doc.mfbo.minimum[i]);
    w.endChunk(s);
  }

  // MTXF
  if (doc.textureFlags) {
    w.patchUint32(mhdrSlots.mtxf, mhdrRel(w.offset));
    const s = w.beginChunk('MTXF');
    for (const f of doc.textureFlags) w.uint32(f);
    w.endChunk(s);
  }

  // Preserved unknown chunks.
  for (const extra of doc.extraChunks) {
    w.chunk(extra.magic, extra.data);
  }

  return w.toUint8Array();
}
