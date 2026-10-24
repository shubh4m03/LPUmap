import { describe, expect, it } from 'vitest';
import { createAppStore } from '../../../src/app/store/index.ts';
import {
  PHOTOREAL_PROVIDER,
  PHOTOREAL_UNAVAILABLE_REASON,
  PROVIDER_FAILURE_REASONS,
  SATELLITE_NOT_CONFIGURED_REASON,
} from '../../../src/map/providers/types.ts';
import {
  buildViewUrl,
  deepLinkViewMode,
  DEFAULT_VIEW_MODE_AVAILABILITY,
  ISOMETRIC_DURING_NAVIGATION_REASON,
  isMapViewMode,
  locationSwitchAnnouncement,
  MAP_UNAVAILABLE_REASON,
  supportsCanvas2D,
  VIEW_MODE_NAMES,
  viewModeBlockedReason,
  mode3dFor,
  navigationSwitchAnnouncement,
  parseViewParam,
  providerBlockedReason,
  resolveViewMode,
  supports,
  VIEW_MODE_DESCRIPTIONS,
  VIEW_MODE_FALLBACKS,
  VIEW_MODE_IMAGERY,
  VIEW_MODE_LABELS,
  VIEW_MODE_OPTIONS,
  VIEW_MODE_SUPPORT,
  VIEW_MODE_TITLES,
  VIEW_MODES,
  viewModeToParam,
  type ViewMode,
} from '../../../src/app/view-mode.ts';

describe('?view= deep-link parameter', () => {
  it('parses 3d / iso / 2d (case-insensitive) and ignores unknown or missing values', () => {
    expect(parseViewParam('?view=3d')).toBe('realistic3d');
    expect(parseViewParam('?place=osm:way/1&view=ISO')).toBe('isometric');
    expect(parseViewParam('?view=2d')).toBe('standard2d');
    expect(parseViewParam('?view=vr')).toBeNull();
    expect(parseViewParam('?view=')).toBeNull();
    expect(parseViewParam('')).toBeNull();
  });

  it('round-trips through buildViewUrl, keeping other params and the hash', () => {
    for (const m of VIEW_MODES) {
      const url = buildViewUrl('https://example.org/app/?place=osm:way/1#x', m);
      expect(parseViewParam(new URL(url).search)).toBe(m);
      expect(url).toContain('place=osm');
      expect(url.endsWith('#x')).toBe(true);
      expect(url).toContain(`view=${viewModeToParam(m)}`);
    }
    expect(buildViewUrl('https://example.org/?view=iso&a=1', null)).toBe('https://example.org/?a=1');
  });
});

describe('capability matrix', () => {
  it('has an entry for every capability in every mode, with a reason whenever unsupported', () => {
    const caps = Object.keys(VIEW_MODE_SUPPORT.realistic3d).sort();
    for (const m of VIEW_MODES) {
      expect(Object.keys(VIEW_MODE_SUPPORT[m]).sort()).toEqual(caps);
      for (const s of Object.values(VIEW_MODE_SUPPORT[m])) {
        if (s.supported) expect(s.reason).toBeNull();
        else expect(s.reason).toMatch(/\S/);
      }
    }
  });

  it('runs live navigation only in the map modes and says why not in the overview', () => {
    expect(supports('realistic3d', 'live-navigation').supported).toBe(true);
    expect(supports('standard2d', 'live-navigation').supported).toBe(true);
    expect(supports('isometric', 'live-navigation')).toEqual({
      supported: false,
      reason: expect.stringMatching(/map view/),
    });
    for (const m of VIEW_MODES) {
      expect(supports(m, 'select').supported).toBe(true);
      expect(supports(m, 'directory').supported).toBe(true);
      expect(supports(m, 'route-plan').supported).toBe(true);
    }
    expect(navigationSwitchAnnouncement('standard2d')).toBe(
      'Live navigation uses the map view. Switched to 2D map.',
    );
  });

  it('derives mode3d and map-mode membership', () => {
    expect(VIEW_MODES.map(mode3dFor)).toEqual([true, false, false]);
    expect(VIEW_MODES.map(isMapViewMode)).toEqual([true, false, true]);
  });
});

describe('view-mode store state', () => {
  it('starts from viewMode, or from the legacy mode3d option', () => {
    expect(createAppStore({ map: { viewMode: 'isometric' } }).getState()).toMatchObject({
      viewMode: 'isometric',
      mode3d: false,
      lastMapMode: 'realistic3d',
    });
    expect(createAppStore({ map: { mode3d: false } }).getState()).toMatchObject({
      viewMode: 'standard2d',
      lastMapMode: 'standard2d',
    });
    expect(createAppStore({ map: { mode3d: false, viewMode: 'realistic3d' } }).getState().viewMode).toBe(
      'realistic3d',
    );
  });

  it('keeps mode3d in sync and remembers the last map mode', () => {
    const s = createAppStore({ map: { viewMode: 'standard2d' } });
    expect(s.getState().setViewMode('realistic3d', { reason: 'deep-link' })).toBe(true);
    expect(s.getState()).toMatchObject({
      mode3d: true,
      lastMapMode: 'realistic3d',
      viewModeReason: 'deep-link',
    });
    s.getState().setViewMode('isometric');
    expect(s.getState()).toMatchObject({ viewMode: 'isometric', mode3d: false, lastMapMode: 'realistic3d' });
    s.getState().toggleMode3d(); // from the overview → 3D
    expect(s.getState().viewMode).toBe('realistic3d');
    s.getState().toggleMode3d();
    expect(s.getState()).toMatchObject({ viewMode: 'standard2d', mode3d: false });
    s.getState().setMode3d(true);
    expect(s.getState().viewMode).toBe('realistic3d');
  });

  it('refuses the overview during live navigation without changing state', () => {
    const s = createAppStore({ map: { viewMode: 'standard2d' } });
    s.setState({ navigationActive: true });
    expect(s.getState().setViewMode('isometric')).toBe(false);
    expect(s.getState().viewMode).toBe('standard2d');
    expect(s.getState().setViewMode('realistic3d', { reason: 'navigation' })).toBe(true);
  });
});

describe('map unavailable (no WebGL) and blocked reasons', () => {
  it('switches to the overview and refuses the map modes, with the reason for each', () => {
    const s = createAppStore({ map: { viewMode: 'realistic3d' } });
    s.getState().setMapUnavailable(MAP_UNAVAILABLE_REASON);
    expect(s.getState()).toMatchObject({ viewMode: 'isometric', mode3d: false, viewModeReason: 'fallback' });
    expect(s.getState().setViewMode('standard2d')).toBe(false);
    expect(s.getState().viewMode).toBe('isometric');
    const state = { navigationActive: false, mapUnavailable: MAP_UNAVAILABLE_REASON };
    expect(viewModeBlockedReason('realistic3d', state)).toBe(MAP_UNAVAILABLE_REASON);
    expect(viewModeBlockedReason('isometric', state)).toBeNull();
    expect(viewModeBlockedReason('isometric', { navigationActive: true, mapUnavailable: null })).toBe(
      ISOMETRIC_DURING_NAVIGATION_REASON,
    );
    expect(viewModeBlockedReason('standard2d', { navigationActive: true, mapUnavailable: null })).toBeNull();
  });

  it('names every mode for the switcher and announces a location switch', () => {
    expect(VIEW_MODES.map((m) => VIEW_MODE_NAMES[m])).toEqual(['3D map', 'Isometric overview', '2D map']);
    expect(locationSwitchAnnouncement('realistic3d')).toBe(
      'Live location uses the map view. Switched to 3D map.',
    );
  });

  it('detects Canvas2D only where the browser has it (jsdom has none)', () => {
    expect(supportsCanvas2D()).toBe(false);
  });
});

describe('opt-in layer state', () => {
  it('starts with both opt-in layers off (APP_CONFIG) and restores them with the defaults', () => {
    const s = createAppStore();
    expect(s.getState()).toMatchObject({ showNearbyOutsideCampus: false, showDetectedFootprints: false });
    s.getState().setShowNearbyOutsideCampus(true);
    s.getState().setShowDetectedFootprints(true);
    expect(s.getState()).toMatchObject({ showNearbyOutsideCampus: true, showDetectedFootprints: true });
    s.getState().restoreDefaults();
    expect(s.getState()).toMatchObject({ showNearbyOutsideCampus: false, showDetectedFootprints: false });
  });
});

describe('five modes: satellite and photorealistic (docs/MAP_PROVIDER_CONFIGURATION.md §modes)', () => {
  const NO_BLOCK = { navigationActive: false, mapUnavailable: null };
  const SATELLITE_ON = { satellite: null, photoreal: PHOTOREAL_UNAVAILABLE_REASON };

  it('keeps ?view=3d|iso|2d and adds satellite and earth; every mode round-trips', () => {
    expect(parseViewParam('?view=satellite')).toBe('satellite2d');
    expect(parseViewParam('?view=EARTH')).toBe('photoreal3d');
    expect(VIEW_MODE_OPTIONS).toEqual([
      'satellite2d',
      'photoreal3d',
      'realistic3d',
      'isometric',
      'standard2d',
    ]);
    for (const m of VIEW_MODE_OPTIONS) {
      expect(parseViewParam(new URL(buildViewUrl('https://example.org/', m)).search)).toBe(m);
    }
    expect(VIEW_MODES).toEqual(['realistic3d', 'isometric', 'standard2d']); // today's switcher, unchanged
  });

  it('labels, names, titles and descriptions exist for all five and are distinct', () => {
    for (const table of [VIEW_MODE_LABELS, VIEW_MODE_NAMES, VIEW_MODE_TITLES, VIEW_MODE_DESCRIPTIONS]) {
      const values = VIEW_MODE_OPTIONS.map((m) => table[m]);
      expect(values.every((v) => v.trim().length > 0)).toBe(true);
      expect(new Set(values).size).toBe(5);
    }
    expect(VIEW_MODE_OPTIONS.map((m) => VIEW_MODE_TITLES[m])).toEqual([
      'Satellite 2D',
      'Photorealistic 3D',
      'Campus 3D',
      'Isometric overview',
      'Campus map 2D',
    ]);
    // Truthful copy: imagery is "not live"; photoreal says it is not available.
    expect(VIEW_MODE_DESCRIPTIONS.satellite2d).toMatch(/not live/);
    expect(VIEW_MODE_DESCRIPTIONS.photoreal3d).toMatch(/Not available/);
  });

  it('satellite is a MapLibre mode, photoreal is not; neither is the 3D mode', () => {
    expect(VIEW_MODE_OPTIONS.map(isMapViewMode)).toEqual([true, false, true, false, true]);
    expect(VIEW_MODE_OPTIONS.map(mode3dFor)).toEqual([false, false, true, false, false]);
    expect(VIEW_MODE_IMAGERY).toEqual({
      satellite2d: 'required',
      realistic3d: 'optional',
      photoreal3d: 'none',
      isometric: 'none',
      standard2d: 'none',
    });
  });

  it('blocks satellite until imagery is configured and photoreal always, with reasons', () => {
    expect(DEFAULT_VIEW_MODE_AVAILABILITY).toEqual({
      satellite: SATELLITE_NOT_CONFIGURED_REASON,
      photoreal: PHOTOREAL_UNAVAILABLE_REASON,
    });
    expect(viewModeBlockedReason('satellite2d', NO_BLOCK)).toBe(SATELLITE_NOT_CONFIGURED_REASON);
    expect(viewModeBlockedReason('photoreal3d', NO_BLOCK)).toBe(PHOTOREAL_UNAVAILABLE_REASON);
    expect(viewModeBlockedReason('satellite2d', { ...NO_BLOCK, availability: SATELLITE_ON })).toBeNull();
    // No WebGL wins over a configured provider for the MapLibre satellite mode.
    expect(
      viewModeBlockedReason('satellite2d', {
        ...NO_BLOCK,
        mapUnavailable: MAP_UNAVAILABLE_REASON,
        availability: SATELLITE_ON,
      }),
    ).toBe(MAP_UNAVAILABLE_REASON);
    expect(viewModeBlockedReason('photoreal3d', { ...NO_BLOCK, availability: SATELLITE_ON })).toBe(
      PHOTOREAL_UNAVAILABLE_REASON,
    );
    for (const m of ['realistic3d', 'isometric', 'standard2d'] as ViewMode[])
      expect(providerBlockedReason(m)).toBeNull();
  });

  it('every photoreal capability is unsupported with the reason; satellite behaves like the 2D map', () => {
    for (const s of Object.values(VIEW_MODE_SUPPORT.photoreal3d)) {
      expect(s).toEqual({ supported: false, reason: PHOTOREAL_UNAVAILABLE_REASON });
    }
    expect(VIEW_MODE_SUPPORT.satellite2d).toEqual(VIEW_MODE_SUPPORT.standard2d);
    expect(supports('satellite2d', 'live-navigation').supported).toBe(true);
    expect(navigationSwitchAnnouncement('satellite2d')).toBe(
      'Live navigation uses the map view. Switched to Satellite map.',
    );
  });

  it('deep links never open a mode that is not available (the device default applies)', () => {
    expect(deepLinkViewMode('?view=satellite')).toBeNull();
    expect(deepLinkViewMode('?view=earth')).toBeNull();
    expect(deepLinkViewMode('?view=earth', SATELLITE_ON)).toBeNull();
    expect(deepLinkViewMode('?view=satellite', SATELLITE_ON)).toBe('satellite2d');
    expect(deepLinkViewMode('?view=iso')).toBe('isometric');
    expect(deepLinkViewMode('?view=vr')).toBeNull();
  });

  it('falls back along the documented chains with the reason, never to a blank screen', () => {
    expect(resolveViewMode('photoreal3d', NO_BLOCK)).toEqual({
      mode: 'realistic3d',
      fallbackFrom: 'photoreal3d',
      reason: PHOTOREAL_UNAVAILABLE_REASON,
    });
    expect(resolveViewMode('satellite2d', NO_BLOCK)).toEqual({
      mode: 'standard2d',
      fallbackFrom: 'satellite2d',
      reason: SATELLITE_NOT_CONFIGURED_REASON,
    });
    expect(resolveViewMode('satellite2d', { ...NO_BLOCK, mapUnavailable: MAP_UNAVAILABLE_REASON }).mode).toBe(
      'isometric',
    );
    expect(resolveViewMode('standard2d', NO_BLOCK)).toEqual({
      mode: 'standard2d',
      fallbackFrom: null,
      reason: null,
    });
    // Nothing showable (no WebGL during navigation): the overview, which needs neither WebGL nor a provider.
    expect(
      resolveViewMode('realistic3d', { navigationActive: true, mapUnavailable: MAP_UNAVAILABLE_REASON }).mode,
    ).toBe('isometric');
    for (const m of VIEW_MODE_OPTIONS) {
      expect(VIEW_MODE_FALLBACKS[m]).not.toContain(m);
      expect(VIEW_MODE_FALLBACKS[m]).not.toContain('photoreal3d');
      expect(VIEW_MODE_FALLBACKS[m]).not.toContain('satellite2d');
    }
  });

  it('the store refuses unavailable modes and keeps the current one', () => {
    const s = createAppStore({ map: { viewMode: 'standard2d' } });
    expect(s.getState().setViewMode('photoreal3d')).toBe(false);
    expect(s.getState().setViewMode('satellite2d')).toBe(false);
    expect(s.getState().viewMode).toBe('standard2d');
  });

  it('the photoreal provider is a fixed unavailable record; every failure has a reason', () => {
    expect(PHOTOREAL_PROVIDER).toMatchObject({ kind: 'photoreal', id: 'none', status: 'unavailable' });
    expect(PHOTOREAL_PROVIDER.detail).toMatch(/billing account/);
    expect(PHOTOREAL_PROVIDER.detail).toMatch(/unverified/);
    expect(PHOTOREAL_PROVIDER.detail).toMatch(/not photorealistic/);
    for (const reason of Object.values(PROVIDER_FAILURE_REASONS)) expect(reason).toMatch(/\S/);
  });
});
