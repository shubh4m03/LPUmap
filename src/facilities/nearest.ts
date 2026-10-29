/**
 * Nearest-facility discovery. Candidates are pre-filtered by straight-line
 * distance, then (when a router is available) ranked by walking/cycling route
 * distance. A straight-line figure is always labelled as such and never mixed
 * into the route-distance ordering. Results say nothing about whether a
 * facility is open or available.
 */
import type { LngLat, Place } from '../data/index.ts';
import { haversineM, isValidLngLat } from '../distance/index.ts';
import type { RouteProfileId, Router } from '../routing/index.ts';
import type { FacilityDirectory } from './directory.ts';

export interface NearestResult {
  place: Place;
  distanceM: number;
  distanceKind: 'route' | 'straight-line';
  durationS?: number;
}

/** How many straight-line-closest candidates are routed; bounds router work per query. */
export const NEAREST_ROUTE_CANDIDATES = 8;
export const NEAREST_DEFAULT_LIMIT = 5;

export interface FindNearestArgs {
  origin: LngLat;
  categoryId: string;
  directory: FacilityDirectory;
  router?: Router;
  profile?: RouteProfileId;
  limit?: number;
}

const byDistanceThenId = (a: NearestResult, b: NearestResult) =>
  a.distanceM - b.distanceM || (a.place.id < b.place.id ? -1 : a.place.id > b.place.id ? 1 : 0);

function routeTo(router: Router, origin: LngLat, place: Place, location: LngLat, profile: RouteProfileId) {
  try {
    const result = router.route({
      from: { kind: 'point', label: 'Starting point', location: origin },
      to: { kind: 'place', placeId: place.id, label: place.displayName, location, nodeId: place.graphNodeId },
      profile,
    });
    return result.ok && Number.isFinite(result.distanceM) ? result : null;
  } catch {
    return null;
  }
}

export function findNearest(args: FindNearestArgs): NearestResult[] {
  const { origin, categoryId, directory, router, profile = 'walk' } = args;
  const limit = Math.max(0, Math.floor(args.limit ?? NEAREST_DEFAULT_LIMIT));
  if (!isValidLngLat(origin) || limit === 0) return [];

  const straight: Array<NearestResult & { location: LngLat }> = [];
  for (const place of directory.byCategory(categoryId)) {
    const location = place.location;
    if (location === null || !isValidLngLat(location)) continue;
    straight.push({
      place,
      location,
      distanceM: haversineM(origin, location),
      distanceKind: 'straight-line',
    });
  }
  straight.sort(byDistanceThenId);
  const candidates = straight.slice(0, router ? NEAREST_ROUTE_CANDIDATES : limit);
  const strip = ({ place, distanceM }: NearestResult): NearestResult => ({
    place,
    distanceM,
    distanceKind: 'straight-line',
  });
  if (!router) return candidates.map(strip);

  const routed: NearestResult[] = [];
  const fallback: NearestResult[] = [];
  for (const c of candidates) {
    // Only places with a validated network connection are routed. Routing a
    // place without one would let the router snap it onto an arbitrary nearby
    // node — an invented connection presented as a walking distance.
    if (c.place.graphNodeId === undefined) {
      fallback.push(strip(c));
      continue;
    }
    const route = routeTo(router, origin, c.place, c.location, profile);
    if (route) {
      routed.push({
        place: c.place,
        distanceM: route.distanceM,
        distanceKind: 'route',
        durationS: route.durationS,
      });
    } else {
      fallback.push(strip(c));
    }
  }
  routed.sort(byDistanceThenId);
  fallback.sort(byDistanceThenId);
  return [...routed, ...fallback].slice(0, limit);
}
