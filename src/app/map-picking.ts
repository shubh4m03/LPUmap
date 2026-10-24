/**
 * "Choose on map" clicks, shared by the MapLibre stage and the isometric overview.
 *
 * A place is routed to only through its validated path node (S7, place-actions.ts).
 * A place that is not connected to the mapped path network therefore cannot be
 * picked as an endpoint; instead of swallowing that click silently, the user is
 * told why and picking stays on, so the next click on a nearby path sets a plain
 * map point. The point is labelled as a picked point, never as the place.
 *
 * An off-campus place (owner rule, map spec Phase 6) is never a route endpoint
 * and gets no "nearby point" suggestion: directions cover campus paths only.
 * Picking stays on, so the user can still pick an arbitrary map point.
 */
import type { LngLat, Place } from '../data/index.ts';
import type { RouteEndpoint } from '../routing/index.ts';
import { isOffCampus, placeEndpoint } from './place-actions.ts';
import { useAppStore, type PickTarget } from './store/index.ts';

export const PICKED_POINT_LABEL = 'Point picked on map';

const roleWord = (role: PickTarget) => (role === 'origin' ? 'start' : 'destination');

/** Toast shown when a picked place is not connected to the mapped paths. */
export function notConnectedPickMessage(name: string, role: PickTarget): string {
  return `“${name}” is not connected to the mapped paths, so it can't be the ${roleWord(role)}. Choose a point on a nearby path instead.`;
}

/** Toast shown when a picked place is outside the campus. No nearby-point suggestion. */
export function outsideCampusPickMessage(name: string, role: PickTarget): string {
  return `“${name}” is outside the campus, so it can't be the ${roleWord(role)}. Directions cover campus paths only.`;
}

/** Toast shown when the user asks for a nearby point instead of an unconnected place. */
export function nearbyPointPrompt(name: string): string {
  return `Choose a point on a mapped path near “${name}”. The route will end at that point; the place itself is not connected to the mapped paths.`;
}

export type PickOutcome =
  /** Not picking: the click is an ordinary selection. */
  | { kind: 'not-picking' }
  /** An endpoint was set and picking ended. */
  | { kind: 'set'; endpoint: RouteEndpoint }
  /** A place without a path connection was clicked; picking stays on. */
  | { kind: 'not-connected'; message: string }
  /** An off-campus place was clicked; it is never an endpoint. Picking stays on. */
  | { kind: 'outside-campus'; message: string }
  /** Nothing usable under the click (the ground click is handled separately). */
  | { kind: 'ignored' };

function setEndpoint(endpoint: RouteEndpoint): void {
  const s = useAppStore.getState();
  if (s.pickingOnMap === 'origin') s.setOrigin(endpoint);
  else s.setDestination(endpoint);
  s.setPickingOnMap(null);
}

/** A place (or nothing) was clicked while the map may be picking a route endpoint. */
export function pickPlaceOnMap(place: Place | undefined): PickOutcome {
  const role = useAppStore.getState().pickingOnMap;
  if (!role) return { kind: 'not-picking' };
  if (!place) return { kind: 'ignored' };
  const endpoint = placeEndpoint(place);
  if (!endpoint) {
    // No verified position at all: nothing to say beyond "pick a point", which the banner says.
    if (place.location === null) return { kind: 'ignored' };
    if (isOffCampus(place))
      return { kind: 'outside-campus', message: outsideCampusPickMessage(place.displayName, role) };
    return { kind: 'not-connected', message: notConnectedPickMessage(place.displayName, role) };
  }
  setEndpoint(endpoint);
  return { kind: 'set', endpoint };
}

/** Empty ground was clicked while the map may be picking a route endpoint. */
export function pickPointOnMap(lngLat: LngLat): PickOutcome {
  if (!useAppStore.getState().pickingOnMap) return { kind: 'not-picking' };
  const endpoint: RouteEndpoint = { kind: 'point', label: PICKED_POINT_LABEL, location: lngLat };
  setEndpoint(endpoint);
  return { kind: 'set', endpoint };
}
