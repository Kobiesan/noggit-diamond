/**
 * Editor tools: translate pointer strokes into editing-library calls
 * with undo capture. One stroke (pointerdown..pointerup) = one history
 * transaction.
 */

import type { Editor, ToolId } from './editor';
import type { Transaction } from '../lib/edit/history';
import { raiseLower, flattenTo, smoothHeights } from '../lib/edit/sculpt';
import { paintTexture } from '../lib/edit/texture';
import { paintVertexColor } from '../lib/edit/vertexcolor';
import { paintWater, eraseWater, getWaterLevel } from '../lib/edit/water';
import { setHoleAtPoint } from '../lib/edit/holes';
import { paintAreaId, setImpassable } from '../lib/edit/area';

/** Pointer stroke context passed to tools. */
export interface StrokePoint {
  x: number;
  y: number;
  z: number;
  /** Modifier: ctrl inverts most tools (lower/erase/fill). */
  inverted: boolean;
  /** Seconds since the previous stroke step. */
  dt: number;
}

export interface ToolInfo {
  id: ToolId;
  name: string;
  icon: string;
  key: string;
  hint: string;
}

/** Toolbar metadata, in display order. */
export const TOOLS: ToolInfo[] = [
  { id: 'navigate', name: 'Navigate', icon: '🖐', key: '1', hint: 'RMB look · WASD fly · wheel speed' },
  { id: 'raise', name: 'Raise / Lower', icon: '⛰', key: '2', hint: 'LMB raise · Ctrl+LMB lower' },
  { id: 'flatten', name: 'Flatten', icon: '▬', key: '3', hint: 'LMB flatten to first-hit height (or locked height)' },
  { id: 'smooth', name: 'Smooth', icon: '〰', key: '4', hint: 'LMB blur terrain' },
  { id: 'texture', name: 'Texture Paint', icon: '🖌', key: '5', hint: 'LMB paint selected texture · Ctrl+LMB erase' },
  { id: 'color', name: 'Vertex Color', icon: '🎨', key: '6', hint: 'LMB tint · Ctrl+LMB restore neutral' },
  { id: 'water', name: 'Water', icon: '💧', key: '7', hint: 'LMB add water · Ctrl+LMB remove' },
  { id: 'holes', name: 'Holes', icon: '⬚', key: '8', hint: 'LMB punch hole · Ctrl+LMB fill' },
  { id: 'area', name: 'Area / Flags', icon: '🚩', key: '9', hint: 'LMB paint area id (or impassable flag)' },
  { id: 'objects', name: 'Objects', icon: '📦', key: '0', hint: 'LMB select · drag move · Del delete · R rotate' },
];

/** Runtime state for the flatten tool's "first hit" target height. */
let flattenTarget: number | null = null;

/** Called on stroke start; may capture state that lasts for the stroke. */
export function strokeBegin(editor: Editor, p: StrokePoint): Transaction | null {
  const tool = editor.activeTool;
  if (tool === 'navigate' || tool === 'objects') return null;
  const tx = editor.history.begin(TOOLS.find((t) => t.id === tool)?.name ?? tool);
  flattenTarget = editor.settings.flattenLock ? editor.settings.flattenHeight : p.y;
  return tx;
}

/** Called on every stroke step (including the first). */
export function strokeStep(editor: Editor, tx: Transaction, p: StrokePoint): void {
  const s = editor.settings;
  const inner = s.radius * s.innerRatio;
  const t = editor.terrain;
  switch (editor.activeTool) {
    case 'raise': {
      editor.captureRadius(p.x, p.z, s.radius, tx);
      const amount = s.amount * Math.max(p.dt, 0.016) * (p.inverted ? -1 : 1);
      raiseLower(t, p.x, p.z, s.radius, inner, s.shape, amount);
      break;
    }
    case 'flatten': {
      editor.captureRadius(p.x, p.z, s.radius, tx);
      const target = flattenTarget ?? p.y;
      const strength = Math.min(1, s.strength * Math.max(p.dt, 0.016) * 8);
      flattenTo(t, p.x, p.z, s.radius, inner, s.shape, target, strength, s.flattenMode);
      break;
    }
    case 'smooth': {
      editor.captureRadius(p.x, p.z, s.radius, tx);
      const strength = Math.min(1, s.strength * Math.max(p.dt, 0.016) * 8);
      smoothHeights(t, p.x, p.z, s.radius, inner, s.shape, strength);
      break;
    }
    case 'texture': {
      editor.captureRadius(p.x, p.z, s.radius, tx);
      const strength = Math.min(1, s.strength * Math.max(p.dt, 0.016) * 10);
      paintTexture(
        t, p.x, p.z, s.radius, inner, s.shape, strength,
        p.inverted ? 0 : s.opacity,
        editor.selectedTexture,
      );
      break;
    }
    case 'color': {
      editor.captureRadius(p.x, p.z, s.radius, tx);
      const strength = Math.min(1, s.strength * Math.max(p.dt, 0.016) * 8);
      paintVertexColor(
        t, p.x, p.z, s.radius, inner, s.shape, strength,
        p.inverted ? [127, 127, 127] : s.color,
      );
      break;
    }
    case 'water': {
      editor.captureRadius(p.x, p.z, s.radius, tx);
      if (p.inverted) {
        eraseWater(t, p.x, p.z, s.radius);
      } else {
        const level = s.waterLevelRelative ? p.y + s.waterLevel : s.waterLevel;
        // Keep an existing chunk's level if painting over it re-levels
        // unexpectedly? No: painting sets the chosen level, consistent.
        paintWater(t, p.x, p.z, s.radius, { typeId: s.waterType, level });
      }
      break;
    }
    case 'holes': {
      const ref = t.chunkAtPoint(p.x, p.z);
      if (ref) editor.captureChunks([ref], tx);
      setHoleAtPoint(t, p.x, p.z, !p.inverted);
      break;
    }
    case 'area': {
      editor.captureRadius(p.x, p.z, s.radius, tx);
      if (s.impassable) {
        setImpassable(t, p.x, p.z, s.radius, !p.inverted);
      } else {
        paintAreaId(t, p.x, p.z, s.radius, p.inverted ? 0 : s.areaId);
      }
      break;
    }
    default:
      break;
  }
}

/** Read the water level under the cursor into the settings (eyedropper). */
export function pickWaterLevel(editor: Editor): void {
  const ref = editor.terrain.chunkAtPoint(editor.cursor.x, editor.cursor.z);
  if (!ref) return;
  const level = getWaterLevel(ref.doc, ref.index);
  if (level !== null) {
    editor.settings.waterLevel = level;
    editor.settings.waterLevelRelative = false;
  }
}
