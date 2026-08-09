# Changelog

## 1.0.0 — 2026-08-09

First release: a complete, from-scratch reimplementation of the Noggit WoW map editor
as a browser application.

### Format library (`src/lib`)
- Full WotLK 3.3.5a ADT parser/serializer: MVER, MHDR, MCIN, MTEX, MMDX/MMID,
  MWMO/MWID, MDDF, MODF, MH2O (all liquid vertex formats, exists bitmaps, attributes),
  MFBO, MTXF, and per-chunk MCVT, MCCV, MCNR (with preserved pad), MCLY, MCRF, MCSH,
  MCAL (4-bit, 8-bit big-alpha, RLE-compressed — auto-detected), MCLQ and MCSE
  (preserved verbatim), holes, area ids, flags.
- Byte-idempotent serialization; unknown chunks survive load→save untouched.
- WDT parse/serialize (tile index, big-alpha flags, global WMO) and WDL
  parse/serialize/regeneration (distant-terrain heights + hole masks).
- Blank-tile builder, multi-tile Terrain facade with spatial queries, exact height
  interpolation over the render triangulation, seam stitching, dirty tracking.
- Editing ops: raise/lower, flatten, smooth (7 brush falloffs), texture-layer
  management and alpha painting, MCCV painting, water paint/erase/level, holes,
  area/impassable painting, cross-border normal recomputation.
- Transactional undo/redo with per-chunk snapshots (water-cell aware).
- Seeded simplex noise (fBm, ridged), tile-seamless procedural generation,
  heightmap import/export with a lossless 16-bit PGM codec.
- 121 unit tests.

### Editor app (`src/app`)
- Three.js renderer: per-chunk meshes, CPU splat compositing with MCCV tint,
  baked-shadow display, area/impass overlays, wireframe, water rendering,
  object markers, brush cursor, picking.
- 10 tools with stroke-scoped undo; fly camera; texture palette with image skinning;
  chunk layer inspector; object inspector (move/rotate/scale/delete).
- New Map wizard (flat/procedural, up to 4×4 tiles), drag-and-drop ADT/WDT loading,
  save tile / save all with regenerated WDT + WDL.
- Heightmap import (image/PGM) and export (PNG/PGM), procedural generation dialog.
- Minimap with teleport, status bar, Diamond Script JavaScript console (`nd` API).
