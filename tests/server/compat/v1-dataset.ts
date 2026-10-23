/**
 * The committed schema-v1 dataset, for the v1 → v2 compatibility and rollback
 * tests (owner condition 4 / Gate 6).
 *
 * Source: `git show <V1_COMMIT>:public/data/<file>` exported into a fresh temp
 * directory — never the working tree, never a deployed or shared database.
 * V1_COMMIT is pinned (not HEAD) so the tests keep meaning the same thing
 * after the v2 data is committed. When the commit is not available (a shallow
 * CI checkout), the dependent suites SKIP with the reason below; set
 * LPU_V1_DATA_DIR to a directory holding the v1 files to run them anyway.
 *
 * The v1 files are read with a FROZEN v1 reader: the current element schemas
 * (placeSchema is byte-identical to v1; graphEdgeSchema only gained the
 * optional v2 `campus` flag) with `schemaVersion: 1`. That is exactly what the
 * v1 server accepted, so BaseData built here is what the deployed v1 server
 * used when the D1 records were created.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { z } from 'zod';
import { buildBaseData, type BaseData, type FetchAsset } from '../../../server/base-data.ts';
import {
  boundaryFileSchema,
  graphEdgeSchema,
  lngLatSchema,
  placeSchema,
  type BoundaryFile,
  type GraphFile,
  type Place,
} from '../../../src/data/schema.ts';
import { REPO_ROOT } from '../helpers/test-db.ts';

/** Last commit whose public/data is schema v1 (docs: campus geography audit, before the v2 contract). */
export const V1_COMMIT = '902af56';
/** datasetVersion of the v1 dataset at V1_COMMIT. */
export const V1_DATASET_VERSION = 'b628c5855b1d';

/** Files the server reads (plus the manifest). */
export const V1_SERVER_FILES = ['manifest.json', 'places.json', 'graph.json', 'boundary.geojson'] as const;

export const v1ManifestSchema = z.object({
  schemaVersion: z.literal(1),
  datasetVersion: z.string().min(6),
  counts: z.record(z.string(), z.number()),
});
export const v1PlacesFileSchema = z.object({ schemaVersion: z.literal(1), places: z.array(placeSchema) });
export const v1GraphFileSchema = z.object({
  schemaVersion: z.literal(1),
  nodes: z.array(lngLatSchema),
  edges: z.array(graphEdgeSchema),
});

const gitAvailable = (): boolean => {
  try {
    execFileSync('git', ['-C', REPO_ROOT, 'cat-file', '-e', `${V1_COMMIT}^{commit}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

export type V1Source = { dir: string; origin: string } | { skip: string };

let exported: V1Source | null = null;

/**
 * Directory whose `data/` holds the v1 files (exported once per process).
 * Returns `{ skip }` with a reason when no v1 source is available.
 */
export function v1Source(): V1Source {
  if (exported) return exported;
  const fromEnv = process.env.LPU_V1_DATA_DIR;
  if (fromEnv) {
    const dir = existsSync(join(fromEnv, 'data')) ? fromEnv : join(fromEnv, '..');
    exported = { dir, origin: `LPU_V1_DATA_DIR=${fromEnv}` };
    return exported;
  }
  if (!gitAvailable()) {
    exported = {
      skip: `v1 dataset unavailable: commit ${V1_COMMIT} is not in this checkout (shallow clone?). Fetch full history (actions/checkout fetch-depth: 0) or set LPU_V1_DATA_DIR.`,
    };
    return exported;
  }
  const dir = mkdtempSync(join(tmpdir(), 'lpu-v1-data-'));
  mkdirSync(join(dir, 'data'));
  for (const f of V1_SERVER_FILES) {
    const body = execFileSync('git', ['-C', REPO_ROOT, 'show', `${V1_COMMIT}:public/data/${f}`], {
      maxBuffer: 256 * 1024 * 1024,
    });
    writeFileSync(join(dir, 'data', f), body);
  }
  exported = { dir, origin: `git show ${V1_COMMIT}:public/data/*` };
  // v1Source() is called while a test file is collected, so this hook belongs to that file:
  // the export is removed when the file's tests finish (modules are isolated per test file).
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    exported = null;
  });
  return exported;
}

const readJson = (dir: string, f: string): unknown => JSON.parse(readFileSync(join(dir, 'data', f), 'utf8'));

export interface V1Parts {
  datasetVersion: string;
  places: Place[];
  graph: Pick<GraphFile, 'nodes' | 'edges'>;
  boundary: BoundaryFile;
}

export function v1Parts(dir: string): V1Parts {
  const manifest = v1ManifestSchema.parse(readJson(dir, 'manifest.json'));
  const places = v1PlacesFileSchema.parse(readJson(dir, 'places.json')).places;
  const graph = v1GraphFileSchema.parse(readJson(dir, 'graph.json'));
  const boundary = boundaryFileSchema.parse(readJson(dir, 'boundary.geojson'));
  return { datasetVersion: manifest.datasetVersion, places, graph, boundary };
}

/** BaseData exactly as the v1 server built it (v1 had no context places or review items). */
export function v1BaseData(dir: string): BaseData {
  return buildBaseData(v1Parts(dir));
}

/** Fetcher serving `<root>/<path>` like the Pages ASSETS binding (paths look like 'data/places.json'). */
export const dirAssets =
  (root: string, log?: string[]): FetchAsset =>
  async (path: string) => {
    const rel = path.replace(/^\/+/, '');
    log?.push(rel);
    try {
      return new Response(readFileSync(join(root, rel)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  };
