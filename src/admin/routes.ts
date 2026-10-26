/**
 * /admin URL model (pure). src/main.tsx imports only ./is-admin-path.ts, so
 * nothing here reaches the public entry.
 *
 *   /admin                      → queue
 *   /admin/<section>            → section list
 *   /admin/<section>/<id>       → one record (id percent-encoded: `osm%3Away%2F1`)
 *   ?key=value                  → section filters (kept as plain strings)
 */

import { ADMIN_BASE_PATH, isAdminPath } from './is-admin-path.ts';

export { ADMIN_BASE_PATH, isAdminPath };

export const ADMIN_SECTIONS = [
  'queue',
  'locations',
  'overrides',
  'studio',
  'templates',
  'artwork',
  'audit',
  'quality',
] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export const ADMIN_SECTION_LABELS: Readonly<Record<AdminSection, string>> = {
  queue: 'Moderation queue',
  locations: 'Locations',
  overrides: 'Base-place overrides',
  studio: 'Building Studio',
  templates: 'Templates',
  artwork: 'Artwork',
  audit: 'History',
  quality: 'Quality',
};

export const DEFAULT_ADMIN_SECTION: AdminSection = 'queue';

export interface AdminRoute {
  section: AdminSection;
  /** Decoded record id, or null for the section's list. */
  id: string | null;
  /** Section filters from the query string (empty values dropped). */
  query: Readonly<Record<string, string>>;
}

const isSection = (s: string): s is AdminSection => (ADMIN_SECTIONS as readonly string[]).includes(s);

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * The route for a pathname + search, or null when the path is under /admin
 * but names no known section or has too many segments (the app then replaces
 * the URL with the default section instead of showing a blank page).
 */
export function parseAdminRoute(pathname: string, search = ''): AdminRoute | null {
  if (!isAdminPath(pathname)) return null;
  const rest = pathname.slice(ADMIN_BASE_PATH.length).split('/').filter(Boolean);
  const query: Record<string, string> = {};
  try {
    for (const [k, v] of new URLSearchParams(search)) if (v !== '') query[k] = v;
  } catch {
    // Malformed query: ignore the filters.
  }
  if (rest.length === 0) return { section: DEFAULT_ADMIN_SECTION, id: null, query };
  const [section, rawId, ...extra] = rest;
  if (!section || !isSection(section) || extra.length > 0) return null;
  if (rawId === undefined) return { section, id: null, query };
  const id = decode(rawId);
  if (id === null || id.length === 0 || id.length > 200) return null;
  return { section, id, query };
}

/** Path + query for a route. */
export function adminHref(route: {
  section: AdminSection;
  id?: string | null;
  query?: Readonly<Record<string, string>>;
}): string {
  let path = `${ADMIN_BASE_PATH}/${route.section}`;
  if (route.id) path += `/${encodeURIComponent(route.id)}`;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(route.query ?? {})) if (v !== '') params.set(k, v);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
