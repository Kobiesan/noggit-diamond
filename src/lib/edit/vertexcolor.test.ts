import { describe, expect, it } from 'vitest';
import { Terrain } from '../world/terrain';
import { createBlankAdt } from '../adt/builder';
import { MCNK_FLAGS } from '../constants';
import { ensureVertexColors, paintVertexColor, resetVertexColors } from './vertexcolor';

describe('vertex colors', () => {
  it('initializes to neutral and sets the MCCV flag', () => {
    const doc = createBlankAdt('T', 0, 0);
    const colors = ensureVertexColors(doc.chunks[0]);
    expect(colors).toHaveLength(580);
    expect(colors[0]).toBe(0x7f);
    expect(doc.chunks[0].flags & MCNK_FLAGS.HAS_MCCV).toBeTruthy();
  });

  it('blends toward the target color under the brush (BGRA order)', () => {
    const doc = createBlankAdt('T', 0, 0);
    const t = new Terrain();
    t.addTile(doc);
    paintVertexColor(t, 0, 0, 5, 5, 'flat', 1, [255, 0, 100]);
    const colors = doc.chunks[0].vertexColors!;
    expect(colors[0]).toBe(100); // b
    expect(colors[1]).toBe(0); // g
    expect(colors[2]).toBe(255); // r
    // A vertex far outside the brush is untouched (still null array elsewhere
    // or neutral where initialized).
    const far = doc.chunks[255].vertexColors;
    expect(far).toBeNull();
  });

  it('partial strength blends proportionally', () => {
    const doc = createBlankAdt('T', 0, 0);
    const t = new Terrain();
    t.addTile(doc);
    paintVertexColor(t, 0, 0, 5, 5, 'flat', 0.5, [255, 127, 0]);
    const colors = doc.chunks[0].vertexColors!;
    expect(colors[2]).toBe(191); // 127 + (255-127)*0.5
    expect(colors[1]).toBe(127);
    expect(colors[0]).toBe(64); // 127 + (0-127)*0.5 rounded
  });

  it('reset removes coloring and clears flags', () => {
    const doc = createBlankAdt('T', 0, 0);
    ensureVertexColors(doc.chunks[7]);
    resetVertexColors(doc);
    expect(doc.chunks[7].vertexColors).toBeNull();
    expect(doc.chunks[7].flags & MCNK_FLAGS.HAS_MCCV).toBe(0);
  });
});
