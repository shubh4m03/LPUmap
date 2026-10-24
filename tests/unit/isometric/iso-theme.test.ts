/** WCAG contrast of the overview palette in both themes (§6.5). */
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../../../src/map/contrast.ts';
import { ISO_THEME_COLORS, type IsoTheme } from '../../../src/isometric/iso-theme.ts';

const THEMES: IsoTheme[] = ['light', 'dark'];
const HEX = /^#[0-9a-f]{6}$/i;

describe.each(THEMES)('isometric palette (%s)', (theme) => {
  const c = ISO_THEME_COLORS[theme];
  const ground = [
    c.surroundings,
    c.campusGround,
    c.landuse,
    c.green,
    c.pitch,
    c.parking,
    c.water,
    c.roadBand,
    c.service,
  ];
  const buildings = [...Object.values(c.building), ...Object.values(c.placeholder)];
  /** Best contrast a two-tone mark (fill + outline/halo) reaches against a surface. */
  const best = (a: string, b: string, under: string) =>
    Math.max(contrastRatio(a, under), contrastRatio(b, under));

  it('uses plain hex colours (contrast-testable)', () => {
    const flat = [...Object.values(c).filter((v): v is string => typeof v === 'string'), ...buildings];
    for (const v of flat) expect(v).toMatch(HEX);
  });

  it('label text reaches 4.5:1 on its halo; map-key text on the marker fill', () => {
    expect(contrastRatio(c.labelText, c.labelHalo)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.keyMarkerText, c.labelHalo)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.gridText, c.campusGround)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.endpointText, c.endpointFill)).toBeGreaterThanOrEqual(3);
  });

  it('markers reach 3:1 against every ground and building surface', () => {
    for (const u of [...ground, ...buildings])
      expect(best(c.keyMarkerFill, c.keyMarkerStroke, u)).toBeGreaterThanOrEqual(3);
  });

  it('the selection outline (with its halo) reaches 3:1 everywhere', () => {
    for (const u of [...ground, ...buildings])
      expect(best(c.selected, c.selectedHalo, u)).toBeGreaterThanOrEqual(3);
  });

  it('the route (with its casing) reaches 3:1 against every ground surface', () => {
    for (const u of ground) expect(best(c.route, c.routeCasing, u)).toBeGreaterThanOrEqual(3);
  });

  it('roof and walls differ, so prisms read as solids', () => {
    expect(contrastRatio(c.building.roof, c.building.wallShade)).toBeGreaterThan(1.5);
    expect(c.building.wallLit).not.toBe(c.building.wallMid);
    expect(c.building.wallMid).not.toBe(c.building.wallShade);
  });
});
