import { describe, expect, it } from 'vitest';
import { Terrain } from '../world/terrain';
import { createBlankAdt } from '../adt/builder';
import { ALPHA_SIDE, CHUNK_SIZE, MCLY_FLAGS } from '../constants';
import { ensureLayer, ensureTexture, paintTexture, pruneEmptyLayers, removeLayer, swapTexture } from './texture';

function setup(): { t: Terrain; doc: ReturnType<typeof createBlankAdt> } {
  const doc = createBlankAdt('T', 0, 0, { textures: ['base.blp'] });
  const t = new Terrain();
  t.addTile(doc);
  return { t, doc };
}

describe('texture layer management', () => {
  it('ensureTexture dedupes case-insensitively', () => {
    const { doc } = setup();
    expect(ensureTexture(doc, 'BASE.BLP')).toBe(0);
    expect(ensureTexture(doc, 'grass.blp')).toBe(1);
    expect(ensureTexture(doc, 'Grass.blp')).toBe(1);
    expect(doc.textures).toEqual(['base.blp', 'grass.blp']);
  });

  it('ensureLayer caps at 4 layers and returns -1 when full', () => {
    const { doc } = setup();
    const chunk = doc.chunks[0];
    expect(ensureLayer(doc, chunk, 0)).toBe(0);
    expect(ensureLayer(doc, chunk, 1)).toBe(1);
    expect(ensureLayer(doc, chunk, 2)).toBe(2);
    expect(ensureLayer(doc, chunk, 3)).toBe(3);
    expect(ensureLayer(doc, chunk, 4)).toBe(-1);
    expect(ensureLayer(doc, chunk, 2)).toBe(2); // existing still found
    expect(chunk.layers[0].alpha).toBeNull();
    expect(chunk.layers[1].alpha).toHaveLength(4096);
    expect(chunk.layers[1].flags & MCLY_FLAGS.USE_ALPHA_MAP).toBeTruthy();
  });

  it('removeLayer(0) promotes the next layer to opaque base', () => {
    const { doc } = setup();
    const chunk = doc.chunks[0];
    ensureLayer(doc, chunk, 1);
    removeLayer(chunk, 0);
    expect(chunk.layers).toHaveLength(1);
    expect(chunk.layers[0].textureId).toBe(1);
    expect(chunk.layers[0].alpha).toBeNull();
    expect(chunk.layers[0].flags & MCLY_FLAGS.USE_ALPHA_MAP).toBe(0);
  });

  it('swapTexture retargets layers across the tile', () => {
    const { doc } = setup();
    ensureLayer(doc, doc.chunks[3], 0);
    swapTexture(doc, 0, 5);
    expect(doc.chunks[3].layers[0].textureId).toBe(5);
  });
});

describe('paintTexture', () => {
  it('saturates texels near the center and leaves the rim untouched', () => {
    const { t, doc } = setup();
    const cx = CHUNK_SIZE / 2;
    const cz = CHUNK_SIZE / 2;
    paintTexture(t, cx, cz, 10, 10, 'flat', 1, 255, 'grass.blp');
    const chunk = doc.chunks[0];
    expect(chunk.layers).toHaveLength(2);
    const alpha = chunk.layers[1].alpha!;
    const texel = CHUNK_SIZE / ALPHA_SIDE;
    const centerIdx =
      Math.floor(cz / texel) * ALPHA_SIDE + Math.floor(cx / texel);
    expect(alpha[centerIdx]).toBe(255);
    expect(alpha[0]).toBe(0); // corner is ~18 yards away
  });

  it('paints across chunk borders', () => {
    const { t, doc } = setup();
    t.takeDirty();
    const r = paintTexture(t, CHUNK_SIZE, CHUNK_SIZE / 2, 8, 8, 'flat', 1, 255, 'grass.blp');
    expect(r.paintedChunks).toBeGreaterThanOrEqual(2);
    expect(doc.chunks[0].layers).toHaveLength(2);
    expect(doc.chunks[1].layers).toHaveLength(2);
  });

  it('reports chunks skipped when all layer slots are taken', () => {
    const { t, doc } = setup();
    const chunk = doc.chunks[0];
    ensureLayer(doc, chunk, ensureTexture(doc, 'a.blp'));
    ensureLayer(doc, chunk, ensureTexture(doc, 'b.blp'));
    ensureLayer(doc, chunk, ensureTexture(doc, 'c.blp'));
    const r = paintTexture(t, 1, 1, 2, 2, 'flat', 1, 255, 'new.blp');
    expect(r.skippedFull).toBe(1);
  });

  it('painting the base texture is a painted no-op', () => {
    const { t } = setup();
    const r = paintTexture(t, 1, 1, 2, 2, 'flat', 1, 255, 'base.blp');
    expect(r.paintedChunks).toBe(1);
    expect(r.skippedFull).toBe(0);
  });
});

describe('pruneEmptyLayers', () => {
  it('drops all-zero alpha layers and keeps painted ones', () => {
    const { t, doc } = setup();
    const chunk = doc.chunks[0];
    ensureLayer(doc, chunk, ensureTexture(doc, 'empty.blp')); // never painted -> all zero
    paintTexture(t, CHUNK_SIZE / 2, CHUNK_SIZE / 2, 6, 6, 'flat', 1, 200, 'rock.blp');
    expect(chunk.layers).toHaveLength(3);
    const removed = pruneEmptyLayers(doc);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(chunk.layers).toHaveLength(2);
    expect(doc.textures[chunk.layers[1].textureId]).toBe('rock.blp');
  });
});
