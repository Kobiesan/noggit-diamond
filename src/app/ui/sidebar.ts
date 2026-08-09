/**
 * Right sidebar: tool parameters, texture palette, object inspector.
 */

import type { Editor } from '../editor';
import { BRUSH_SHAPES } from '../../lib/edit/brush';
import { LIQUID_TYPE_LABELS } from '../../lib/constants';
import { removeLayer } from '../../lib/edit/texture';
import { chunkCapture } from '../../lib/edit/history';
import { toast } from './modal';

export class Sidebar {
  private root: HTMLElement;

  constructor(private editor: Editor) {
    this.root = document.getElementById('sidebar')!;
    editor.on('tool', () => this.render());
    editor.on('tiles', () => this.render());
    editor.on('selection', () => this.render());
    editor.on('textures', () => this.render());
    this.render();
  }

  render(): void {
    const e = this.editor;
    const s = e.settings;
    this.root.innerHTML = '';
    const tool = e.activeTool;

    if (tool !== 'navigate' && tool !== 'objects' && tool !== 'holes') {
      this.section('Brush');
      this.slider('Radius', s.radius, 1, 120, 1, (v) => (s.radius = v));
      this.slider('Inner %', Math.round(s.innerRatio * 100), 0, 100, 1, (v) => (s.innerRatio = v / 100));
      this.select(
        'Shape',
        s.shape,
        BRUSH_SHAPES.map((b) => ({ value: b, label: b })),
        (v) => (s.shape = v as typeof s.shape),
      );
    }

    switch (tool) {
      case 'raise':
        this.section('Raise / Lower');
        this.slider('Speed', s.amount, 1, 150, 1, (v) => (s.amount = v));
        this.hint('LMB raises, Ctrl+LMB lowers. Speed is yards per second at full falloff.');
        break;
      case 'flatten':
        this.section('Flatten');
        this.slider('Strength', s.strength, 0.05, 1, 0.05, (v) => (s.strength = v));
        this.select(
          'Mode',
          s.flattenMode,
          [
            { value: 'both', label: 'Both directions' },
            { value: 'raise', label: 'Raise only' },
            { value: 'lower', label: 'Lower only' },
          ],
          (v) => (s.flattenMode = v as typeof s.flattenMode),
        );
        this.checkbox('Lock height', s.flattenLock, (v) => {
          s.flattenLock = v;
          this.render();
        });
        if (s.flattenLock) {
          this.number('Height', s.flattenHeight, (v) => (s.flattenHeight = v));
        } else {
          this.hint('Target height is sampled where the stroke starts.');
        }
        break;
      case 'smooth':
        this.section('Smooth');
        this.slider('Strength', s.strength, 0.05, 1, 0.05, (v) => (s.strength = v));
        break;
      case 'texture':
        this.section('Texture Paint');
        this.slider('Strength', s.strength, 0.05, 1, 0.05, (v) => (s.strength = v));
        this.slider('Opacity', s.opacity, 0, 255, 1, (v) => (s.opacity = v));
        this.texturePalette();
        break;
      case 'color':
        this.section('Vertex Color');
        this.slider('Strength', s.strength, 0.05, 1, 0.05, (v) => (s.strength = v));
        this.colorField('Color', s.color, (v) => (s.color = v));
        this.hint('Ctrl+LMB paints back to neutral (127,127,127).');
        break;
      case 'water':
        this.section('Water');
        this.select(
          'Liquid',
          String(s.waterType),
          Object.entries(LIQUID_TYPE_LABELS)
            .filter(([id]) => ['1', '2', '3', '4', '5', '6', '7', '8'].includes(id))
            .map(([id, label]) => ({ value: id, label: `${label} (${id})` })),
          (v) => (s.waterType = parseInt(v, 10)),
        );
        this.checkbox('Level relative to terrain', s.waterLevelRelative, (v) => {
          s.waterLevelRelative = v;
          this.render();
        });
        this.number(
          s.waterLevelRelative ? 'Offset' : 'Level',
          s.waterLevel,
          (v) => (s.waterLevel = v),
        );
        this.hint('LMB floods whole chunks at the chosen level. Ctrl+LMB drains.');
        break;
      case 'holes':
        this.section('Holes');
        this.hint('LMB punches a hole through the terrain quad under the cursor. Ctrl+LMB fills it back. Holes are stored per 2x2-quad block (WotLK low-res masks).');
        break;
      case 'area':
        this.section('Area / Flags');
        this.checkbox('Paint impassable flag', s.impassable, (v) => {
          s.impassable = v;
          this.render();
        });
        if (!s.impassable) {
          this.number('Area id', s.areaId, (v) => (s.areaId = Math.max(0, Math.round(v))));
          this.hint('AreaTable.dbc id painted per chunk. Enable the area overlay in View to see ids as colors.');
        } else {
          this.hint('LMB marks chunks impassable, Ctrl+LMB clears. Enable the impass overlay in View.');
        }
        break;
      case 'objects':
        this.objectInspector();
        break;
      default:
        this.section('Navigate');
        this.hint('Right-drag to look, WASD to fly, Q/E down/up, Shift for boost, mouse wheel changes speed.<br/><br/>Drop .adt files anywhere to load them. Use the Objects tool to inspect doodad and WMO placements.');
        break;
    }

    if (tool === 'texture') this.layerList();
  }

  // ---- Widgets ----

  private section(title: string): void {
    const h = document.createElement('h3');
    h.textContent = title;
    this.root.appendChild(h);
  }

  private hint(html: string): void {
    const p = document.createElement('p');
    p.className = 'hint';
    p.innerHTML = html;
    this.root.appendChild(p);
  }

  private slider(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onInput: (v: number) => void,
  ): void {
    const row = document.createElement('div');
    row.className = 'field';
    row.innerHTML = `<label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}" value="${value}"/><span class="value">${value}</span>`;
    const input = row.querySelector('input')!;
    const val = row.querySelector('.value')!;
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      val.textContent = String(v);
      onInput(v);
    });
    this.root.appendChild(row);
  }

  private number(label: string, value: number, onInput: (v: number) => void): void {
    const row = document.createElement('div');
    row.className = 'field';
    row.innerHTML = `<label>${label}</label><input type="number" step="any" value="${value}"/>`;
    row.querySelector('input')!.addEventListener('input', (e) => {
      onInput(parseFloat((e.target as HTMLInputElement).value) || 0);
    });
    this.root.appendChild(row);
  }

  private select(
    label: string,
    value: string,
    options: { value: string; label: string }[],
    onChange: (v: string) => void,
  ): void {
    const row = document.createElement('div');
    row.className = 'field';
    const sel = document.createElement('select');
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      sel.appendChild(opt);
    }
    sel.value = value;
    sel.addEventListener('change', () => onChange(sel.value));
    row.innerHTML = `<label>${label}</label>`;
    row.appendChild(sel);
    this.root.appendChild(row);
  }

  private checkbox(label: string, value: boolean, onChange: (v: boolean) => void): void {
    const row = document.createElement('div');
    row.className = 'field';
    row.innerHTML = `<label>${label}</label><input type="checkbox"${value ? ' checked' : ''}/>`;
    row.querySelector('input')!.addEventListener('change', (e) => {
      onChange((e.target as HTMLInputElement).checked);
    });
    this.root.appendChild(row);
  }

  private colorField(
    label: string,
    value: [number, number, number],
    onChange: (v: [number, number, number]) => void,
  ): void {
    const row = document.createElement('div');
    row.className = 'field';
    const hex = `#${value.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    row.innerHTML = `<label>${label}</label><input type="color" value="${hex}"/>`;
    row.querySelector('input')!.addEventListener('input', (e) => {
      const v = (e.target as HTMLInputElement).value;
      onChange([
        parseInt(v.slice(1, 3), 16),
        parseInt(v.slice(3, 5), 16),
        parseInt(v.slice(5, 7), 16),
      ]);
    });
    this.root.appendChild(row);
  }

  // ---- Texture palette ----

  private texturePalette(): void {
    const e = this.editor;
    this.section('Texture Palette');
    const known = new Set<string>();
    for (const doc of e.terrain.tiles.values()) {
      for (const t of doc.textures) known.add(t);
    }
    known.add(e.selectedTexture);
    for (const preset of [
      'Tileset\\Generic\\Grass.blp',
      'Tileset\\Generic\\Dirt.blp',
      'Tileset\\Generic\\Rock.blp',
      'Tileset\\Generic\\Snow.blp',
      'Tileset\\Generic\\Sand.blp',
    ]) {
      known.add(preset);
    }
    const list = document.createElement('div');
    list.className = 'tex-list';
    for (const path of [...known].sort()) {
      const entry = e.textures.get(path);
      const item = document.createElement('div');
      item.className = `tex-item${path === e.selectedTexture ? ' active' : ''}`;
      const [r, g, b] = entry.color;
      item.innerHTML = `<div class="tex-swatch" style="background:rgb(${r},${g},${b})"></div><div class="tex-name" title="${path}">${path.split('\\').pop()}</div>`;
      item.addEventListener('click', () => {
        e.selectedTexture = path;
        this.render();
      });
      list.appendChild(item);
    }
    this.root.appendChild(list);

    const row = document.createElement('div');
    row.className = 'btn-row';
    row.style.marginTop = '8px';
    const addBtn = document.createElement('button');
    addBtn.className = 'btn';
    addBtn.textContent = '+ Add path…';
    addBtn.addEventListener('click', async () => {
      const path = prompt('Texture path (e.g. Tileset\\\\Elwynn\\\\ElwynnGrassBase.blp)');
      if (path) {
        this.editor.selectedTexture = path;
        this.editor.textures.get(path);
        this.render();
      }
    });
    const skinBtn = document.createElement('button');
    skinBtn.className = 'btn';
    skinBtn.textContent = 'Skin with image…';
    skinBtn.title = 'Associate a PNG/JPG with the selected texture path for preview';
    skinBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (file) {
          await this.editor.textures.setImage(this.editor.selectedTexture, file);
          toast(`Skinned ${this.editor.selectedTexture.split('\\').pop()}`);
        }
      });
      input.click();
    });
    row.append(addBtn, skinBtn);
    this.root.appendChild(row);
  }

  /** Layers of the chunk under the cursor. */
  private layerList(): void {
    const e = this.editor;
    const ref = e.terrain.chunkAtPoint(e.cursor.x, e.cursor.z);
    this.section('Chunk Layers (under cursor)');
    if (!ref) {
      this.hint('Hover terrain to inspect its layers.');
      return;
    }
    const list = document.createElement('div');
    list.className = 'tex-list';
    ref.chunk.layers.forEach((layer, i) => {
      const path = ref.doc.textures[layer.textureId] ?? `#${layer.textureId}`;
      const entry = e.textures.get(path);
      const item = document.createElement('div');
      item.className = 'tex-item';
      const [r, g, b] = entry.color;
      item.innerHTML = `<div class="tex-swatch" style="background:rgb(${r},${g},${b})"></div>
        <div class="tex-name">${i}: ${path.split('\\').pop()}</div>
        ${i > 0 ? '<button class="btn danger" style="padding:1px 7px">✕</button>' : ''}`;
      item.querySelector('button')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const tx = e.history.begin('Remove layer');
        const cap = chunkCapture(e.terrain, ref);
        tx.capture(ref.key, cap.take, cap.restore);
        removeLayer(ref.chunk, i);
        e.history.commit();
        e.terrain.markDirty(ref);
        this.render();
      });
      list.appendChild(item);
    });
    this.root.appendChild(list);
  }

  // ---- Object inspector ----

  private objectInspector(): void {
    const e = this.editor;
    this.section('Objects');
    const sel = e.selection;
    if (!sel) {
      this.hint('Click a marker to select a doodad (cones) or WMO (boxes). Drag moves it on the terrain; R rotates 15°; Delete removes it.');
      const counts = { doodads: 0, wmos: 0 };
      for (const doc of e.terrain.tiles.values()) {
        counts.doodads += doc.doodads.length;
        counts.wmos += doc.wmos.length;
      }
      this.hint(`Loaded: <b>${counts.doodads}</b> doodads, <b>${counts.wmos}</b> WMOs.`);
      return;
    }
    const placement = sel.kind === 'doodad' ? sel.doc.doodads[sel.index] : sel.doc.wmos[sel.index];
    if (!placement) {
      this.hint('Selection no longer exists.');
      return;
    }
    const name =
      sel.kind === 'doodad'
        ? sel.doc.m2Models[sel.doc.doodads[sel.index].nameId] ?? '(unknown m2)'
        : sel.doc.wmoModels[sel.doc.wmos[sel.index].nameId] ?? '(unknown wmo)';
    this.hint(`<b>${sel.kind.toUpperCase()}</b> · ${name.split('\\').pop()}<br/>${name}`);
    const p = sel.kind === 'doodad' ? sel.doc.doodads[sel.index] : sel.doc.wmos[sel.index];
    this.number('X', round2(p.position[0]), (v) => {
      p.position[0] = v;
      this.touch();
    });
    this.number('Y (height)', round2(p.position[1]), (v) => {
      p.position[1] = v;
      this.touch();
    });
    this.number('Z', round2(p.position[2]), (v) => {
      p.position[2] = v;
      this.touch();
    });
    this.number('Rot Y°', round2(p.rotation[1]), (v) => {
      p.rotation[1] = v;
      this.touch();
    });
    if (sel.kind === 'doodad') {
      this.number('Scale', sel.doc.doodads[sel.index].scale, (v) => {
        sel.doc.doodads[sel.index].scale = Math.max(0.01, v);
        this.touch();
      });
    }
    const del = document.createElement('button');
    del.className = 'btn danger';
    del.textContent = 'Delete object';
    del.addEventListener('click', () => this.deleteSelected());
    this.root.appendChild(del);
  }

  private touch(): void {
    // Nudge renderer: mark any chunk dirty to trigger marker rebuild.
    const doc = this.editor.docs[0];
    if (doc) this.editor.terrain.dirtyChunks.add(this.editor.chunkKeyOf(doc, 0));
  }

  deleteSelected(): void {
    const e = this.editor;
    const sel = e.selection;
    if (!sel) return;
    if (sel.kind === 'doodad') sel.doc.doodads.splice(sel.index, 1);
    else sel.doc.wmos.splice(sel.index, 1);
    // Fix MCRF references: indices above the removed one shift down.
    for (const chunk of sel.doc.chunks) {
      const refs = sel.kind === 'doodad' ? chunk.doodadRefs : chunk.wmoRefs;
      const fixed = refs
        .filter((r) => r !== sel.index)
        .map((r) => (r > sel.index ? r - 1 : r));
      if (sel.kind === 'doodad') chunk.doodadRefs = fixed;
      else chunk.wmoRefs = fixed;
    }
    e.selection = null;
    e.emit('selection');
    this.touch();
    toast('Object deleted');
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
