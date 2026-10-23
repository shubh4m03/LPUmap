/**
 * Read-only view of the static base dataset the server needs: places (for
 * duplicate detection and override targets), graph nodes + walkable nodes
 * (access-point validation) and the campus boundary (campusZone).
 *
 * Loaded through a fetcher (Pages `env.ASSETS` in production, files on disk in
 * tests), validated with the shared Zod schemas, cached per isolate keyed by
 * the manifest's datasetVersion. The base files are never written.
 */
import type { z } from 'zod';
import {
  boundaryFileSchema,
  DATA_FILES,
  graphFileSchema,
  manifestSchema,
  placesFileSchema,
  type BoundaryFile,
  type GraphFile,
  type LngLat,
  type Place,
} from '../src/data/schema.ts';
import { boundaryPolygons, footNodeSet, type PolygonRings } from '../src/community/geo.ts';
import { DomainError } from './errors.ts';

export interface BaseData {
  datasetVersion: string;
  places: Map<string, Place>;
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
  graph: Pick<GraphFile, 'nodes' | 'edges'>;
  boundary: BoundaryFile;
}

/** Builds BaseData from already-validated parts (used by the loader and tests). */
export function buildBaseData(parts: BaseDataParts): BaseData {
  const places = new Map<string, Place>();
  for (const p of parts.places) if (!places.has(p.id)) places.set(p.id, p);
  return {
    datasetVersion: parts.datasetVersion,
    places,
    graphNodes: parts.graph.nodes,
    footNodes: footNodeSet(parts.graph),
    boundary: boundaryPolygons(parts.boundary),
  };
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

function check<S extends z.ZodType>(schema: S, v: unknown, file: string): z.infer<S> {
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
    const [places, graph, boundary] = await Promise.all([
      fetchJson(fetchAsset, DATA_FILES.places).then((v) => check(placesFileSchema, v, DATA_FILES.places)),
      fetchJson(fetchAsset, DATA_FILES.graph).then((v) => check(graphFileSchema, v, DATA_FILES.graph)),
      fetchJson(fetchAsset, DATA_FILES.boundary).then((v) =>
        check(boundaryFileSchema, v, DATA_FILES.boundary),
      ),
    ]);
    return buildBaseData({ datasetVersion: manifest.datasetVersion, places: places.places, graph, boundary });
  })();
  cached = { version: manifest.datasetVersion, data };
  // Never cache a failure: the next request retries.
  data.catch(() => {
    if (cached?.data === data) cached = null;
  });
  return data;
}
