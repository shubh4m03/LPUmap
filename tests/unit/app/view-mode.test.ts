import { describe, expect, it } from 'vitest';
import { createAppStore } from '../../../src/app/store/index.ts';
import {
  buildViewUrl,
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
  supports,
  VIEW_MODE_SUPPORT,
  VIEW_MODES,
  viewModeToParam,
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
