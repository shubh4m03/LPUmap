/** Truthful helpers for acting on a place (routing eligibility, endpoints, share links). */
import type { Place } from '../data/index.ts';
import type { FacilityDirectory } from '../facilities/index.ts';
import type { RouteEndpoint } from '../routing/index.ts';
import { buildPlaceUrl } from './deep-link.ts';

/** Why a place cannot be a route endpoint, or null when it can. */
export function routeBlockReason(place: Place, directory: FacilityDirectory): string | null {
  if (place.location === null) return 'No verified map position, so it cannot be routed to.';
  if (!directory.isRoutable(place)) return 'Not connected to the mapped path network.';
  return null;
}

export function placeEndpoint(place: Place): RouteEndpoint | null {
  if (place.location === null) return null;
  return {
    kind: 'place',
    placeId: place.id,
    label: place.displayName,
    location: place.location,
    ...(place.graphNodeId !== undefined ? { nodeId: place.graphNodeId } : {}),
  };
}

export function shareUrlFor(placeId: string): string {
  return buildPlaceUrl(window.location.href, placeId);
}
