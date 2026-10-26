/** Builds search docs from dataset records. Only data that exists in the records is used. */
import { getCategory, type CategoryDef } from '../config/categories.ts';
import { APP_CONFIG } from '../config/index.ts';
import { PLACE_KIND_LABELS } from '../data/place-labels.ts';
import type { Place } from '../data/schema.ts';
import type { ArtworkTerms } from './artwork-docs.ts';
import type { SearchDoc } from './types.ts';

export const PLACE_DOC_PREFIX = 'place:';
export const CATEGORY_DOC_PREFIX = 'category:';
/** Badge of the opt-in "Nearby, outside campus" layer (owner decision 2). */
export const OFF_CAMPUS_LABEL: string = APP_CONFIG.optionalLayers.nearbyOutsideCampus.badge;

/**
 * A code-like alias: short alphanumerics ('B34', 'BH-4') containing a digit,
 * or an all-caps abbreviation of at most 5 letters ('LIM').
 */
export function looksLikeCode(alias: string): boolean {
  const trimmed = alias.trim();
  const compact = trimmed.replace(/[-\s.]/g, '');
  if (!/^[A-Za-z0-9]+$/.test(compact) || compact.length > 6) return false;
  if (/\d/.test(compact)) return true;
  return compact.length >= 2 && compact.length <= 5 && compact === compact.toUpperCase();
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = v.trim();
    if (t === '' || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

/**
 * One doc per place that has a real source name or at least one alias.
 *
 * Places with `name === null` and no aliases are deliberately EXCLUDED: the
 * dataset holds hundreds of truthfully labelled "Unnamed building" records,
 * and indexing their generated display labels would flood every generic query
 * ('building', 'block') with indistinguishable rows. They stay reachable on the
 * map. When a nameless place has a sourced alias, that alias becomes the title
 * — no name is ever invented.
 */
export interface PlaceDocOptions {
  /** Display name of the place another place is located in (from located_in relations). */
  hostName?: (placeId: string) => string | undefined;
  /**
   * v2, owner decision 2: off-campus places (context-places.json) are excluded
   * from campus search unless the "Nearby, outside campus" layer is enabled
   * and the caller passes true. Their subtitle then says "Outside campus".
   */
  includeContext?: boolean;
  /**
   * Map key (Decision D6, e.g. 'C4-07') of a campus building, from
   * buildings.geojson `directoryKey`. A keyed building becomes findable by its
   * key; an unnamed one gets the key as its title ("Map key C4-07"), never an
   * invented name, and no category synonyms (so generic queries are not flooded).
   */
  mapKey?: (placeId: string) => string | null | undefined;
  /**
   * Exact labels, aliases and artwork numbers of the VERIFIED illustration
   * items depicting a building (src/search/artwork-docs.ts). They are search
   * terms of the building's one doc; a building with no other title is titled
   * with its first printed label (never an invented name).
   */
  artworkTerms?: (placeId: string) => ArtworkTerms | undefined;
}

export const MAP_KEY_TITLE_PREFIX = 'Map key';

/**
 * Two docs with the same title (e.g. an OpenStreetMap facility "School of Design"
 * and the university's department of that name, located in it) must be told apart
 * by their subtitle: append the kind and, when known, where it is located.
 */
function disambiguate(docs: SearchDoc[], byId: Map<string, Place>, opts: PlaceDocOptions): void {
  const groups = new Map<string, SearchDoc[]>();
  for (const d of docs) {
    const key = d.title.toLocaleLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const d of group) {
      const place = byId.get(d.ref);
      if (!place) continue;
      const parts = [PLACE_KIND_LABELS[place.kind]];
      const host = opts.hostName?.(place.id);
      if (host) parts.push(`in ${host}`);
      d.qualifier = parts.join(' · ');
      d.subtitle = [d.subtitle, d.qualifier].filter(Boolean).join(' · ');
    }
  }
}

export function docsFromPlaces(places: Place[], opts: PlaceDocOptions = {}): SearchDoc[] {
  const docs: SearchDoc[] = [];
  const byId = new Map<string, Place>();
  for (const place of places) {
    const offCampus = place.campusZone === 'off-campus-nearby';
    if (offCampus && !opts.includeContext) continue;
    const key = place.kind === 'building' && !offCampus ? (opts.mapKey?.(place.id) ?? null) : null;
    const art = place.kind === 'building' && !offCampus ? opts.artworkTerms?.(place.id) : undefined;
    const aliases = uniqueNonEmpty([
      ...(place.aliases ?? []),
      ...(key ? [key] : []),
      ...(art ? [...art.labels, ...art.aliases] : []),
    ]);
    const name = place.name?.trim() ? place.name.trim() : null;
    const sourcedTitle = name ?? uniqueNonEmpty(place.aliases ?? [])[0];
    const artTitle = art?.labels[0];
    const title =
      sourcedTitle ??
      (key ? `${MAP_KEY_TITLE_PREFIX} ${key}` : artTitle !== undefined ? artTitle : undefined);
    if (title === undefined) continue;
    const category = getCategory(place.categoryId);
    const subtitleParts =
      sourcedTitle === undefined
        ? [place.displayName, ...(title === artTitle ? ['Label on the campus illustration'] : [])]
        : [category.label];
    if (offCampus) subtitleParts.push(OFF_CAMPUS_LABEL);
    const keywords =
      sourcedTitle === undefined
        ? []
        : uniqueNonEmpty([...category.synonyms, ...(place.subcategory ? [place.subcategory] : [])]);
    byId.set(place.id, place);
    docs.push({
      id: `${PLACE_DOC_PREFIX}${place.id}`,
      kind: 'place',
      title,
      subtitle: subtitleParts.join(' · '),
      aliases: aliases.filter((a) => a !== title),
      codes: uniqueNonEmpty([...aliases.filter(looksLikeCode), ...(key ? [key] : []), ...(art?.codes ?? [])]),
      keywords,
      categoryId: place.categoryId,
      ref: place.id,
      hasLocation: place.location !== null,
    });
  }
  disambiguate(docs, byId, opts);
  return docs;
}

function mappedLabel(count: number | undefined): string | undefined {
  if (count === undefined || !Number.isFinite(count) || count < 0) return undefined;
  return count === 0 ? 'None mapped yet' : `${Math.floor(count)} mapped`;
}

/**
 * One doc per category so 'atm', 'water' or 'xerox' surface the category
 * action. The subtitle uses only the counts passed in; a category missing from
 * `counts` gets no count rather than a guessed one.
 */
export function docsFromCategories(
  categories: readonly CategoryDef[],
  counts: Record<string, number>,
): SearchDoc[] {
  return categories.map((c) => {
    const subtitle = mappedLabel(counts[c.id]);
    const doc: SearchDoc = {
      id: `${CATEGORY_DOC_PREFIX}${c.id}`,
      kind: 'category',
      title: c.label,
      aliases: uniqueNonEmpty([c.noun]).filter((a) => a.toLowerCase() !== c.label.toLowerCase()),
      codes: [],
      keywords: uniqueNonEmpty(c.synonyms),
      categoryId: c.id,
      ref: c.id,
      hasLocation: false,
    };
    if (subtitle !== undefined) doc.subtitle = subtitle;
    return doc;
  });
}
