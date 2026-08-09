import { describe, expect, it } from 'vitest';
import { BinaryReader, iterateChunks } from '../binary/reader';
import { createBlankAdt } from './builder';
import { serializeAdt } from './serializer';

/**
 * Validates binary layout invariants that real WotLK clients rely on,
 * independent of our own parser.
 */
describe('ADT binary structure', () => {
  const bytes = serializeAdt(createBlankAdt('S', 0, 0, { textures: ['a.blp'] }));

  it('starts with MVER=18 followed by a 64-byte MHDR', () => {
    const r = new BinaryReader(bytes);
    expect(r.magic()).toBe('MVER');
    expect(r.uint32()).toBe(4);
    expect(r.uint32()).toBe(18);
    expect(r.magic()).toBe('MHDR');
    expect(r.uint32()).toBe(64);
  });

  it('MHDR.ofsMCIN is 0x40 (MCIN directly after MHDR)', () => {
    const r = new BinaryReader(bytes);
    r.seek(0x14 + 4); // MHDR data + flags
    expect(r.uint32()).toBe(0x40);
  });

  it('MHDR offsets point at the chunks they name', () => {
    const mhdrData = 0x14;
    const r = new BinaryReader(bytes);
    r.seek(mhdrData + 4);
    const names = ['MCIN', 'MTEX', 'MMDX', 'MMID', 'MWMO', 'MWID', 'MDDF', 'MODF'];
    for (const name of names) {
      const ofs = r.uint32();
      expect(ofs, name).toBeGreaterThan(0);
      const probe = new BinaryReader(bytes);
      probe.seek(mhdrData + ofs);
      expect(probe.magic(), name).toBe(name);
    }
  });

  it('MCIN entries point at all 256 MCNK chunks with header-inclusive sizes', () => {
    const r = new BinaryReader(bytes);
    r.seek(0x14 + 4);
    const ofsMcin = r.uint32();
    const mcin = new BinaryReader(bytes);
    mcin.seek(0x14 + ofsMcin + 8); // skip magic+size
    for (let i = 0; i < 256; i++) {
      const offset = mcin.uint32();
      const size = mcin.uint32();
      mcin.uint32();
      mcin.uint32();
      const probe = new BinaryReader(bytes);
      probe.seek(offset);
      expect(probe.magic(), `MCIN[${i}]`).toBe('MCNK');
      expect(probe.uint32()).toBe(size - 8);
    }
  });

  it('first MCNK sub-chunk offset (ofsHeight) is 0x88 pointing at MCVT', () => {
    // Find the first MCNK via chunk iteration.
    const r = new BinaryReader(bytes);
    let mcnkOffset = -1;
    for (const c of iterateChunks(r)) {
      if (c.magic === 'MCNK') {
        mcnkOffset = c.chunkOffset;
        break;
      }
    }
    expect(mcnkOffset).toBeGreaterThan(0);
    const h = new BinaryReader(bytes);
    h.seek(mcnkOffset + 8 + 0x14); // header field ofsHeight
    const ofsHeight = h.uint32();
    expect(ofsHeight).toBe(0x88);
    const probe = new BinaryReader(bytes);
    probe.seek(mcnkOffset + ofsHeight);
    expect(probe.magic()).toBe('MCVT');
    expect(probe.uint32()).toBe(145 * 4);
  });

  it('MCNR declares 435 bytes but carries 448', () => {
    const r = new BinaryReader(bytes);
    let mcnkOffset = -1;
    for (const c of iterateChunks(r)) {
      if (c.magic === 'MCNK') {
        mcnkOffset = c.chunkOffset;
        break;
      }
    }
    const h = new BinaryReader(bytes);
    h.seek(mcnkOffset + 8 + 0x18); // ofsNormal
    const ofsNormal = h.uint32();
    const probe = new BinaryReader(bytes);
    probe.seek(mcnkOffset + ofsNormal);
    expect(probe.magic()).toBe('MCNR');
    expect(probe.uint32()).toBe(435);
    // Next sub-chunk (MCLY) starts 448 bytes after the MCNR payload begins.
    h.seek(mcnkOffset + 8 + 0x1c); // ofsLayer
    const ofsLayer = h.uint32();
    expect(ofsLayer).toBe(ofsNormal + 8 + 448);
  });

  it('all top-level chunks are well-formed to the end of file', () => {
    const r = new BinaryReader(bytes);
    const magics = [...iterateChunks(r)].map((c) => c.magic);
    expect(r.remaining).toBe(0);
    expect(magics.filter((m) => m === 'MCNK')).toHaveLength(256);
    expect(magics.slice(0, 10)).toEqual([
      'MVER', 'MHDR', 'MCIN', 'MTEX', 'MMDX', 'MMID', 'MWMO', 'MWID', 'MDDF', 'MODF',
    ]);
  });
});
