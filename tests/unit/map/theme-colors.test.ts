import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  MAP_THEME_COLORS,
  parseHexColor,
  relativeLuminance,
  type MapTheme,
} from '../../../src/map/index.ts';

const THEMES: MapTheme[] = ['light', 'dark'];

describe('contrast helpers', () => {
  it('matches WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    // #777 on white is the classic "just fails AA" example (≈4.48).
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#fff', '#000')).toBe(contrastRatio('#000000', '#ffffff'));
    expect(relativeLuminance('#ff0000')).toBeCloseTo(0.2126, 4);
  });

  it('rejects malformed colours instead of guessing', () => {
    expect(parseHexColor('red')).toBeNull();
    expect(parseHexColor('#12345')).toBeNull();
    expect(parseHexColor('#0a0B0c')).toEqual([10, 11, 12]);
    expect(() => relativeLuminance('rgba(0,0,0,1)')).toThrow(/hex/);
  });
});

describe('map theme colours', () => {
  it('every colour is a parseable hex value in both themes', () => {
    for (const theme of THEMES) {
      for (const [key, value] of Object.entries(MAP_THEME_COLORS[theme])) {
        expect(parseHexColor(value), `${theme}.${key}`).not.toBeNull();
      }
    }
  });

  it('light and dark palettes differ in their surfaces and text', () => {
    const l = MAP_THEME_COLORS.light;
    const d = MAP_THEME_COLORS.dark;
    for (const key of ['background', 'landuse', 'buildingFill', 'road', 'labelText', 'labelHalo'] as const) {
      expect(l[key]).not.toBe(d[key]);
    }
    expect(relativeLuminance(l.background)).toBeGreaterThan(relativeLuminance(d.background));
  });

  it.each(THEMES)('%s: label text meets WCAG AA (4.5:1) on every surface it can sit on', (theme) => {
    const c = MAP_THEME_COLORS[theme];
    const surfaces = [
      c.background,
      c.landuse,
      c.green,
      c.water,
      c.pitch,
      c.parking,
      c.campusFill,
      c.buildingFill,
    ];
    surfaces.push(c.labelHalo, c.extrusionMeasured, c.extrusionEstimated, c.extrusionUnknown);
    for (const s of surfaces)
      expect(contrastRatio(c.labelText, s), `${c.labelText} on ${s}`).toBeGreaterThanOrEqual(4.5);
    for (const s of [c.labelHalo, c.road, c.roadMajor, c.service, c.background]) {
      expect(contrastRatio(c.roadLabelText, s), `road label on ${s}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEMES)(
    '%s: route, location and selection read against the map (3:1 non-text contrast)',
    (theme) => {
      const c = MAP_THEME_COLORS[theme];
      for (const s of [c.background, c.buildingFill, c.road]) {
        expect(contrastRatio(c.routeLine, s)).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(c.selected, s)).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(c.userDot, s)).toBeGreaterThanOrEqual(3);
      }
      expect(contrastRatio(c.routeLine, c.routeCasing)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(c.path, c.background)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(c.steps, c.background)).toBeGreaterThanOrEqual(3);
    },
  );

  it.each(THEMES)('%s: every POI marker has an outline with 3:1 contrast on every map surface', (theme) => {
    const c = MAP_THEME_COLORS[theme];
    const surfaces = [
      c.background,
      c.landuse,
      c.green,
      c.water,
      c.pitch,
      c.parking,
      c.campusFill,
      c.buildingFill,
      c.road,
      c.roadMajor,
      c.service,
      c.extrusionMeasured,
      c.extrusionEstimated,
      c.extrusionUnknown,
    ];
    // Category fills are config-owned and several sit below 3:1 on these surfaces, so the
    // marker ring (normal and selected) is what keeps every marker perceivable (WCAG 1.4.11).
    for (const ring of [c.poiStroke, c.selectedOutline]) {
      for (const s of surfaces) expect(contrastRatio(ring, s), `${ring} on ${s}`).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(THEMES)('%s: the three building height sources get three distinct colours', (theme) => {
    const c = MAP_THEME_COLORS[theme];
    expect(new Set([c.extrusionMeasured, c.extrusionEstimated, c.extrusionUnknown]).size).toBe(3);
    // Placeholder heights are the lightest tone, so they read as "unknown" rather than data.
    expect(relativeLuminance(c.extrusionUnknown)).toBeGreaterThan(relativeLuminance(c.extrusionMeasured));
    expect(relativeLuminance(c.extrusionUnknown)).toBeGreaterThan(relativeLuminance(c.extrusionEstimated));
  });
});
