/**
 * Server base-data loader vs dataset schema versions (Gate 6).
 *
 * Decision (docs/DATA_ROLLBACK.md §1): the server reads ONLY the schema
 * version of the code it was built from (DATA_SCHEMA_VERSION = 2) and refuses
 * anything else loudly — it does not support v1 and v2 side by side. Reading
 * v1 would put off-campus places back into the override-target set (owner
 * decision 2) and the client app refuses v1 anyway, so "support both" is not
 * trivially safe. Server code and data ship in one commit; a rollback reverts
 * both, so the reverted server reads v1 again.
 */
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearBaseDataCache,
  describeOrphan,
  loadBaseData,
  orphanReasonFor,
  SCHEMA_VERSION_REASON,
} from '../../../server/base-data.ts';
import { DomainError } from '../../../server/errors.ts';
import { DATA_SCHEMA_VERSION, manifestSchema } from '../../../src/data/schema.ts';
import { REPO_ROOT } from '../helpers/test-db.ts';
import { dirAssets, v1Source, V1_DATASET_VERSION } from './v1-dataset.ts';

const PUBLIC = join(REPO_ROOT, 'public');
const manifest = manifestSchema.parse(
  JSON.parse(readFileSync(join(PUBLIC, 'data', 'manifest.json'), 'utf8')),
);
const v1 = v1Source();

async function rejection(p: Promise<unknown>): Promise<DomainError> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(DomainError);
  return e as DomainError;
}

const temps: string[] = [];
/** A copy of public/data in a temp dir, with `patch` applied to the named files. */
function patchedV2(patch: Record<string, (json: Record<string, unknown>) => unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'lpu-compat-'));
  temps.push(root);
  mkdirSync(join(root, 'data'));
  for (const f of readdirSync(join(PUBLIC, 'data'))) {
    if (!/\.(json|geojson)$/.test(f)) continue;
    const from = join(PUBLIC, 'data', f);
    const fn = patch[f];
    if (fn) writeFileSync(join(root, 'data', f), JSON.stringify(fn(JSON.parse(readFileSync(from, 'utf8')))));
    else copyFileSync(from, join(root, 'data', f));
  }
  return root;
}

afterAll(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

beforeEach(() => clearBaseDataCache());

describe('server base data: schema v2', () => {
  it('loads the v2 dataset: campus places, context places and review items kept apart', async () => {
    expect(DATA_SCHEMA_VERSION).toBe(2);
    const base = await loadBaseData(dirAssets(PUBLIC));
    expect(base.datasetVersion).toBe(manifest.datasetVersion);
    expect(base.places.size).toBe(manifest.counts.places);
    expect(base.contextPlaces.size).toBe(manifest.counts.contextPlaces);
    expect(base.reviewItems.size).toBe(manifest.counts['boundaryReview:items']);
    for (const p of base.places.values()) expect(p.campusZone).toBe('on-campus');
    for (const p of base.contextPlaces.values()) {
      expect(p.campusZone).toBe('off-campus-nearby');
      expect(base.places.has(p.id)).toBe(false);
    }
  });

  it('explains orphan targets: context layer, boundary review, or gone', async () => {
    const base = await loadBaseData(dirAssets(PUBLIC));
    const campusId = [...base.places.keys()].sort()[0]!;
    const contextId = [...base.contextPlaces.keys()].sort()[0]!;
    const reviewId = [...base.reviewItems.entries()]
      .filter(([id, r]) => r.campusStatus === 'uncertain' && !base.places.has(id))
      .map(([id]) => id)
      .sort()[0];
    expect(reviewId).toBeDefined();
    expect(orphanReasonFor(base, campusId)).toBeNull();
    expect(describeOrphan(base, campusId)).toBe('');
    expect(orphanReasonFor(base, contextId)).toBe('context-layer');
    expect(describeOrphan(base, contextId)).toContain('Nearby, outside campus');
    expect(orphanReasonFor(base, reviewId!)).toBe('boundary-review');
    expect(describeOrphan(base, reviewId!)).toContain('boundary review');
    expect(orphanReasonFor(base, 'osm:way/1')).toBe('not-in-dataset');
  });

  it('refuses a file with another schemaVersion by name (mixed deploy), and never caches the failure', async () => {
    const mixed = patchedV2({ 'places.json': (j) => ({ ...j, schemaVersion: 1 }) });
    const e = await rejection(loadBaseData(dirAssets(mixed)));
    expect(e.code).toBe('unavailable');
    expect(e.status).toBe(503);
    expect(e.message).toContain('places.json has schemaVersion 1');
    expect(e.details).toEqual({ reason: SCHEMA_VERSION_REASON, file: 'places.json', expected: 2, found: 1 });
    // The next request retries and succeeds once correct data is served.
    const ok = await loadBaseData(dirAssets(PUBLIC));
    expect(ok.datasetVersion).toBe(manifest.datasetVersion);
  });

  it('refuses a file with no schemaVersion at all', async () => {
    const root = patchedV2({
      'context-places.json': (j) => {
        const { schemaVersion: _s, ...rest } = j;
        return rest;
      },
    });
    const e = await rejection(loadBaseData(dirAssets(root)));
    expect(e.details).toMatchObject({
      reason: SCHEMA_VERSION_REASON,
      file: 'context-places.json',
      found: null,
    });
  });
});

describe.skipIf('skip' in v1)('server base data: the committed v1 dataset', () => {
  const dir = 'dir' in v1 ? v1.dir : '';

  it('is refused loudly at the manifest, before any other file is read', async () => {
    const log: string[] = [];
    const e = await rejection(loadBaseData(dirAssets(dir, log)));
    expect(e.code).toBe('unavailable');
    expect(e.status).toBe(503);
    expect(e.message).toContain('manifest.json has schemaVersion 1');
    expect(e.message).toContain('this server reads schema version 2');
    expect(e.message).toContain('docs/DATA_ROLLBACK.md');
    expect(e.details).toEqual({
      reason: SCHEMA_VERSION_REASON,
      file: 'manifest.json',
      expected: 2,
      found: 1,
    });
    expect(log).toEqual(['data/manifest.json']);
  });

  it('is the pinned v1 dataset (sanity of the fixture source)', () => {
    const m = JSON.parse(readFileSync(join(dir, 'data', 'manifest.json'), 'utf8')) as {
      schemaVersion: number;
      datasetVersion: string;
    };
    expect(m).toMatchObject({ schemaVersion: 1, datasetVersion: V1_DATASET_VERSION });
  });

  it('v1 places mixed into a v2 deploy are refused (no partial rollback)', async () => {
    const root = patchedV2({});
    copyFileSync(join(dir, 'data', 'places.json'), join(root, 'data', 'places.json'));
    const e = await rejection(loadBaseData(dirAssets(root)));
    expect(e.details).toMatchObject({ reason: SCHEMA_VERSION_REASON, file: 'places.json', found: 1 });
  });
});
