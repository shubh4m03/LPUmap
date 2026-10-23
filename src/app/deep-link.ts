/**
 * `?place=<id>` deep links. Ids are validated against the dataset id grammar
 * before use; anything else is ignored.
 */

export const PLACE_PARAM = 'place';
const MAX_ID_LENGTH = 200;
const PLACE_ID_RE = /^(osm:(node|way|relation)\/\d{1,20}|cur:[a-z0-9][a-z0-9-]{0,150})$/;

export function isPlaceIdLike(id: string): boolean {
  return id.length <= MAX_ID_LENGTH && PLACE_ID_RE.test(id);
}

/** Reads a syntactically valid place id from a query string, or null. */
export function parsePlaceParam(search: string): string | null {
  let value: string | null;
  try {
    value = new URLSearchParams(search).get(PLACE_PARAM);
  } catch {
    return null;
  }
  if (value === null) return null;
  const id = value.trim();
  return isPlaceIdLike(id) ? id : null;
}

/** `href` with `?place=` set to `placeId` (or removed when null); other params and the hash are kept. */
export function buildPlaceUrl(href: string, placeId: string | null): string {
  const url = new URL(href);
  if (placeId === null) url.searchParams.delete(PLACE_PARAM);
  else url.searchParams.set(PLACE_PARAM, placeId);
  return url.toString();
}

/** Mirrors the selection in the address bar without adding a history entry. */
export function writePlaceParam(placeId: string | null): void {
  if (typeof window === 'undefined') return;
  const next = buildPlaceUrl(window.location.href, placeId);
  if (next === window.location.href) return;
  try {
    window.history.replaceState(window.history.state, '', next);
  } catch {
    // Some embedded browsers forbid replaceState; the deep link is a convenience only.
  }
}
