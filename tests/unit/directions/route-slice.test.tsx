import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { AtlasContext } from '../../../src/app/data/atlas-context.ts';
import { useRouteSolver } from '../../../src/app/hooks/useRouteSolver.ts';
import { buildRouteOverlay, createAppStore, useAppStore } from '../../../src/app/store/index.ts';
import { createGeolocationWatcher } from '../../../src/geolocation/index.ts';
import type { RouteEndpoint, RouteFailure, RouteOk } from '../../../src/routing/index.ts';
import { resetAppStore, syntheticServices } from '../app/render-helpers.tsx';
import { createFakeGeolocation } from '../navigation-ui/fake-geolocation.ts';

const A: RouteEndpoint = { kind: 'point', label: 'A', location: [75.7, 31.25] };
const B: RouteEndpoint = { kind: 'point', label: 'B', location: [75.702, 31.25] };

const ok = (over: Partial<RouteOk> = {}): RouteOk => ({
  ok: true,
  profile: 'walk',
  preference: 'shortest',
  coordinates: [A.location, B.location],
  distanceM: 190,
  durationS: 146,
  edgeIds: [0, 1],
  steps: [],
  caveats: [],
  snap: { fromM: 0, toM: 0 },
  ...over,
});
const FAIL: RouteFailure = { ok: false, reason: 'no-path', message: 'No connected path.' };

describe('route slice', () => {
  it('set, swap and clear', () => {
    const s = createAppStore();
    s.getState().setOrigin(A);
    s.getState().setDestination(B);
    s.getState().swap();
    expect(s.getState()).toMatchObject({ origin: B, destination: A });
    s.getState().setRouteResult(ok(), [ok()]);
    s.getState().clearRoute();
    expect(s.getState()).toMatchObject({ origin: null, destination: null, result: null, alternatives: [] });
  });

  it('a failed request clears the previous route and its overlay', () => {
    const s = createAppStore();
    s.getState().setOrigin(A);
    s.getState().setDestination(B);
    s.getState().setRouteResult(ok(), [ok(), ok({ edgeIds: [3] })]);
    s.getState().setActiveAlternative(1);
    // Even if a caller passes stale alternatives with a failure, none survive.
    s.getState().setRouteResult(FAIL, [ok()]);
    const st = s.getState();
    expect(st.result).toEqual(FAIL);
    expect(st.alternatives).toEqual([]);
    expect(st.activeAlternative).toBe(0);
    expect(
      buildRouteOverlay(st.alternatives, st.activeAlternative, st.progress, st.navigationActive),
    ).toBeNull();
  });

  it('every request change clears the result and ends navigation that followed it', () => {
    const s = createAppStore();
    s.getState().setRouteResult(ok(), [ok()]);
    s.getState().startNavigation();
    expect(s.getState().navigationActive).toBe(true);
    s.getState().setPreference('fastest');
    expect(s.getState()).toMatchObject({ navigationActive: false, result: null, alternatives: [] });
    s.getState().stopLocation();
  });

  it('re-solving an identical route while navigating keeps progress; a different one re-anchors it', () => {
    const s = createAppStore({
      watcherFactory: () => ({ start() {}, stop() {}, status: 'idle', active: false }),
    });
    s.getState().setRouteResult(ok(), [ok()]);
    s.getState().startNavigation();
    s.setState({ progress: { marker: 1 } as never });
    s.getState().setRouteResult(ok(), [ok()]);
    expect(s.getState().progress).toEqual({ marker: 1 });
    s.getState().setRouteResult(ok({ edgeIds: [9], distanceM: 300 }), [ok({ edgeIds: [9], distanceM: 300 })]);
    expect(s.getState().progress).toBeNull(); // re-anchored, waiting for the next fix
    expect(s.getState().navigationActive).toBe(true);
  });

  it('applyReroute: success replaces the route; failure keeps the original and says why', () => {
    const s = createAppStore({
      watcherFactory: () => ({ start() {}, stop() {}, status: 'idle', active: false }),
    });
    s.getState().setDestination(B);
    s.getState().setRouteResult(ok(), [ok()]);
    s.getState().startNavigation();
    expect(s.getState().applyReroute(A, [FAIL])).toBe(false);
    expect(s.getState()).toMatchObject({ rerouteError: FAIL.message, navigationActive: true });
    expect(s.getState().alternatives).toHaveLength(1);
    const next = ok({ edgeIds: [1], distanceM: 95 });
    expect(s.getState().applyReroute(A, [next])).toBe(true);
    expect(s.getState()).toMatchObject({
      origin: A,
      result: next,
      rerouteError: null,
      navigationActive: true,
    });
  });

  it("'My location' waits for an accurate fresh fix before setting the endpoint", () => {
    const geo = createFakeGeolocation();
    const s = createAppStore({
      watcherFactory: (o) =>
        createGeolocationWatcher({ ...o, geolocation: geo.geolocation, secureContext: true }),
    });
    s.getState().setEndpointToMyLocation('origin');
    expect(s.getState().awaitingLocationFor).toBe('origin');
    geo.emit([75.7, 31.25], 300, Date.now());
    expect(s.getState().origin).toBeNull();
    geo.emit([75.7001, 31.25], 10, Date.now());
    expect(s.getState().origin).toMatchObject({
      kind: 'point',
      label: 'My location',
      location: [75.7001, 31.25],
    });
    expect(s.getState().awaitingLocationFor).toBeNull();
    s.getState().stopLocation();
  });

  it("'My location' is abandoned when location is denied", () => {
    const geo = createFakeGeolocation();
    const s = createAppStore({
      watcherFactory: (o) =>
        createGeolocationWatcher({ ...o, geolocation: geo.geolocation, secureContext: true }),
    });
    s.getState().setEndpointToMyLocation('destination');
    geo.fail(1);
    expect(s.getState()).toMatchObject({ awaitingLocationFor: null, destination: null, geoStatus: 'denied' });
  });

  it("'My location' is one-shot: the watch is released once the endpoint is filled", () => {
    const geo = createFakeGeolocation();
    const s = createAppStore({
      watcherFactory: (o) =>
        createGeolocationWatcher({ ...o, geolocation: geo.geolocation, secureContext: true }),
    });
    s.getState().setEndpointToMyLocation('origin');
    expect(s.getState()).toMatchObject({ locationActive: true, locationByUser: false });
    geo.emit([75.7001, 31.25], 10, Date.now());
    expect(s.getState().origin?.label).toBe('My location');
    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
    expect(s.getState()).toMatchObject({ locationActive: false, lastSample: null, geoStatus: 'idle' });
  });

  it("'My location' keeps location on when the user had turned it on themselves", () => {
    const geo = createFakeGeolocation();
    const s = createAppStore({
      watcherFactory: (o) =>
        createGeolocationWatcher({ ...o, geolocation: geo.geolocation, secureContext: true }),
    });
    s.getState().startLocation();
    s.getState().setEndpointToMyLocation('destination');
    geo.emit([75.7001, 31.25], 10, Date.now());
    expect(s.getState().destination?.label).toBe('My location');
    expect(geo.clearWatch).not.toHaveBeenCalled();
    expect(s.getState().locationActive).toBe(true);
    s.getState().stopLocation();
  });

  it("choosing another start while 'My location' is pending releases the watch", () => {
    const geo = createFakeGeolocation();
    const s = createAppStore({
      watcherFactory: (o) =>
        createGeolocationWatcher({ ...o, geolocation: geo.geolocation, secureContext: true }),
    });
    s.getState().setEndpointToMyLocation('origin');
    s.getState().setOrigin(A);
    expect(s.getState()).toMatchObject({ origin: A, awaitingLocationFor: null, locationActive: false });
    expect(geo.clearWatch).toHaveBeenCalledTimes(1);

    s.getState().setEndpointToMyLocation('origin');
    s.getState().cancelAwaitingLocation();
    expect(s.getState()).toMatchObject({ origin: A, locationActive: false });
    expect(geo.clearWatch).toHaveBeenCalledTimes(2);
  });
});

describe('route solving (useRouteSolver + route slice)', () => {
  afterEach(resetAppStore);

  it('computes on endpoint change and recomputes when the profile changes', () => {
    const services = syntheticServices();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AtlasContext.Provider value={services}>{children}</AtlasContext.Provider>
    );
    renderHook(() => useRouteSolver(), { wrapper });
    act(() => {
      useAppStore.getState().setOrigin(A);
      useAppStore.getState().setDestination(B);
    });
    const walk = useAppStore.getState().result;
    expect(walk?.ok).toBe(true);
    expect(walk?.ok && walk.profile).toBe('walk');
    act(() => useAppStore.getState().setProfile('cycle'));
    const cycle = useAppStore.getState().result;
    expect(cycle?.ok && cycle.profile).toBe('cycle');
    expect(cycle).not.toBe(walk);
    // Same point → failure, and no old route survives.
    act(() => useAppStore.getState().setDestination(A));
    expect(useAppStore.getState().result).toMatchObject({ ok: false, reason: 'same-point' });
    expect(useAppStore.getState().alternatives).toEqual([]);
  });
});
