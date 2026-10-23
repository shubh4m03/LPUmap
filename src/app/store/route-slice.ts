/**
 * Route request + result — the single source of truth for the planned route.
 *
 * The result is computed outside the store (src/app/hooks/useRouteSolver.ts)
 * because the router lives in the data context. Every change to the request
 * clears the old result first, and a failed request leaves no route behind,
 * so a stale route is never displayed as current. Changing the request while
 * navigating ends navigation (it was following the old route); only
 * `applyReroute` swaps the route under a running navigation.
 */
import { APP_CONFIG } from '../../config/index.ts';
import type { GeoSample } from '../../geolocation/index.ts';
import type { RouteEndpoint, RouteOk } from '../../routing/index.ts';
import type { RouteSlice } from './route-types.ts';
import type { AppState, SliceCreator } from './types.ts';

const cleared = (): Pick<RouteSlice, 'result' | 'alternatives' | 'activeAlternative' | 'rerouteError'> => ({
  result: null,
  alternatives: [],
  activeAlternative: 0,
  rerouteError: null,
});

/** Same geometry and edges: re-solving an identical request must not reset live progress. */
export function sameRoute(a: RouteOk | undefined, b: RouteOk | undefined): boolean {
  if (!a || !b) return false;
  if (a.distanceM !== b.distanceM || a.coordinates.length !== b.coordinates.length) return false;
  if (a.edgeIds.length !== b.edgeIds.length || a.edgeIds.some((id, i) => id !== b.edgeIds[i])) return false;
  const [a0, b0] = [a.coordinates[0], b.coordinates[0]];
  return a0 !== undefined && b0 !== undefined && a0[0] === b0[0] && a0[1] === b0[1];
}

/** A fix good enough to plan from: accurate and fresh. */
export function isPlanningFix(sample: GeoSample, now: number): boolean {
  const g = APP_CONFIG.geolocation;
  return sample.accuracyM <= g.maxAcceptedAccuracyM && now - sample.timestamp <= g.staleAfterMs;
}

export const MY_LOCATION_LABEL = 'My location';

export const createRouteSlice: SliceCreator<RouteSlice> = (set, get) => {
  /** Ends navigation (if any) and applies a request change with a cleared result. */
  const changeRequest = (patch: Partial<AppState>) => {
    if (get().navigationActive) get().stopNavigation();
    set({ ...patch, ...cleared() });
  };
  const setEndpoint = (t: 'origin' | 'destination', e: RouteEndpoint | null) =>
    changeRequest(t === 'origin' ? { origin: e } : { destination: e });

  return {
    origin: null,
    destination: null,
    profile: 'walk',
    preference: 'shortest',
    result: null,
    alternatives: [],
    activeAlternative: 0,
    pickingOnMap: null,
    awaitingLocationFor: null,
    rerouteError: null,

    setOrigin(origin) {
      const replacesWait = get().awaitingLocationFor === 'origin';
      changeRequest({ origin, ...(replacesWait ? { awaitingLocationFor: null } : {}) });
      if (replacesWait) get().releaseLocationIfUnused();
    },
    setDestination(destination) {
      const replacesWait = get().awaitingLocationFor === 'destination';
      changeRequest({ destination, ...(replacesWait ? { awaitingLocationFor: null } : {}) });
      if (replacesWait) get().releaseLocationIfUnused();
    },
    swap() {
      const { origin, destination, awaitingLocationFor: a } = get();
      const awaiting = a === 'origin' ? 'destination' : a === 'destination' ? 'origin' : null;
      changeRequest({ origin: destination, destination: origin, awaitingLocationFor: awaiting });
    },
    setProfile: (profile) => {
      if (profile !== get().profile) changeRequest({ profile });
    },
    setPreference: (preference) => {
      if (preference !== get().preference) changeRequest({ preference });
    },

    setRouteResult(result, alternatives) {
      const s = get();
      const ok = result?.ok ? [...alternatives] : [];
      if (s.navigationActive) {
        const current = s.alternatives[s.activeAlternative];
        if (ok.length === 0) {
          // The followed route no longer exists for this request: stop rather than show it as current.
          s.stopNavigation();
        } else if (sameRoute(current, ok[0])) {
          set({ result, alternatives: ok, activeAlternative: 0 });
          return;
        } else {
          set({ result, alternatives: ok, activeAlternative: 0 });
          get().rebaseNavigation();
          return;
        }
      }
      set({ result, alternatives: ok, activeAlternative: 0 });
    },

    setActiveAlternative(i) {
      const { alternatives, activeAlternative } = get();
      if (!Number.isInteger(i) || i < 0 || i >= alternatives.length || i === activeAlternative) return;
      set({ activeAlternative: i });
      if (get().navigationActive) get().rebaseNavigation();
    },

    setPickingOnMap(pickingOnMap) {
      if (!pickingOnMap) {
        set({ pickingOnMap });
        return;
      }
      const wasWaiting = get().awaitingLocationFor !== null;
      set({ pickingOnMap, awaitingLocationFor: null });
      if (wasWaiting) get().releaseLocationIfUnused();
    },

    setEndpointToMyLocation(t) {
      const s = get();
      set({ awaitingLocationFor: t, pickingOnMap: null });
      if (s.lastSample && isPlanningFix(s.lastSample, Date.now())) {
        get().resolveAwaitingLocation(s.lastSample);
        return;
      }
      s.startLocation('endpoint');
    },

    cancelAwaitingLocation() {
      if (!get().awaitingLocationFor) return;
      set({ awaitingLocationFor: null });
      get().releaseLocationIfUnused();
    },

    resolveAwaitingLocation(sample, now = Date.now()) {
      const t = get().awaitingLocationFor;
      if (!t || !isPlanningFix(sample, now)) return;
      const endpoint: RouteEndpoint = { kind: 'point', label: MY_LOCATION_LABEL, location: sample.lngLat };
      set({ awaitingLocationFor: null });
      setEndpoint(t, endpoint);
      // One-shot: the position "at that moment" is all that was asked for.
      get().releaseLocationIfUnused();
    },

    applyReroute(from, results) {
      const best = results[0];
      if (!best || !best.ok) {
        set({ rerouteError: best?.message ?? 'No route was found from your position.' });
        return false;
      }
      const ok = results.filter((r): r is RouteOk => r.ok);
      set({ origin: from, result: best, alternatives: ok, activeAlternative: 0, rerouteError: null });
      get().rebaseNavigation();
      return true;
    },

    clearRoute() {
      const wasWaiting = get().awaitingLocationFor !== null;
      if (get().navigationActive) get().stopNavigation();
      set({ origin: null, destination: null, pickingOnMap: null, awaitingLocationFor: null, ...cleared() });
      if (wasWaiting) get().releaseLocationIfUnused();
    },
  };
};
