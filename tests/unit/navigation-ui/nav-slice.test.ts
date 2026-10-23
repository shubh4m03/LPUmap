import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppStore } from '../../../src/app/store/index.ts';
import { createGeolocationWatcher, GEO_MESSAGES } from '../../../src/geolocation/index.ts';
import type { RouteOk } from '../../../src/routing/index.ts';
import { createFakeGeolocation, storageSnapshot, type FakeGeolocation } from './fake-geolocation.ts';

/** Synthetic straight route along a parallel (~190 m). */
const ROUTE: RouteOk = {
  ok: true,
  profile: 'walk',
  preference: 'shortest',
  coordinates: [
    [75.7, 31.25],
    [75.701, 31.25],
    [75.702, 31.25],
  ],
  distanceM: 190,
  durationS: 146,
  edgeIds: [0, 1],
  steps: [],
  caveats: [],
  snap: { fromM: 0, toM: 0 },
};

let geo: FakeGeolocation;
const makeStore = () =>
  createAppStore({
    watcherFactory: (o) =>
      createGeolocationWatcher({ ...o, geolocation: geo.geolocation, secureContext: true }),
  });

describe('nav slice with a fake Geolocation', () => {
  let before: string;
  beforeEach(() => {
    geo = createFakeGeolocation();
    localStorage.clear();
    sessionStorage.clear();
    before = storageSnapshot();
  });
  afterEach(() => {
    // Coordinates must never reach web storage, whatever the test did.
    expect(storageSnapshot()).toBe(before);
  });

  it('start/stop: one watch, cleared exactly once even when stop is repeated', () => {
    const s = makeStore();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    s.getState().startLocation();
    s.getState().startLocation();
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    expect(s.getState()).toMatchObject({
      geoStatus: 'requesting',
      locationActive: true,
      locationByUser: true,
    });
    geo.emit([75.7, 31.25], 8, Date.now());
    expect(s.getState().geoStatus).toBe('active');
    expect(s.getState().lastSample?.accuracyM).toBe(8);
    s.getState().stopLocation();
    s.getState().stopLocation();
    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
    expect(s.getState()).toMatchObject({ lastSample: null, locationActive: false, geoStatus: 'idle' });
    expect(setItem).not.toHaveBeenCalled();
  });

  it('denial is reported with how to re-enable it, and the watch is cleared', () => {
    const s = makeStore();
    s.getState().startLocation();
    geo.fail(1);
    expect(s.getState()).toMatchObject({ geoStatus: 'denied', locationActive: false });
    expect(s.getState().geoMessage).toBe(GEO_MESSAGES.denied);
    expect(s.getState().geoMessage).toMatch(/site settings/);
    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
    s.getState().stopLocation();
    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
  });

  it('timeout keeps watching and retry restarts the watch without ending navigation', () => {
    const s = makeStore();
    s.getState().setRouteResult(ROUTE, [ROUTE]);
    s.getState().startNavigation();
    geo.fail(3);
    expect(s.getState()).toMatchObject({
      geoStatus: 'timeout',
      locationActive: true,
      navigationActive: true,
    });
    s.getState().retryLocation();
    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
    expect(s.getState().navigationActive).toBe(true);
  });

  it('location started for navigation stops when navigation ends; a user-enabled one stays on', () => {
    const s = makeStore();
    s.getState().setRouteResult(ROUTE, [ROUTE]);
    s.getState().startNavigation();
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    expect(s.getState().locationByUser).toBe(false);
    s.getState().stopNavigation();
    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
    expect(s.getState().locationActive).toBe(false);

    s.getState().startLocation('user');
    s.getState().startNavigation();
    s.getState().stopNavigation();
    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
    expect(s.getState().locationActive).toBe(true);
  });

  it('progress is updated per fix without re-routing; a stale stored fix is not used to start', () => {
    const s = makeStore();
    const setRouteResult = vi.spyOn(s.getState(), 'setRouteResult');
    s.getState().setRouteResult(ROUTE, [ROUTE]);
    s.getState().startNavigation();
    const t = Date.now();
    geo.emit([75.7, 31.25], 8, t);
    geo.emit([75.701, 31.25], 8, t + 20_000);
    const p = s.getState().progress!;
    expect(p.remainingM).toBeGreaterThan(80);
    expect(p.remainingM).toBeLessThan(110);
    expect(s.getState().navTrip?.acceptedSamples).toBe(2);
    expect(setRouteResult).toHaveBeenCalledTimes(1);
  });

  it('walk tracking: distance from accepted movement, summary on stop, nothing kept afterwards', () => {
    const s = makeStore();
    s.getState().startTracking();
    expect(s.getState()).toMatchObject({ trackingActive: true, locationActive: true });
    const t = Date.now();
    geo.emit([75.7, 31.25], 5, t);
    geo.emit([75.7005, 31.25], 5, t + 15_000);
    geo.emit([75.701, 31.25], 200, t + 30_000); // low accuracy: ignored
    geo.emit([75.701, 31.25], 5, t + 45_000);
    expect(s.getState().tracking?.travelledM).toBeGreaterThan(85);
    s.getState().stopTracking();
    const summary = s.getState().trackingSummary!;
    expect(summary.travelledM).toBeGreaterThan(85);
    expect(summary.travelledM).toBeLessThan(105);
    expect(summary.rejectedSamples).toBe(1);
    expect(summary.plannedDistanceM).toBeNull();
    expect(s.getState()).toMatchObject({ trackingActive: false, tracking: null, locationActive: false });
    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
    s.getState().dismissTrackingSummary();
    expect(s.getState().trackingSummary).toBeNull();
  });

  it('tracking stopped during navigation records the planned distance', () => {
    const s = makeStore();
    s.getState().setRouteResult(ROUTE, [ROUTE]);
    s.getState().startNavigation();
    s.getState().startTracking();
    s.getState().stopTracking();
    expect(s.getState().trackingSummary?.plannedDistanceM).toBe(190);
    expect(s.getState().locationActive).toBe(true); // navigation still needs it
  });

  it('explicitly stopping location ends navigation and tracking', () => {
    const s = makeStore();
    s.getState().setRouteResult(ROUTE, [ROUTE]);
    s.getState().startNavigation();
    s.getState().startTracking();
    s.getState().stopLocation();
    expect(s.getState()).toMatchObject({
      navigationActive: false,
      trackingActive: false,
      locationActive: false,
    });
    expect(s.getState().trackingSummary).not.toBeNull();
    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
  });

  it('a momentary "unavailable" between good fixes is held back; a lasting one is reported', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const s = makeStore();
      s.getState().startLocation();
      geo.emit([75.7, 31.25], 8, Date.now());
      geo.fail(2);
      expect(s.getState().geoStatus).toBe('active');
      geo.emit([75.7, 31.25], 8, Date.now() + 1000);
      vi.advanceTimersByTime(20_000);
      expect(s.getState().geoStatus).toBe('active');
      geo.fail(2);
      vi.advanceTimersByTime(10_000);
      expect(s.getState()).toMatchObject({ geoStatus: 'unavailable', geoMessage: GEO_MESSAGES.unavailable });
      s.getState().stopLocation();
    } finally {
      vi.useRealTimers();
    }
  });

  it('unsupported (insecure context) never calls watchPosition', () => {
    const s = createAppStore({
      watcherFactory: (o) =>
        createGeolocationWatcher({ ...o, geolocation: geo.geolocation, secureContext: false }),
    });
    s.getState().startLocation();
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(s.getState()).toMatchObject({ geoStatus: 'unsupported', locationActive: false });
  });
});
