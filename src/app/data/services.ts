/**
 * Services derived once from the loaded dataset: facility directory, search
 * index, router and lookups. Every count comes from the data itself.
 *
 * `data` is the base dataset with the owner's publication already applied
 * (./apply-publication.ts), so every view mode, the building directory and
 * search see the same records with the same ids.
 */
import type { StudioRenderModel } from '../../building-studio/merge.ts';
import { CATEGORIES } from '../../config/categories.ts';
import type { CampusData, OptionalDataLoaders, Place, Relation } from '../../data/index.ts';
import { createDirectory, type CampusDirectory } from '../../directory/index.ts';
import { createFacilityDirectory, type FacilityDirectory } from '../../facilities/index.ts';
import { createRouter, type Router } from '../../routing/index.ts';
import {
  createSearchIndex,
  docsFromCategories,
  docsFromPlaces,
  PLACE_DOC_PREFIX,
  type SearchDoc,
  type SearchIndex,
} from '../../search/index.ts';
import { commandDocs, layerDocs } from '../commands.ts';
import { applyPublication } from './apply-publication.ts';
import type { PublicationLoad } from './publication.ts';
import type { PublicationStatus } from './publication-status.ts';

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
  /** The building directory shared by every view mode (studio buildings hidden from it are left out). */
  buildingDirectory: CampusDirectory;
  /** Published owner-placed models both 3D modes draw (sorted by publicId). */
  studioModels: readonly StudioRenderModel[];
  /** State of the owner's publication layer (GET /api/locations). */
  publication: PublicationStatus;
  /** Lazy v2 files (context places, detections, boundary review); null in tests that need none. */
  optional: OptionalDataLoaders | null;
  /**
   * Off-campus places for the opt-in "Nearby, outside campus" layer: empty
   * until the layer is turned on (then context-places.json plus the
   * publication's off-campus results). While non-empty they are also
   * searchable and selectable, always labelled "Outside campus".
   */
  contextPlaces: readonly Place[];
  /** Published studio buildings not shown because their campus membership could not be re-checked. */
  studioSkipped: number;
}

export interface ServiceExtras {
  studioModels?: readonly StudioRenderModel[];
  /** Ids left out of the building directory and search (studio directoryVisible: false). */
  hiddenFromDirectory?: ReadonlySet<string>;
  publication?: PublicationStatus;
  optional?: OptionalDataLoaders | null;
  studioSkipped?: number;
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

/** Map key (Decision D6) per building id, from buildings.geojson `directoryKey`. */
export function mapKeys(data: Pick<CampusData, 'buildings'>): (id: string) => string | null {
  const keys = new Map<string, string>();
  for (const f of data.buildings.features)
    if (f.properties.directoryKey) keys.set(f.properties.id, f.properties.directoryKey);
  return (id) => keys.get(id) ?? null;
}

/** True for a published owner-placed studio building (its id is the studio record id). */
export const isStudioPlaceId = (id: string): boolean => id.startsWith('stu:');

/**
 * An owner-placed building with no name and no alias still gets exactly one
 * doc (docs/BUILDING_STUDIO_DESIGN.md S4): its honest label, no category
 * synonyms, so generic queries are not flooded.
 */
function unnamedStudioDocs(places: readonly Place[], have: ReadonlySet<string>): SearchDoc[] {
  return places
    .filter((p) => isStudioPlaceId(p.id) && !have.has(p.id))
    .map((p) => ({
      id: `${PLACE_DOC_PREFIX}${p.id}`,
      kind: 'place' as const,
      title: p.displayName,
      ...(p.provenance.notes ? { subtitle: p.provenance.notes } : {}),
      aliases: [],
      codes: [],
      keywords: [],
      categoryId: p.categoryId,
      ref: p.id,
      hasLocation: p.location !== null,
    }));
}

export function buildSearchDocs(
  places: Place[],
  categoryCounts: Record<string, number>,
  locatedCounts: Record<string, number>,
  relations: readonly Relation[] = [],
  opts: { mapKey?: (id: string) => string | null; exclude?: ReadonlySet<string> } = {},
): SearchDoc[] {
  // Every registered category gets a count; absent from the data means 0 ("None mapped yet").
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, categoryCounts[c.id] ?? 0]));
  const categories = docsFromCategories(CATEGORIES, counts).map((d) => {
    const subtitle = categorySubtitle(categoryCounts[d.ref] ?? 0, locatedCounts[d.ref] ?? 0);
    return { ...d, ...(subtitle ? { subtitle } : {}), boost: CATEGORY_DOC_BOOST };
  });
  const searchable = opts.exclude?.size ? places.filter((p) => !opts.exclude!.has(p.id)) : places;
  const placeDocs = docsFromPlaces(searchable, {
    hostName: hostNames(places, relations),
    ...(opts.mapKey ? { mapKey: opts.mapKey } : {}),
  });
  const have = new Set(placeDocs.map((d) => d.ref));
  return [
    ...categories,
    ...placeDocs,
    ...unnamedStudioDocs(searchable, have),
    ...layerDocs(locatedCounts),
    ...commandDocs(),
  ];
}

const NO_MODELS: readonly StudioRenderModel[] = [];
const NO_PLACES: readonly Place[] = [];

export function buildServices(data: CampusData, extras: ServiceExtras = {}): AtlasServices {
  const directory = createFacilityDirectory(data.places, data.relations);
  const categoryCounts = directory.countsByCategory();
  const locatedCounts = directory.countsByCategory({ located: true });
  const exclude = extras.hiddenFromDirectory;
  const docs = buildSearchDocs(directory.all, categoryCounts, locatedCounts, data.relations, {
    mapKey: mapKeys(data),
    ...(exclude ? { exclude } : {}),
  });
  const router = createRouter(data.graph);
  const sources = new Map(data.manifest.sources.map((s) => [s.id, s]));
  const services: AtlasServices = {
    data,
    directory,
    searchIndex: createSearchIndex(docs),
    router,
    getPlace: (id) => directory.get(id),
    categoryCounts,
    locatedCounts,
    sourceName: (id) => sources.get(id)?.name ?? id,
    buildingDirectory: createDirectory({
      buildings: data.buildings,
      places: data.places,
      relations: data.relations,
      ...(exclude ? { exclude } : {}),
    }),
    studioModels: extras.studioModels ?? NO_MODELS,
    publication: extras.publication ?? { kind: 'unavailable' },
    optional: extras.optional ?? null,
    contextPlaces: NO_PLACES,
    studioSkipped: extras.studioSkipped ?? 0,
  };
  baseDocs.set(services, docs);
  return services;
}

const baseDocs = new WeakMap<AtlasServices, SearchDoc[]>();

/**
 * The same services with the "Nearby, outside campus" layer's places added:
 * searchable (subtitle "Outside campus") and resolvable by id, never part of
 * the campus directory, counts, categories or routing. `base` is unchanged,
 * so turning the layer off restores it exactly.
 */
export function withContextPlaces(base: AtlasServices, places: readonly Place[]): AtlasServices {
  if (places.length === 0) return base;
  const byId = new Map<string, Place>();
  for (const p of places) if (!base.getPlace(p.id) && !byId.has(p.id)) byId.set(p.id, p);
  const contextPlaces = [...byId.values()];
  const docs = [...(baseDocs.get(base) ?? []), ...docsFromPlaces(contextPlaces, { includeContext: true })];
  return {
    ...base,
    searchIndex: createSearchIndex(docs),
    getPlace: (id) => base.getPlace(id) ?? byId.get(id),
    contextPlaces,
  };
}

export interface AppServices {
  services: AtlasServices;
  /** Off-campus results of the publication (rule 4a), shown only with the "Nearby, outside campus" layer. */
  publicationContextPlaces: Place[];
}

/**
 * Applies a loaded publication to the base dataset and derives the services.
 * Studio buildings are re-checked against the boundary review the server used
 * (boundary-review.json, fetched only when the publication has buildings).
 */
export async function buildAppServices(
  base: CampusData,
  load: PublicationLoad,
  optional: OptionalDataLoaders | null,
): Promise<AppServices> {
  const pub = load.publication;
  const review =
    pub?.buildings?.length && optional ? await optional.boundaryReview().catch(() => null) : null;
  const applied = applyPublication(base, pub, review);
  const services = buildServices(applied.data, {
    studioModels: applied.studioModels,
    hiddenFromDirectory: applied.hiddenFromDirectory,
    publication: load.status,
    optional,
    studioSkipped: applied.studioSkipped,
  });
  return { services, publicationContextPlaces: applied.contextPlaces };
}
