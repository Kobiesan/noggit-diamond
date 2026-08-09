import { describe, expect, it } from 'vitest';
import { Terrain } from '../world/terrain';
import { createBlankAdt } from '../adt/builder';
import { History, chunkCapture } from './history';
import { setChunkWater } from './water';
import { paintTexture } from './texture';

function setup(): { t: Terrain; doc: ReturnType<typeof createBlankAdt>; h: History } {
  const doc = createBlankAdt('T', 0, 0, { textures: ['base.blp'] });
  const t = new Terrain();
  t.addTile(doc);
  return { t, doc, h: new History() };
}

describe('History', () => {
  it('undoes and redoes a height edit', () => {
    const { t, doc, h } = setup();
    const ref = t.chunkAt(0, 0, 0)!;
    const tx = h.begin('raise');
    const cap = chunkCapture(t, ref);
    tx.capture(ref.key, cap.take, cap.restore);
    doc.chunks[0].heights[0] = 99;
    h.commit();

    t.takeDirty();
    expect(h.undo()).toBe('raise');
    expect(doc.chunks[0].heights[0]).toBe(0);
    expect(t.takeDirty()).toContain(ref.key);
    expect(h.redo()).toBe('raise');
    expect(doc.chunks[0].heights[0]).toBe(99);
  });

  it('keeps the first before-state when capture is called twice', () => {
    const { t, doc, h } = setup();
    const ref = t.chunkAt(0, 0, 0)!;
    const tx = h.begin('multi');
    const cap = chunkCapture(t, ref);
    tx.capture(ref.key, cap.take, cap.restore);
    doc.chunks[0].heights[0] = 10;
    tx.capture(ref.key, cap.take, cap.restore); // no-op
    doc.chunks[0].heights[0] = 20;
    h.commit();
    h.undo();
    expect(doc.chunks[0].heights[0]).toBe(0);
    h.redo();
    expect(doc.chunks[0].heights[0]).toBe(20);
  });

  it('clears the redo tail on a new transaction', () => {
    const { t, doc, h } = setup();
    const ref = t.chunkAt(0, 0, 0)!;
    for (const value of [1, 2]) {
      const tx = h.begin(`set-${value}`);
      const cap = chunkCapture(t, ref);
      tx.capture(ref.key, cap.take, cap.restore);
      doc.chunks[0].heights[0] = value;
      h.commit();
    }
    h.undo();
    expect(h.canRedo).toBe(true);
    const tx = h.begin('set-3');
    const cap = chunkCapture(t, ref);
    tx.capture(ref.key, cap.take, cap.restore);
    doc.chunks[0].heights[0] = 3;
    h.commit();
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe('set-3');
    expect(doc.chunks[0].heights[0]).toBe(1);
  });

  it('drops empty transactions and trims to the limit', () => {
    const { t, doc } = setup();
    const h = new History(2);
    h.begin('empty');
    h.commit();
    expect(h.canUndo).toBe(false);
    const ref = t.chunkAt(0, 0, 0)!;
    for (const value of [1, 2, 3]) {
      const tx = h.begin(`v${value}`);
      const cap = chunkCapture(t, ref);
      tx.capture(ref.key, cap.take, cap.restore);
      doc.chunks[0].heights[0] = value;
      h.commit();
    }
    expect(h.depth).toBe(2);
    h.undo();
    h.undo();
    expect(h.canUndo).toBe(false);
    expect(doc.chunks[0].heights[0]).toBe(1); // v1's before-state was trimmed
  });

  it('round-trips a water null -> created transition', () => {
    const { t, doc, h } = setup();
    const ref = t.chunkAt(0, 0, 5)!;
    const tx = h.begin('add water');
    const cap = chunkCapture(t, ref);
    tx.capture(ref.key, cap.take, cap.restore);
    setChunkWater(doc, 5, { typeId: 5, level: 12 });
    h.commit();
    h.undo();
    expect(doc.water).toBeNull();
    h.redo();
    expect(doc.water![5]!.instances[0].maxHeight).toBe(12);
    h.undo();
    expect(doc.water).toBeNull();
  });

  it('restores texture tables alongside layers', () => {
    const { t, doc, h } = setup();
    const ref = t.chunkAt(0, 0, 0)!;
    const tx = h.begin('paint');
    const cap = chunkCapture(t, ref);
    tx.capture(ref.key, cap.take, cap.restore);
    paintTexture(t, 1, 1, 5, 5, 'flat', 1, 255, 'grass.blp');
    h.commit();
    expect(doc.textures).toHaveLength(2);
    h.undo();
    expect(doc.textures).toHaveLength(1);
    expect(doc.chunks[0].layers).toHaveLength(1);
  });

  it('rollback restores before-states without pushing an entry', () => {
    const { t, doc, h } = setup();
    const ref = t.chunkAt(0, 0, 0)!;
    const tx = h.begin('aborted');
    const cap = chunkCapture(t, ref);
    tx.capture(ref.key, cap.take, cap.restore);
    doc.chunks[0].heights[0] = 123;
    h.rollback();
    expect(doc.chunks[0].heights[0]).toBe(0);
    expect(h.canUndo).toBe(false);
  });
});
