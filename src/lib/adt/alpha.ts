/**
 * MCAL alpha-map codecs.
 *
 * On disk an alpha map is one of:
 *  - 2048 bytes: 4-bit texels, two per byte, low nibble first ("small alpha")
 *  - 4096 bytes: 8-bit texels ("big alpha", requires WDT MPHD 0x4/0x80)
 *  - RLE-compressed 8-bit (MCLY flag 0x200)
 *
 * In memory we always use a normalized Uint8Array(4096), 0..255.
 *
 * The client additionally "fixes" alpha maps unless MCNK flag
 * DO_NOT_FIX_ALPHA_MAP (0x8000) is set: the last row and column are
 * ignored and replaced with copies of row/column 62 — i.e. the map is
 * effectively 63x63. To keep editing intuitive we normalize on decode
 * (duplicate row/col 62 into 63) and re-apply the duplication on encode
 * when the fix is active.
 */

import { ALPHA_SIDE, ALPHA_SIZE } from '../constants';

/** Duplicate row/column 62 into row/column 63 in place (the client "fix"). */
export function fixAlphaEdges(alpha: Uint8Array): Uint8Array {
  for (let x = 0; x < ALPHA_SIDE; x++) {
    alpha[63 * ALPHA_SIDE + x] = alpha[62 * ALPHA_SIDE + x];
  }
  for (let y = 0; y < ALPHA_SIDE; y++) {
    alpha[y * ALPHA_SIDE + 63] = alpha[y * ALPHA_SIDE + 62];
  }
  return alpha;
}

/** Decode a 2048-byte 4-bit alpha map to 4096 bytes (nibble * 17). */
export function decodeAlpha4(data: Uint8Array): Uint8Array {
  if (data.length < ALPHA_SIZE / 2) {
    throw new Error(`4-bit alpha map too short: ${data.length}`);
  }
  const out = new Uint8Array(ALPHA_SIZE);
  for (let i = 0; i < ALPHA_SIZE / 2; i++) {
    const b = data[i];
    out[i * 2] = (b & 0x0f) * 17;
    out[i * 2 + 1] = ((b >> 4) & 0x0f) * 17;
  }
  return out;
}

/** Encode 4096 normalized bytes as a 2048-byte 4-bit alpha map. */
export function encodeAlpha4(alpha: Uint8Array): Uint8Array {
  const out = new Uint8Array(ALPHA_SIZE / 2);
  for (let i = 0; i < ALPHA_SIZE / 2; i++) {
    const lo = Math.round(alpha[i * 2] / 17) & 0x0f;
    const hi = Math.round(alpha[i * 2 + 1] / 17) & 0x0f;
    out[i] = lo | (hi << 4);
  }
  return out;
}

/** Decode a 4096-byte 8-bit alpha map (copy). */
export function decodeAlpha8(data: Uint8Array): Uint8Array {
  if (data.length < ALPHA_SIZE) {
    throw new Error(`8-bit alpha map too short: ${data.length}`);
  }
  return data.slice(0, ALPHA_SIZE);
}

/**
 * Decode an RLE-compressed alpha map (always 8-bit output).
 * Stream of control bytes: bit 7 set = "fill" (repeat next byte N times),
 * clear = "copy" (copy next N literal bytes); N = low 7 bits.
 * Returns the number of input bytes consumed via the out-param object.
 */
export function decodeAlphaCompressed(
  data: Uint8Array,
  consumed?: { bytes: number },
): Uint8Array {
  const out = new Uint8Array(ALPHA_SIZE);
  let inPos = 0;
  let outPos = 0;
  while (outPos < ALPHA_SIZE) {
    if (inPos >= data.length) {
      throw new Error('compressed alpha map truncated');
    }
    const control = data[inPos++];
    const fill = (control & 0x80) !== 0;
    let count = control & 0x7f;
    if (count === 0) count = 0; // zero-count controls are skipped
    if (fill) {
      if (inPos >= data.length) throw new Error('compressed alpha map truncated');
      const value = data[inPos++];
      for (let i = 0; i < count && outPos < ALPHA_SIZE; i++) out[outPos++] = value;
    } else {
      for (let i = 0; i < count && outPos < ALPHA_SIZE; i++) {
        if (inPos >= data.length) throw new Error('compressed alpha map truncated');
        out[outPos++] = data[inPos++];
      }
    }
    if (count === 0 && !fill) {
      // A 0x00 control would loop forever; treat as corrupt.
      throw new Error('compressed alpha map contains empty copy run');
    }
  }
  if (consumed) consumed.bytes = inPos;
  return out;
}

/** Encode 4096 bytes with the MCAL RLE scheme (rows encoded independently). */
export function encodeAlphaCompressed(alpha: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let row = 0; row < ALPHA_SIDE; row++) {
    const start = row * ALPHA_SIDE;
    let i = 0;
    while (i < ALPHA_SIDE) {
      // Find run length of identical bytes.
      let run = 1;
      while (i + run < ALPHA_SIDE && alpha[start + i + run] === alpha[start + i] && run < 127) {
        run++;
      }
      if (run >= 2) {
        out.push(0x80 | run, alpha[start + i]);
        i += run;
      } else {
        // Collect literals until the next run of >= 3 (or row end).
        let lit = i + 1;
        let pending = 1;
        while (lit < ALPHA_SIDE && pending < 127) {
          let r = 1;
          while (lit + r < ALPHA_SIDE && alpha[start + lit + r] === alpha[start + lit] && r < 3) r++;
          if (r >= 3) break;
          lit++;
          pending++;
        }
        out.push(pending);
        for (let j = i; j < i + pending; j++) out.push(alpha[start + j]);
        i += pending;
      }
    }
  }
  return Uint8Array.from(out);
}

/**
 * Decode an alpha map of unknown storage into normalized 4096 bytes.
 * `size` is the byte length available for this layer in MCAL.
 */
export function decodeAlphaAuto(
  data: Uint8Array,
  compressed: boolean,
): Uint8Array {
  if (compressed) return decodeAlphaCompressed(data);
  if (data.length >= ALPHA_SIZE) return decodeAlpha8(data);
  return decodeAlpha4(data);
}
