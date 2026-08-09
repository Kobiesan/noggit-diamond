/**
 * Little-endian growable binary writer for WoW chunked files.
 */
export class BinaryWriter {
  private buf: ArrayBuffer;
  private view: DataView;
  private bytes: Uint8Array;
  public offset = 0;
  private used = 0;

  constructor(initialCapacity = 64 * 1024) {
    this.buf = new ArrayBuffer(Math.max(16, initialCapacity));
    this.view = new DataView(this.buf);
    this.bytes = new Uint8Array(this.buf);
  }

  get length(): number {
    return this.used;
  }

  private ensure(count: number): void {
    const needed = this.offset + count;
    if (needed <= this.buf.byteLength) return;
    let cap = this.buf.byteLength * 2;
    while (cap < needed) cap *= 2;
    const next = new ArrayBuffer(cap);
    new Uint8Array(next).set(this.bytes.subarray(0, this.used));
    this.buf = next;
    this.view = new DataView(next);
    this.bytes = new Uint8Array(next);
  }

  private advance(count: number): void {
    this.offset += count;
    if (this.offset > this.used) this.used = this.offset;
  }

  seek(offset: number): void {
    if (offset < 0 || offset > this.used) {
      throw new RangeError(`seek(${offset}) out of bounds (used ${this.used})`);
    }
    this.offset = offset;
  }

  uint8(v: number): void {
    this.ensure(1);
    this.view.setUint8(this.offset, v);
    this.advance(1);
  }

  int8(v: number): void {
    this.ensure(1);
    this.view.setInt8(this.offset, v);
    this.advance(1);
  }

  uint16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.offset, v, true);
    this.advance(2);
  }

  int16(v: number): void {
    this.ensure(2);
    this.view.setInt16(this.offset, v, true);
    this.advance(2);
  }

  uint32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.offset, v >>> 0, true);
    this.advance(4);
  }

  int32(v: number): void {
    this.ensure(4);
    this.view.setInt32(this.offset, v | 0, true);
    this.advance(4);
  }

  uint64(v: bigint): void {
    this.ensure(8);
    this.view.setBigUint64(this.offset, v, true);
    this.advance(8);
  }

  float32(v: number): void {
    this.ensure(4);
    this.view.setFloat32(this.offset, v, true);
    this.advance(4);
  }

  bytesArray(data: Uint8Array): void {
    this.ensure(data.byteLength);
    this.bytes.set(data, this.offset);
    this.advance(data.byteLength);
  }

  float32Array(data: Float32Array | number[]): void {
    for (let i = 0; i < data.length; i++) this.float32(data[i]);
  }

  uint32Array(data: Uint32Array | number[]): void {
    for (let i = 0; i < data.length; i++) this.uint32(data[i]);
  }

  /** Write a NUL-terminated string (Latin-1/ASCII). */
  cstring(s: string): void {
    for (let i = 0; i < s.length; i++) this.uint8(s.charCodeAt(i) & 0xff);
    this.uint8(0);
  }

  /** Write `count` zero bytes. */
  zeros(count: number): void {
    this.ensure(count);
    this.bytes.fill(0, this.offset, this.offset + count);
    this.advance(count);
  }

  /** Write a logical 4CC magic byte-reversed, as stored on disk. */
  magic(name: string): void {
    if (name.length !== 4) throw new Error(`magic must be 4 chars, got "${name}"`);
    this.uint8(name.charCodeAt(3));
    this.uint8(name.charCodeAt(2));
    this.uint8(name.charCodeAt(1));
    this.uint8(name.charCodeAt(0));
  }

  /**
   * Begin a chunk: writes magic + placeholder size, returns a token
   * to pass to endChunk() once the payload has been written.
   */
  beginChunk(name: string): number {
    this.magic(name);
    const sizeOffset = this.offset;
    this.uint32(0);
    return sizeOffset;
  }

  /** Patch the chunk size for a chunk started with beginChunk(). */
  endChunk(sizeOffset: number): void {
    const size = this.used - sizeOffset - 4;
    const save = this.offset;
    this.view.setUint32(sizeOffset, size >>> 0, true);
    this.offset = save;
  }

  /** Write a whole chunk from a payload in one call. */
  chunk(name: string, payload: Uint8Array): void {
    this.magic(name);
    this.uint32(payload.byteLength);
    this.bytesArray(payload);
  }

  /** Patch a uint32 at an absolute offset without moving the cursor. */
  patchUint32(offset: number, v: number): void {
    if (offset + 4 > this.used) {
      throw new RangeError(`patchUint32(${offset}) beyond written data (${this.used})`);
    }
    this.view.setUint32(offset, v >>> 0, true);
  }

  /** Snapshot of the written data (copy). */
  toUint8Array(): Uint8Array {
    return this.bytes.slice(0, this.used);
  }
}
