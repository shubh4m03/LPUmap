/** Isometric variants (?view=iso&iso=art|map): illustrated by default, map-accurate fallback, honest capabilities. */
import { describe, expect, it } from 'vitest';
import {
  buildIsometricViewUrl,
  buildViewUrl,
  DEFAULT_ISOMETRIC_VARIANT,
  ILLUSTRATED_PICK_REASON,
  ILLUSTRATED_ROUTE_REASON,
  ISOMETRIC_VARIANT_DESCRIPTIONS,
  ISOMETRIC_VARIANT_LABELS,
  ISOMETRIC_VARIANTS,
  parseIsometricVariantParam,
  parseViewParam,
  resolveIsometricVariant,
  supportsIsometric,
  VIEW_MODE_SUPPORT,
} from '../../../src/app/view-mode.ts';

describe('isometric variant deep links', () => {
  it('keeps ?view=iso working and defaults to the illustrated overview', () => {
    expect(parseViewParam('?view=iso')).toBe('isometric');
    expect(parseIsometricVariantParam('?view=iso')).toBeNull();
    expect(DEFAULT_ISOMETRIC_VARIANT).toBe('illustrated');
    expect(resolveIsometricVariant(null, { artworkUnavailable: null })).toEqual({
      variant: 'illustrated',
      fallbackFrom: null,
      reason: null,
    });
  });

  it('parses iso=art|map only together with view=iso; unknown values are ignored', () => {
    expect(parseIsometricVariantParam('?view=iso&iso=map')).toBe('map-accurate');
    expect(parseIsometricVariantParam('?view=ISO&iso=ART')).toBe('illustrated');
    expect(parseIsometricVariantParam('?view=3d&iso=map')).toBeNull();
    expect(parseIsometricVariantParam('?iso=map')).toBeNull();
    expect(parseIsometricVariantParam('?view=iso&iso=photo')).toBeNull();
  });

  it('round-trips through buildIsometricViewUrl, keeping other params and the hash', () => {
    for (const v of ISOMETRIC_VARIANTS) {
      const url = new URL(buildIsometricViewUrl('https://example.org/?place=osm:way/1#x', v));
      expect(parseViewParam(url.search)).toBe('isometric');
      expect(parseIsometricVariantParam(url.search)).toBe(v);
      expect(url.searchParams.get('place')).toBe('osm:way/1');
      expect(url.hash).toBe('#x');
    }
    expect(buildIsometricViewUrl('https://example.org/?view=iso&iso=map', null)).toBe(
      'https://example.org/?view=iso',
    );
    // switching away from the overview leaves ?iso= harmlessly ignored
    expect(
      parseIsometricVariantParam(
        new URL(buildViewUrl('https://example.org/?view=iso&iso=map', 'standard2d')).search,
      ),
    ).toBeNull();
  });
});

describe('isometric variant truthfulness', () => {
  it('labels both variants distinctly and says the illustration is not geographically exact', () => {
    expect(ISOMETRIC_VARIANT_LABELS).toEqual({
      illustrated: 'Illustrated overview',
      'map-accurate': 'Map-accurate isometric',
    });
    expect(ISOMETRIC_VARIANT_DESCRIPTIONS.illustrated).toMatch(/not geographically exact/);
    expect(ISOMETRIC_VARIANT_DESCRIPTIONS.illustrated).not.toMatch(/3D|rotat/i);
  });

  it('the illustration cannot plan routes, pick points, rotate or tilt — each with a reason', () => {
    expect(supportsIsometric('illustrated', 'route-plan')).toEqual({
      supported: false,
      reason: ILLUSTRATED_ROUTE_REASON,
    });
    expect(supportsIsometric('illustrated', 'pick-endpoint')).toEqual({
      supported: false,
      reason: ILLUSTRATED_PICK_REASON,
    });
    expect(supportsIsometric('illustrated', 'free-rotate').supported).toBe(false);
    expect(supportsIsometric('illustrated', 'pitch').supported).toBe(false);
    expect(supportsIsometric('illustrated', 'select').supported).toBe(true);
    expect(supportsIsometric('illustrated', 'search').supported).toBe(true);
    expect(supportsIsometric('illustrated', 'directory').supported).toBe(true);
  });

  it('the map-accurate variant keeps the existing isometric capabilities', () => {
    for (const cap of Object.keys(
      VIEW_MODE_SUPPORT.isometric,
    ) as (keyof typeof VIEW_MODE_SUPPORT.isometric)[])
      expect(supportsIsometric('map-accurate', cap)).toEqual(VIEW_MODE_SUPPORT.isometric[cap]);
  });

  it('falls back to the map-accurate drawing with the reason when the illustration cannot load', () => {
    expect(resolveIsometricVariant('illustrated', { artworkUnavailable: 'No art.' })).toEqual({
      variant: 'map-accurate',
      fallbackFrom: 'illustrated',
      reason: 'No art.',
    });
    expect(resolveIsometricVariant('map-accurate', { artworkUnavailable: 'No art.' }).variant).toBe(
      'map-accurate',
    );
  });
});
