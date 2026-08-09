# WotLK 3.3.5a terrain formats — as implemented

Notes on the binary formats Noggit Diamond reads and writes, and the exact conventions
the code follows. General reference: [wowdev.wiki](https://wowdev.wiki/ADT/v18).

## Chunked files

All files are sequences of `[4CC magic][uint32 size][payload]`, little-endian, with the
magic stored **byte-reversed** on disk (`MVER` → `REVM`). `src/lib/binary` handles the
framing; parsers walk chunks sequentially and never rely on directory offsets, while the
serializer emits every offset table correctly for the client.

## Coordinates

* **World** (server) coords: X north, Y west, Z up. `ZEROPOINT = 32 · 533.33…` maps the
  64×64 tile grid onto ±17066.66.
* **Map** (editor) coords: `mx` east, `mz` south, `my` up, origin at the NW corner of
  tile (0,0). Conversions: `mx = ZEROPOINT − worldY`, `mz = ZEROPOINT − worldX`.
* MDDF/MODF positions are already stored in map-style coordinates
  (`pos = [mx, height, mz]`); MCNK header positions are world coordinates
  `[worldX, worldY, baseHeight]` (see `chunkHeaderPosition`).

## ADT (version 18, monolithic)

Top-level order written: `MVER MHDR MCIN MTEX MMDX MMID MWMO MWID MDDF MODF [MH2O]
MCNK×256 [MFBO] [MTXF] <preserved unknown chunks>`.

* **MHDR** — 64 bytes; offsets are relative to the MHDR *data* start and point at chunk
  magics (`ofsMCIN` is always 0x40). Bit 0 of flags = has MFBO.
* **MCIN** — 256 × `{ofs, size, flags, asyncId}`; `ofs` absolute to the MCNK magic,
  `size` **includes** the 8-byte chunk header.
* **MTEX / MMDX+MMID / MWMO+MWID** — NUL-separated string blocks; MMID/MWID hold byte
  offsets into the blocks; MDDF/MODF `nameId` indexes MMID/MWID.
* **MDDF** (36 B) — nameId, uniqueId, pos[3], rot[3] (degrees), scale (1024 = 1.0),
  flags. **MODF** (64 B) — adds extents box and doodadSet/nameSet.
* **MH2O** — 256 × 12-byte headers `{ofsInstances, layerCount, ofsAttributes}` with all
  offsets relative to the MH2O data start. Instances are 24 bytes; vertex data layout
  depends on the liquid vertex format: 0 = heights+depths, 1 = heights+uv,
  2 = depths only, 3 = heights+uv+depths. Exists bitmaps are `ceil(w·h/8)` bytes.
* **MFBO** — two 3×3 int16 planes (max, then min).
* **MTXF** — one uint32 of flags per MTEX entry.

### MCNK

128-byte header; sub-chunk offsets are relative to the **MCNK magic** and point at the
sub-chunk magic (first is `ofsHeight = 0x88`). Layout written:
`MCVT [MCCV] MCNR MCLY MCRF [MCSH] MCAL [MCLQ] [MCSE]`.

* **MCVT** — 145 float heights relative to `position[2]`, in 17-value stripes
  (9 outer + 8 inner). Diamond stores heights **absolutely in float64**, which makes
  `base + rel` exact and the round trip byte-identical.
* **MCNR** — 145 × 3 int8 normals in (east, south, up)·127 order. The size field lies:
  it says 435 but the payload is 448; the 13 trailing bytes are preserved verbatim.
* **MCCV** — 145 × BGRA bytes, 0x7F neutral. Flag 0x40 on the chunk.
* **MCLY** — 16 bytes/layer: textureId, flags (0x100 use-alpha, 0x200 compressed),
  offset into MCAL data, effectId. Max 4 layers; layer 0 has no alpha.
* **MCAL** — per layer: 2048 B 4-bit (two texels/byte, low nibble first, ×17), 4096 B
  8-bit ("big alpha", WDT MPHD 0x4/0x80), or RLE-compressed (control bit 7 = fill,
  low 7 bits = count). `sizeAlpha` in the header includes the 8-byte MCAL header.
  Unless MCNK flag 0x8000 (`do_not_fix_alpha_map`) is set, the client ignores row/col 63
  and repeats 62 — Diamond normalizes on load and re-applies on save. With no WDT
  present, 8-bit maps are auto-detected (4-bit maps only yield multiples of 17).
* **MCSH** — 512-byte 64×64 shadow bitmask, LSB-first; bit-expanded in memory.
* **MCRF** — `nDoodadRefs` then `nMapObjRefs` uint32 indices into MDDF/MODF; kept
  consistent when objects are deleted.
* **MCLQ** — pre-MH2O liquid. Preserved verbatim (`sizeLiquid` bytes from `ofsLiquid`,
  which include the sub-chunk header); `sizeLiquid = 8` means none.
* **MCSE** — sound emitters, preserved verbatim with their header count.
* **Holes** — low-res: 16 bits, one per 2×2-quad block (4×4 grid over the 8×8 quads).

## WDT

`MVER, MPHD (flags + 7 preserved uint32), MAIN (64×64 × {flags, asyncId}), [MWMO],
[MODF]`. Flag 0x1 in MAIN marks a tile present. MPHD 0x4/0x80 selects big alpha;
0x1 marks WMO-only maps (global WMO in MWMO/MODF).

## WDL

`MVER, [MWMO MWID MODF preserved], MAOF (4096 absolute offsets), MARE (545 int16:
17×17 outer + 16×16 inner low-res heights) per tile, each optionally followed by MAHO
(16 uint16 hole masks)`. Diamond regenerates MARE/MAHO from the edited tiles on save so
distant terrain matches the edits.

## Round-trip guarantees

`serializeAdt(parseAdt(bytes))` is **byte-identical** for files Diamond wrote, and
content-preserving for foreign files (layout may be normalized to the order above; all
unknown top-level chunks and unmodeled payloads — MCLQ, MCSE, MCNR pad, header spare
fields — are carried through verbatim). Covered by `roundtrip.test.ts` and
`structure.test.ts`, which validate the invariants the 3.3.5a client depends on
(MCIN header-inclusive sizes, `ofsHeight = 0x88`, MCNR 435/448, MHDR offset targets).
