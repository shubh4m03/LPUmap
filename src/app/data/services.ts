/**
 * Services derived once from the loaded dataset: facility directory, search
 * index, router and lookups. Every count comes from the data itself.
 */
import { CATEGORIES } from '../../config/categories.ts';
import type { CampusData, Place, Relation } from '../../data/index.ts';
import { createFacilityDirectory, type FacilityDirectory } from '../../facilities/index.ts';
import { createRouter, type Router } from '../../routing/index.ts';
import {
  createSearchIndex,
  docsFromCategories,
  docsFromPlaces,
  type SearchDoc,
  type SearchIndex,
} from '../../search/index.ts';
import { commandDocs, layerDocs } from '../commands.ts';

/** Category docs win exact-score ties against places sharing their synonyms. */
export const CATEGORY_DOC_BOOST = 50;

export interface AtlasServices {
  data: CampusData;
  directory: FacilityDirectory;
  searchIndex: SearchIndex;
  router: Router;
  getPlace(id: string): Place | undefined;
  /** All places per category (located or not). */
  categoryCounts: Record<string, number>;
  /** Places with a map position per category. */
  locatedCounts: Record<string, number>;
  /** Display name of a manifest source, falling back to its id. */
  sourceName(sourceId: string): string;
}

/**
 * Category subtitle that does not call a place "mapped" when it has no map
 * position (e.g. the Central Library is listed by the university but unlocated).
 * Undefined keeps the search module's own wording (all places located, or none).
 */
export function categorySubtitle(total: number, located: number): string | undefined {
  if (total === 0 || located >= total) return undefined;
  const missing = total - located;
  if (located === 0) return `${total} listed · no verified map position yet`;
  return `${located} mapped · ${missing} without a verified map position`;
}

/** Display name of the place each place is located_in (first stated relation wins). */
export function hostNames(
  places: Place[],
  relations: readonly Relation[],
): (id: string) => string | undefined {
  const names = new Map(places.map((p) => [p.id, p.displayName]));
  const hosts = new Map<string, string>();
  for (const r of relations) {
    const name = names.get(r.to);
    if (r.type === 'located_in' && name && !hosts.has(r.from)) hosts.set(r.from, name);
  }
  return (id) => hosts.get(id);
}

export function buildSearchDocs(
  places: Place[],
  categoryCounts: Record<string, number>,
  locatedCounts: Record<string, number>,
  relations: readonly Relation[] = [],
): SearchDoc[] {
  // Every registered category gets a count; absent from the data means 0 ("None mapped yet").
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, categoryCounts[c.id] ?? 0]));
  const categories = docsFromCategories(CATEGORIES, counts).map((d) => {
    const subtitle = categorySubtitle(categoryCounts[d.ref] ?? 0, locatedCounts[d.ref] ?? 0);
    return { ...d, ...(subtitle ? { subtitle } : {}), boost: CATEGORY_DOC_BOOST };
  });
  return [
    ...categories,
    ...docsFromPlaces(places, { hostName: hostNames(places, relations) }),
    ...layerDocs(locatedCounts),
    ...commandDocs(),
  ];
}

export function buildServices(data: CampusData): AtlasServices {
  const directory = createFacilityDirectory(data.places, data.relations);
  const categoryCounts = directory.countsByCategory();
  const locatedCounts = directory.countsByCategory({ located: true });
  const searchIndex = createSearchIndex(
    buildSearchDocs(directory.all, categoryCounts, locatedCounts, data.relations),
  );
  const router = createRouter(data.graph);
  const sources = new Map(data.manifest.sources.map((s) => [s.id, s]));
  return {
    data,
    directory,
    searchIndex,
    router,
    getPlace: (id) => directory.get(id),
    categoryCounts,
    locatedCounts,
    sourceName: (id) => sources.get(id)?.name ?? id,
  };
}
