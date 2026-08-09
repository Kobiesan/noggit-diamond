/**
 * Toolbar (left), status bar (bottom), minimap and script console.
 */

import type { Editor, ToolId } from '../editor';
import type { FlyCamera } from '../camera';
import { TOOLS } from '../tools';
import { TILE_SIZE, CHUNKS_PER_TILE_SIDE } from '../../lib/constants';
import { mapToWorld } from '../../lib/coords';

export class Toolbar {
  constructor(private editor: Editor) {
    const root = document.getElementById('toolbar')!;
    for (const tool of TOOLS) {
      const btn = document.createElement('button');
      btn.innerHTML = `${tool.icon}<span class="num">${tool.key}</span>`;
      btn.title = `${tool.name} (${tool.key}) — ${tool.hint}`;
      btn.dataset.tool = tool.id;
      btn.addEventListener('click', () => editor.setTool(tool.id));
      root.appendChild(btn);
    }
    editor.on('tool', () => this.refresh());
    this.refresh();
  }

  private refresh(): void {
    document.querySelectorAll<HTMLButtonElement>('#toolbar button').forEach((b) => {
      b.classList.toggle('active', b.dataset.tool === this.editor.activeTool);
    });
  }
}

export class StatusBar {
  private root: HTMLElement;

  constructor(private editor: Editor) {
    this.root = document.getElementById('statusbar')!;
  }

  update(fps: number): void {
    const e = this.editor;
    const c = e.cursor;
    const tool = TOOLS.find((t) => t.id === e.activeTool);
    let pos = '—';
    let tile = '—';
    let area = '—';
    if (c.valid) {
      const world = mapToWorld(c.x, c.z);
      pos = `${c.x.toFixed(1)}, ${c.z.toFixed(1)} (h ${c.y.toFixed(1)}) · world ${world.x.toFixed(0)}, ${world.y.toFixed(0)}`;
      const ref = e.terrain.chunkAtPoint(c.x, c.z);
      if (ref) {
        tile = `${ref.doc.tileX},${ref.doc.tileY} · chunk ${ref.chunk.ix},${ref.chunk.iy}`;
        area = String(ref.chunk.areaId);
      }
    }
    this.root.innerHTML =
      `<span>Tool <b>${tool?.name ?? ''}</b></span>` +
      `<span>Pos <b>${pos}</b></span>` +
      `<span>Tile <b>${tile}</b></span>` +
      `<span>Area <b>${area}</b></span>` +
      `<span>Tiles <b>${e.tileCount}</b></span>` +
      `<span>Undo <b>${e.history.depth}</b></span>` +
      `<span style="margin-left:auto">${fps.toFixed(0)} fps</span>`;
  }
}

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(
    private editor: Editor,
    private camera: FlyCamera,
  ) {
    this.canvas = document.getElementById('minimap') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.canvas.addEventListener('click', (e) => this.teleport(e));
  }

  /** Bounds of loaded tiles (min/max tile indices), or null. */
  private bounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    let minX = 64, minY = 64, maxX = -1, maxY = -1;
    for (const doc of this.editor.terrain.tiles.values()) {
      minX = Math.min(minX, doc.tileX);
      minY = Math.min(minY, doc.tileY);
      maxX = Math.max(maxX, doc.tileX);
      maxY = Math.max(maxY, doc.tileY);
    }
    return maxX < 0 ? null : { minX, minY, maxX, maxY };
  }

  draw(): void {
    const { ctx, canvas } = this;
    ctx.fillStyle = '#0a0b0d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const b = this.bounds();
    if (!b) return;
    const span = Math.max(b.maxX - b.minX + 1, b.maxY - b.minY + 1);
    const pad = 8;
    const scale = (canvas.width - pad * 2) / span;
    // Tiles with a simple height shading.
    for (const doc of this.editor.terrain.tiles.values()) {
      const x0 = pad + (doc.tileX - b.minX) * scale;
      const y0 = pad + (doc.tileY - b.minY) * scale;
      const cs = scale / CHUNKS_PER_TILE_SIDE;
      for (const chunk of doc.chunks) {
        let min = Infinity;
        let max = -Infinity;
        // Sample sparse: corners + center of the 145 array.
        for (const vi of [0, 8, 72, 136, 144]) {
          const h = chunk.heights[vi];
          if (h < min) min = h;
          if (h > max) max = h;
        }
        const t = Math.max(0, Math.min(1, (max + 80) / 400));
        const g = Math.round(60 + t * 150);
        ctx.fillStyle = chunk.holes ? '#151517' : `rgb(${g * 0.55}, ${g * 0.8}, ${g * 0.5})`;
        const hasWater = doc.water?.[chunk.iy * 16 + chunk.ix];
        if (hasWater && hasWater.instances.length > 0) ctx.fillStyle = '#2e5f8e';
        ctx.fillRect(x0 + chunk.ix * cs, y0 + chunk.iy * cs, Math.ceil(cs), Math.ceil(cs));
      }
      ctx.strokeStyle = '#3a4048';
      ctx.strokeRect(x0, y0, scale, scale);
    }
    // Camera marker.
    const cam = this.camera.camera.position;
    const cx = pad + (cam.x / TILE_SIZE - b.minX) * scale;
    const cy = pad + (cam.z / TILE_SIZE - b.minY) * scale;
    ctx.fillStyle = '#ffd54f';
    ctx.beginPath();
    ctx.arc(cx, cy, 3.4, 0, Math.PI * 2);
    ctx.fill();
  }

  private teleport(e: MouseEvent): void {
    const b = this.bounds();
    if (!b) return;
    const span = Math.max(b.maxX - b.minX + 1, b.maxY - b.minY + 1);
    const pad = 8;
    const scale = (this.canvas.width - pad * 2) / span;
    const rect = this.canvas.getBoundingClientRect();
    const mx = ((e.clientX - rect.left - pad) / scale + b.minX) * TILE_SIZE;
    const mz = ((e.clientY - rect.top - pad) / scale + b.minY) * TILE_SIZE;
    const y = this.editor.terrain.heightAt(mx, mz) ?? 60;
    this.camera.focusOn(mx, y, mz, 180);
  }
}

/** The Diamond Script console: JavaScript with an `nd` API object. */
export class ScriptConsole {
  private wrap: HTMLElement;
  private out: HTMLElement;
  private input: HTMLTextAreaElement;

  constructor(private api: Record<string, unknown>) {
    this.wrap = document.getElementById('console-wrap')!;
    this.out = document.getElementById('console-out')!;
    this.input = document.getElementById('console-in') as HTMLTextAreaElement;
    document.getElementById('console-close')!.addEventListener('click', () => this.toggle(false));
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.run();
      }
    });
  }

  toggle(force?: boolean): void {
    const show = force ?? this.wrap.classList.contains('hidden');
    this.wrap.classList.toggle('hidden', !show);
    if (show) this.input.focus();
  }

  get visible(): boolean {
    return !this.wrap.classList.contains('hidden');
  }

  private print(text: string, cls = ''): void {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = text;
    this.out.appendChild(div);
    this.out.scrollTop = this.out.scrollHeight;
  }

  run(): void {
    const code = this.input.value.trim();
    if (!code) return;
    this.print(`» ${code}`);
    try {
      const fn = new Function('nd', `'use strict'; return (${code});`);
      let result: unknown;
      try {
        result = fn(this.api);
      } catch {
        // Statement form (declarations, multiple lines).
        const stmt = new Function('nd', `'use strict'; ${code}`);
        result = stmt(this.api);
      }
      this.print(formatResult(result), 'res');
    } catch (e) {
      this.print(String(e), 'err');
    }
  }
}

function formatResult(v: unknown): string {
  if (v === undefined) return 'undefined';
  try {
    if (typeof v === 'object' && v !== null) return JSON.stringify(v, jsonSafe, 1).slice(0, 2000);
    return String(v);
  } catch {
    return String(v);
  }
}

function jsonSafe(_key: string, value: unknown): unknown {
  if (value instanceof Float64Array || value instanceof Float32Array) {
    return `[${value.constructor.name} x${value.length}]`;
  }
  if (value instanceof Uint8Array || value instanceof Int8Array) {
    return `[${value.constructor.name} x${value.length}]`;
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}
