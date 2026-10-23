/**
 * Live location, route-following progress and walk tracking.
 *
 * One geolocation watcher serves everything. It starts only from a user
 * gesture (`startLocation`, `startNavigation`, `startTracking`,
 * `setEndpointToMyLocation`) and stops automatically once navigation and
 * tracking have both ended — unless the user explicitly asked to see their
 * location. 'My location' as a route endpoint is one-shot: the watch is
 * released as soon as the endpoint has been filled (or the wait cancelled). Each fix updates progress in O(window) (see
 * src/navigation/progress.ts); the route itself is never recomputed from a
 * fix — only an explicit "Recalculate from here" does that.
 *
 * Privacy: samples live only in this in-memory store. Nothing here logs,
 * persists or transmits a coordinate.
 */
import { APP_CONFIG } from '../../config/index.ts';
import {
  createGeolocationWatcher,
  type GeolocationWatcher,
  type GeolocationWatcherOptions,
  type GeoSample,
  type GeoStatus,
} from '../../geolocation/index.ts';
import {
  createRouteProgress,
  createTrackingSession,
  type RouteProgress,
  type TrackingSession,
} from '../../navigation/index.ts';
import type { NavSlice } from './nav-types.ts';
import type { AppState, SliceCreator } from './types.ts';

/** Statuses during which the browser watch is (still) running. */
const WATCHING: ReadonlySet<GeoStatus> = new Set(['requesting', 'active', 'unavailable', 'timeout']);
/** Statuses after which 'My location' cannot be filled. */
const FINAL_FAILURE: ReadonlySet<GeoStatus> = new Set(['denied', 'unsupported', 'error']);

export type WatcherFactory = (opts: GeolocationWatcherOptions) => GeolocationWatcher;

/**
 * Devices often report a momentary "position unavailable" / timeout between
 * good fixes. Within this long after a fix such a status is held back, and
 * only surfaced if no new fix arrives in the meantime.
 */
export const TRANSIENT_STATUS_GRACE_MS = 10_000;
const TRANSIENT: ReadonlySet<GeoStatus> = new Set(['unavailable', 'timeout']);

const isFresh = (s: GeoSample | null, now: number): s is GeoSample =>
  s !== null && now - s.timestamp <= APP_CONFIG.geolocation.staleAfterMs;

export const createNavSlice =
  (makeWatcher: WatcherFactory = createGeolocationWatcher): SliceCreator<NavSlice> =>
  (set, get) => {
    let watcher: GeolocationWatcher | null = null;
    let progress: RouteProgress | null = null;
    let navTrip: TrackingSession | null = null;
    let tracking: TrackingSession | null = null;
    let heldStatus: ReturnType<typeof setTimeout> | null = null;

    const releaseHeldStatus = () => {
      if (heldStatus !== null) clearTimeout(heldStatus);
      heldStatus = null;
    };

    const activeRoute = () => {
      const { alternatives, activeAlternative } = get();
      return alternatives[activeAlternative] ?? null;
    };

    const onSample = (sample: GeoSample) => {
      const s = get();
      const patch: Partial<AppState> = { lastSample: sample };
      if (s.navigationActive && progress) {
        patch.progress = progress.update(sample);
        if (navTrip) patch.navTrip = navTrip.addSample(sample);
      }
      if (s.trackingActive && tracking) patch.tracking = tracking.addSample(sample);
      set(patch);
      if (s.awaitingLocationFor) get().resolveAwaitingLocation(sample);
    };

    const applyStatus = (status: GeoStatus, message?: string) => {
      releaseHeldStatus();
      set({ geoStatus: status, geoMessage: message ?? null, locationActive: WATCHING.has(status) });
      if (FINAL_FAILURE.has(status) && get().awaitingLocationFor) get().cancelAwaitingLocation();
    };

    const onStatus = (status: GeoStatus, message?: string) => {
      const last = get().lastSample;
      if (TRANSIENT.has(status) && last && Date.now() - last.timestamp < TRANSIENT_STATUS_GRACE_MS) {
        releaseHeldStatus();
        heldStatus = setTimeout(() => applyStatus(status, message), TRANSIENT_STATUS_GRACE_MS);
        return;
      }
      applyStatus(status, message);
    };

    /** Stops the browser watch and forgets the last fix. */
    const stopWatch = () => {
      releaseHeldStatus();
      if (watcher) {
        watcher.stop();
        watcher = null;
      }
      set({
        locationActive: false,
        locationByUser: false,
        lastSample: null,
        geoStatus: 'idle',
        geoMessage: null,
      });
    };

    /**
     * Location is released once nothing needs it and the user never asked to
     * see it. A denial or missing support is kept (the watch is not running
     * anyway) so the UI can go on explaining why location is unavailable.
     */
    const releaseIfUnused = () => {
      const s = get();
      if (s.navigationActive || s.trackingActive || s.locationByUser || s.awaitingLocationFor) return;
      if (s.geoStatus === 'denied' || s.geoStatus === 'unsupported') return;
      stopWatch();
    };

    return {
      geoStatus: 'idle',
      geoMessage: null,
      lastSample: null,
      locationActive: false,
      locationByUser: false,
      navigationActive: false,
      navStartedAt: null,
      progress: null,
      navTrip: null,
      followUser: false,
      trackingActive: false,
      trackingStartedAt: null,
      tracking: null,
      trackingSummary: null,

      startLocation(reason = 'user') {
        if (reason === 'user' && !get().locationByUser) set({ locationByUser: true });
        if (watcher?.active || (watcher && WATCHING.has(get().geoStatus))) return;
        watcher ??= makeWatcher({ onSample, onStatus });
        watcher.start();
      },

      stopLocation() {
        if (get().navigationActive) get().stopNavigation();
        if (get().trackingActive) get().stopTracking();
        stopWatch();
      },

      releaseLocationIfUnused: releaseIfUnused,

      retryLocation() {
        if (!watcher) {
          get().startLocation(get().locationByUser ? 'user' : 'navigation');
          return;
        }
        watcher.stop();
        watcher.start();
      },

      startNavigation() {
        const route = activeRoute();
        if (!route || route.coordinates.length === 0 || get().navigationActive) return;
        const now = Date.now();
        progress = createRouteProgress(route);
        navTrip = createTrackingSession(now);
        const last = get().lastSample;
        const fresh = isFresh(last, now);
        set({
          navigationActive: true,
          navStartedAt: now,
          progress: fresh ? progress.update(last, now) : null,
          navTrip: fresh ? navTrip.addSample(last, now) : navTrip.snapshot(now),
          rerouteError: null,
          pickingOnMap: null,
          followUser: true,
        });
        get().startLocation('navigation');
      },

      stopNavigation() {
        if (!get().navigationActive) return;
        progress = null;
        navTrip = null;
        set({
          navigationActive: false,
          navStartedAt: null,
          progress: null,
          navTrip: null,
          rerouteError: null,
          followUser: false,
        });
        releaseIfUnused();
      },

      setFollowUser(follow) {
        const next = follow && get().navigationActive;
        if (next !== get().followUser) set({ followUser: next });
      },

      rebaseNavigation() {
        if (!get().navigationActive) return;
        const route = activeRoute();
        if (!route || route.coordinates.length === 0) {
          get().stopNavigation();
          return;
        }
        const now = Date.now();
        progress = createRouteProgress(route);
        const last = get().lastSample;
        set({ progress: isFresh(last, now) ? progress.update(last, now) : null });
      },

      startTracking() {
        if (get().trackingActive) return;
        const now = Date.now();
        tracking = createTrackingSession(now);
        const last = get().lastSample;
        set({
          trackingActive: true,
          trackingStartedAt: now,
          tracking: isFresh(last, now) ? tracking.addSample(last, now) : tracking.snapshot(now),
          trackingSummary: null,
        });
        get().startLocation('tracking');
      },

      stopTracking() {
        const s = get();
        if (!s.trackingActive || !tracking) return;
        const final = tracking.stop();
        tracking = null;
        set({
          trackingActive: false,
          tracking: null,
          trackingStartedAt: null,
          trackingSummary: {
            ...final,
            startedAt: s.trackingStartedAt ?? final.endedAt,
            plannedDistanceM: s.navigationActive ? (activeRoute()?.distanceM ?? null) : null,
          },
        });
        releaseIfUnused();
      },

      dismissTrackingSummary: () => set({ trackingSummary: null }),
    };
  };
