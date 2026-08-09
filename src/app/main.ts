/**
 * Noggit Diamond application bootstrap.
 */

import { Editor } from './editor';
import { AppRenderer } from './renderer';
import { FlyCamera, isTypingTarget } from './camera';
import { Topbar } from './ui/topbar';
import { Sidebar } from './ui/sidebar';
import { Toolbar, StatusBar, Minimap, ScriptConsole } from './ui/chrome';
import { strokeBegin, strokeStep, TOOLS } from './tools';
import type { Transaction } from '../lib/edit/history';
import { raiseLower, flattenTo, smoothHeights } from '../lib/edit/sculpt';
import { paintTexture } from '../lib/edit/texture';
import { paintWater, eraseWater } from '../lib/edit/water';
import { paintAreaId } from '../lib/edit/area';
import { recomputeNormals } from '../lib/edit/normals';
import { generateTerrain, defaultProceduralParams } from '../lib/gen/procedural';
import { toast } from './ui/modal';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const viewport = document.getElementById('viewport')!;
const dropHint = document.getElementById('drop-hint')!;

const editor = new Editor();
const fly = new FlyCamera(canvas);
const renderer = new AppRenderer(editor, canvas);
const topbar = new Topbar(editor, renderer, fly);
new Toolbar(editor);
new Sidebar(editor);
const statusBar = new StatusBar(editor);
const minimap = new Minimap(editor, fly);

// ---- Scripting API (`nd`) ----

const nd = {
  editor,
  terrain: editor.terrain,
  get cursor() {
    return editor.cursor;
  },
  get tiles() {
    return editor.docs;
  },
  raise: (x: number, z: number, radius: number, inner: number, shape: string, amount: number) => {
    raiseLower(editor.terrain, x, z, radius, inner, shape as never, amount);
    recomputeNormals(editor.terrain);
    return `raised at ${x.toFixed(1)},${z.toFixed(1)}`;
  },
  flatten: (x: number, z: number, radius: number, height: number, strength = 1) => {
    flattenTo(editor.terrain, x, z, radius, radius * 0.5, 'smooth', height, strength);
    recomputeNormals(editor.terrain);
    return 'flattened';
  },
  smooth: (x: number, z: number, radius: number, strength = 0.5) => {
    smoothHeights(editor.terrain, x, z, radius, 0, 'smooth', strength);
    recomputeNormals(editor.terrain);
    return 'smoothed';
  },
  paint: (x: number, z: number, radius: number, texture: string, opacity = 255) => {
    return paintTexture(editor.terrain, x, z, radius, radius * 0.5, 'smooth', 1, opacity, texture);
  },
  water: (x: number, z: number, radius: number, typeId = 5, level = 0) =>
    `flooded ${paintWater(editor.terrain, x, z, radius, { typeId, level })} chunk(s)`,
  drain: (x: number, z: number, radius: number) =>
    `drained ${eraseWater(editor.terrain, x, z, radius)} chunk(s)`,
  area: (x: number, z: number, radius: number, areaId: number) =>
    `set area on ${paintAreaId(editor.terrain, x, z, radius, areaId)} chunk(s)`,
  generate: (seed = 1337, style: 'rolling' | 'ridged' | 'islands' = 'rolling', amplitude = 60) => {
    for (const doc of editor.docs) {
      generateTerrain(doc, { ...defaultProceduralParams(seed), style, amplitude });
      editor.terrain.markTileDirty(doc);
    }
    recomputeNormals(editor.terrain);
    return `generated ${editor.docs.length} tile(s)`;
  },
  heightAt: (x: number, z: number) => editor.terrain.heightAt(x, z),
  help: () =>
    [
      'nd.cursor — {x, z, y} under the mouse',
      "nd.raise(x, z, radius, inner, 'smooth', amount)",
      'nd.flatten(x, z, radius, height, strength?)',
      'nd.smooth(x, z, radius, strength?)',
      "nd.paint(x, z, radius, 'Tileset\\\\...blp', opacity?)",
      'nd.water(x, z, radius, typeId?, level?) / nd.drain(x, z, radius)',
      'nd.area(x, z, radius, areaId)',
      "nd.generate(seed?, 'rolling'|'ridged'|'islands', amplitude?)",
      'nd.heightAt(x, z) · nd.tiles · nd.terrain · nd.editor',
    ].join('\n'),
};
const scriptConsole = new ScriptConsole(nd as unknown as Record<string, unknown>);

// ---- Pointer input: strokes + object interaction ----

let stroke: { tx: Transaction | null; lastTime: number } | null = null;
let draggingObject = false;

function ndcFromEvent(e: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
    y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
  };
}

function updateCursor(e: PointerEvent): void {
  const ndcPos = ndcFromEvent(e);
  const hit = renderer.pickTerrain(ndcPos.x, ndcPos.y, fly.camera);
  if (hit) {
    editor.cursor.x = hit.x;
    editor.cursor.z = hit.z;
    editor.cursor.y = hit.y;
    editor.cursor.valid = true;
  } else {
    editor.cursor.valid = false;
  }
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  updateCursor(e);
  if (editor.activeTool === 'objects') {
    const ndcPos = ndcFromEvent(e);
    const picked = renderer.pickObject(ndcPos.x, ndcPos.y, fly.camera);
    editor.selection = picked;
    editor.emit('selection');
    renderer.refreshObjects();
    draggingObject = picked !== null;
    if (draggingObject) canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (editor.activeTool === 'navigate' || !editor.cursor.valid) return;
  canvas.setPointerCapture(e.pointerId);
  const p = {
    x: editor.cursor.x,
    y: editor.cursor.y,
    z: editor.cursor.z,
    inverted: e.ctrlKey || e.metaKey,
    dt: 0.016,
  };
  const tx = strokeBegin(editor, p);
  stroke = { tx, lastTime: performance.now() };
  if (tx) strokeStep(editor, tx, p);
});

canvas.addEventListener('pointermove', (e) => {
  updateCursor(e);
  if (draggingObject && editor.selection && editor.cursor.valid) {
    const sel = editor.selection;
    const p = sel.kind === 'doodad' ? sel.doc.doodads[sel.index] : sel.doc.wmos[sel.index];
    if (p) {
      const dy = p.position[1] - (editor.terrain.heightAt(p.position[0], p.position[2]) ?? p.position[1]);
      p.position[0] = editor.cursor.x;
      p.position[2] = editor.cursor.z;
      p.position[1] = editor.cursor.y + Math.max(0, dy);
      if (sel.kind === 'wmo') {
        // Drag the extents box along with the origin.
        const w = sel.doc.wmos[sel.index];
        const cx = (w.extentsMin[0] + w.extentsMax[0]) / 2;
        const cy = (w.extentsMin[1] + w.extentsMax[1]) / 2;
        const cz = (w.extentsMin[2] + w.extentsMax[2]) / 2;
        const dx = w.position[0] - cx;
        const dyc = w.position[1] - cy;
        const dz = w.position[2] - cz;
        for (const k of [0, 1, 2] as const) {
          const d = [dx, dyc, dz][k];
          w.extentsMin[k] += d;
          w.extentsMax[k] += d;
        }
      }
      renderer.refreshObjects();
    }
    return;
  }
  if (stroke?.tx && editor.cursor.valid) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - stroke.lastTime) / 1000);
    if (dt < 0.016) return; // ~60 Hz stroke rate
    stroke.lastTime = now;
    strokeStep(editor, stroke.tx, {
      x: editor.cursor.x,
      y: editor.cursor.y,
      z: editor.cursor.z,
      inverted: e.ctrlKey || e.metaKey,
      dt,
    });
  }
});

window.addEventListener('pointerup', (e) => {
  if (e.button !== 0) return;
  if (draggingObject) {
    draggingObject = false;
    return;
  }
  if (stroke) {
    editor.endStroke();
    stroke = null;
  }
});

// ---- Keyboard shortcuts ----

window.addEventListener('keydown', (e) => {
  if (isTypingTarget(e.target)) return;
  if (e.key === '`') {
    e.preventDefault();
    scriptConsole.toggle();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
    e.preventDefault();
    if (e.shiftKey) editor.redo();
    else editor.undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
    e.preventDefault();
    editor.redo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
    e.preventDefault();
    topbar.saveCurrent();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tool = TOOLS.find((t) => t.key === e.key);
  if (tool) {
    editor.setTool(tool.id);
    return;
  }
  if (e.code === 'KeyN') void topbar.newMapDialog();
  if (e.code === 'KeyO') topbar.openFiles();
  if (e.code === 'KeyG') void topbar.generateDialog();
  if (e.code === 'KeyR' && editor.selection) {
    const sel = editor.selection;
    const p = sel.kind === 'doodad' ? sel.doc.doodads[sel.index] : sel.doc.wmos[sel.index];
    if (p) {
      p.rotation[1] = (p.rotation[1] + 15) % 360;
      renderer.refreshObjects();
      editor.emit('selection');
    }
  }
  if ((e.code === 'Delete' || e.code === 'Backspace') && editor.selection) {
    const sel = editor.selection;
    if (sel.kind === 'doodad') sel.doc.doodads.splice(sel.index, 1);
    else sel.doc.wmos.splice(sel.index, 1);
    for (const chunk of sel.doc.chunks) {
      const refs = sel.kind === 'doodad' ? chunk.doodadRefs : chunk.wmoRefs;
      const fixed = refs.filter((r) => r !== sel.index).map((r) => (r > sel.index ? r - 1 : r));
      if (sel.kind === 'doodad') chunk.doodadRefs = fixed;
      else chunk.wmoRefs = fixed;
    }
    editor.selection = null;
    editor.emit('selection');
    renderer.refreshObjects();
    toast('Object deleted');
  }
});

// ---- Drag & drop loading ----

viewport.addEventListener('dragover', (e) => {
  e.preventDefault();
  viewport.classList.add('dragover');
});
viewport.addEventListener('dragleave', () => viewport.classList.remove('dragover'));
viewport.addEventListener('drop', async (e) => {
  e.preventDefault();
  viewport.classList.remove('dragover');
  if (e.dataTransfer?.files.length) {
    await topbar.handleFiles(e.dataTransfer.files);
  }
});

editor.on('tiles', () => {
  dropHint.classList.toggle('hidden', editor.tileCount > 0);
});

// ---- Resize ----

function resize(): void {
  const rect = viewport.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  renderer.resize(w, h);
  fly.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

// ---- Main loop ----

let lastFrame = performance.now();
let fpsAccum = 0;
let fpsFrames = 0;
let fps = 60;
let minimapTimer = 0;

function frame(): void {
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  fpsAccum += dt;
  fpsFrames++;
  if (fpsAccum >= 0.5) {
    fps = fpsFrames / fpsAccum;
    fpsAccum = 0;
    fpsFrames = 0;
  }

  fly.update(dt);
  renderer.sync();

  // Brush cursor.
  const showBrush =
    editor.cursor.valid && editor.activeTool !== 'navigate' && editor.activeTool !== 'objects';
  renderer.setBrush(
    showBrush,
    editor.cursor.x,
    editor.cursor.y,
    editor.cursor.z,
    editor.settings.radius,
    editor.settings.radius * editor.settings.innerRatio,
  );

  renderer.render(fly.camera);
  statusBar.update(fps);
  minimapTimer += dt;
  if (minimapTimer > 0.25) {
    minimapTimer = 0;
    minimap.draw();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Expose for the curious (and for e2e checks).
(window as unknown as { nd: typeof nd }).nd = nd;
