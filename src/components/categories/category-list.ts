/** Orders a category's places by distance from an origin, labelling each distance honestly. */
import type { LngLat, Place } from '../../data/index.ts';
import { formatDistance, formatDuration, haversineM } from '../../distance/index.ts';
import { findNearest, type FacilityDirectory } from '../../facilities/index.ts';
import type { Router } from '../../routing/index.ts';

export interface CategoryRow {
  place: Place;
  /** e.g. "350 m walk · 5 min" or "≈ 300 m straight-line"; null without an origin/position. */
  distanceText: string | null;
}

const byName = (a: Place, b: Place) =>
  Number(a.name === null) - Number(b.name === null) || a.displayName.localeCompare(b.displayName);

export function categoryRows(args: {
  categoryId: string;
  directory: FacilityDirectory;
  router: Router;
  origin: LngLat | null;
}): CategoryRow[] {
  const { categoryId, directory, router, origin } = args;
  const places = directory.byCategory(categoryId);
  const located = places.filter((p) => p.location !== null);
  const unlocated = places.filter((p) => p.location === null).sort(byName);
  const tail = unlocated.map((place) => ({ place, distanceText: null }));
  if (!origin) return [...located.sort(byName).map((place) => ({ place, distanceText: null })), ...tail];

  const nearest = findNearest({ origin, categoryId, directory, router, profile: 'walk', limit: 8 });
  const seen = new Set(nearest.map((n) => n.place.id));
  const head: CategoryRow[] = nearest.map((n) => ({
    place: n.place,
    distanceText:
      n.distanceKind === 'route'
        ? `${formatDistance(n.distanceM)} walk${n.durationS !== undefined ? ` · ${formatDuration(n.durationS)}` : ''}`
        : `≈ ${formatDistance(n.distanceM)} straight-line`,
  }));
  const rest = located
    .filter((p) => !seen.has(p.id))
    .map((p) => ({ place: p, d: haversineM(origin, p.location as LngLat) }))
    .sort((a, b) => a.d - b.d)
    .map(({ place, d }) => ({ place, distanceText: `≈ ${formatDistance(d)} straight-line` }));
  return [...head, ...rest, ...tail];
}
