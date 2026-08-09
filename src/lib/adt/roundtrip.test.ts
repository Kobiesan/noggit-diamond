import { describe, expect, it } from 'vitest';
import { BinaryWriter } from '../binary/writer';
import { createBlankAdt } from './builder';
import { parseAdt } from './parser';
import { serializeAdt } from './serializer';
import { MCLY_FLAGS, MCNK_FLAGS } from '../constants';
import type { AdtDoc } from './types';
import { mulberryBytes } from './testutil';

/** Build a document exercising every modeled feature. */
function makeRichAdt(bigAlpha: boolean): AdtDoc {
  const doc = createBlankAdt('TestMap', 30, 31, {
    baseHeight: 100,
    textures: ['Tileset\\Generic\\Black.blp', 'Tileset\\Generic\\Grass.blp'],
    areaId: 141,
  });
  doc.bigAlpha = bigAlpha;

  // Terrain shape: deterministic wave, exact float32 values.
  for (const chunk of doc.chunks) {
    for (let i = 0; i < 145; i++) {
      chunk.heights[i] =
        chunk.position[2] + Math.fround(Math.sin((chunk.ix * 145 + i) * 0.1) * 25);
    }
  }

  // Chunk 0: alpha layer with fixed edges (client fix path).
  {
    const c = doc.chunks[0];
    const alpha = new Uint8Array(4096);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const sy = Math.min(y, 62);
        const sx = Math.min(x, 62);
        alpha[y * 64 + x] = bigAlpha ? (sx * 4 + sy) % 256 : ((sx + sy) % 16) * 17;
      }
    }
    c.layers.push({ textureId: 1, flags: MCLY_FLAGS.USE_ALPHA_MAP, effectId: 0, alpha });
  }

  // Chunk 1: DO_NOT_FIX_ALPHA_MAP + arbitrary alpha (edge texels kept).
  {
    const c = doc.chunks[1];
    c.flags |= MCNK_FLAGS.DO_NOT_FIX_ALPHA_MAP;
    const alpha = new Uint8Array(4096);
    for (let i = 0; i < 4096; i++) alpha[i] = bigAlpha ? (i * 7) % 256 : ((i * 7) % 16) * 17;
    c.layers.push({ textureId: 1, flags: MCLY_FLAGS.USE_ALPHA_MAP, effectId: 2, alpha });
  }

  // Chunk 2: vertex colors + shadow map + holes + impass.
  {
    const c = doc.chunks[2];
    c.vertexColors = mulberryBytes(145 * 4, 3);
    const shadow = new Uint8Array(4096);
    for (let i = 0; i < 4096; i++) shadow[i] = (i % 3 === 0 ? 1 : 0);
    c.shadowMap = shadow;
    c.holes = 0b1010_0000_0000_0101;
    c.flags |= MCNK_FLAGS.IMPASS;
  }

  // Chunk 3: sound emitters + legacy liquid raw payloads.
  {
    const c = doc.chunks[3];
    c.soundEmitters = mulberryBytes(28 * 2, 4);
    c.soundEmitterCount = 2;
    // Legacy MCLQ preserved verbatim (raw includes its own chunk header).
    const lq = new BinaryWriter();
    lq.chunk('MCLQ', mulberryBytes(48, 5));
    c.liquidLegacy = lq.toUint8Array();
    // Non-zero MCNR trailing pad must survive the round trip too.
    c.normalsPad = mulberryBytes(13, 6);
  }

  // Models + placements.
  doc.m2Models = ['World\\Tree.m2', 'World\\Rock.m2'];
  doc.wmoModels = ['World\\wmo\\Keep.wmo'];
  doc.doodads = [
    {
      nameId: 1,
      uniqueId: 4242,
      position: [16100.5, 120.25, 16700.75],
      rotation: [0, 90.5, 0],
      scale: 1.5,
      flags: 0,
    },
  ];
  doc.wmos = [
    {
      nameId: 0,
      uniqueId: 999,
      position: [16000, 100, 16600],
      rotation: [0, 180, 0],
      extentsMin: [15900, 50, 16500],
      extentsMax: [16100, 150, 16700],
      flags: 0,
      doodadSet: 1,
      nameSet: 0,
      scale: 0,
    },
  ];
  doc.chunks[4].doodadRefs = [0];
  doc.chunks[4].wmoRefs = [0];

  // Water: LVF 0 lake on chunk 5, LVF 2 ocean sub-rect on chunk 6.
  doc.water = new Array(256).fill(null);
  doc.water[5] = {
    instances: [
      {
        liquidTypeId: 5,
        liquidVertexFormat: 0,
        minHeight: 103,
        maxHeight: 103,
        xOffset: 0,
        yOffset: 0,
        width: 8,
        height: 8,
        existsBitmap: null,
        heightMap: new Float32Array(81).fill(103),
        depthMap: new Uint8Array(81).fill(20),
        uvMap: null,
      },
    ],
    attributes: { fishable: 0xffffffffffffffffn, deep: 0x00000000ffffffffn },
  };
  doc.water[6] = {
    instances: [
      {
        liquidTypeId: 6,
        liquidVertexFormat: 2,
        minHeight: 90,
        maxHeight: 90,
        xOffset: 2,
        yOffset: 3,
        width: 4,
        height: 2,
        existsBitmap: new Uint8Array([0b10111111]),
        heightMap: null,
        depthMap: new Uint8Array(15).fill(200),
        uvMap: null,
      },
    ],
    attributes: null,
  };

  // Flight bounds + texture flags + an unknown chunk.
  doc.mfbo = {
    maximum: Int16Array.from([900, 900, 900, 900, 900, 900, 900, 900, 900]),
    minimum: Int16Array.from([-100, -100, -100, -100, -100, -100, -100, -100, -100]),
  };
  doc.textureFlags = [0, 0];
  doc.extraChunks = [{ magic: 'MAMP', data: new Uint8Array([1, 0, 0, 0]) }];

  return doc;
}

function expectDocsEqual(a: AdtDoc, b: AdtDoc): void {
  expect(b.version).toBe(a.version);
  expect(b.textures).toEqual(a.textures);
  expect(b.m2Models).toEqual(a.m2Models);
  expect(b.wmoModels).toEqual(a.wmoModels);
  expect(b.doodads).toEqual(a.doodads);
  expect(b.wmos).toEqual(a.wmos);
  expect(b.mfbo).toEqual(a.mfbo);
  expect(b.textureFlags).toEqual(a.textureFlags);
  expect(b.extraChunks).toEqual(a.extraChunks);
  expect(b.chunks.length).toBe(256);
  for (let i = 0; i < 256; i++) {
    const ca = a.chunks[i];
    const cb = b.chunks[i];
    expect(cb.ix, `chunk ${i} ix`).toBe(ca.ix);
    expect(cb.iy).toBe(ca.iy);
    expect(cb.areaId).toBe(ca.areaId);
    expect(cb.holes).toBe(ca.holes);
    expect(cb.position).toEqual(ca.position);
    expect(cb.heights, `chunk ${i} heights`).toEqual(ca.heights);
    expect(cb.normals).toEqual(ca.normals);
    expect(cb.vertexColors).toEqual(ca.vertexColors);
    expect(cb.shadowMap).toEqual(ca.shadowMap);
    expect(cb.doodadRefs).toEqual(ca.doodadRefs);
    expect(cb.wmoRefs).toEqual(ca.wmoRefs);
    expect(cb.layers.length, `chunk ${i} layer count`).toBe(ca.layers.length);
    for (let l = 0; l < ca.layers.length; l++) {
      expect(cb.layers[l].textureId).toBe(ca.layers[l].textureId);
      expect(cb.layers[l].effectId).toBe(ca.layers[l].effectId);
      expect(cb.layers[l].alpha, `chunk ${i} layer ${l} alpha`).toEqual(ca.layers[l].alpha);
    }
    expect(cb.soundEmitters).toEqual(ca.soundEmitters);
    expect(cb.liquidLegacy, `chunk ${i} MCLQ`).toEqual(ca.liquidLegacy);
    expect(cb.normalsPad, `chunk ${i} MCNR pad`).toEqual(ca.normalsPad);
  }
  if (a.water === null) {
    expect(b.water).toBeNull();
  } else {
    expect(b.water).not.toBeNull();
    for (let i = 0; i < 256; i++) {
      expect(b.water![i], `water cell ${i}`).toEqual(a.water[i]);
    }
  }
}

describe('ADT round-trip', () => {
  it('blank ADT survives serialize -> parse', () => {
    const doc = createBlankAdt('Blank', 1, 2, { baseHeight: 50, textures: ['t.blp'] });
    const parsed = parseAdt(serializeAdt(doc), { mapName: 'Blank', tileX: 1, tileY: 2 });
    expectDocsEqual(doc, parsed);
    expect(parsed.tileX).toBe(1);
    expect(parsed.tileY).toBe(2);
  });

  for (const bigAlpha of [false, true]) {
    it(`rich ADT survives serialize -> parse (bigAlpha=${bigAlpha})`, () => {
      const doc = makeRichAdt(bigAlpha);
      const bytes = serializeAdt(doc);
      const parsed = parseAdt(bytes, { bigAlpha });
      expectDocsEqual(doc, parsed);
    });

    it(`serialization is idempotent (bigAlpha=${bigAlpha})`, () => {
      const doc = makeRichAdt(bigAlpha);
      const once = serializeAdt(doc);
      const twice = serializeAdt(parseAdt(once, { bigAlpha }));
      expect(twice.length).toBe(once.length);
      expect(twice).toEqual(once);
    });
  }

  it('auto-detects big alpha without a WDT hint', () => {
    const doc = makeRichAdt(true);
    const parsed = parseAdt(serializeAdt(doc));
    expect(parsed.bigAlpha).toBe(true);
    const small = makeRichAdt(false);
    const parsedSmall = parseAdt(serializeAdt(small));
    expect(parsedSmall.bigAlpha).toBe(false);
  });

  it('compressed alpha round-trips losslessly', () => {
    const doc = makeRichAdt(true);
    const bytes = serializeAdt(doc, { compressAlpha: true });
    const parsed = parseAdt(bytes, { bigAlpha: true });
    expectDocsEqual(doc, parsed);
  });

  it('rejects non-WotLK versions', () => {
    const doc = createBlankAdt('x', 0, 0);
    const bytes = serializeAdt(doc);
    bytes[8] = 23; // patch MVER payload
    expect(() => parseAdt(bytes)).toThrow(/unsupported version/);
  });
});
