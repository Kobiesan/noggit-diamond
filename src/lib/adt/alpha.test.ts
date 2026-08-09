import { describe, expect, it } from 'vitest';
import {
  decodeAlpha4,
  decodeAlpha8,
  decodeAlphaCompressed,
  encodeAlpha4,
  encodeAlphaCompressed,
  fixAlphaEdges,
} from './alpha';
import { mulberryBytes } from './testutil';

describe('4-bit alpha codec', () => {
  it('round-trips values that are multiples of 17', () => {
    const alpha = new Uint8Array(4096);
    for (let i = 0; i < 4096; i++) alpha[i] = (i % 16) * 17;
    const decoded = decodeAlpha4(encodeAlpha4(alpha));
    expect(decoded).toEqual(alpha);
  });

  it('expands nibbles low-first with x17 scaling', () => {
    const data = new Uint8Array(2048);
    data[0] = 0xf1; // low nibble 1, high nibble 15
    const out = decodeAlpha4(data);
    expect(out[0]).toBe(17);
    expect(out[1]).toBe(255);
  });

  it('quantizes arbitrary bytes to the nearest nibble', () => {
    const alpha = new Uint8Array(4096);
    alpha[0] = 200; // 200/17 = 11.76 -> 12 -> 204
    const decoded = decodeAlpha4(encodeAlpha4(alpha));
    expect(decoded[0]).toBe(204);
  });
});

describe('8-bit alpha codec', () => {
  it('copies through unchanged', () => {
    const alpha = mulberryBytes(4096, 1);
    expect(decodeAlpha8(alpha)).toEqual(alpha);
  });
});

describe('compressed alpha codec', () => {
  it('round-trips uniform maps compactly', () => {
    const alpha = new Uint8Array(4096).fill(128);
    const enc = encodeAlphaCompressed(alpha);
    expect(enc.length).toBeLessThan(300);
    expect(decodeAlphaCompressed(enc)).toEqual(alpha);
  });

  it('round-trips arbitrary (seeded) maps', () => {
    const alpha = mulberryBytes(4096, 7);
    expect(decodeAlphaCompressed(encodeAlphaCompressed(alpha))).toEqual(alpha);
  });

  it('round-trips maps mixing runs and literals', () => {
    const alpha = new Uint8Array(4096);
    for (let i = 0; i < 4096; i++) {
      alpha[i] = i % 128 < 64 ? 255 : (i * 31) & 0xff;
    }
    expect(decodeAlphaCompressed(encodeAlphaCompressed(alpha))).toEqual(alpha);
  });

  it('rejects truncated streams', () => {
    expect(() => decodeAlphaCompressed(new Uint8Array([0x85, 1]))).toThrow(/truncated/);
    expect(() => decodeAlphaCompressed(new Uint8Array([0x05, 1, 2]))).toThrow(/truncated/);
  });
});

describe('fixAlphaEdges', () => {
  it('duplicates row/column 62 into 63', () => {
    const alpha = new Uint8Array(4096);
    alpha[62 * 64 + 10] = 99; // row 62
    alpha[20 * 64 + 62] = 77; // col 62
    alpha[62 * 64 + 62] = 55; // corner
    fixAlphaEdges(alpha);
    expect(alpha[63 * 64 + 10]).toBe(99);
    expect(alpha[20 * 64 + 63]).toBe(77);
    expect(alpha[63 * 64 + 63]).toBe(55);
  });
});
