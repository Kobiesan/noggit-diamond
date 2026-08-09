import { describe, expect, it } from 'vitest';
import { BinaryReader, readChunkHeader, iterateChunks } from './reader';
import { BinaryWriter } from './writer';

describe('BinaryWriter / BinaryReader', () => {
  it('round-trips scalar values', () => {
    const w = new BinaryWriter(8);
    w.uint8(0xfe);
    w.int8(-5);
    w.uint16(0xbeef);
    w.int16(-1234);
    w.uint32(0xdeadbeef);
    w.int32(-123456789);
    w.float32(1.5);
    w.uint64(0x1122334455667788n);
    w.cstring('Tileset\\Test.blp');

    const r = new BinaryReader(w.toUint8Array());
    expect(r.uint8()).toBe(0xfe);
    expect(r.int8()).toBe(-5);
    expect(r.uint16()).toBe(0xbeef);
    expect(r.int16()).toBe(-1234);
    expect(r.uint32()).toBe(0xdeadbeef);
    expect(r.int32()).toBe(-123456789);
    expect(r.float32()).toBe(1.5);
    expect(r.uint64()).toBe(0x1122334455667788n);
    expect(r.cstring()).toBe('Tileset\\Test.blp');
    expect(r.eof).toBe(true);
  });

  it('stores magics byte-reversed on disk', () => {
    const w = new BinaryWriter();
    w.magic('MVER');
    const bytes = w.toUint8Array();
    expect(String.fromCharCode(...bytes)).toBe('REVM');
    const r = new BinaryReader(bytes);
    expect(r.magic()).toBe('MVER');
  });

  it('frames chunks with patched sizes', () => {
    const w = new BinaryWriter();
    const s = w.beginChunk('MTEX');
    w.cstring('a.blp');
    w.cstring('b.blp');
    w.endChunk(s);
    w.chunk('MMDX', new Uint8Array([1, 2, 3]));

    const r = new BinaryReader(w.toUint8Array());
    const chunks = [...iterateChunks(r)];
    expect(chunks.map((c) => c.magic)).toEqual(['MTEX', 'MMDX']);
    expect(chunks[0].size).toBe(12);
    expect(chunks[1].size).toBe(3);
  });

  it('reads chunk headers and skips payloads', () => {
    const w = new BinaryWriter();
    w.chunk('MVER', new Uint8Array([18, 0, 0, 0]));
    w.chunk('MHDR', new Uint8Array(64));
    const r = new BinaryReader(w.toUint8Array());
    const first = readChunkHeader(r);
    expect(first.magic).toBe('MVER');
    expect(first.size).toBe(4);
    expect(first.dataOffset).toBe(8);
    const second = readChunkHeader(r);
    expect(second.magic).toBe('MHDR');
    expect(second.chunkOffset).toBe(12);
  });

  it('throws on out-of-bounds reads', () => {
    const r = new BinaryReader(new Uint8Array([1, 2]));
    expect(() => r.uint32()).toThrow(RangeError);
  });

  it('grows the writer buffer transparently', () => {
    const w = new BinaryWriter(4);
    const big = new Uint8Array(100_000).fill(7);
    w.bytesArray(big);
    expect(w.length).toBe(100_000);
    expect(w.toUint8Array()[99_999]).toBe(7);
  });

  it('patches uint32 at absolute offsets', () => {
    const w = new BinaryWriter();
    w.uint32(0);
    w.uint32(42);
    w.patchUint32(0, 1234);
    const r = new BinaryReader(w.toUint8Array());
    expect(r.uint32()).toBe(1234);
    expect(r.uint32()).toBe(42);
  });
});
