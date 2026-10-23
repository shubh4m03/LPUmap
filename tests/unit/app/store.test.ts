import { describe, expect, it, vi } from 'vitest';
import {
  buildRouteOverlay,
  createAppStore,
  DEFAULT_VISIBLE_GROUPS,
  selectOverlayDepth,
} from '../../../src/app/store/index.ts';
import { LAYER_GROUPS } from '../../../src/config/categories.ts';
import type { GeolocationWatcherOptions, GeoSample } from '../../../src/geolocation/index.ts';
import type { RouteOk } from '../../../src/routing/index.ts';

function fakeWatcher() {
  let opts: GeolocationWatcherOptions | null = null;
  const start = vi.fn(() => opts?.onStatus('requesting'));
  const stop = vi.fn(() => opts?.onStatus('idle'));
  const factory = (o: GeolocationWatcherOptions) => {
    opts = o;
    return {
      start,
      stop,
      get status() {
        return 'idle' as const;
      },
      get active() {
        return false;
      },
    };
  };
  return {
    factory,
    start,
    stop,
    emit: (s: GeoSample) => opts?.onSample(s),
    status: (s: Parameters<GeolocationWatcherOptions['onStatus']>[0], m?: string) => opts?.onStatus(s, m),
  };
}

const route = (coords: Array<[number, number]>): RouteOk => ({
  ok: true,
  profile: 'walk',
  preference: 'shortest',
  coordinates: coords,
  distanceM: 100,
  durationS: 80,
  edgeIds: [0],
  steps: [],
  caveats: [],
  snap: { fromM: 0, toM: 0 },
});

describe('ui slice', () => {
  it('stacks panels, returns to an existing panel and pops on close', () => {
    const s = createAppStore({ map: { mode3d: false } });
    s.getState().openPanel('category');
    s.getState().openPanel('details');
    s.getState().openPanel('directions');
    expect(s.getState().panelStack).toEqual(['category', 'details', 'directions']);
    s.getState().openPanel('details');
    expect(s.getState().panelStack).toEqual(['category', 'details']);
    expect(s.getState().activePanel).toBe('details');
    s.getState().closePanel();
    expect(s.getState().activePanel).toBe('category');
    s.getState().closePanel();
    s.getState().closePanel();
    expect(s.getState().activePanel).toBe('none');
  });

  it('counts palette and panels as history layers', () => {
    const s = createAppStore();
    s.getState().openPanel('layers');
    s.getState().openPalette('atm');
    expect(selectOverlayDepth(s.getState())).toBe(2);
    expect(s.getState().paletteInitialQuery).toBe('atm');
    s.getState().closePalette();
    expect(selectOverlayDepth(s.getState())).toBe(1);
  });

  it('opening a report closes the palette; category/results set their subject', () => {
    const s = createAppStore();
    s.getState().openPalette();
    s.getState().openReport({ kind: 'missing-facility', placeName: 'xyz' });
    expect(s.getState().paletteOpen).toBe(false);
    expect(s.getState().reportTarget).toEqual({ kind: 'missing-facility', placeName: 'xyz' });
    s.getState().openCategory('water');
    expect(s.getState()).toMatchObject({ categoryId: 'water', activePanel: 'category' });
    s.getState().showResults('block');
    expect(s.getState()).toMatchObject({ resultsQuery: 'block', activePanel: 'results' });
  });
});

describe('selection slice', () => {
  it('selecting opens details and requests focus; closing details clears the selection', () => {
    const s = createAppStore();
    s.getState().selectPlace('osm:node/1');
    expect(s.getState().selectedPlaceId).toBe('osm:node/1');
    expect(s.getState().activePanel).toBe('details');
    expect(s.getState().focusRequest).toMatchObject({ kind: 'place', placeId: 'osm:node/1' });
    s.getState().closePanel();
    expect(s.getState().selectedPlaceId).toBeNull();
  });

  it('can select without moving the camera, and focus requests are distinct', () => {
    const s = createAppStore();
    s.getState().selectPlace('osm:node/1', { focus: false });
    expect(s.getState().focusRequest).toBeNull();
    s.getState().requestFocus({ kind: 'reset' });
    const first = s.getState().focusRequest?.seq;
    s.getState().requestFocus({ kind: 'reset' });
    expect(s.getState().focusRequest?.seq).not.toBe(first);
  });

  it('clearSelection closes the details panel only when it is on top', () => {
    const s = createAppStore();
    s.getState().selectPlace('a');
    s.getState().openPanel('directions');
    s.getState().clearSelection();
    expect(s.getState().activePanel).toBe('directions');
    expect(s.getState().selectedPlaceId).toBeNull();
  });
});

describe('map slice', () => {
  it('defaults to every layer group visible and restores defaults', () => {
    const s = createAppStore({ map: { mode3d: true } });
    expect([...s.getState().visibleGroups].sort()).toEqual(LAYER_GROUPS.map((g) => g.id).sort());
    s.getState().toggleGroup('food');
    s.getState().setGroupVisible('water', false);
    s.getState().setShowLabels(false);
    expect(s.getState().visibleGroups.has('food')).toBe(false);
    expect(s.getState().visibleGroups.has('water')).toBe(false);
    s.getState().restoreDefaults();
    expect(s.getState().visibleGroups).toBe(DEFAULT_VISIBLE_GROUPS);
    expect(s.getState().showLabels).toBe(true);
  });

  it('keeps the same Set when visibility does not change, and toggles 3D', () => {
    const s = createAppStore({ map: { mode3d: false } });
    const before = s.getState().visibleGroups;
    s.getState().setGroupVisible('food', true);
    expect(s.getState().visibleGroups).toBe(before);
    s.getState().toggleMode3d();
    expect(s.getState().mode3d).toBe(true);
  });
});

describe('route slice', () => {
  it('changing an endpoint or profile clears the stale result; swap swaps', () => {
    const s = createAppStore();
    const a = { kind: 'point' as const, label: 'A', location: [75.7, 31.25] as [number, number] };
    const b = { kind: 'point' as const, label: 'B', location: [75.701, 31.25] as [number, number] };
    s.getState().setOrigin(a);
    s.getState().setDestination(b);
    s.getState().setRouteResult(route([a.location, b.location]), [route([a.location, b.location])]);
    expect(s.getState().alternatives).toHaveLength(1);
    s.getState().setProfile('cycle');
    expect(s.getState().result).toBeNull();
    expect(s.getState().alternatives).toEqual([]);
    s.getState().swap();
    expect(s.getState().origin?.label).toBe('B');
    s.getState().setActiveAlternative(3);
    expect(s.getState().activeAlternative).toBe(0);
    s.getState().clearRoute();
    expect(s.getState().origin).toBeNull();
  });

  it('builds a map overlay with alternatives, and completed/remaining while navigating', () => {
    const r1 = route([
      [0, 0],
      [1, 1],
    ]);
    const r2 = route([
      [0, 0],
      [2, 2],
    ]);
    expect(buildRouteOverlay([], 0, null, false)).toBeNull();
    expect(buildRouteOverlay([r1, r2], 0, null, false)).toEqual({
      coordinates: r1.coordinates,
      alternatives: [r2.coordinates],
    });
    const progress = {
      completedCoords: [
        [0, 0],
        [0.5, 0.5],
      ],
      remainingCoords: [
        [0.5, 0.5],
        [1, 1],
      ],
    } as never;
    expect(buildRouteOverlay([r1], 0, progress, true)).toMatchObject({
      coordinates: [
        [0.5, 0.5],
        [1, 1],
      ],
      completed: [
        [0, 0],
        [0.5, 0.5],
      ],
    });
  });
});

describe('nav slice', () => {
  it('starts and stops the watcher, keeping the fix in memory only', () => {
    const w = fakeWatcher();
    const s = createAppStore({ watcherFactory: w.factory });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    s.getState().startLocation();
    expect(w.start).toHaveBeenCalledTimes(1);
    expect(s.getState()).toMatchObject({ geoStatus: 'requesting', locationActive: true });
    const sample: GeoSample = {
      lngLat: [75.7, 31.25],
      accuracyM: 8,
      timestamp: Date.now(),
      speedMps: null,
      headingDeg: null,
    };
    w.emit(sample);
    w.status('active');
    expect(s.getState().lastSample).toBe(sample);
    expect(setItem).not.toHaveBeenCalled();
    s.getState().stopLocation();
    expect(w.stop).toHaveBeenCalled();
    expect(s.getState()).toMatchObject({ lastSample: null, locationActive: false, geoStatus: 'idle' });
  });

  it('reports denial with its message and marks location inactive', () => {
    const w = fakeWatcher();
    const s = createAppStore({ watcherFactory: w.factory });
    s.getState().startLocation();
    w.status('denied', 'blocked');
    expect(s.getState()).toMatchObject({ geoStatus: 'denied', geoMessage: 'blocked', locationActive: false });
  });

  it('navigation tracks progress along the active route', () => {
    const w = fakeWatcher();
    const s = createAppStore({ watcherFactory: w.factory });
    const r = route([
      [75.7, 31.25],
      [75.701, 31.25],
    ]);
    s.getState().setRouteResult(r, [r]);
    s.getState().startNavigation();
    expect(s.getState().navigationActive).toBe(true);
    w.emit({
      lngLat: [75.7002, 31.25],
      accuracyM: 5,
      timestamp: Date.now(),
      speedMps: null,
      headingDeg: null,
    });
    expect(s.getState().progress).not.toBeNull();
    s.getState().stopNavigation();
    expect(s.getState()).toMatchObject({ navigationActive: false, progress: null });
  });
});
