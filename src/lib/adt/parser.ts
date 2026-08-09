/**
 * WotLK (3.3.5a) ADT parser: binary tile -> AdtDoc.
 *
 * The parser walks top-level chunks sequentially (offsets in MHDR/MCIN
 * are validated implicitly by never being needed), lifts everything the
 * editor understands into the document model and preserves the rest raw.
 */

import { BinaryReader, readChunkHeader } from '../binary/reader';
import {
  ADT_VERSION,
  CHUNKS_PER_TILE,
  CHUNKS_PER_TILE_SIDE,
  MCNK_FLAGS,
  MCLY_FLAGS,
  VERTS_PER_CHUNK,
  ALPHA_SIZE,
  SHADOW_SIDE,
} from '../constants';
import { decodeAlpha4, decodeAlpha8, decodeAlphaCompressed, fixAlphaEdges } from './alpha';
import type {
  AdtDoc,
  DoodadPlacement,
  McnkChunk,
  TextureLayer,
  WaterChunk,
  WaterInstance,
  WmoPlacement,
  RawChunk,
  Mfbo,
} from './types';

export interface ParseAdtMeta {
  mapName?: string;
  tileX?: number;
  tileY?: number;
}

export class AdtParseError extends Error {
  constructor(message: string) {
    super(`ADT parse error: ${message}`);
    this.name = 'AdtParseError';
  }
}

/** Split a NUL-separated string block, returning strings by byte offset. */
function readStringBlock(data: Uint8Array): Map<number, string> {
  const out = new Map<number, string>();
  let start = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0) {
      let s = '';
      for (let j = start; j < i; j++) s += String.fromCharCode(data[j]);
      out.set(start, s);
      start = i + 1;
    }
  }
  return out;
}

function parseMddf(r: BinaryReader): DoodadPlacement[] {
  const out: DoodadPlacement[] = [];
  while (r.remaining >= 36) {
    out.push({
      nameId: r.uint32(),
      uniqueId: r.uint32(),
      position: [r.float32(), r.float32(), r.float32()],
      rotation: [r.float32(), r.float32(), r.float32()],
      scale: r.uint16() / 1024,
      flags: r.uint16(),
    });
  }
  return out;
}

function parseModf(r: BinaryReader): WmoPlacement[] {
  const out: WmoPlacement[] = [];
  while (r.remaining >= 64) {
    out.push({
      nameId: r.uint32(),
      uniqueId: r.uint32(),
      position: [r.float32(), r.float32(), r.float32()],
      rotation: [r.float32(), r.float32(), r.float32()],
      extentsMin: [r.float32(), r.float32(), r.float32()],
      extentsMax: [r.float32(), r.float32(), r.float32()],
      flags: r.uint16(),
      doodadSet: r.uint16(),
      nameSet: r.uint16(),
      scale: r.uint16(),
    });
  }
  return out;
}

function parseMh2o(data: Uint8Array): (WaterChunk | null)[] {
  const r = new BinaryReader(data);
  const headers: { ofsInstances: number; layerCount: number; ofsAttributes: number }[] = [];
  for (let i = 0; i < CHUNKS_PER_TILE; i++) {
    headers.push({
      ofsInstances: r.uint32(),
      layerCount: r.uint32(),
      ofsAttributes: r.uint32(),
    });
  }
  const cells: (WaterChunk | null)[] = [];
  for (let i = 0; i < CHUNKS_PER_TILE; i++) {
    const h = headers[i];
    if (h.layerCount === 0) {
      cells.push(null);
      continue;
    }
    const instances: WaterInstance[] = [];
    for (let li = 0; li < h.layerCount; li++) {
      const ir = new BinaryReader(data);
      ir.seek(h.ofsInstances + li * 24);
      const liquidTypeId = ir.uint16();
      const liquidVertexFormat = ir.uint16();
      const minHeight = ir.float32();
      const maxHeight = ir.float32();
      const xOffset = ir.uint8();
      const yOffset = ir.uint8();
      const width = ir.uint8();
      const height = ir.uint8();
      const ofsExists = ir.uint32();
      const ofsVertex = ir.uint32();

      let existsBitmap: Uint8Array | null = null;
      if (ofsExists !== 0) {
        const bytes = Math.ceil((width * height) / 8);
        existsBitmap = data.slice(ofsExists, ofsExists + bytes);
      }

      const vertCount = (width + 1) * (height + 1);
      let heightMap: Float32Array | null = null;
      let depthMap: Uint8Array | null = null;
      let uvMap: Uint16Array | null = null;
      if (ofsVertex !== 0) {
        const vr = new BinaryReader(data);
        vr.seek(ofsVertex);
        switch (liquidVertexFormat) {
          case 0:
            heightMap = vr.float32Array(vertCount);
            depthMap = vr.bytesArray(vertCount);
            break;
          case 1: {
            heightMap = vr.float32Array(vertCount);
            uvMap = new Uint16Array(vertCount * 2);
            for (let v = 0; v < vertCount * 2; v++) uvMap[v] = vr.uint16();
            break;
          }
          case 2:
            depthMap = vr.bytesArray(vertCount);
            break;
          case 3: {
            heightMap = vr.float32Array(vertCount);
            uvMap = new Uint16Array(vertCount * 2);
            for (let v = 0; v < vertCount * 2; v++) uvMap[v] = vr.uint16();
            depthMap = vr.bytesArray(vertCount);
            break;
          }
          default:
            throw new AdtParseError(`unknown liquid vertex format ${liquidVertexFormat}`);
        }
      }
      instances.push({
        liquidTypeId,
        liquidVertexFormat,
        minHeight,
        maxHeight,
        xOffset,
        yOffset,
        width,
        height,
        existsBitmap,
        heightMap,
        depthMap,
        uvMap,
      });
    }
    let attributes: WaterChunk['attributes'] = null;
    if (h.ofsAttributes !== 0) {
      const ar = new BinaryReader(data);
      ar.seek(h.ofsAttributes);
      attributes = { fishable: ar.uint64(), deep: ar.uint64() };
    }
    cells.push({ instances, attributes });
  }
  return cells;
}

interface McnkHeaderRaw {
  flags: number;
  ix: number;
  iy: number;
  nLayers: number;
  nDoodadRefs: number;
  ofsHeight: number;
  ofsNormal: number;
  ofsLayer: number;
  ofsRefs: number;
  ofsAlpha: number;
  sizeAlpha: number;
  ofsShadow: number;
  sizeShadow: number;
  areaId: number;
  nMapObjRefs: number;
  holes: number;
  lowQualityTextureMap: Uint8Array;
  noEffectDoodad: Uint8Array;
  ofsSndEmitters: number;
  nSndEmitters: number;
  ofsLiquid: number;
  sizeLiquid: number;
  position: [number, number, number];
  ofsMccv: number;
  pad0: number;
  pad1: number;
}

function readMcnkHeader(r: BinaryReader): McnkHeaderRaw {
  return {
    flags: r.uint32(),
    ix: r.uint32(),
    iy: r.uint32(),
    nLayers: r.uint32(),
    nDoodadRefs: r.uint32(),
    ofsHeight: r.uint32(),
    ofsNormal: r.uint32(),
    ofsLayer: r.uint32(),
    ofsRefs: r.uint32(),
    ofsAlpha: r.uint32(),
    sizeAlpha: r.uint32(),
    ofsShadow: r.uint32(),
    sizeShadow: r.uint32(),
    areaId: r.uint32(),
    nMapObjRefs: r.uint32(),
    holes: r.uint32() & 0xffff,
    lowQualityTextureMap: r.bytesArray(16),
    noEffectDoodad: r.bytesArray(8),
    ofsSndEmitters: r.uint32(),
    nSndEmitters: r.uint32(),
    ofsLiquid: r.uint32(),
    sizeLiquid: r.uint32(),
    position: [r.float32(), r.float32(), r.float32()],
    ofsMccv: r.uint32(),
    pad0: r.uint32(),
    pad1: r.uint32(),
  };
}

/**
 * Locate a sub-chunk given its header-relative offset. Offsets are
 * relative to the MCNK chunk start (the magic). Returns a reader over the
 * sub-chunk payload, or null when the offset is 0 / invalid.
 * Tolerates writers that measured from the data start instead (+8).
 */
function subChunk(
  mcnk: Uint8Array,
  ofs: number,
  expected: string,
): { data: Uint8Array; size: number } | null {
  if (ofs <= 0) return null;
  for (const base of [ofs, ofs + 8]) {
    if (base + 8 > mcnk.length) continue;
    const magic =
      String.fromCharCode(mcnk[base + 3]) +
      String.fromCharCode(mcnk[base + 2]) +
      String.fromCharCode(mcnk[base + 1]) +
      String.fromCharCode(mcnk[base]);
    if (magic !== expected) continue;
    const size =
      mcnk[base + 4] | (mcnk[base + 5] << 8) | (mcnk[base + 6] << 16) | (mcnk[base + 7] << 24);
    const start = base + 8;
    const avail = Math.max(0, mcnk.length - start);
    return { data: mcnk.subarray(start, start + Math.min(size >>> 0, avail)), size: size >>> 0 };
  }
  return null;
}

function parseMcnk(chunkBytes: Uint8Array, bigAlphaHint: boolean | null): McnkChunk {
  // chunkBytes includes the 8-byte chunk header (magic + size).
  const r = new BinaryReader(chunkBytes);
  r.seek(8);
  const h = readMcnkHeader(r);

  // MCVT — heights, relative to header base height.
  const mcvt = subChunk(chunkBytes, h.ofsHeight, 'MCVT');
  if (!mcvt) throw new AdtParseError(`MCNK (${h.ix},${h.iy}) missing MCVT`);
  const vr = new BinaryReader(mcvt.data);
  const heights = new Float64Array(VERTS_PER_CHUNK);
  const base = h.position[2];
  for (let i = 0; i < VERTS_PER_CHUNK; i++) heights[i] = base + vr.float32();

  // MCNR — normals (+13 preserved trailing bytes).
  let normals = new Int8Array(VERTS_PER_CHUNK * 3);
  let normalsPad = new Uint8Array(13);
  const mcnr = subChunk(chunkBytes, h.ofsNormal, 'MCNR');
  if (mcnr) {
    // The size field famously lies (says 435, payload is 448).
    const nrStart = h.ofsNormal >= 0 ? 0 : 0;
    const bytes = mcnr.data.length >= 435 ? mcnr.data : null;
    if (bytes) {
      normals = new Int8Array(bytes.buffer, bytes.byteOffset, 435).slice();
    }
    // Trailing pad lives beyond the declared payload; fetch from raw bytes.
    const padStart = (h.ofsNormal < chunkBytes.length ? h.ofsNormal : 0) + 8 + 435;
    if (padStart + 13 <= chunkBytes.length) {
      normalsPad = chunkBytes.slice(padStart, padStart + 13);
    }
  }

  // MCCV — vertex colors.
  let vertexColors: Uint8Array | null = null;
  if (h.ofsMccv > 0) {
    const mccv = subChunk(chunkBytes, h.ofsMccv, 'MCCV');
    if (mccv && mccv.data.length >= VERTS_PER_CHUNK * 4) {
      vertexColors = mccv.data.slice(0, VERTS_PER_CHUNK * 4);
    }
  }

  // MCLY — texture layers.
  const layers: TextureLayer[] = [];
  const layerAlphaOfs: number[] = [];
  const mcly = subChunk(chunkBytes, h.ofsLayer, 'MCLY');
  if (mcly && h.nLayers > 0) {
    const lr = new BinaryReader(mcly.data);
    for (let i = 0; i < h.nLayers && lr.remaining >= 16; i++) {
      const textureId = lr.uint32();
      const flags = lr.uint32();
      const ofsAlpha = lr.uint32();
      const effectId = lr.uint32();
      layers.push({ textureId, flags, effectId, alpha: null });
      layerAlphaOfs.push(ofsAlpha);
    }
  }

  // MCAL — alpha maps for layers with USE_ALPHA_MAP.
  const mcal = subChunk(chunkBytes, h.ofsAlpha, 'MCAL');
  if (mcal) {
    // sizeAlpha includes the 8-byte chunk header; the size field of MCAL
    // itself is unreliable in some files, so use sizeAlpha.
    const alphaData = (() => {
      const start = h.ofsAlpha + 8;
      const size = Math.max(0, Math.min(h.sizeAlpha - 8, chunkBytes.length - start));
      return chunkBytes.subarray(start, start + size);
    })();
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if ((layer.flags & MCLY_FLAGS.USE_ALPHA_MAP) === 0) continue;
      const ofs = layerAlphaOfs[i];
      const slice = alphaData.subarray(ofs);
      let alpha: Uint8Array;
      if (layer.flags & MCLY_FLAGS.ALPHA_MAP_COMPRESSED) {
        alpha = decodeAlphaCompressed(slice);
      } else {
        // Determine this layer's byte length from the next layer's offset.
        let next = alphaData.length;
        for (let j = 0; j < layers.length; j++) {
          if (j === i) continue;
          if ((layers[j].flags & MCLY_FLAGS.USE_ALPHA_MAP) === 0) continue;
          if (layerAlphaOfs[j] > ofs && layerAlphaOfs[j] < next) next = layerAlphaOfs[j];
        }
        const len = next - ofs;
        const big = bigAlphaHint !== null ? bigAlphaHint : len >= ALPHA_SIZE;
        alpha = big ? decodeAlpha8(slice) : decodeAlpha4(slice);
      }
      if ((h.flags & MCNK_FLAGS.DO_NOT_FIX_ALPHA_MAP) === 0) fixAlphaEdges(alpha);
      layer.alpha = alpha;
    }
  }

  // MCRF — doodad + wmo references.
  const doodadRefs: number[] = [];
  const wmoRefs: number[] = [];
  const mcrf = subChunk(chunkBytes, h.ofsRefs, 'MCRF');
  if (mcrf) {
    const rr = new BinaryReader(mcrf.data);
    for (let i = 0; i < h.nDoodadRefs && rr.remaining >= 4; i++) doodadRefs.push(rr.uint32());
    for (let i = 0; i < h.nMapObjRefs && rr.remaining >= 4; i++) wmoRefs.push(rr.uint32());
  }

  // MCSH — shadow map, bit-expanded to 4096 bytes of 0/1.
  let shadowMap: Uint8Array | null = null;
  if ((h.flags & MCNK_FLAGS.HAS_MCSH) !== 0 && h.ofsShadow > 0 && h.sizeShadow > 8) {
    const mcsh = subChunk(chunkBytes, h.ofsShadow, 'MCSH');
    if (mcsh) {
      const packed = mcsh.data;
      shadowMap = new Uint8Array(SHADOW_SIDE * SHADOW_SIDE);
      const n = Math.min(packed.length, 512);
      for (let bi = 0; bi < n; bi++) {
        const b = packed[bi];
        for (let bit = 0; bit < 8; bit++) {
          shadowMap[bi * 8 + bit] = (b >> bit) & 1;
        }
      }
    }
  }

  // MCLQ — legacy liquid: preserve `sizeLiquid` raw bytes from ofsLiquid.
  let liquidLegacy: Uint8Array | null = null;
  if (h.sizeLiquid > 8 && h.ofsLiquid > 0 && h.ofsLiquid < chunkBytes.length) {
    const end = Math.min(chunkBytes.length, h.ofsLiquid + h.sizeLiquid);
    liquidLegacy = chunkBytes.slice(h.ofsLiquid, end);
  }

  // MCSE — sound emitters, preserved raw.
  let soundEmitters: Uint8Array | null = null;
  if (h.nSndEmitters > 0) {
    const mcse = subChunk(chunkBytes, h.ofsSndEmitters, 'MCSE');
    if (mcse) soundEmitters = mcse.data.slice();
  }

  return {
    flags: h.flags,
    ix: h.ix,
    iy: h.iy,
    areaId: h.areaId,
    holes: h.holes,
    position: h.position,
    heights,
    normals,
    normalsPad,
    vertexColors,
    layers,
    shadowMap,
    doodadRefs,
    wmoRefs,
    liquidLegacy,
    soundEmitters,
    soundEmitterCount: h.nSndEmitters,
    lowQualityTextureMap: h.lowQualityTextureMap,
    noEffectDoodad: h.noEffectDoodad,
    pad0: h.pad0,
    pad1: h.pad1,
  };
}

/** Options for parseAdt. */
export interface ParseAdtOptions extends ParseAdtMeta {
  /**
   * Whether uncompressed alpha maps are 4096-byte 8-bit ("big alpha",
   * from the map WDT's MPHD flags). Auto-detected per layer when omitted.
   */
  bigAlpha?: boolean;
}

/** Parse a WotLK ADT file into an editable document. */
export function parseAdt(bytes: Uint8Array, options: ParseAdtOptions = {}): AdtDoc {
  const r = new BinaryReader(bytes);
  const doc: AdtDoc = {
    tileX: options.tileX ?? 0,
    tileY: options.tileY ?? 0,
    mapName: options.mapName ?? 'map',
    version: ADT_VERSION,
    mhdrFlags: 0,
    textures: [],
    m2Models: [],
    wmoModels: [],
    doodads: [],
    wmos: [],
    water: null,
    chunks: [],
    mfbo: null,
    textureFlags: null,
    bigAlpha: options.bigAlpha ?? false,
    extraChunks: [],
  };

  let mmdxBlock: Map<number, string> | null = null;
  let mwmoBlock: Map<number, string> | null = null;
  let mmidOffsets: Uint32Array | null = null;
  let mwidOffsets: Uint32Array | null = null;
  const mcnkChunks: McnkChunk[] = [];
  let sawBigAlphaEvidence: boolean | null = options.bigAlpha ?? null;

  while (r.remaining >= 8) {
    const header = readChunkHeader(r);
    const data = bytes.subarray(header.dataOffset, header.dataOffset + header.size);
    switch (header.magic) {
      case 'MVER': {
        const version = new BinaryReader(data).uint32();
        if (version !== ADT_VERSION) {
          throw new AdtParseError(
            `unsupported version ${version} (expected ${ADT_VERSION}; only WotLK 3.3.5a monolithic ADTs are supported)`,
          );
        }
        doc.version = version;
        break;
      }
      case 'MHDR': {
        doc.mhdrFlags = new BinaryReader(data).uint32();
        break;
      }
      case 'MCIN':
        // Regenerated on save; sequential MCNK order is authoritative.
        break;
      case 'MTEX': {
        const block = readStringBlock(data);
        doc.textures = [...block.values()];
        break;
      }
      case 'MMDX':
        mmdxBlock = readStringBlock(data);
        break;
      case 'MMID':
        mmidOffsets = new BinaryReader(data).uint32Array(Math.floor(data.length / 4));
        break;
      case 'MWMO':
        mwmoBlock = readStringBlock(data);
        break;
      case 'MWID':
        mwidOffsets = new BinaryReader(data).uint32Array(Math.floor(data.length / 4));
        break;
      case 'MDDF':
        doc.doodads = parseMddf(new BinaryReader(data));
        break;
      case 'MODF':
        doc.wmos = parseModf(new BinaryReader(data));
        break;
      case 'MH2O':
        doc.water = data.length >= CHUNKS_PER_TILE * 12 ? parseMh2o(data.slice()) : null;
        break;
      case 'MCNK': {
        const whole = bytes.subarray(header.chunkOffset, header.dataOffset + header.size);
        mcnkChunks.push(parseMcnk(whole, sawBigAlphaEvidence));
        break;
      }
      case 'MFBO': {
        const fr = new BinaryReader(data);
        const maximum = new Int16Array(9);
        const minimum = new Int16Array(9);
        for (let i = 0; i < 9; i++) maximum[i] = fr.int16();
        for (let i = 0; i < 9; i++) minimum[i] = fr.int16();
        doc.mfbo = { maximum, minimum } satisfies Mfbo;
        break;
      }
      case 'MTXF': {
        const fr = new BinaryReader(data);
        const flags: number[] = [];
        while (fr.remaining >= 4) flags.push(fr.uint32());
        doc.textureFlags = flags;
        break;
      }
      default:
        doc.extraChunks.push({ magic: header.magic, data: data.slice() } satisfies RawChunk);
        break;
    }
  }

  // Resolve model name tables through MMID/MWID indirection.
  if (mmdxBlock) {
    if (mmidOffsets) {
      doc.m2Models = [...mmidOffsets].map((o) => mmdxBlock!.get(o) ?? '');
    } else {
      doc.m2Models = [...mmdxBlock.values()];
    }
  }
  if (mwmoBlock) {
    if (mwidOffsets) {
      doc.wmoModels = [...mwidOffsets].map((o) => mwmoBlock!.get(o) ?? '');
    } else {
      doc.wmoModels = [...mwmoBlock.values()];
    }
  }

  if (mcnkChunks.length !== CHUNKS_PER_TILE) {
    throw new AdtParseError(`expected 256 MCNK chunks, found ${mcnkChunks.length}`);
  }

  // Order chunks by their (iy, ix) indices; fall back to file order.
  const ordered = new Array<McnkChunk | undefined>(CHUNKS_PER_TILE);
  let indexable = true;
  for (const c of mcnkChunks) {
    const idx = c.iy * CHUNKS_PER_TILE_SIDE + c.ix;
    if (c.ix > 15 || c.iy > 15 || ordered[idx] !== undefined) {
      indexable = false;
      break;
    }
    ordered[idx] = c;
  }
  doc.chunks = indexable ? (ordered as McnkChunk[]) : mcnkChunks;

  // Detect big alpha for round-trip fidelity when not specified: any
  // layer that decoded from a 4096-byte window implies big alpha.
  if (options.bigAlpha === undefined) {
    doc.bigAlpha = detectBigAlpha(doc);
  }

  return doc;
}

/** Heuristic: do the parsed alpha maps look 8-bit? */
function detectBigAlpha(doc: AdtDoc): boolean {
  // 4-bit maps only produce multiples of 17 (0, 17, ..., 255). If any
  // alpha texel is not a multiple of 17, the source was 8-bit.
  for (const chunk of doc.chunks) {
    for (const layer of chunk.layers) {
      if (layer.flags & MCLY_FLAGS.ALPHA_MAP_COMPRESSED) continue;
      if (!layer.alpha) continue;
      for (let i = 0; i < layer.alpha.length; i += 7) {
        if (layer.alpha[i] % 17 !== 0) return true;
      }
    }
  }
  return false;
}
