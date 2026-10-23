// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../../../src/config/categories.ts';
import type { CategoryDef } from '../../../src/config/categories.ts';
import { APP_CONFIG } from '../../../src/config/index.ts';
import { classifyTags, matchesMatcher } from '../../../scripts/lib/classify.ts';
import { computeHeight, parseMetres, unnamedBuildingLabel } from '../../../scripts/lib/height.ts';
import { aliasesFromTags, contactFromTags, safeHttpUrl } from '../../../scripts/lib/place-fields.ts';

describe('classifyTags priority', () => {
  it('specific use beats the generic building category', () => {
    expect(classifyTags({ building: 'yes', amenity: 'restaurant' })).toBe('food');
    expect(classifyTags({ building: 'yes' })).toBe('building');
  });

  it('use tags beat building-type values', () => {
    expect(classifyTags({ building: 'apartments', amenity: 'cafe' })).toBe('food');
    expect(classifyTags({ building: 'dormitory' })).toBe('hostel');
    expect(classifyTags({ building: 'university' })).toBe('academic');
  });

  it('registry order decides inside a pass (food bakery before generic shop)', () => {
    expect(classifyTags({ shop: 'bakery' })).toBe('food');
    expect(classifyTags({ shop: 'copyshop' })).toBe('printing');
    expect(classifyTags({ shop: 'mobile_phone' })).toBe('shop');
    expect(classifyTags({ healthcare: 'clinic' })).toBe('health');
  });

  it('matches semicolon lists, never "no", and returns null for untyped features', () => {
    expect(classifyTags({ amenity: 'bank;atm' })).toBe('finance');
    expect(classifyTags({ building: 'no' })).toBeNull();
    expect(classifyTags({ natural: 'tree' })).toBeNull();
    expect(matchesMatcher({ shop: 'no' }, { key: 'shop' })).toBe(false);
  });

  it('uses whatever registry it is given', () => {
    const custom: CategoryDef[] = [
      { ...CATEGORIES[0]!, id: 'b', osm: [{ key: 'building' }] },
      { ...CATEGORIES[0]!, id: 'x', osm: [{ key: 'amenity', values: ['x'] }] },
    ];
    expect(classifyTags({ building: 'yes', amenity: 'x' }, custom)).toBe('x');
  });
});

describe('computeHeight', () => {
  const cfg = APP_CONFIG.map;

  it('prefers a tagged height and marks it as sourced', () => {
    expect(computeHeight({ height: '12.5 m', 'building:levels': '10' })).toMatchObject({
      heightM: 12.5,
      heightSource: 'osm-height',
      levels: 10,
    });
  });

  it('estimates from levels, otherwise falls back', () => {
    expect(computeHeight({ 'building:levels': '4' })).toMatchObject({
      heightM: 4 * cfg.metresPerLevel,
      heightSource: 'osm-levels-estimate',
    });
    expect(computeHeight({})).toMatchObject({
      heightM: cfg.fallbackBuildingHeightM,
      heightSource: 'fallback',
      levels: null,
    });
    expect(computeHeight({ height: '40 ft' }).heightSource).toBe('fallback');
    expect(computeHeight({ 'building:levels': '0' }).heightSource).toBe('fallback');
  });

  it('respects min_height and building:min_level', () => {
    expect(computeHeight({ height: '20', min_height: '5' }).minHeightM).toBe(5);
    expect(computeHeight({ 'building:levels': '7', 'building:min_level': '6' }).minHeightM).toBeCloseTo(
      6 * cfg.metresPerLevel,
    );
  });

  it('ignores a minimum that is not below the top instead of emitting an inverted extrusion', () => {
    const h = computeHeight({ 'building:min_level': '5' });
    expect(h).toMatchObject({ minHeightM: 0, minHeightIgnored: true, heightSource: 'fallback' });
  });

  it('parses metres strictly', () => {
    expect(parseMetres('7')).toBe(7);
    expect(parseMetres(' 7.5m ')).toBe(7.5);
    expect(parseMetres('7;8')).toBeNull();
    expect(parseMetres(undefined)).toBeNull();
  });
});

describe('labels and tag fields', () => {
  it('labels unnamed buildings truthfully', () => {
    expect(unnamedBuildingLabel(null)).toBe('Unnamed building');
    expect(unnamedBuildingLabel(1)).toBe('Unnamed building · 1 floor');
    expect(unnamedBuildingLabel(10)).toBe('Unnamed building · 10 floors');
    expect(unnamedBuildingLabel(2.5)).toBe('Unnamed building');
  });

  it('collects name variants that differ from the name', () => {
    expect(
      aliasesFromTags(
        {
          name: 'Lovely Professional University',
          'name:en': 'Lovely Professional University',
          short_name: 'LPU;lpu',
          old_name: 'LPU Old',
        },
        'Lovely Professional University',
      ),
    ).toEqual(['LPU', 'LPU Old']);
  });

  it('keeps only valid http(s) websites', () => {
    expect(safeHttpUrl('https://www.lpu.in/')).toBe('https://www.lpu.in/');
    expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeHttpUrl('www.lpu.in')).toBeUndefined();
    expect(safeHttpUrl('ftp://example.org')).toBeUndefined();
    expect(contactFromTags({ 'contact:phone': '+91 1', website: 'bad' })).toEqual({ phone: '+91 1' });
    expect(contactFromTags({})).toBeUndefined();
  });
});
