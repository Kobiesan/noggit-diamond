/**
 * Top bar: brand, menus (File / Edit / Terrain / View / Help), undo/redo.
 */

import type { Editor } from '../editor';
import type { AppRenderer } from '../renderer';
import type { FlyCamera } from '../camera';
import { createBlankAdt } from '../../lib/adt/builder';
import { generateTerrain, defaultProceduralParams, type ProceduralStyle } from '../../lib/gen/procedural';
import { recomputeNormals } from '../../lib/edit/normals';
import { pruneEmptyLayers } from '../../lib/edit/texture';
import { clearAllHoles } from '../../lib/edit/holes';
import { TILE_SIZE, MPHD_FLAGS } from '../../lib/constants';
import {
  exportTileHeightmapPgm,
  exportTileHeightmapPng,
  importTileHeightmap,
  loadFiles,
  saveAll,
  saveTile,
} from '../files';
import { showModal, toast } from './modal';

interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
}

export class Topbar {
  private root: HTMLElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;

  constructor(
    private editor: Editor,
    private renderer: AppRenderer,
    private camera: FlyCamera,
  ) {
    this.root = document.getElementById('topbar')!;
    this.build();
    editor.on('history', () => this.refresh());
    editor.on('tiles', () => this.refresh());
  }

  private menu(name: string, items: MenuItem[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'menu';
    const btn = document.createElement('button');
    btn.className = 'menu-btn';
    btn.textContent = name;
    const list = document.createElement('div');
    list.className = 'menu-list';
    for (const item of items) {
      if (item.separator) {
        list.appendChild(document.createElement('hr'));
        continue;
      }
      const b = document.createElement('button');
      b.innerHTML = `${item.label}${item.shortcut ? `<i>${item.shortcut}</i>` : ''}`;
      b.addEventListener('click', () => {
        wrap.classList.remove('open');
        item.action?.();
      });
      list.appendChild(b);
    }
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = wrap.classList.contains('open');
      document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
      if (!wasOpen) wrap.classList.add('open');
    });
    wrap.append(btn, list);
    return wrap;
  }

  private build(): void {
    const e = this.editor;
    this.root.innerHTML = '';
    const brand = document.createElement('div');
    brand.className = 'brand';
    brand.innerHTML = 'Noggit <span>◆ Diamond</span>';
    this.root.appendChild(brand);

    this.root.appendChild(
      this.menu('File', [
        { label: 'New Map…', shortcut: 'N', action: () => this.newMapDialog() },
        { label: 'Open ADT / WDT…', shortcut: 'O', action: () => this.openFiles() },
        { separator: true, label: '' },
        { label: 'Save Current Tile', shortcut: 'Ctrl+S', action: () => this.saveCurrent() },
        { label: 'Save All (+ WDT & WDL)', action: () => this.saveAllTiles() },
      ]),
    );
    this.root.appendChild(
      this.menu('Edit', [
        { label: 'Undo', shortcut: 'Ctrl+Z', action: () => this.editor.undo() },
        { label: 'Redo', shortcut: 'Ctrl+Y', action: () => this.editor.redo() },
        { separator: true, label: '' },
        { label: 'Prune empty texture layers', action: () => this.prune() },
        { label: 'Clear all holes (current tile)', action: () => this.clearHoles() },
        { label: 'Recompute all normals', action: () => this.recomputeAll() },
      ]),
    );
    this.root.appendChild(
      this.menu('Terrain', [
        { label: 'Generate Procedural…', shortcut: 'G', action: () => this.generateDialog() },
        { separator: true, label: '' },
        { label: 'Import heightmap onto tile…', action: () => this.importHeightmapDialog() },
        { label: 'Export heightmap (16-bit PGM)', action: () => this.exportHeights('pgm') },
        { label: 'Export heightmap (PNG)', action: () => this.exportHeights('png') },
      ]),
    );
    this.root.appendChild(
      this.menu('View', [
        { label: 'Toggle wireframe', action: () => this.toggleWireframe() },
        { label: 'Toggle area-id overlay', action: () => this.toggleOverlay('areas') },
        { label: 'Toggle impassable overlay', action: () => this.toggleOverlay('impass') },
        { label: 'Toggle baked shadows', action: () => this.toggleOverlay('shadows') },
        { separator: true, label: '' },
        { label: 'Jump to map center', action: () => this.jumpCenter() },
      ]),
    );
    this.root.appendChild(
      this.menu('Help', [
        {
          label: 'Controls & shortcuts',
          action: () =>
            showModal(
              'Controls',
              [],
              'Close',
              `<b>Camera</b>: RMB-drag look · WASD fly · Q/E down/up · Shift boost · wheel speed<br/>
               <b>Tools</b>: keys 1–0 · Ctrl inverts (lower / erase / drain / fill)<br/>
               <b>Undo</b>: Ctrl+Z / Ctrl+Y · <b>Console</b>: backtick (\`)<br/>
               <b>Objects</b>: click select · drag move · R rotate 15° · Delete removes<br/><br/>
               Drop .adt files (plus the map .wdt for correct alpha format) into the viewport.`,
            ),
        },
        {
          label: 'About Noggit Diamond',
          action: () =>
            showModal(
              'Noggit Diamond 1.0',
              [],
              'Close',
              `A from-scratch, browser-based reimagining of the classic Noggit
               map editor for World of Warcraft 3.3.5a (WotLK).<br/><br/>
               Edits real ADT terrain files: sculpting, texture & vertex-color
               painting, water, holes, areas, objects, procedural generation,
               heightmap round-tripping, WDT/WDL regeneration — with full undo.`,
            ),
        },
      ]),
    );

    const spacer = document.createElement('div');
    spacer.className = 'spacer';
    this.root.appendChild(spacer);

    this.undoBtn = document.createElement('button');
    this.undoBtn.textContent = '↩ Undo';
    this.undoBtn.addEventListener('click', () => this.editor.undo());
    this.redoBtn = document.createElement('button');
    this.redoBtn.textContent = '↪ Redo';
    this.redoBtn.addEventListener('click', () => this.editor.redo());
    this.root.append(this.undoBtn, this.redoBtn);

    const hint = document.createElement('span');
    hint.className = 'kbd-hint';
    hint.textContent = '` console';
    this.root.appendChild(hint);

    document.addEventListener('click', () => {
      document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
    });
    this.refresh();
  }

  private refresh(): void {
    this.undoBtn.disabled = !this.editor.history.canUndo;
    this.redoBtn.disabled = !this.editor.history.canRedo;
  }

  // ---- Actions ----

  async newMapDialog(): Promise<void> {
    const res = await showModal('New Map', [
      { key: 'name', label: 'Map name', type: 'text', value: this.editor.mapName },
      { key: 'tileX', label: 'Tile X (0–63)', type: 'number', value: 32, min: 0, max: 63 },
      { key: 'tileY', label: 'Tile Y (0–63)', type: 'number', value: 32, min: 0, max: 63 },
      { key: 'size', label: 'Tiles (NxN)', type: 'number', value: 1, min: 1, max: 4 },
      { key: 'height', label: 'Base height', type: 'number', value: 0 },
      { key: 'areaId', label: 'Area id', type: 'number', value: 1, min: 0 },
      { key: 'bigAlpha', label: 'Big alpha (8-bit)', type: 'checkbox', value: this.editor.bigAlpha },
      {
        key: 'style', label: 'Terrain', type: 'select', value: 'flat',
        options: [
          { value: 'flat', label: 'Flat' },
          { value: 'rolling', label: 'Procedural: rolling hills' },
          { value: 'ridged', label: 'Procedural: ridged mountains' },
          { value: 'islands', label: 'Procedural: islands' },
        ],
      },
      { key: 'seed', label: 'Seed', type: 'number', value: 1337 },
    ]);
    if (!res) return;
    const name = String(res.name || 'NewMap').replace(/[^\w-]/g, '_');
    this.editor.mapName = name;
    this.editor.bigAlpha = Boolean(res.bigAlpha);
    if (this.editor.bigAlpha) this.editor.wdt.flags |= MPHD_FLAGS.ADT_HAS_BIG_ALPHA;
    const n = Math.max(1, Math.min(4, Number(res.size)));
    const baseX = Math.min(63 - (n - 1), Math.max(0, Number(res.tileX)));
    const baseY = Math.min(63 - (n - 1), Math.max(0, Number(res.tileY)));
    let focus: { x: number; z: number } | null = null;
    for (let dy = 0; dy < n; dy++) {
      for (let dx = 0; dx < n; dx++) {
        const doc = createBlankAdt(name, baseX + dx, baseY + dy, {
          baseHeight: Number(res.height),
          textures: ['Tileset\\Generic\\Grass.blp'],
          areaId: Number(res.areaId),
          bigAlpha: this.editor.bigAlpha,
        });
        if (res.style !== 'flat') {
          generateTerrain(doc, {
            ...defaultProceduralParams(Number(res.seed)),
            style: res.style as ProceduralStyle,
            baseHeight: Number(res.height),
          });
        }
        this.editor.addTile(doc);
        if (!focus) {
          focus = { x: (doc.tileX + 0.5) * TILE_SIZE, z: (doc.tileY + 0.5) * TILE_SIZE };
        }
      }
    }
    recomputeNormals(this.editor.terrain);
    if (focus) {
      const y = this.editor.terrain.heightAt(focus.x, focus.z) ?? Number(res.height);
      this.camera.focusOn(focus.x, y, focus.z, 260);
    }
    this.editor.history.clear();
    toast(`Created ${n * n} tile(s) for ${name}`);
  }

  openFiles(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.adt,.wdt,image/*';
    input.addEventListener('change', async () => {
      if (input.files) await this.handleFiles(input.files);
    });
    input.click();
  }

  async handleFiles(files: FileList | File[]): Promise<void> {
    const report = await loadFiles(this.editor, files);
    if (report.loadedTiles.length > 0) {
      const doc = this.editor.docs[0];
      const cx = (doc.tileX + 0.5) * TILE_SIZE;
      const cz = (doc.tileY + 0.5) * TILE_SIZE;
      const y = this.editor.terrain.heightAt(cx, cz) ?? 50;
      this.camera.focusOn(cx, y, cz, 320);
      toast(`Loaded ${report.loadedTiles.length} tile(s)${report.loadedWdt ? ' + WDT' : ''}`);
    }
    for (const err of report.errors) toast(err, true);
  }

  private currentTile(): ReturnType<Editor['docs']['find']> {
    // Tile under the camera cursor, else the first loaded.
    const at = this.editor.terrain.chunkAtPoint(this.editor.cursor.x, this.editor.cursor.z);
    return at?.doc ?? this.editor.docs[0];
  }

  saveCurrent(): void {
    const doc = this.currentTile();
    if (!doc) {
      toast('Nothing to save yet', true);
      return;
    }
    saveTile(this.editor, doc);
    toast(`Saved ${doc.mapName}_${doc.tileX}_${doc.tileY}.adt`);
  }

  saveAllTiles(): void {
    const { files } = saveAll(this.editor);
    if (files === 0) toast('Nothing to save yet', true);
    else toast(`Saved ${files} file(s) — check your downloads`);
  }

  private prune(): void {
    let total = 0;
    for (const doc of this.editor.docs) {
      total += pruneEmptyLayers(doc);
      this.editor.terrain.markTileDirty(doc);
    }
    toast(`Removed ${total} empty layer(s)`);
  }

  private clearHoles(): void {
    const doc = this.currentTile();
    if (!doc) return;
    clearAllHoles(doc);
    this.editor.terrain.markTileDirty(doc);
    toast('All holes cleared');
  }

  private recomputeAll(): void {
    recomputeNormals(this.editor.terrain);
    toast('Normals recomputed');
  }

  async generateDialog(): Promise<void> {
    const doc = this.currentTile();
    if (!doc) {
      toast('Create or load a tile first', true);
      return;
    }
    const res = await showModal(
      `Generate terrain — tile ${doc.tileX},${doc.tileY}`,
      [
        {
          key: 'style', label: 'Style', type: 'select', value: 'rolling',
          options: [
            { value: 'rolling', label: 'Rolling hills' },
            { value: 'ridged', label: 'Ridged mountains' },
            { value: 'islands', label: 'Islands' },
          ],
        },
        { key: 'seed', label: 'Seed', type: 'number', value: Math.floor(Math.random() * 100000) },
        { key: 'amplitude', label: 'Amplitude (yd)', type: 'number', value: 60 },
        { key: 'frequency', label: 'Frequency', type: 'number', value: 0.003, step: 0.0005 },
        { key: 'octaves', label: 'Octaves', type: 'number', value: 5, min: 1, max: 8 },
        { key: 'base', label: 'Base height', type: 'number', value: 0 },
        { key: 'allTiles', label: 'Apply to all loaded tiles', type: 'checkbox', value: true },
      ],
      'Generate',
      'Generation is seed-deterministic and seamless across tiles. This replaces terrain heights (undoable is <b>not</b> supported for whole-tile generation — save first if unsure).',
    );
    if (!res) return;
    const params = {
      ...defaultProceduralParams(Number(res.seed)),
      style: res.style as ProceduralStyle,
      amplitude: Number(res.amplitude),
      frequency: Number(res.frequency),
      octaves: Number(res.octaves),
      baseHeight: Number(res.base),
    };
    const targets = res.allTiles ? this.editor.docs : [doc];
    for (const d of targets) {
      generateTerrain(d, params);
      this.editor.terrain.markTileDirty(d);
    }
    recomputeNormals(this.editor.terrain);
    this.editor.history.clear();
    toast(`Generated ${targets.length} tile(s) with seed ${params.seed}`);
  }

  private async importHeightmapDialog(): Promise<void> {
    const doc = this.currentTile();
    if (!doc) {
      toast('Create or load a tile first', true);
      return;
    }
    const res = await showModal(
      `Import heightmap — tile ${doc.tileX},${doc.tileY}`,
      [
        { key: 'file', label: 'Image / PGM', type: 'file', accept: '.pgm,image/*' },
        { key: 'min', label: 'Min height', type: 'number', value: 0 },
        { key: 'max', label: 'Max height', type: 'number', value: 100 },
      ],
      'Import',
      'Grayscale is mapped linearly between the two heights. 16-bit PGM (from Export) round-trips losslessly.',
    );
    if (!res || !(res.file instanceof File)) return;
    try {
      await importTileHeightmap(this.editor, doc, res.file, Number(res.min), Number(res.max));
      recomputeNormals(this.editor.terrain);
      this.editor.history.clear();
      toast('Heightmap imported');
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  private exportHeights(kind: 'pgm' | 'png'): void {
    const doc = this.currentTile();
    if (!doc) {
      toast('Nothing to export yet', true);
      return;
    }
    if (kind === 'pgm') exportTileHeightmapPgm(this.editor, doc);
    else void exportTileHeightmapPng(this.editor, doc);
    toast('Heightmap exported');
  }

  private toggleWireframe(): void {
    this.renderer.setWireframe(!this.renderer.overlays.wireframe);
  }

  private toggleOverlay(key: 'areas' | 'impass' | 'shadows'): void {
    this.renderer.overlays[key] = !this.renderer.overlays[key];
    this.renderer.repaintAll();
    toast(`${key} overlay ${this.renderer.overlays[key] ? 'on' : 'off'}`);
  }

  private jumpCenter(): void {
    const doc = this.editor.docs[0];
    if (!doc) return;
    const cx = (doc.tileX + 0.5) * TILE_SIZE;
    const cz = (doc.tileY + 0.5) * TILE_SIZE;
    this.camera.focusOn(cx, this.editor.terrain.heightAt(cx, cz) ?? 50, cz, 300);
  }
}
