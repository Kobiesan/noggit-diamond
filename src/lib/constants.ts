/**
 * World of Warcraft (WotLK 3.3.5a) map geometry constants.
 *
 * A continent is a 64x64 grid of map tiles (ADT files). Each tile is a
 * 16x16 grid of map chunks (MCNK). Each chunk is an 8x8 grid of quads whose
 * geometry uses a 9x9 grid of "outer" vertices interleaved with an 8x8 grid
 * of "inner" (center) vertices — 145 vertices per chunk in total.
 */

/** Size of one map tile (ADT) in yards: 1600 / 3. */
export const TILE_SIZE = 1600 / 3;

/** Size of one map chunk (MCNK) in yards: TILE_SIZE / 16. */
export const CHUNK_SIZE = TILE_SIZE / 16;

/** Size of one terrain quad in yards: CHUNK_SIZE / 8. */
export const UNIT_SIZE = CHUNK_SIZE / 8;

/** Half of UNIT_SIZE — spacing of the inner (center) vertex grid. */
export const HALF_UNIT = UNIT_SIZE / 2;

/** Tiles per side of a continent. */
export const TILES_PER_MAP = 64;

/** Chunks per side of a tile. */
export const CHUNKS_PER_TILE_SIDE = 16;

/** Chunks per tile (16 x 16). */
export const CHUNKS_PER_TILE = CHUNKS_PER_TILE_SIDE * CHUNKS_PER_TILE_SIDE;

/** Outer vertex grid side (9x9). */
export const OUTER_SIDE = 9;

/** Inner vertex grid side (8x8). */
export const INNER_SIDE = 8;

/** Vertices per chunk: 9*9 + 8*8. */
export const VERTS_PER_CHUNK = OUTER_SIDE * OUTER_SIDE + INNER_SIDE * INNER_SIDE; // 145

/** Alpha map side length (64x64 texels per chunk). */
export const ALPHA_SIDE = 64;

/** Alpha map size in texels. */
export const ALPHA_SIZE = ALPHA_SIDE * ALPHA_SIDE; // 4096

/** Shadow map side length (64x64 bits per chunk). */
export const SHADOW_SIDE = 64;

/** Maximum number of texture layers per chunk (base + 3 blended). */
export const MAX_LAYERS = 4;

/**
 * The world origin offset. World coordinates run from +ZEROPOINT (tile 0)
 * to -ZEROPOINT (tile 64) on both horizontal axes; the map center
 * (tile 32|32 corner) is world (0, 0).
 */
export const ZEROPOINT = (TILES_PER_MAP / 2) * TILE_SIZE; // 17066.666

/** ADT file format version (WotLK). */
export const ADT_VERSION = 18;

/** Default area id for freshly created chunks. */
export const DEFAULT_AREA_ID = 0;

/** MCNK header flags. */
export const MCNK_FLAGS = {
  HAS_MCSH: 0x1,
  IMPASS: 0x2,
  LQ_RIVER: 0x4,
  LQ_OCEAN: 0x8,
  LQ_MAGMA: 0x10,
  LQ_SLIME: 0x20,
  HAS_MCCV: 0x40,
  DO_NOT_FIX_ALPHA_MAP: 0x8000,
  HIGH_RES_HOLES: 0x10000,
} as const;

/** MCLY texture layer flags. */
export const MCLY_FLAGS = {
  ANIMATION_ROTATION_MASK: 0x7,
  ANIMATION_SPEED_MASK: 0x38,
  ANIMATION_ENABLED: 0x40,
  OVERBRIGHT: 0x80,
  USE_ALPHA_MAP: 0x100,
  ALPHA_MAP_COMPRESSED: 0x200,
  USE_CUBE_MAP_REFLECTION: 0x400,
} as const;

/** MHDR flags. */
export const MHDR_FLAGS = {
  HAS_MFBO: 0x1,
  NORTHREND: 0x2,
} as const;

/** WDT MPHD flags. */
export const MPHD_FLAGS = {
  WMO_ONLY: 0x1,
  ADT_HAS_MCCV: 0x2,
  ADT_HAS_BIG_ALPHA: 0x4,
  ADT_HAS_DOODADREFS_SORTED: 0x8,
  ADT_HAS_HEIGHT_TEXTURING: 0x80,
} as const;

/** Known liquid type ids (LiquidType.dbc, WotLK). */
export const LIQUID_TYPES = {
  WATER: 5,
  OCEAN: 6,
  MAGMA: 7,
  SLIME: 8,
} as const;

/** Human labels for common liquid ids. */
export const LIQUID_TYPE_LABELS: Record<number, string> = {
  1: 'Water',
  2: 'Ocean',
  3: 'Magma',
  4: 'Slime',
  5: 'Water',
  6: 'Ocean',
  7: 'Magma',
  8: 'Slime',
  13: 'WMO Water',
  14: 'WMO Ocean',
  17: 'Naxxramas Slime',
  19: 'WMO Magma',
  20: 'WMO Slime',
  21: 'Naxxramas Slime',
  41: 'Coilfang Water',
  61: 'Hyjal Past Water',
  81: 'Lake Wintergrasp Water',
  100: 'Basic Procedural Water',
};
