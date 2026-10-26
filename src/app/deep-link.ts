/**
 * `?place=<id>` deep links. Ids are validated against the dataset id grammar
 * before use; anything else is ignored. An item of the campus illustration
 * that is not linked to a verified building is selected by its stable `art:`
 * subject id (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §1).
 */

export const PLACE_PARAM = 'place';
const MAX_ID_LENGTH = 200;
/**
 * Base ids (osm:, cur:), published owner/community locations (own:, com:) and
 * published studio buildings (stu:, docs/BUILDING_STUDIO_DESIGN.md S4).
 */
const PLACE_ID_RE =
  /^(osm:(node|way|relation)\/\d{1,20}|cur:[a-z0-9][a-z0-9._-]{0,150}|(own|com):[A-Za-z0-9_-]{1,150}|stu:[a-z2-7]{20,32})$/;

/**
 * Artwork subject id (`art:num-25`, `art:scene-091`, `art:area-scene-pavilion`).
 * Same grammar as ART_SUBJECT_ID_RE in src/isometric-art/schema.ts (kept here
 * so the start-up chunk does not load the schema; a test checks they agree).
 */
export const ARTWORK_ID_RE = /^art:(?:num|scene|area)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ARTWORK_ID_MAX = 64;

/** True for a syntactically valid artwork subject id. */
export function isArtworkId(id: string): boolean {
  return id.length <= ARTWORK_ID_MAX && ARTWORK_ID_RE.test(id);
}

export function isPlaceIdLike(id: string): boolean {
  return (id.length <= MAX_ID_LENGTH && PLACE_ID_RE.test(id)) || isArtworkId(id);
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
