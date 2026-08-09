/**
 * Little-endian binary reader with a cursor, tuned for WoW chunked files.
 */
export class BinaryReader {
  private view: DataView;
  private bytes: Uint8Array;
  public offset = 0;

  constructor(buffer: ArrayBuffer | Uint8Array, byteOffset = 0, byteLength?: number) {
    if (buffer instanceof Uint8Array) {
      this.bytes = byteLength !== undefined || byteOffset !== 0
        ? buffer.subarray(byteOffset, byteLength !== undefined ? byteOffset + byteLength : undefined)
        : buffer;
      this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    } else {
      this.bytes = new Uint8Array(buffer, byteOffset, byteLength);
      this.view = new DataView(buffer, byteOffset, byteLength ?? buffer.byteLength - byteOffset);
    }
  }

  get length(): number {
    return this.bytes.byteLength;
  }

  get remaining(): number {
    return this.length - this.offset;
  }

  get eof(): boolean {
    return this.offset >= this.length;
  }

  seek(offset: number): void {
    if (offset < 0 || offset > this.length) {
      throw new RangeError(`seek(${offset}) out of bounds (length ${this.length})`);
    }
    this.offset = offset;
  }

  skip(count: number): void {
    this.seek(this.offset + count);
  }

  private need(count: number): void {
    if (this.offset + count > this.length) {
      throw new RangeError(
        `read of ${count} bytes at offset ${this.offset} exceeds length ${this.length}`,
      );
    }
  }

  uint8(): number {
    this.need(1);
    return this.view.getUint8(this.offset++);
  }

  int8(): number {
    this.need(1);
    return this.view.getInt8(this.offset++);
  }

  uint16(): number {
    this.need(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  int16(): number {
    this.need(2);
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  uint32(): number {
    this.need(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  int32(): number {
    this.need(4);
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  uint64(): bigint {
    this.need(8);
    const v = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return v;
  }

  float32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  /** Read `count` raw bytes as a copy. */
  bytesArray(count: number): Uint8Array {
    this.need(count);
    const out = this.bytes.slice(this.offset, this.offset + count);
    this.offset += count;
    return out;
  }

  /** Read `count` float32 values into a Float32Array. */
  float32Array(count: number): Float32Array {
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) out[i] = this.float32();
    return out;
  }

  /** Read `count` uint32 values. */
  uint32Array(count: number): Uint32Array {
    const out = new Uint32Array(count);
    for (let i = 0; i < count; i++) out[i] = this.uint32();
    return out;
  }

  /** Read a NUL-terminated string (Latin-1/ASCII as used by WoW paths). */
  cstring(): string {
    let end = this.offset;
    while (end < this.length && this.bytes[end] !== 0) end++;
    let s = '';
    for (let i = this.offset; i < end; i++) s += String.fromCharCode(this.bytes[i]);
    this.offset = Math.min(end + 1, this.length);
    return s;
  }

  /**
   * Read a 4-byte chunk magic. On disk magics are byte-reversed
   * ("MVER" is stored as "REVM"); this returns the logical name.
   */
  magic(): string {
    this.need(4);
    const b = this.bytes;
    const o = this.offset;
    this.offset += 4;
    return (
      String.fromCharCode(b[o + 3]) +
      String.fromCharCode(b[o + 2]) +
      String.fromCharCode(b[o + 1]) +
      String.fromCharCode(b[o])
    );
  }

  /** Peek the logical magic at the current offset without advancing. */
  peekMagic(): string {
    const save = this.offset;
    const m = this.magic();
    this.offset = save;
    return m;
  }

  /** A sub-reader over the next `count` bytes; advances this reader. */
  sub(count: number): BinaryReader {
    this.need(count);
    const r = new BinaryReader(this.bytes.subarray(this.offset, this.offset + count));
    this.offset += count;
    return r;
  }

  /** A sub-reader over an absolute [offset, offset+count) window; cursor unchanged. */
  window(offset: number, count: number): BinaryReader {
    if (offset < 0 || offset + count > this.length) {
      throw new RangeError(`window(${offset}, ${count}) out of bounds (length ${this.length})`);
    }
    return new BinaryReader(this.bytes.subarray(offset, offset + count));
  }

  /** Raw byte view of the whole buffer (no copy). */
  raw(): Uint8Array {
    return this.bytes;
  }
}

/** One chunk of a chunked file: logical magic, payload window. */
export interface ChunkHeader {
  magic: string;
  size: number;
  /** Absolute offset of the chunk magic within the reader. */
  chunkOffset: number;
  /** Absolute offset of the payload within the reader. */
  dataOffset: number;
}

/** Read the chunk header at the cursor and advance past the payload. */
export function readChunkHeader(r: BinaryReader): ChunkHeader {
  const chunkOffset = r.offset;
  const magic = r.magic();
  const size = r.uint32();
  const dataOffset = r.offset;
  r.skip(size);
  return { magic, size, chunkOffset, dataOffset };
}

/** Iterate all top-level chunks of a chunked file. */
export function* iterateChunks(r: BinaryReader): Generator<ChunkHeader> {
  while (r.remaining >= 8) {
    yield readChunkHeader(r);
  }
}
