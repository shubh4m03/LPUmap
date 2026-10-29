/**
 * Owner/community locations list model (pure): URL filters, client-side
 * filtering of the full list (GET /locations returns every location incl.
 * hidden; there are few), and picking a record from a map click.
 */
import type { LngLat } from '../../../data/index.ts';
import { haversineM } from '../../../distance/index.ts';
import type { LocationRecord } from '../../api/schemas.ts';

export interface LocationFilters {
  status: 'all' | 'active' | 'hidden';
  origin: 'all' | 'owner' | 'community';
  q: string;
}

export const DEFAULT_LOCATION_FILTERS: LocationFilters = { status: 'all', origin: 'all', q: '' };

/** The route id of the "new location" editor (real ids are own:… / com:…). */
export const NEW_LOCATION_ID = 'new';

export function parseLocationFilters(query: Readonly<Record<string, string>>): LocationFilters {
  return {
    status: query.status === 'active' || query.status === 'hidden' ? query.status : 'all',
    origin: query.origin === 'owner' || query.origin === 'community' ? query.origin : 'all',
    q: (query.q ?? '').trim().slice(0, 120),
  };
}

export function locationFiltersQuery(f: LocationFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.status !== 'all') out.status = f.status;
  if (f.origin !== 'all') out.origin = f.origin;
  if (f.q) out.q = f.q;
  return out;
}

const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

export function filterLocations(items: readonly LocationRecord[], f: LocationFilters): LocationRecord[] {
  const q = fold(f.q);
  return items
    .filter(
      (l) =>
        (f.status === 'all' || l.status === f.status) &&
        (f.origin === 'all' || l.origin === f.origin) &&
        (!q || fold(l.name).includes(q) || l.id.toLowerCase().includes(q)),
    )
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** The location nearest to a map click within `maxM`, or null. */
export function locationNear(items: readonly LocationRecord[], at: LngLat, maxM = 25): LocationRecord | null {
  let best: LocationRecord | null = null;
  let bestD = Infinity;
  for (const l of items) {
    const d = haversineM(at, l.location);
    if (d <= maxM && d < bestD) {
      best = l;
      bestD = d;
    }
  }
  return best;
}
