import { describe, expect, it } from 'vitest';
import { Terrain } from '../world/terrain';
import { createBlankAdt } from '../adt/builder';
import { parseAdt } from '../adt/parser';
import { serializeAdt } from '../adt/serializer';
import { CHUNK_SIZE } from '../constants';
import {
  eraseWater,
  getWaterLevel,
  hasWater,
  makeFullInstance,
  paintWater,
  removeChunkWater,
  setChunkWater,
  setWaterLevel,
} from './water';

describe('water editing', () => {
  it('creates a full-cover lake instance (LVF 0)', () => {
    const inst = makeFullInstance(5, 42);
    expect(inst.liquidVertexFormat).toBe(0);
    expect(inst.width).toBe(8);
    expect(inst.height).toBe(8);
    expect(inst.heightMap).toHaveLength(81);
    expect(inst.heightMap![40]).toBe(42);
    expect(inst.existsBitmap).toBeNull();
  });

  it('creates flat ocean instances (LVF 2, no height map)', () => {
    const inst = makeFullInstance(6, 0);
    expect(inst.liquidVertexFormat).toBe(2);
    expect(inst.heightMap).toBeNull();
    expect(inst.depthMap).toHaveLength(81);
  });

  it('sets, levels and removes chunk water', () => {
    const doc = createBlankAdt('T', 0, 0);
    setChunkWater(doc, 10, { typeId: 5, level: 100 });
    expect(hasWater(doc, 10)).toBe(true);
    expect(getWaterLevel(doc, 10)).toBe(100);
    setWaterLevel(doc, 10, 105);
    expect(getWaterLevel(doc, 10)).toBe(105);
    expect(doc.water![10]!.instances[0].heightMap![0]).toBe(105);
    removeChunkWater(doc, 10);
    expect(hasWater(doc, 10)).toBe(false);
    expect(doc.water).toBeNull(); // collapsed when last cell cleared
  });

  it('paints and erases with chunk granularity through Terrain', () => {
    const doc = createBlankAdt('T', 0, 0);
    const t = new Terrain();
    t.addTile(doc);
    t.takeDirty();
    const painted = paintWater(t, CHUNK_SIZE * 2, CHUNK_SIZE * 2, CHUNK_SIZE * 0.9, {
      typeId: 5,
      level: 20,
    });
    expect(painted).toBeGreaterThanOrEqual(4);
    expect(t.takeDirty().length).toBe(painted);
    const erased = eraseWater(t, CHUNK_SIZE * 2, CHUNK_SIZE * 2, CHUNK_SIZE * 0.9);
    expect(erased).toBe(painted);
    expect(doc.water).toBeNull();
  });

  it('survives an ADT serialize/parse round trip', () => {
    const doc = createBlankAdt('T', 3, 4, { textures: ['t.blp'] });
    setChunkWater(doc, 17, { typeId: 5, level: 33.5 });
    setChunkWater(doc, 200, { typeId: 6, level: 0 });
    const parsed = parseAdt(serializeAdt(doc));
    expect(hasWater(parsed, 17)).toBe(true);
    expect(getWaterLevel(parsed, 17)).toBe(33.5);
    expect(parsed.water![200]!.instances[0].liquidVertexFormat).toBe(2);
    expect(parsed.water![16]).toBeNull();
  });
});
