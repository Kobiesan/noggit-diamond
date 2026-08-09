import { describe, expect, it } from 'vitest';
import { createWdt, parseWdt, serializeWdt, wdtBigAlpha, wdtHasTile, wdtSetTile } from './wdt';
import { MPHD_FLAGS } from '../constants';

describe('WDT', () => {
  it('round-trips tiles and flags', () => {
    const wdt = createWdt(MPHD_FLAGS.ADT_HAS_BIG_ALPHA);
    wdtSetTile(wdt, 30, 31, true);
    wdtSetTile(wdt, 0, 0, true);
    wdtSetTile(wdt, 63, 63, true);
    const parsed = parseWdt(serializeWdt(wdt));
    expect(parsed.version).toBe(18);
    expect(parsed.flags).toBe(MPHD_FLAGS.ADT_HAS_BIG_ALPHA);
    expect(wdtHasTile(parsed, 30, 31)).toBe(true);
    expect(wdtHasTile(parsed, 31, 30)).toBe(false);
    expect(wdtHasTile(parsed, 63, 63)).toBe(true);
    expect(parsed.mwmoPresent).toBe(true);
    expect(wdtBigAlpha(parsed)).toBe(true);
  });

  it('serializes byte-identically through a round trip', () => {
    const wdt = createWdt();
    wdtSetTile(wdt, 10, 20, true);
    const once = serializeWdt(wdt);
    const twice = serializeWdt(parseWdt(once));
    expect(twice).toEqual(once);
  });

  it('preserves a global WMO placement', () => {
    const wdt = createWdt(MPHD_FLAGS.WMO_ONLY);
    wdt.globalWmo = 'World\\wmo\\Azeroth\\Buildings\\Stormwind\\Stormwind.wmo';
    wdt.globalWmoPlacement = {
      nameId: 0,
      uniqueId: 1,
      position: [17066, 100, 17066],
      rotation: [0, 0, 0],
      extentsMin: [17000, 0, 17000],
      extentsMax: [17100, 200, 17100],
      flags: 0,
      doodadSet: 0,
      nameSet: 0,
      scale: 0,
    };
    const parsed = parseWdt(serializeWdt(wdt));
    expect(parsed.globalWmo).toBe(wdt.globalWmo);
    expect(parsed.globalWmoPlacement).toEqual(wdt.globalWmoPlacement);
  });
});
