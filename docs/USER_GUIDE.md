# Noggit Diamond — User Guide

## 1. Getting terrain into the editor

### Start from scratch
**File ▸ New Map…** — pick a map name, tile coordinates (0–63), tile count (up to 4×4),
base height, and optionally a procedural style (rolling / ridged / islands) with a seed.
The result is a fully valid set of ADTs the WotLK client can load once you register the
map (see §7).

### Edit an existing map
1. Extract the tiles you want from the client MPQs (e.g. with Ladik's MPQ Editor):
   `World\Maps\<Map>\<Map>_<x>_<y>.adt` — and grab `<Map>.wdt` too.
2. Drag all of them into the viewport (or **File ▸ Open**). The WDT tells Diamond
   whether the map uses 8-bit "big alpha"; without it the format is auto-detected.
3. Adjacent tiles loaded together are edited as one continuous world.

## 2. Tools

Keys **1–0** switch tools; **Ctrl** inverts any brush (lower / erase / drain / fill).
Brush radius, inner-radius %, and falloff shape are in the sidebar.

| # | Tool | Notes |
|---|---|---|
| 1 | Navigate | Camera only. |
| 2 | Raise / Lower | Speed is yards/second at full falloff. |
| 3 | Flatten | Target = height under the cursor at stroke start, or a locked height; raise-only / lower-only modes for building plateaus and carving lakes. |
| 4 | Smooth | Order-independent blur toward the local average. |
| 5 | Texture Paint | Paints the selected palette texture. Chunks are limited to 4 layers (a WotLK format limit) — full chunks are skipped and counted; use **Edit ▸ Prune empty texture layers** to reclaim slots. |
| 6 | Vertex Color | MCCV tinting; Ctrl restores neutral gray. |
| 7 | Water | Floods whole chunks (like Noggit). Level can be absolute or relative to the terrain under the cursor. Ocean types write flat LVF-2 instances. |
| 8 | Holes | Punches/fills the low-res hole block under the cursor. |
| 9 | Area / Flags | Paints AreaTable ids per chunk, or the impassable flag. Toggle the overlays in **View** to see them. |
| 0 | Objects | Click a cone (doodad) or box (WMO) to select. Drag moves it along the terrain keeping its height offset, **R** rotates 15°, **Delete** removes it. Exact coordinates are editable in the sidebar. |

Every stroke is one undo step (**Ctrl+Z / Ctrl+Y**, 200 deep). Normals are recomputed
automatically around each stroke.

## 3. Texturing without MPQs

Diamond cannot read BLPs out of MPQ archives in the browser, so each texture path gets a
stable, distinct stand-in color (with sensible colors for `grass`, `rock`, `snow`, …).
To see real textures: select a path in the palette, click **Skin with image…**, and pick
a PNG/JPG you exported from the game data (BLPConverter, WoW Export, etc.). The saved
ADTs always reference the real `Tileset\…blp` paths — skins are preview-only.

## 4. Heightmaps

* **Terrain ▸ Export heightmap (16-bit PGM)** — lossless; the min/max heights are in the
  filename and the file comment. Edit it in Blender/Gaea/Krita (they read PGM) and
  re-import with the same min/max for a perfect round trip.
* **Export (PNG)** — 8-bit convenience export.
* **Import** — any grayscale image; black maps to *Min height*, white to *Max height*.

## 5. Procedural generation

**Terrain ▸ Generate Procedural…** overwrites tile heights with seeded simplex fractal
noise. The same seed + parameters always produce the same terrain, and generation samples
absolute world coordinates, so neighboring tiles generated separately still join
seamlessly. Styles: rolling hills (fBm), ridged mountains (ridged multifractal), islands
(radial falloff). Generation clears undo history — save first if unsure.

## 6. Scripting (Diamond Script)

Press <kbd>`</kbd>. The console runs JavaScript with the `nd` API (Ctrl+Enter executes):

```js
nd.help()                                  // list the API
nd.cursor                                  // {x, z, y} under the mouse
nd.raise(nd.cursor.x, nd.cursor.z, 60, 15, 'smooth', 10)
nd.flatten(17000, 17300, 80, 42)           // flatten to height 42
nd.paint(nd.cursor.x, nd.cursor.z, 50, 'Tileset\\Elwynn\\ElwynnGrassBase.blp')
nd.water(nd.cursor.x, nd.cursor.z, 40, 5, 30)   // lake at height 30
nd.generate(4242, 'ridged', 120)           // regenerate all tiles
for (let i = 0; i < 10; i++)               // scripted stamps
  nd.raise(16000 + i * 90, 17000, 35, 5, 'gaussian', 18)
```

`nd.terrain` and `nd.editor` expose the full library for advanced scripts.

## 7. Saving and shipping

**File ▸ Save All** downloads every loaded tile plus:

* `<Map>.wdt` — updated tile-presence index (and big-alpha flag),
* `<Map>.wdl` — regenerated low-res distant terrain (classic Noggit never did this;
  it is why far mountains desync on old edits).

Pack the files into a patch MPQ under `World\Maps\<Map>\` (e.g. with Ladik's editor as
`patch-4.mpq`). For a brand-new map you additionally need a `Map.dbc` row — standard
server-side modding, see the emulator documentation of your choice (TrinityCore /
AzerothCore extractors also need re-running for navmeshes).

## 8. Tips

* The status bar always shows map position, WoW world coordinates, tile/chunk under the
  cursor and its area id.
* The minimap (bottom right) shows loaded tiles, water, holes and the camera; click to
  teleport.
* **View ▸ wireframe** is invaluable when judging sculpt topology; the area overlay
  turns area-id painting into a coloring-book view.
* Object uniqueIds are preserved on move and never reused after delete, so patches stay
  client-safe.
