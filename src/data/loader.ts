/**
 * Loads and validates the generated dataset. The manifest is fetched first so
 * a schema-version mismatch fails fast with a clear message; the remaining
 * files are fetched in parallel with a `?v=<datasetVersion>` cache-buster.
 */
import type { z } from 'zod';
import type { CampusData } from './campus-data.ts';
import {
  basemapFileSchema,
  boundaryFileSchema,
  boundaryReviewFileSchema,
  buildingsFileSchema,
  contextPlacesFileSchema,
  DATA_FILES,
  DATA_SCHEMA_VERSION,
  DETECTION_MANIFEST_SOURCE_IDS,
  detectionsFileSchema,
  graphFileSchema,
  manifestSchema,
  placesFileSchema,
  relationsFileSchema,
  type BoundaryReviewFile,
  type DetectionsFile,
  type Manifest,
  type Place,
} from './schema.ts';

export type DatasetErrorCode = 'network' | 'schema-version' | 'invalid';

export class DatasetError extends Error {
  readonly code: DatasetErrorCode;
  /** Data file the error concerns, when known. */
  readonly file: string | undefined;
  constructor(code: DatasetErrorCode, message: string, options: { file?: string; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DatasetError';
    this.code = code;
    this.file = options.file;
  }
}

export interface LoadCampusDataOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** import.meta.env.BASE_URL + 'data/' under Vite; '/data/' elsewhere (Node, tests). */
export function defaultDataBaseUrl(): string {
  // Written as the literal `import.meta.env` so Vite's static replacement applies; undefined in plain Node.
  const env = import.meta.env as { BASE_URL?: unknown } | undefined;
  const base = typeof env?.BASE_URL === 'string' && env.BASE_URL !== '' ? env.BASE_URL : '/';
  return `${withSlash(base)}data/`;
}

const withSlash = (s: string) => (s.endsWith('/') ? s : `${s}/`);

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  file: string,
  init?: RequestInit,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (cause) {
    throw new DatasetError('network', `Could not download ${file}. Check your connection and try again.`, {
      file,
      cause,
    });
  }
  if (!res.ok) {
    throw new DatasetError('network', `Could not download ${file} (HTTP ${res.status}).`, { file });
  }
  try {
    return await res.json();
  } catch (cause) {
    throw new DatasetError('invalid', `${file} is not valid JSON.`, { file, cause });
  }
}

function validate<S extends z.ZodType>(schema: S, value: unknown, file: string): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const first = parsed.error.issues[0];
  const where = first ? ` at ${first.path.join('.') || '(root)'}: ${first.message}` : '';
  throw new DatasetError('invalid', `${file} failed validation${where}.`, { file, cause: parsed.error });
}

/**
 * Rejects anything that is not this app's schema version — notably a cached
 * v1 dataset next to a v2 app — with a clear 'schema-version' error.
 */
export function checkSchemaVersion(rawManifest: unknown): void {
  const version =
    rawManifest && typeof rawManifest === 'object'
      ? (rawManifest as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (typeof version !== 'number') {
    throw new DatasetError('invalid', `${DATA_FILES.manifest} has no numeric schemaVersion.`, {
      file: DATA_FILES.manifest,
    });
  }
  if (version !== DATA_SCHEMA_VERSION) {
    throw new DatasetError(
      'schema-version',
      `The campus data uses schema version ${String(version)}, but this app expects version ${DATA_SCHEMA_VERSION}. ` +
        'Reload the page to get the matching app version.',
      { file: DATA_FILES.manifest },
    );
  }
}

const resolveOptions = (opts: LoadCampusDataOptions) => ({
  baseUrl: withSlash(opts.baseUrl ?? defaultDataBaseUrl()),
  fetchImpl: opts.fetchImpl ?? (((input, init) => globalThis.fetch(input, init)) as typeof fetch),
});

function fileGetter(baseUrl: string, fetchImpl: typeof fetch, manifest: Manifest) {
  const v = `?v=${encodeURIComponent(manifest.datasetVersion)}`;
  return async <S extends z.ZodType>(file: string, schema: S): Promise<z.infer<S>> =>
    validate(schema, await fetchJson(fetchImpl, `${baseUrl}${file}${v}`, file), file);
}

export async function loadCampusData(opts: LoadCampusDataOptions = {}): Promise<CampusData> {
  const { baseUrl, fetchImpl } = resolveOptions(opts);
  const rawManifest = await fetchJson(fetchImpl, `${baseUrl}${DATA_FILES.manifest}`, DATA_FILES.manifest, {
    cache: 'no-cache',
  });
  checkSchemaVersion(rawManifest);
  const manifest = validate(manifestSchema, rawManifest, DATA_FILES.manifest);
  const get = fileGetter(baseUrl, fetchImpl, manifest);

  const [boundary, buildings, basemap, places, relations, graph] = await Promise.all([
    get(DATA_FILES.boundary, boundaryFileSchema),
    get(DATA_FILES.buildings, buildingsFileSchema),
    get(DATA_FILES.basemap, basemapFileSchema),
    get(DATA_FILES.places, placesFileSchema),
    get(DATA_FILES.relations, relationsFileSchema),
    get(DATA_FILES.graph, graphFileSchema),
  ]);
  return {
    manifest,
    boundary,
    buildings,
    basemap,
    places: places.places,
    relations: relations.relations,
    graph,
  };
}

/**
 * Lazy loaders for the v2 files that are NOT needed at startup. Each is
 * fetched only when first called (i.e. when the user enables the layer or
 * opens the admin review), memoised, and retried on the next call after a
 * failure. They use the same `?v=<datasetVersion>` as the startup files, so
 * they always belong to the loaded dataset.
 */
export interface OptionalDataLoaders {
  /** Off-campus POIs for the opt-in "Nearby, outside campus" layer. */
  contextPlaces(): Promise<Place[]>;
  /** Machine-detected footprints for the "Unverified detected footprints" layer. */
  detections(): Promise<DetectionsFile>;
  /** Boundary-review summary (admin data quality). */
  boundaryReview(): Promise<BoundaryReviewFile>;
}

function memo<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= load().catch((err: unknown) => {
      pending = null;
      throw err;
    });
    return pending;
  };
}

/** Throws when a detection source is used without a licensed manifest source record. */
function checkDetectionAttribution(file: DetectionsFile, manifest: Manifest): void {
  const used = new Set(file.features.map((f) => f.properties.source));
  for (const source of used) {
    const id = DETECTION_MANIFEST_SOURCE_IDS[source];
    const record = manifest.sources.find((s) => s.id === id);
    if (!record?.license) {
      throw new DatasetError(
        'invalid',
        `${DATA_FILES.detections} uses ${source} footprints, but the manifest has no licensed source '${id}'.`,
        { file: DATA_FILES.detections },
      );
    }
  }
}

export function createOptionalLoaders(
  manifest: Manifest,
  opts: LoadCampusDataOptions = {},
): OptionalDataLoaders {
  const { baseUrl, fetchImpl } = resolveOptions(opts);
  const get = fileGetter(baseUrl, fetchImpl, manifest);
  return {
    contextPlaces: memo(async () => (await get(DATA_FILES.contextPlaces, contextPlacesFileSchema)).places),
    detections: memo(async () => {
      const file = await get(DATA_FILES.detections, detectionsFileSchema);
      checkDetectionAttribution(file, manifest);
      return file;
    }),
    boundaryReview: memo(() => get(DATA_FILES.boundaryReview, boundaryReviewFileSchema)),
  };
}
