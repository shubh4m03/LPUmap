/**
 * Read-only view of the static base dataset the server needs: places (for
 * duplicate detection and override targets), graph nodes + walkable nodes
 * (access-point validation) and the campus boundary (campusZone).
 *
 * Loaded through a fetcher (Pages `env.ASSETS` in production, files on disk in
 * tests), validated with the shared Zod schemas, cached per isolate keyed by
 * the manifest's datasetVersion. The base files are never written.
 *
 * Schema versions (docs/DATA_ROLLBACK.md): the server reads exactly
 * DATA_SCHEMA_VERSION — the version of the code it was built from. Any other
 * version (e.g. v1 data next to a v2 server after a half-done rollback) is
 * refused LOUDLY with a 'schema-version' 503 before anything else is read, so
 * overrides are never checked against a dataset the code does not understand.
 * Server code and data ship in the same commit/deploy; a rollback reverts both.
 *
 * v2: `places` holds CAMPUS places only (the only override targets). Off-campus
 * POIs (context-places.json) and the ids held for boundary review
 * (boundary-review.json) are loaded read-only so the server can still detect
 * duplicates against off-campus POIs and tell the owner WHY an override target
 * vanished — never to apply an override to them.
 */
import type { z } from 'zod';
import {
  boundaryFileSchema,
  boundaryReviewFileSchema,
  contextPlacesFileSchema,
  DATA_FILES,
  DATA_SCHEMA_VERSION,
  graphFileSchema,
  manifestSchema,
  placesFileSchema,
  type BoundaryFile,
  type BoundaryReviewItem,
  type CampusStatus,
  type GraphFile,
  type LngLat,
  type Place,
} from '../src/data/schema.ts';
import { boundaryPolygons, footNodeSet, type PolygonRings } from '../src/community/geo.ts';
import { DomainError } from './errors.ts';

/** A footprint/place held out of the campus inventory (boundary-review.json item). */
export interface ReviewItemRef {
  campusStatus: CampusStatus;
  reviewSectionId: string | null;
  membershipReason: string;
}

export interface BaseData {
  datasetVersion: string;
  /** Campus places (places.json): the only valid override targets. */
  places: Map<string, Place>;
  /**
   * v2: off-campus POIs of the opt-in context layer (context-places.json).
   * Read-only: used for duplicate detection and orphan reasons, NEVER as
   * override targets (an override on one of these ids is an orphan).
   */
  contextPlaces: Map<string, Place>;
  /** v2: boundary-review items by id (boundary-review.json), for orphan reasons. */
  reviewItems: Map<string, ReviewItemRef>;
  /** Node i = graphNodes[i] = [lon, lat]. */
  graphNodes: LngLat[];
  /** Nodes incident to at least one `foot: true` edge. */
  footNodes: Set<number>;
  /** Campus boundary polygons, each as rings (outer first, then holes). */
  boundary: PolygonRings[];
}

export type FetchAsset = (path: string) => Promise<Response>;

export interface BaseDataParts {
  datasetVersion: string;
  places: Place[];
  /** v2 context-places.json places (default none). */
  contextPlaces?: Place[];
  /** v2 boundary-review.json items (default none). */
  reviewItems?: BoundaryReviewItem[];
  graph: Pick<GraphFile, 'nodes' | 'edges'>;
  boundary: BoundaryFile;
}

/** Builds BaseData from already-validated parts (used by the loader and tests). */
export function buildBaseData(parts: BaseDataParts): BaseData {
  const places = new Map<string, Place>();
  for (const p of parts.places) if (!places.has(p.id)) places.set(p.id, p);
  const contextPlaces = new Map<string, Place>();
  for (const p of parts.contextPlaces ?? [])
    if (!places.has(p.id) && !contextPlaces.has(p.id)) contextPlaces.set(p.id, p);
  const reviewItems = new Map<string, ReviewItemRef>();
  for (const r of parts.reviewItems ?? [])
    if (!reviewItems.has(r.id))
      reviewItems.set(r.id, {
        campusStatus: r.campusStatus,
        reviewSectionId: r.reviewSectionId,
        membershipReason: r.membershipReason,
      });
  return {
    datasetVersion: parts.datasetVersion,
    places,
    contextPlaces,
    reviewItems,
    graphNodes: parts.graph.nodes,
    footNodes: footNodeSet(parts.graph),
    boundary: boundaryPolygons(parts.boundary),
  };
}

/** Why an override target is not a campus place in the current dataset. */
export type OrphanReason = 'context-layer' | 'boundary-review' | 'not-in-dataset';

export function orphanReasonFor(base: BaseData, targetId: string): OrphanReason | null {
  if (base.places.has(targetId)) return null;
  const review = base.reviewItems.get(targetId);
  if (review && review.campusStatus === 'uncertain') return 'boundary-review';
  if (base.contextPlaces.has(targetId)) return 'context-layer';
  return 'not-in-dataset';
}

/** Owner-facing explanation of an orphan reason (admin data-quality). */
export function describeOrphan(base: BaseData, targetId: string): string {
  switch (orphanReasonFor(base, targetId)) {
    case null:
      return '';
    case 'context-layer':
      return 'It is now an off-campus place in the optional "Nearby, outside campus" layer; owner overrides apply to campus places only.';
    case 'boundary-review': {
      const section = base.reviewItems.get(targetId)?.reviewSectionId;
      return `It is held out of the campus inventory for boundary review${section ? ` (section '${section}')` : ''}; the override applies again once the owner confirms it is on campus.`;
    }
    case 'not-in-dataset':
      return 'It is no longer in the dataset (e.g. an off-campus building or a removed duplicate).';
  }
}

const unavailable = (message: string, cause?: unknown) =>
  new DomainError(
    'unavailable',
    `Base dataset unavailable: ${message}`,
    cause === undefined ? {} : { cause },
  );

async function fetchJson(fetchAsset: FetchAsset, file: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchAsset(`data/${file}`);
  } catch (cause) {
    throw unavailable(`could not read ${file}.`, cause);
  }
  if (!res.ok) throw unavailable(`${file} returned HTTP ${res.status}.`);
  try {
    return await res.json();
  } catch (cause) {
    throw unavailable(`${file} is not valid JSON.`, cause);
  }
}

/** Thrown (as 'unavailable', reason 'schema-version') when a data file is not DATA_SCHEMA_VERSION. */
export const SCHEMA_VERSION_REASON = 'schema-version';

/**
 * Refuses any file whose schemaVersion is not the one this server was built
 * for — checked BEFORE full validation, so a v1 dataset produces a precise
 * message instead of a generic validation failure.
 */
function checkSchemaVersion(v: unknown, file: string): void {
  const found =
    typeof v === 'object' && v !== null && 'schemaVersion' in v
      ? (v as { schemaVersion: unknown }).schemaVersion
      : undefined;
  if (found === DATA_SCHEMA_VERSION) return;
  throw new DomainError(
    'unavailable',
    `Base dataset unavailable: ${file} has schemaVersion ${JSON.stringify(found ?? null)} but this server reads schema version ${DATA_SCHEMA_VERSION}. Deploy the data and the server from the same commit (see docs/DATA_ROLLBACK.md).`,
    {
      details: {
        reason: SCHEMA_VERSION_REASON,
        file,
        expected: DATA_SCHEMA_VERSION,
        found: found ?? null,
      },
    },
  );
}

function check<S extends z.ZodType>(schema: S, v: unknown, file: string): z.infer<S> {
  checkSchemaVersion(v, file);
  const r = schema.safeParse(v);
  if (!r.success) throw unavailable(`${file} failed validation.`);
  return r.data;
}

/** boundary.geojson is a plain FeatureCollection without a schemaVersion. */
function checkUnversioned<S extends z.ZodType>(schema: S, v: unknown, file: string): z.infer<S> {
  const r = schema.safeParse(v);
  if (!r.success) throw unavailable(`${file} failed validation.`);
  return r.data;
}

let cached: { version: string; data: Promise<BaseData> } | null = null;

/** Drops the per-isolate cache (tests). */
export function clearBaseDataCache(): void {
  cached = null;
}

export async function loadBaseData(fetchAsset: FetchAsset): Promise<BaseData> {
  const manifest = check(
    manifestSchema,
    await fetchJson(fetchAsset, DATA_FILES.manifest),
    DATA_FILES.manifest,
  );
  if (cached && cached.version === manifest.datasetVersion) return cached.data;
  const data = (async () => {
    const [places, contextPlaces, review, graph, boundary] = await Promise.all([
      fetchJson(fetchAsset, DATA_FILES.places).then((v) => check(placesFileSchema, v, DATA_FILES.places)),
      fetchJson(fetchAsset, DATA_FILES.contextPlaces).then((v) =>
        check(contextPlacesFileSchema, v, DATA_FILES.contextPlaces),
      ),
      fetchJson(fetchAsset, DATA_FILES.boundaryReview).then((v) =>
        check(boundaryReviewFileSchema, v, DATA_FILES.boundaryReview),
      ),
      fetchJson(fetchAsset, DATA_FILES.graph).then((v) => check(graphFileSchema, v, DATA_FILES.graph)),
      fetchJson(fetchAsset, DATA_FILES.boundary).then((v) =>
        checkUnversioned(boundaryFileSchema, v, DATA_FILES.boundary),
      ),
    ]);
    return buildBaseData({
      datasetVersion: manifest.datasetVersion,
      places: places.places,
      contextPlaces: contextPlaces.places,
      reviewItems: review.items,
      graph,
      boundary,
    });
  })();
  cached = { version: manifest.datasetVersion, data };
  // Never cache a failure: the next request retries.
  data.catch(() => {
    if (cached?.data === data) cached = null;
  });
  return data;
}
