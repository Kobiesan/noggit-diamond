/**
 * Editor — central application state shared by tools, UI and renderer.
 */

import { Terrain, chunkKey, type ChunkRef } from '../lib/world/terrain';
import { History, chunkCapture } from '../lib/edit/history';
import { recomputeNormals } from '../lib/edit/normals';
import type { AdtDoc, WdtDoc } from '../lib/adt/types';
import { createWdt, wdtSetTile } from '../lib/wdt/wdt';
import { MPHD_FLAGS } from '../lib/constants';
import type { BrushShape } from '../lib/edit/brush';
import { TextureRegistry } from './textures';

/** Identifiers of the editor tools (toolbar order). */
export type ToolId =
  | 'navigate'
  | 'raise'
  | 'flatten'
  | 'smooth'
  | 'texture'
  | 'color'
  | 'water'
  | 'holes'
  | 'area'
  | 'objects';

/** Brush + tool parameters, mutated directly by the sidebar UI. */
export interface ToolSettings {
  radius: number;
  innerRatio: number; // innerRadius = radius * innerRatio
  shape: BrushShape;
  amount: number; // raise/lower speed (yards/sec at full falloff)
  strength: number; // 0..1 for flatten/smooth/paint
  opacity: number; // 0..255 texture paint target
  flattenMode: 'both' | 'raise' | 'lower';
  flattenLock: boolean;
  flattenHeight: number;
  color: [number, number, number];
  waterType: number;
  waterLevel: number;
  waterLevelRelative: boolean;
  areaId: number;
  impassable: boolean;
}

/** A doodad or WMO selection. */
export interface ObjectSelection {
  kind: 'doodad' | 'wmo';
  doc: AdtDoc;
  index: number;
}

type Listener = () => void;

export class Editor {
  readonly terrain = new Terrain();
  readonly history = new History(200);
  readonly textures = new TextureRegistry();

  wdt: WdtDoc = createWdt();
  mapName = 'NewMap';
  bigAlpha = false;

  activeTool: ToolId = 'navigate';
  selectedTexture = 'Tileset\\Generic\\Grass.blp';
  selection: ObjectSelection | null = null;

  /** Last terrain point under the mouse (map coords), for status/console. */
  cursor = { x: 0, z: 0, y: 0, valid: false };

  settings: ToolSettings = {
    radius: 25,
    innerRatio: 0.4,
    shape: 'smooth',
    amount: 20,
    strength: 0.5,
    opacity: 255,
    flattenMode: 'both',
    flattenLock: false,
    flattenHeight: 0,
    color: [180, 140, 100],
    waterType: 5,
    waterLevel: 0,
    waterLevelRelative: true,
    areaId: 1,
    impassable: false,
  };

  private listeners = new Map<string, Set<Listener>>();
  /** Chunk keys touched during the current stroke (for normals pass). */
  strokeTouched = new Set<string>();

  /** Subscribe to a named event ('tiles' | 'tool' | 'selection' | 'history' | 'textures'). */
  on(event: string, fn: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit(event: string): void {
    this.listeners.get(event)?.forEach((fn) => fn());
  }

  setTool(tool: ToolId): void {
    if (this.activeTool === tool) return;
    this.activeTool = tool;
    this.emit('tool');
  }

  /** Add a tile to the world (and the WDT index). */
  addTile(doc: AdtDoc): void {
    doc.bigAlpha = this.bigAlpha;
    this.mapName = doc.mapName || this.mapName;
    this.terrain.addTile(doc);
    wdtSetTile(this.wdt, doc.tileX, doc.tileY, true);
    if (this.bigAlpha) this.wdt.flags |= MPHD_FLAGS.ADT_HAS_BIG_ALPHA;
    // Seed the texture registry so palettes show everything in use.
    for (const path of doc.textures) this.textures.get(path);
    this.emit('tiles');
  }

  get tileCount(): number {
    return this.terrain.tiles.size;
  }

  /** Capture chunks into the open transaction before a brush step. */
  captureChunks(refs: Iterable<ChunkRef>, tx: ReturnType<History['begin']>): void {
    for (const ref of refs) {
      const cap = chunkCapture(this.terrain, ref);
      tx.capture(ref.key, cap.take, cap.restore);
      this.strokeTouched.add(ref.key);
    }
  }

  /** Capture every chunk within radius of a point (plus the point's own). */
  captureRadius(mx: number, mz: number, radius: number, tx: ReturnType<History['begin']>): void {
    this.captureChunks(this.terrain.chunksInRadius(mx, mz, radius + 1), tx);
  }

  /** Finish a stroke: recompute normals for touched chunks + neighbors. */
  endStroke(): void {
    if (this.strokeTouched.size > 0) {
      const expanded = new Set<string>(this.strokeTouched);
      for (const key of this.strokeTouched) {
        const [tx, ty, idx] = key.split('_').map(Number);
        const ref = this.terrain.chunkAt(tx, ty, idx);
        if (!ref) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const n = this.terrain.neighborChunk(ref, dx, dz);
          if (n) expanded.add(n.key);
        }
      }
      recomputeNormals(this.terrain, expanded);
      this.strokeTouched.clear();
    }
    this.history.commit();
    this.emit('history');
  }

  undo(): string | null {
    const label = this.history.undo();
    this.emit('history');
    return label;
  }

  redo(): string | null {
    const label = this.history.redo();
    this.emit('history');
    return label;
  }

  /** All loaded docs, sorted by tile coords. */
  get docs(): AdtDoc[] {
    return [...this.terrain.tiles.values()].sort(
      (a, b) => a.tileY - b.tileY || a.tileX - b.tileX,
    );
  }

  /** Key helper re-exported for tools. */
  chunkKeyOf(doc: AdtDoc, index: number): string {
    return chunkKey(doc.tileX, doc.tileY, index);
  }
}
