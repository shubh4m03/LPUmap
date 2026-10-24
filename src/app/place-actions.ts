/** Truthful helpers for acting on a place (routing eligibility, endpoints, share links). */
import type { Place } from '../data/index.ts';
import { isRoutablePlace, type FacilityDirectory } from '../facilities/index.ts';
import type { RouteEndpoint } from '../routing/index.ts';
import { buildPlaceUrl } from './deep-link.ts';

/**
 * Owner rule (map spec Phase 6): off-campus places are never LPU facilities or
 * routing destinations, as origin or destination, even with a path node.
 */
export const OUTSIDE_CAMPUS_REASON = 'Outside campus — directions cover campus paths only.';

/** True for a place outside the campus boundary (context places, off-campus locations). */
export function isOffCampus(place: Place): boolean {
  return place.campusZone !== 'on-campus';
}

/** Why a place cannot be a route endpoint, or null when it can. */
export function routeBlockReason(place: Place, directory: FacilityDirectory): string | null {
  if (place.location === null) return 'No verified map position, so it cannot be routed to.';
  if (isOffCampus(place)) return OUTSIDE_CAMPUS_REASON;
  if (!directory.isRoutable(place)) return 'Not connected to the mapped path network.';
  return null;
}

/**
 * The route endpoint of a place, or null when it is not routable: a place is
 * routed to only through its validated path node, never by snapping its
 * drawn position to the nearest path (S7), and never when it is off campus.
 * Every caller, including picking a place on the map, gets the same answer as
 * routeBlockReason.
 */
export function placeEndpoint(place: Place): RouteEndpoint | null {
  if (!isRoutablePlace(place) || place.location === null || place.graphNodeId === undefined) return null;
  return {
    kind: 'place',
    placeId: place.id,
    label: place.displayName,
    location: place.location,
    nodeId: place.graphNodeId,
  };
}

export function shareUrlFor(placeId: string): string {
  return buildPlaceUrl(window.location.href, placeId);
}
