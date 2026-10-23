/**
 * Shape of the route slice (owned by the directions workstream). The slice is
 * the single source of truth for the planned route: the directions panel, the
 * navigation HUD and the map overlay all read it.
 */
import type { GeoSample } from '../../geolocation/index.ts';
import type {
  RouteEndpoint,
  RouteOk,
  RoutePreference,
  RouteProfileId,
  RouteResult,
} from '../../routing/index.ts';

export type PickTarget = 'origin' | 'destination';

export interface RouteSlice {
  origin: RouteEndpoint | null;
  destination: RouteEndpoint | null;
  profile: RouteProfileId;
  preference: RoutePreference;
  /** Best route (or the failure) for the current request; null = nothing requested. */
  result: RouteResult | null;
  /** All successful options, best first (alternatives[0] is the best route). Empty after a failure. */
  alternatives: RouteOk[];
  activeAlternative: number;
  /** Next empty-map click (or place click) sets this endpoint. */
  pickingOnMap: PickTarget | null;
  /** 'My location' was chosen for this endpoint; the next accurate, fresh fix fills it. */
  awaitingLocationFor: PickTarget | null;
  /** Why the last "Recalculate from here" failed; navigation keeps following the original route. */
  rerouteError: string | null;
  /**
   * Setters for the request. Each clears the previous result (no stale route is
   * ever shown as current) and ends navigation, which followed the old route.
   */
  setOrigin(e: RouteEndpoint | null): void;
  setDestination(e: RouteEndpoint | null): void;
  swap(): void;
  setProfile(p: RouteProfileId): void;
  setPreference(p: RoutePreference): void;
  /** Stores a solved request. A failure (or null) clears every previous route. */
  setRouteResult(result: RouteResult | null, alternatives: readonly RouteOk[]): void;
  setActiveAlternative(i: number): void;
  setPickingOnMap(t: PickTarget | null): void;
  /** Starts location (user gesture) and fills the endpoint from the next accurate fix. */
  setEndpointToMyLocation(t: PickTarget): void;
  cancelAwaitingLocation(): void;
  /** Called by the nav slice with every fix while an endpoint awaits 'My location'. */
  resolveAwaitingLocation(sample: GeoSample, now?: number): void;
  /**
   * Result of "Recalculate from here" while navigating. Success replaces the
   * route and re-anchors progress; failure keeps the old route and records why.
   */
  applyReroute(from: RouteEndpoint, results: readonly RouteResult[]): boolean;
  clearRoute(): void;
}
