/**
 * File input/output: loading ADTs from the user's disk, saving tiles,
 * WDT/WDL export, heightmap import/export.
 */

import type { Editor } from './editor';
import { parseAdt } from '../lib/adt/parser';
import { serializeAdt } from '../lib/adt/serializer';
import { serializeWdt, wdtBigAlpha, parseWdt } from '../lib/wdt/wdt';
import { emptyWdl, serializeWdl, updateWdlFromAdt } from '../lib/wdl/wdl';
import { adtFileName, parseAdtFileName } from '../lib/coords';
import type { AdtDoc } from '../lib/adt/types';
import {
  decodePgm16,
  encodePgm16,
  exportHeightmap,
  gridMinMax,
  importHeightmap,
  type HeightGrid,
} from '../lib/gen/heightmap';

/** Download bytes as a file. */
export function download(name: string, bytes: Uint8Array, mime = 'application/octet-stream'): void {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Result of loading a batch of files. */
export interface LoadReport {
  loadedTiles: string[];
  loadedWdt: boolean;
  loadedImages: string[];
  errors: string[];
}

/** Load a mixed set of files (.adt, .wdt, images for texture skins). */
export async function loadFiles(editor: Editor, files: FileList | File[]): Promise<LoadReport> {
  const report: LoadReport = { loadedTiles: [], loadedWdt: false, loadedImages: [], errors: [] };
  const list = [...files];
  // WDT first so bigAlpha is known before ADT parsing.
  for (const file of list) {
    if (file.name.toLowerCase().endsWith('.wdt')) {
      try {
        const wdt = parseWdt(new Uint8Array(await file.arrayBuffer()));
        editor.wdt = wdt;
        editor.bigAlpha = wdtBigAlpha(wdt);
        editor.mapName = file.name.replace(/\.wdt$/i, '');
        report.loadedWdt = true;
      } catch (e) {
        report.errors.push(`${file.name}: ${(e as Error).message}`);
      }
    }
  }
  for (const file of list) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.adt')) {
      try {
        const meta = parseAdtFileName(file.name);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const doc = parseAdt(bytes, {
          mapName: meta?.mapName,
          tileX: meta?.tileX,
          tileY: meta?.tileY,
          bigAlpha: report.loadedWdt ? editor.bigAlpha : undefined,
        });
        if (!meta) {
          report.errors.push(`${file.name}: name is not <map>_<x>_<y>.adt; loaded at 0,0`);
        }
        editor.bigAlpha = doc.bigAlpha;
        editor.addTile(doc);
        report.loadedTiles.push(file.name);
      } catch (e) {
        report.errors.push(`${file.name}: ${(e as Error).message}`);
      }
    } else if (/\.(png|jpe?g|webp)$/.test(lower)) {
      report.loadedImages.push(file.name);
    }
  }
  return report;
}

/** Serialize and download one tile. */
export function saveTile(editor: Editor, doc: AdtDoc): void {
  doc.bigAlpha = editor.bigAlpha;
  const bytes = serializeAdt(doc);
  download(adtFileName(doc.mapName || editor.mapName, doc.tileX, doc.tileY), bytes);
}

/** Save every loaded tile plus regenerated WDT and WDL. */
export function saveAll(editor: Editor): { files: number } {
  let files = 0;
  const wdl = emptyWdl();
  for (const doc of editor.docs) {
    saveTile(editor, doc);
    updateWdlFromAdt(wdl, doc);
    files++;
  }
  if (files > 0) {
    download(`${editor.mapName}.wdt`, serializeWdt(editor.wdt));
    download(`${editor.mapName}.wdl`, serializeWdl(wdl));
    files += 2;
  }
  return { files };
}

/** Export the active tile's heightmap as 16-bit PGM. */
export function exportTileHeightmapPgm(editor: Editor, doc: AdtDoc): void {
  const grid = exportHeightmap(doc, 257);
  const { min, max } = gridMinMax(grid);
  download(
    `${doc.mapName}_${doc.tileX}_${doc.tileY}_height_${min.toFixed(2)}_${max.toFixed(2)}.pgm`,
    encodePgm16(grid),
    'image/x-portable-graymap',
  );
}

/** Export the active tile's heightmap as an 8-bit grayscale PNG. */
export async function exportTileHeightmapPng(editor: Editor, doc: AdtDoc): Promise<void> {
  const grid = exportHeightmap(doc, 257);
  const { min, max } = gridMinMax(grid);
  const range = max - min || 1;
  const canvas = document.createElement('canvas');
  canvas.width = grid.width;
  canvas.height = grid.height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(grid.width, grid.height);
  for (let i = 0; i < grid.data.length; i++) {
    const v = Math.round(((grid.data[i] - min) / range) * 255);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
  download(
    `${doc.mapName}_${doc.tileX}_${doc.tileY}_height_${min.toFixed(2)}_${max.toFixed(2)}.png`,
    new Uint8Array(await blob.arrayBuffer()),
    'image/png',
  );
}

/** Import a heightmap file (PGM or image) onto a tile. */
export async function importTileHeightmap(
  editor: Editor,
  doc: AdtDoc,
  file: File,
  minHeight: number,
  maxHeight: number,
): Promise<void> {
  let grid: HeightGrid;
  if (file.name.toLowerCase().endsWith('.pgm')) {
    grid = decodePgm16(new Uint8Array(await file.arrayBuffer()), minHeight, maxHeight);
    importHeightmap(doc, grid, { minHeight, maxHeight, raw: true });
  } else {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const data = new Float32Array(bitmap.width * bitmap.height);
    for (let i = 0; i < data.length; i++) {
      // Luminance normalized to [0, 1].
      data[i] =
        (img.data[i * 4] * 0.2126 + img.data[i * 4 + 1] * 0.7152 + img.data[i * 4 + 2] * 0.0722) /
        255;
    }
    grid = { width: bitmap.width, height: bitmap.height, data };
    importHeightmap(doc, grid, { minHeight, maxHeight });
  }
  editor.terrain.markTileDirty(doc);
}
