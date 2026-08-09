/** Shared deterministic helpers for tests. */

/** Seeded PRNG byte array (mulberry32). */
export function mulberryBytes(length: number, seed: number): Uint8Array {
  let a = seed >>> 0;
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    out[i] = ((t ^ (t >>> 14)) >>> 0) & 0xff;
  }
  return out;
}
