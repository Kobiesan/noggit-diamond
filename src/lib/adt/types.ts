/**
 * In-memory document model for a WotLK (3.3.5a) ADT map tile.
 *
 * Parsing lifts the binary chunks into this editable model; serialization
 * writes a fully valid ADT back out. Fields that the editor does not
 * interpret are preserved raw so unknown data survives a load/save cycle.
 */

/** A single texture layer of a map chunk (MCLY + its MCAL alpha map). */
export interface TextureLayer {
  /** Index into AdtDoc.textures (MTEX). */
  textureId: number;
  /** MCLY flags (animation, USE_ALPHA_MAP, compression...). */
  flags: number;
  /** Ground effect id (GroundEffectTexture.dbc), 0 for none. */
  effectId: number;
  /**
   * Alpha map normalized to 4096 bytes (64x64, 0..255), regardless of
   * on-disk encoding. Null for the base layer (layer 0) which is opaque.
   */
  alpha: Uint8Array | null;
}

/** M2 doodad placement (MDDF entry). Position is in map coords: [mx, height, mz]. */
export interface DoodadPlacement {
  /** Index into AdtDoc.m2Models (via MMID). */
  nameId: number;
  uniqueId: number;
  position: [number, number, number];
  /** Rotation in degrees: [rx, ry, rz]. */
  rotation: [number, number, number];
  /** Scale factor; 1024 = 1.0 on disk, stored here as float. */
  scale: number;
  flags: number;
}

/** WMO placement (MODF entry). Position is in map coords: [mx, height, mz]. */
export interface WmoPlacement {
  /** Index into AdtDoc.wmoModels (via MWID). */
  nameId: number;
  uniqueId: number;
  position: [number, number, number];
  rotation: [number, number, number];
  /** Bounding box in map coords. */
  extentsMin: [number, number, number];
  extentsMax: [number, number, number];
  flags: number;
  doodadSet: number;
  nameSet: number;
  /** uint16 on disk; 0 in WotLK (scale unsupported until Legion). */
  scale: number;
}

/** One liquid instance of an MH2O cell. */
export interface WaterInstance {
  /** LiquidType.dbc id (5 water, 6 ocean, 7 magma, 8 slime...). */
  liquidTypeId: number;
  /** Liquid vertex format 0..3 (a.k.a. LVF). */
  liquidVertexFormat: number;
  minHeight: number;
  maxHeight: number;
  /** Sub-rectangle of the 8x8 liquid grid this instance covers. */
  xOffset: number;
  yOffset: number;
  width: number;
  height: number;
  /**
   * One bit per covered cell, row-major over width*height cells;
   * null means "all cells exist".
   */
  existsBitmap: Uint8Array | null;
  /** (width+1)*(height+1) heights; null for LVF 2 (ocean, flat). */
  heightMap: Float32Array | null;
  /** (width+1)*(height+1) depth bytes; null when absent. */
  depthMap: Uint8Array | null;
  /** (width+1)*(height+1) uv pairs (u16 each); LVF 1/3 only. */
  uvMap: Uint16Array | null;
}

/** MH2O data for one map chunk cell. */
export interface WaterChunk {
  instances: WaterInstance[];
  /** 8-byte fishable + 8-byte deep bitmaps; null when omitted. */
  attributes: { fishable: bigint; deep: bigint } | null;
}

/** Sound emitter entries (MCSE), preserved raw. */
export type SoundEmitters = Uint8Array;

/** One of the 256 terrain chunks (MCNK) of a tile. */
export interface McnkChunk {
  /** MCNK header flags (see MCNK_FLAGS). */
  flags: number;
  /** Column (0..15) of this chunk within the tile. */
  ix: number;
  /** Row (0..15) of this chunk within the tile. */
  iy: number;
  /** AreaTable.dbc id painted onto this chunk. */
  areaId: number;
  /** 16-bit low-res hole mask (bit i covers a 2x2-quad block, 4x4 grid). */
  holes: number;
  /**
   * MCNK header position [worldX, worldY, baseHeight] exactly as stored
   * in the file. Vertex heights below are absolute (base folded in).
   */
  position: [number, number, number];
  /**
   * 145 absolute vertex heights (float64 so base+relative round-trips
   * exactly back to the original float32 pair).
   */
  heights: Float64Array;
  /**
   * 145 normals, 3 signed bytes each in file order (nx, nz, ny),
   * 127 = 1.0. Recomputed on demand by edit ops.
   */
  normals: Int8Array;
  /** 13 trailing bytes of MCNR, preserved verbatim. */
  normalsPad: Uint8Array;
  /** MCCV vertex colors: 145 x 4 bytes (b, g, r, a), null when absent. */
  vertexColors: Uint8Array | null;
  /** Up to 4 texture layers. */
  layers: TextureLayer[];
  /** MCSH shadow map as 4096 bytes 0/1 (bit-expanded), null when absent. */
  shadowMap: Uint8Array | null;
  /** MCRF doodad references (indices into AdtDoc.doodads). */
  doodadRefs: number[];
  /** MCRF wmo references (indices into AdtDoc.wmos). */
  wmoRefs: number[];
  /** Legacy per-chunk liquid (MCLQ), preserved raw; null when absent. */
  liquidLegacy: Uint8Array | null;
  /** Sound emitters (MCSE) raw payload; null when absent. */
  soundEmitters: SoundEmitters | null;
  /** Number of sound emitter entries (from header). */
  soundEmitterCount: number;
  /** ReallyLowQualityTextureingMap — 16 raw bytes at header 0x40. */
  lowQualityTextureMap: Uint8Array;
  /** noEffectDoodad — 8 raw bytes at header 0x50. */
  noEffectDoodad: Uint8Array;
  /** Unused header dwords at 0x78 / 0x7C, preserved. */
  pad0: number;
  pad1: number;
}

/** Flight bounds (MFBO): two 3x3 int16 height planes. */
export interface Mfbo {
  maximum: Int16Array; // 9 values
  minimum: Int16Array; // 9 values
}

/** An unknown/unmodeled top-level chunk preserved verbatim. */
export interface RawChunk {
  magic: string;
  data: Uint8Array;
}

/** A parsed, editable ADT map tile. */
export interface AdtDoc {
  /** Tile column (0..63) — from the filename, not stored in the file. */
  tileX: number;
  /** Tile row (0..63). */
  tileY: number;
  /** Map (continent) internal name — from the filename. */
  mapName: string;

  /** MVER — always 18 for WotLK. */
  version: number;
  /** MHDR flags (bit 0 = has MFBO). */
  mhdrFlags: number;

  /** MTEX — texture file paths, referenced by TextureLayer.textureId. */
  textures: string[];
  /** MMDX — M2 model file paths. */
  m2Models: string[];
  /** MWMO — WMO file paths. */
  wmoModels: string[];

  /** MDDF — doodad placements. */
  doodads: DoodadPlacement[];
  /** MODF — WMO placements. */
  wmos: WmoPlacement[];

  /** MH2O water, one cell per chunk (null cell = no water). Null = no MH2O chunk. */
  water: (WaterChunk | null)[] | null;

  /** The 256 terrain chunks, row-major (index = iy*16 + ix). */
  chunks: McnkChunk[];

  /** MFBO flight bounds; null when absent. */
  mfbo: Mfbo | null;
  /** MTXF per-texture flags; null when absent. */
  textureFlags: number[] | null;

  /**
   * Serialize MCAL as 4096-byte uncompressed ("big alpha", requires the
   * map's WDT to set MPHD 0x4/0x80) instead of 2048-byte 4-bit maps.
   */
  bigAlpha: boolean;

  /** Unmodeled top-level chunks preserved for round-trip. */
  extraChunks: RawChunk[];
}

/** WDT map index file model. */
export interface WdtDoc {
  version: number;
  /** MPHD flags (WMO_ONLY, ADT_HAS_BIG_ALPHA, ...). */
  flags: number;
  /** The 7 uint32s of MPHD after flags, preserved. */
  mphdRest: Uint32Array;
  /** 64x64 tile presence flags (row-major [y][x], bit 0 = has ADT). */
  tiles: Uint32Array; // 4096 entries: flags
  tilesAsync: Uint32Array; // 4096 entries: asyncId (unused, preserved)
  /** Whether the (possibly empty) MWMO chunk is present. */
  mwmoPresent: boolean;
  /** Global WMO filename for WMO-only maps ('' = none). */
  globalWmo: string;
  /** MODF entry for the global WMO; null when absent. */
  globalWmoPlacement: WmoPlacement | null;
}
