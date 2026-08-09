/**
 * Undo/redo: transaction-scoped snapshots keyed by arbitrary strings
 * (chunk keys in practice). A drag gesture is one transaction.
 */

import type { AdtDoc, McnkChunk, TextureLayer, WaterChunk } from '../adt/types';
import type { ChunkRef, Terrain } from '../world/terrain';

interface Capture {
  key: string;
  before: unknown;
  after: unknown;
  restore: (state: unknown) => void;
}

/** One undoable step (a completed transaction). */
export interface HistoryEntry {
  label: string;
  captures: Capture[];
}

/** An in-progress edit gesture. */
export class Transaction {
  private captures = new Map<string, Capture>();
  private takers = new Map<string, () => unknown>();

  constructor(readonly label: string) {}

  /**
   * Record `key`'s state before the first mutation. Subsequent captures
   * for the same key within this transaction are no-ops.
   */
  capture(key: string, take: () => unknown, restore: (state: unknown) => void): void {
    if (this.captures.has(key)) return;
    this.captures.set(key, { key, before: take(), after: undefined, restore });
    this.takers.set(key, take);
  }

  /** Finalize after-states; returns null when nothing was captured. */
  seal(): HistoryEntry | null {
    if (this.captures.size === 0) return null;
    const captures = [...this.captures.values()];
    for (const c of captures) {
      c.after = this.takers.get(c.key)!();
    }
    return { label: this.label, captures };
  }
}

/** Undo/redo stack with a bounded length. */
export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private open: Transaction | null = null;
  /** Notified after any change to the stacks. */
  onChange: (() => void) | null = null;

  constructor(private limit = 100) {}

  /** Start a transaction, committing any still-open one first. */
  begin(label: string): Transaction {
    if (this.open) this.commit();
    this.open = new Transaction(label);
    return this.open;
  }

  /** Commit the open transaction (no-op when none or empty). */
  commit(): void {
    const entry = this.open?.seal() ?? null;
    this.open = null;
    if (!entry) return;
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onChange?.();
  }

  /** Abandon the open transaction, restoring before-states. */
  rollback(): void {
    const entry = this.open?.seal() ?? null;
    this.open = null;
    if (!entry) return;
    for (let i = entry.captures.length - 1; i >= 0; i--) {
      entry.captures[i].restore(entry.captures[i].before);
    }
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Number of entries available to undo. */
  get depth(): number {
    return this.undoStack.length;
  }

  /** Undo the last entry; returns its label or null. */
  undo(): string | null {
    if (this.open) this.commit();
    const entry = this.undoStack.pop();
    if (!entry) return null;
    for (let i = entry.captures.length - 1; i >= 0; i--) {
      entry.captures[i].restore(entry.captures[i].before);
    }
    this.redoStack.push(entry);
    this.onChange?.();
    return entry.label;
  }

  /** Redo the last undone entry; returns its label or null. */
  redo(): string | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    for (const c of entry.captures) c.restore(c.after);
    this.undoStack.push(entry);
    this.onChange?.();
    return entry.label;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.open = null;
    this.onChange?.();
  }
}

/** Deep copy of the editable state of a chunk (plus its water cell). */
interface ChunkState {
  heights: Float64Array;
  normals: Int8Array;
  vertexColors: Uint8Array | null;
  layers: TextureLayer[];
  shadowMap: Uint8Array | null;
  holes: number;
  areaId: number;
  flags: number;
  water: WaterChunk | null;
  textures: string[];
}

function snapshotChunk(doc: AdtDoc, chunk: McnkChunk, index: number): ChunkState {
  return {
    heights: chunk.heights.slice(),
    normals: chunk.normals.slice(),
    vertexColors: chunk.vertexColors ? chunk.vertexColors.slice() : null,
    layers: chunk.layers.map((l) => ({
      textureId: l.textureId,
      flags: l.flags,
      effectId: l.effectId,
      alpha: l.alpha ? l.alpha.slice() : null,
    })),
    shadowMap: chunk.shadowMap ? chunk.shadowMap.slice() : null,
    holes: chunk.holes,
    areaId: chunk.areaId,
    flags: chunk.flags,
    water: doc.water?.[index] ? structuredCloneWater(doc.water[index]!) : null,
    textures: [...doc.textures],
  };
}

function structuredCloneWater(cell: WaterChunk): WaterChunk {
  return {
    instances: cell.instances.map((i) => ({
      ...i,
      existsBitmap: i.existsBitmap ? i.existsBitmap.slice() : null,
      heightMap: i.heightMap ? i.heightMap.slice() : null,
      depthMap: i.depthMap ? i.depthMap.slice() : null,
      uvMap: i.uvMap ? i.uvMap.slice() : null,
    })),
    attributes: cell.attributes ? { ...cell.attributes } : null,
  };
}

/**
 * take/restore pair for a chunk, suitable for Transaction.capture with
 * the chunk's key. Restore writes state back onto the live objects and
 * marks the chunk dirty.
 */
export function chunkCapture(
  terrain: Terrain,
  ref: ChunkRef,
): { take: () => unknown; restore: (state: unknown) => void } {
  const { doc, chunk, index } = ref;
  return {
    take: () => snapshotChunk(doc, chunk, index),
    restore: (raw: unknown) => {
      const state = raw as ChunkState;
      chunk.heights.set(state.heights);
      chunk.normals.set(state.normals);
      chunk.vertexColors = state.vertexColors ? state.vertexColors.slice() : null;
      chunk.layers = state.layers.map((l) => ({
        textureId: l.textureId,
        flags: l.flags,
        effectId: l.effectId,
        alpha: l.alpha ? l.alpha.slice() : null,
      }));
      chunk.shadowMap = state.shadowMap ? state.shadowMap.slice() : null;
      chunk.holes = state.holes;
      chunk.areaId = state.areaId;
      chunk.flags = state.flags;
      doc.textures = [...state.textures];
      if (state.water) {
        if (!doc.water) doc.water = new Array<WaterChunk | null>(256).fill(null);
        doc.water[index] = structuredCloneWater(state.water);
      } else if (doc.water) {
        doc.water[index] = null;
        if (doc.water.every((c) => c === null)) doc.water = null;
      }
      terrain.markDirty(ref);
    },
  };
}
