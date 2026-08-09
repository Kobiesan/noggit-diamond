import { describe, expect, it } from 'vitest';
import { BinaryReader } from '../binary/reader';
import { createBlankAdt } from '../adt/builder';
import { emptyWdl, parseWdl, serializeWdl, updateWdlFromAdt } from './wdl';
import { setHole } from '../coords';

describe('WDL', () => {
  it('round-trips byte-identically', () => {
    const wdl = emptyWdl();
    const heights = new Int16Array(545);
    for (let i = 0; i < 545; i++) heights[i] = (i * 13) % 1000 - 500;
    wdl.tiles[30 * 64 + 40] = heights;
    const holes = new Uint16Array(16);
    holes[3] = 0b101;
    wdl.holes[30 * 64 + 40] = holes;
    const once = serializeWdl(wdl);
    const twice = serializeWdl(parseWdl(once));
    expect(twice).toEqual(once);
  });

  it('writes MAOF offsets that point at MARE magics', () => {
    const wdl = emptyWdl();
    wdl.tiles[100] = new Int16Array(545).fill(7);
    wdl.tiles[200] = new Int16Array(545).fill(-7);
    const bytes = serializeWdl(wdl);
    // Find MAOF chunk.
    const r = new BinaryReader(bytes);
    let maofData = -1;
    while (r.remaining >= 8) {
      const magic = r.magic();
      const size = r.uint32();
      if (magic === 'MAOF') {
        maofData = r.offset;
        break;
      }
      r.skip(size);
    }
    expect(maofData).toBeGreaterThan(0);
    for (const idx of [100, 200]) {
      const or = new BinaryReader(bytes);
      or.seek(maofData + idx * 4);
      const ofs = or.uint32();
      expect(ofs).toBeGreaterThan(0);
      const probe = new BinaryReader(bytes);
      probe.seek(ofs);
      expect(probe.magic()).toBe('MARE');
    }
    // Absent tile has offset 0.
    const or = new BinaryReader(bytes);
    or.seek(maofData);
    expect(or.uint32()).toBe(0);
  });

  it('regenerates low-res heights from a hole-free ADT', () => {
    const doc = createBlankAdt('T', 5, 6, { baseHeight: 100 });
    const wdl = emptyWdl();
    updateWdlFromAdt(wdl, doc);
    const tile = wdl.tiles[6 * 64 + 5]!;
    expect(tile).toHaveLength(545);
    for (const v of tile) expect(v).toBe(100);
    expect(wdl.holes[6 * 64 + 5]!.every((h) => h === 0)).toBe(true);
  });

  it('derives hole masks from chunk holes (holed samples read 0)', () => {
    const doc = createBlankAdt('T', 5, 6, { baseHeight: 100 });
    doc.chunks[3].holes = setHole(0, 2, 2, true); // chunk ix=3, iy=0
    const wdl = emptyWdl();
    updateWdlFromAdt(wdl, doc);
    const holes = wdl.holes[6 * 64 + 5]!;
    expect(holes[0] & (1 << 3)).toBeTruthy();
    expect(holes[1]).toBe(0);
    // Samples over the hole may read 0; everything else stays at 100.
    const tile = wdl.tiles[6 * 64 + 5]!;
    const zeros = [...tile].filter((v) => v === 0).length;
    expect(zeros).toBeLessThanOrEqual(4);
    expect([...tile].filter((v) => v === 100).length).toBe(545 - zeros);
  });
});
