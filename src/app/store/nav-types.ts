/**
 * Shape of the nav slice (owned by the navigation workstream): one geolocation
 * watcher, route-following progress and the optional walk-tracking session.
 *
 * Privacy: every coordinate here lives in memory only — never persisted,
 * logged or sent.
 */
import type { GeoSample, GeoStatus } from '../../geolocation/index.ts';
import type { ProgressState, TrackingSnapshot } from '../../navigation/index.ts';

/**
 * Why location was switched on. Only 'user' keeps it on after navigation and
 * tracking end; 'endpoint' ('My location' as a route endpoint) is one-shot.
 */
export type LocationReason = 'user' | 'navigation' | 'tracking' | 'endpoint';

/** Final numbers of a stopped walk-tracking session (shown once, never stored). */
export interface TrackingSummary extends TrackingSnapshot {
  startedAt: number;
  endedAt: number;
  /** Planned route distance when the session ended during navigation, else null. */
  plannedDistanceM: number | null;
}

export interface NavSlice {
  geoStatus: GeoStatus;
  /** Human-readable message for the current geoStatus (GEO_MESSAGES), if any. */
  geoMessage: string | null;
  /** Latest fix, in memory only — never persisted, logged or sent. */
  lastSample: GeoSample | null;
  /** The browser watch is running (requesting, active, unavailable or timeout). */
  locationActive: boolean;
  /** The user explicitly asked to see their location (kept on after navigation ends). */
  locationByUser: boolean;

  navigationActive: boolean;
  navStartedAt: number | null;
  progress: ProgressState | null;
  /** Distance/time actually covered during this navigation (arrival summary). */
  navTrip: TrackingSnapshot | null;
  /**
   * While navigating, the camera follows accepted location fixes. Turned off when the
   * user pans the map; turned back on with the "Follow" button. On by default per trip.
   */
  followUser: boolean;

  /** "Track my walk" session. */
  trackingActive: boolean;
  trackingStartedAt: number | null;
  tracking: TrackingSnapshot | null;
  /** Set when a tracking session stops; cleared when the summary is dismissed. */
  trackingSummary: TrackingSummary | null;

  /** Call only from a user gesture. Defaults to 'user'. */
  startLocation(reason?: LocationReason): void;
  /** Explicit stop: also ends navigation and tracking, which cannot continue without it. */
  stopLocation(): void;
  /**
   * Stops the watch when nothing needs it any more (no navigation, tracking or
   * pending 'My location', and the user never turned location on themselves).
   */
  releaseLocationIfUnused(): void;
  /** Restarts the watch after a timeout or error, without ending navigation or tracking. */
  retryLocation(): void;
  /** Follow the active route with live progress (starts location if needed). */
  startNavigation(): void;
  stopNavigation(): void;
  setFollowUser(follow: boolean): void;
  /** Re-anchor progress on the current active route (after a reroute or option change). */
  rebaseNavigation(): void;
  startTracking(): void;
  stopTracking(): void;
  dismissTrackingSummary(): void;
}
