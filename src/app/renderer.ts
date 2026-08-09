/**
 * Three.js renderer for the terrain world: one mesh per MCNK chunk with
 * a CPU-composited 64x64 splat texture, water overlays, object markers,
 * a brush cursor and picking.
 */

import * as THREE from 'three';
import type { Editor } from './editor';
import type { ChunkRef } from '../lib/world/terrain';
import {
  ALPHA_SIDE,
  CHUNK_SIZE,
  MCNK_FLAGS,
  UNIT_SIZE,
  VERTS_PER_CHUNK,
} from '../lib/constants';
import { VERTEX_OFFSETS, chunkTriangles } from '../lib/coords';
import type { AdtDoc, WaterInstance } from '../lib/adt/types';

const LIQUID_COLORS: Record<number, number> = {
  1: 0x2e6f9e, 5: 0x2e6f9e, 9: 0x2e6f9e, 13: 0x2e6f9e, 17: 0x2e6f9e,
  2: 0x1f5c8b, 6: 0x1f5c8b, 14: 0x1f5c8b,
  3: 0xd4491c, 7: 0xd4491c, 19: 0xd4491c,
  4: 0x5a8f29, 8: 0x5a8f29, 20: 0x5a8f29,
};

export class AppRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private chunkMeshes = new Map<string, THREE.Mesh>();
  private waterMeshes = new Map<string, THREE.Group>();
  private objectGroup = new THREE.Group();
  private objectMarkers: { box: THREE.Object3D; kind: 'doodad' | 'wmo'; doc: AdtDoc; index: number }[] = [];
  private brushRing: THREE.Group;
  private raycaster = new THREE.Raycaster();
  private texVersionSeen = -1;
  /** Overlay modes toggled from the View menu. */
  overlays = { wireframe: false, areas: false, impass: false, shadows: true };

  constructor(
    private editor: Editor,
    canvas: HTMLCanvasElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x87b5d9);
    this.scene.fog = new THREE.Fog(0x87b5d9, 700, 2400);

    const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    sun.position.set(-0.6, 1, -0.35).multiplyScalar(500);
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0xbfd4e8, 0.9));
    this.scene.add(this.objectGroup);

    this.brushRing = this.makeBrushRing();
    this.scene.add(this.brushRing);
  }

  private makeBrushRing(): THREE.Group {
    const group = new THREE.Group();
    const mkRing = (color: number): THREE.Line => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      return new THREE.Line(geo, new THREE.LineBasicMaterial({ color, depthTest: false }));
    };
    const outer = mkRing(0xffffff);
    outer.name = 'outer';
    const inner = mkRing(0x4fc3f7);
    inner.name = 'inner';
    group.add(outer, inner);
    group.visible = false;
    group.renderOrder = 10;
    return group;
  }

  /** Show/update the brush cursor at a terrain point. */
  setBrush(visible: boolean, x = 0, y = 0, z = 0, radius = 1, inner = 0): void {
    this.brushRing.visible = visible;
    if (!visible) return;
    this.brushRing.position.set(x, y + 0.25, z);
    const outer = this.brushRing.getObjectByName('outer')!;
    const innerRing = this.brushRing.getObjectByName('inner')!;
    outer.scale.setScalar(Math.max(0.01, radius));
    innerRing.scale.setScalar(Math.max(0.01, inner));
  }

  /** Rebuild meshes for chunks the Terrain marked dirty. */
  sync(): void {
    if (this.editor.textures.version !== this.texVersionSeen) {
      this.texVersionSeen = this.editor.textures.version;
      // Texture palette changed: refresh everything visible.
      this.editor.terrain.tiles.forEach((doc) => this.editor.terrain.markTileDirty(doc));
    }
    const dirty = this.editor.terrain.takeDirty();
    if (dirty.length === 0) return;
    for (const key of dirty) {
      const [tx, ty, idx] = key.split('_').map(Number);
      const ref = this.editor.terrain.chunkAt(tx, ty, idx);
      if (!ref) {
        this.disposeChunk(key);
        continue;
      }
      this.buildChunk(key, ref);
      this.buildWater(key, ref);
    }
    this.rebuildObjects();
  }

  private disposeChunk(key: string): void {
    const mesh = this.chunkMeshes.get(key);
    if (mesh) {
      mesh.geometry.dispose();
      (mesh.material as THREE.MeshLambertMaterial).map?.dispose();
      (mesh.material as THREE.Material).dispose();
      this.scene.remove(mesh);
      this.chunkMeshes.delete(key);
    }
    const water = this.waterMeshes.get(key);
    if (water) {
      water.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      this.scene.remove(water);
      this.waterMeshes.delete(key);
    }
  }

  private buildChunk(key: string, ref: ChunkRef): void {
    let mesh = this.chunkMeshes.get(key);
    const positions = new Float32Array(VERTS_PER_CHUNK * 3);
    const normals = new Float32Array(VERTS_PER_CHUNK * 3);
    const uvs = new Float32Array(VERTS_PER_CHUNK * 2);
    const colors = new Float32Array(VERTS_PER_CHUNK * 3);
    const { chunk } = ref;
    for (let vi = 0; vi < VERTS_PER_CHUNK; vi++) {
      const off = VERTEX_OFFSETS[vi];
      positions[vi * 3] = ref.originX + off.x;
      positions[vi * 3 + 1] = chunk.heights[vi];
      positions[vi * 3 + 2] = ref.originZ + off.y;
      // MCNR bytes are (east, south, up); three-space (x, y, z) = (east, up, south).
      normals[vi * 3] = chunk.normals[vi * 3] / 127;
      normals[vi * 3 + 1] = chunk.normals[vi * 3 + 2] / 127;
      normals[vi * 3 + 2] = chunk.normals[vi * 3 + 1] / 127;
      uvs[vi * 2] = off.x / CHUNK_SIZE;
      uvs[vi * 2 + 1] = off.y / CHUNK_SIZE;
      if (chunk.vertexColors) {
        // BGRA, 0x7F neutral => scale so 127 -> 1.0.
        colors[vi * 3] = chunk.vertexColors[vi * 4 + 2] / 127;
        colors[vi * 3 + 1] = chunk.vertexColors[vi * 4 + 1] / 127;
        colors[vi * 3 + 2] = chunk.vertexColors[vi * 4] / 127;
      } else {
        colors[vi * 3] = colors[vi * 3 + 1] = colors[vi * 3 + 2] = 1;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(chunkTriangles(chunk.holes), 1));

    const texture = new THREE.DataTexture(
      this.compositeChunk(ref),
      ALPHA_SIDE,
      ALPHA_SIDE,
      THREE.RGBAFormat,
    );
    texture.needsUpdate = true;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.SRGBColorSpace;

    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = geometry;
      const mat = mesh.material as THREE.MeshLambertMaterial;
      mat.map?.dispose();
      mat.map = texture;
      mat.wireframe = this.overlays.wireframe;
      mat.needsUpdate = true;
    } else {
      const material = new THREE.MeshLambertMaterial({
        map: texture,
        vertexColors: true,
        wireframe: this.overlays.wireframe,
      });
      mesh = new THREE.Mesh(geometry, material);
      mesh.userData.chunkKey = key;
      this.chunkMeshes.set(key, mesh);
      this.scene.add(mesh);
    }
  }

  /** CPU splat compositing of layers into a 64x64 RGBA image. */
  private compositeChunk(ref: ChunkRef): Uint8Array {
    const { chunk, doc } = ref;
    const out = new Uint8Array(ALPHA_SIDE * ALPHA_SIDE * 4);
    const layerEntries = chunk.layers.map((layer) => ({
      layer,
      tex: this.editor.textures.get(doc.textures[layer.textureId] ?? `#${layer.textureId}`),
    }));
    const areaTint = this.overlays.areas ? areaColor(chunk.areaId) : null;
    const impass = this.overlays.impass && (chunk.flags & MCNK_FLAGS.IMPASS) !== 0;
    for (let y = 0; y < ALPHA_SIDE; y++) {
      for (let x = 0; x < ALPHA_SIDE; x++) {
        const i = y * ALPHA_SIDE + x;
        let r = 40, g = 40, b = 44; // untextured base
        for (let li = 0; li < layerEntries.length; li++) {
          const { layer, tex } = layerEntries[li];
          const [tr, tg, tb] = this.editor.textures.sample(tex, x, y);
          const a = li === 0 ? 1 : (layer.alpha ? layer.alpha[i] / 255 : 0);
          r = r + (tr - r) * a;
          g = g + (tg - g) * a;
          b = b + (tb - b) * a;
        }
        if (this.overlays.shadows && chunk.shadowMap && chunk.shadowMap[i]) {
          r *= 0.62; g *= 0.62; b *= 0.62;
        }
        if (areaTint) {
          r = r * 0.6 + areaTint[0] * 0.4;
          g = g * 0.6 + areaTint[1] * 0.4;
          b = b * 0.6 + areaTint[2] * 0.4;
        }
        if (impass) {
          r = r * 0.55 + 200 * 0.45;
          g *= 0.55;
          b *= 0.55;
        }
        const o = i * 4;
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = 255;
      }
    }
    return out;
  }

  private buildWater(key: string, ref: ChunkRef): void {
    const existing = this.waterMeshes.get(key);
    if (existing) {
      existing.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      this.scene.remove(existing);
      this.waterMeshes.delete(key);
    }
    const cell = ref.doc.water?.[ref.index];
    if (!cell || cell.instances.length === 0) return;
    const group = new THREE.Group();
    for (const inst of cell.instances) {
      group.add(this.waterInstanceMesh(ref, inst));
    }
    this.waterMeshes.set(key, group);
    this.scene.add(group);
  }

  private waterInstanceMesh(ref: ChunkRef, inst: WaterInstance): THREE.Mesh {
    const w = inst.width;
    const h = inst.height;
    const cols = w + 1;
    const rows = h + 1;
    const positions = new Float32Array(cols * rows * 3);
    const cell = CHUNK_SIZE / 8;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const vi = r * cols + c;
        const height = inst.heightMap ? inst.heightMap[vi] : inst.maxHeight;
        positions[vi * 3] = ref.originX + (inst.xOffset + c) * cell;
        positions[vi * 3 + 1] = height;
        positions[vi * 3 + 2] = ref.originZ + (inst.yOffset + r) * cell;
      }
    }
    const indices: number[] = [];
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        if (inst.existsBitmap) {
          const bit = r * w + c;
          if (((inst.existsBitmap[bit >> 3] >> (bit & 7)) & 1) === 0) continue;
        }
        const tl = r * cols + c;
        const tr = tl + 1;
        const bl = tl + cols;
        const br = bl + 1;
        indices.push(tl, bl, tr, tr, bl, br);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const color = LIQUID_COLORS[inst.liquidTypeId] ?? 0x2e6f9e;
    const material = new THREE.MeshLambertMaterial({
      color,
      transparent: true,
      opacity: inst.liquidTypeId === 7 || inst.liquidTypeId === 3 ? 0.95 : 0.62,
      side: THREE.DoubleSide,
    });
    return new THREE.Mesh(geometry, material);
  }

  /** Rebuild doodad/WMO markers (cheap; runs on any dirty sync). */
  private rebuildObjects(): void {
    for (const m of this.objectMarkers) {
      m.box.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    this.objectGroup.clear();
    this.objectMarkers = [];
    const selection = this.editor.selection;
    for (const doc of this.editor.terrain.tiles.values()) {
      doc.doodads.forEach((d, index) => {
        const selected =
          selection?.kind === 'doodad' && selection.doc === doc && selection.index === index;
        const marker = makeMarker(3 * d.scale, 0x37d4c0, selected);
        marker.position.set(d.position[0], d.position[1], d.position[2]);
        marker.rotation.y = THREE.MathUtils.degToRad(d.rotation[1]);
        this.objectGroup.add(marker);
        this.objectMarkers.push({ box: marker, kind: 'doodad', doc, index });
      });
      doc.wmos.forEach((m, index) => {
        const selected =
          selection?.kind === 'wmo' && selection.doc === doc && selection.index === index;
        const sx = Math.max(2, m.extentsMax[0] - m.extentsMin[0]);
        const sy = Math.max(2, m.extentsMax[1] - m.extentsMin[1]);
        const sz = Math.max(2, m.extentsMax[2] - m.extentsMin[2]);
        const marker = makeBoxMarker(sx, sy, sz, 0xb07cf2, selected);
        marker.position.set(
          (m.extentsMin[0] + m.extentsMax[0]) / 2,
          (m.extentsMin[1] + m.extentsMax[1]) / 2,
          (m.extentsMin[2] + m.extentsMax[2]) / 2,
        );
        this.objectGroup.add(marker);
        this.objectMarkers.push({ box: marker, kind: 'wmo', doc, index });
      });
    }
  }

  /** Force-refresh markers (e.g. after selection change without edits). */
  refreshObjects(): void {
    this.rebuildObjects();
  }

  /** Raycast the terrain; returns the map-space hit or null. */
  pickTerrain(ndcX: number, ndcY: number, camera: THREE.Camera): THREE.Vector3 | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const meshes = [...this.chunkMeshes.values()];
    const hits = this.raycaster.intersectObjects(meshes, false);
    return hits.length > 0 ? hits[0].point : null;
  }

  /** Raycast object markers; returns the placement reference or null. */
  pickObject(
    ndcX: number,
    ndcY: number,
    camera: THREE.Camera,
  ): { kind: 'doodad' | 'wmo'; doc: AdtDoc; index: number } | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const hits = this.raycaster.intersectObjects(this.objectGroup.children, true);
    if (hits.length === 0) return null;
    let obj: THREE.Object3D | null = hits[0].object;
    while (obj && obj.parent !== this.objectGroup) obj = obj.parent;
    const marker = this.objectMarkers.find((m) => m.box === obj);
    return marker ? { kind: marker.kind, doc: marker.doc, index: marker.index } : null;
  }

  setWireframe(on: boolean): void {
    this.overlays.wireframe = on;
    for (const mesh of this.chunkMeshes.values()) {
      (mesh.material as THREE.MeshLambertMaterial).wireframe = on;
    }
  }

  /** Repaint all chunk textures (after toggling overlays). */
  repaintAll(): void {
    for (const doc of this.editor.terrain.tiles.values()) {
      this.editor.terrain.markTileDirty(doc);
    }
  }

  render(camera: THREE.Camera): void {
    this.renderer.render(this.scene, camera);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
  }
}

function makeMarker(size: number, color: number, selected: boolean): THREE.Object3D {
  const group = new THREE.Group();
  const geo = new THREE.ConeGeometry(size * 0.5, size * 1.6, 6);
  const mat = new THREE.MeshLambertMaterial({
    color: selected ? 0xffd54f : color,
    transparent: true,
    opacity: 0.85,
  });
  const cone = new THREE.Mesh(geo, mat);
  cone.position.y = size * 0.8;
  group.add(cone);
  return group;
}

function makeBoxMarker(
  sx: number,
  sy: number,
  sz: number,
  color: number,
  selected: boolean,
): THREE.Object3D {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  const edges = new THREE.EdgesGeometry(geo);
  const line = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: selected ? 0xffd54f : color }),
  );
  const fill = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: selected ? 0xffd54f : color,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    }),
  );
  group.add(fill, line);
  return group;
}

/** Distinct pastel per area id for the area overlay. */
function areaColor(areaId: number): [number, number, number] {
  let h = (areaId * 2654435761) >>> 0;
  const hue = (h % 360) / 360;
  h = Math.imul(h, 40503) >>> 0;
  const r = Math.abs(Math.sin(hue * Math.PI * 2)) * 200 + 55;
  const g = Math.abs(Math.sin((hue + 0.33) * Math.PI * 2)) * 200 + 55;
  const b = Math.abs(Math.sin((hue + 0.66) * Math.PI * 2)) * 200 + 55;
  return [r, g, b];
}
