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
  buildingsFileSchema,
  DATA_FILES,
  DATA_SCHEMA_VERSION,
  graphFileSchema,
  manifestSchema,
  placesFileSchema,
  relationsFileSchema,
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

export async function loadCampusData(opts: LoadCampusDataOptions = {}): Promise<CampusData> {
  const baseUrl = withSlash(opts.baseUrl ?? defaultDataBaseUrl());
  const fetchImpl = opts.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));

  const rawManifest = await fetchJson(fetchImpl, `${baseUrl}${DATA_FILES.manifest}`, DATA_FILES.manifest, {
    cache: 'no-cache',
  });
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
  const manifest = validate(manifestSchema, rawManifest, DATA_FILES.manifest);
  const v = `?v=${encodeURIComponent(manifest.datasetVersion)}`;
  const get = async <S extends z.ZodType>(file: string, schema: S): Promise<z.infer<S>> =>
    validate(schema, await fetchJson(fetchImpl, `${baseUrl}${file}${v}`, file), file);

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
