import { describe, expect, it } from 'vitest';
import { Terrain } from '../world/terrain';
import { createBlankAdt } from '../adt/builder';
import { CHUNK_SIZE, MCNK_FLAGS, UNIT_SIZE } from '../constants';
import { isHole } from '../coords';
import { clearAllHoles, holeCount, setHoleAtPoint } from './holes';
import { listAreaIds, paintAreaId, setImpassable } from './area';

function setup(): { t: Terrain; doc: ReturnType<typeof createBlankAdt> } {
  const doc = createBlankAdt('T', 0, 0, { areaId: 12 });
  const t = new Terrain();
  t.addTile(doc);
  return { t, doc };
}

describe('holes', () => {
  it('punches the hole covering the pointed-at quad', () => {
    const { t, doc } = setup();
    // Point inside quad (3, 2) of chunk 0 -> low-res block (1, 1).
    expect(setHoleAtPoint(t, 2.5 * UNIT_SIZE, 3.5 * UNIT_SIZE, true)).toBe(true);
    const chunk = doc.chunks[0];
    expect(isHole(chunk.holes, 3, 2)).toBe(true);
    expect(isHole(chunk.holes, 2, 2)).toBe(true); // same 2x2 block
    expect(isHole(chunk.holes, 5, 5)).toBe(false);
    expect(holeCount(chunk)).toBe(1);
  });

  it('fills holes and clears all', () => {
    const { t, doc } = setup();
    setHoleAtPoint(t, 1, 1, true);
    setHoleAtPoint(t, 1, 1, false);
    expect(doc.chunks[0].holes).toBe(0);
    setHoleAtPoint(t, 1, 1, true);
    setHoleAtPoint(t, CHUNK_SIZE + 1, 1, true);
    clearAllHoles(doc);
    expect(doc.chunks.every((c) => c.holes === 0)).toBe(true);
  });

  it('returns false outside loaded terrain', () => {
    const { t } = setup();
    expect(setHoleAtPoint(t, -5, -5, true)).toBe(false);
  });
});

describe('area ids and impassable flags', () => {
  it('paints area ids chunk-granularly', () => {
    const { t, doc } = setup();
    const n = paintAreaId(t, CHUNK_SIZE * 4, CHUNK_SIZE * 4, CHUNK_SIZE, 999);
    expect(n).toBeGreaterThanOrEqual(4);
    const hist = listAreaIds(doc);
    expect(hist.get(999)).toBe(n);
    expect(hist.get(12)).toBe(256 - n);
  });

  it('sets and clears impassable flags', () => {
    const { t, doc } = setup();
    setImpassable(t, 1, 1, 2, true);
    expect(doc.chunks[0].flags & MCNK_FLAGS.IMPASS).toBeTruthy();
    setImpassable(t, 1, 1, 2, false);
    expect(doc.chunks[0].flags & MCNK_FLAGS.IMPASS).toBe(0);
  });
});
