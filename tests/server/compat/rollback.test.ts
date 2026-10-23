/**
 * Rollback invariants (Gate 6, docs/DATA_ROLLBACK.md). Fast, always run.
 *
 * (a) Static app + data: the dataset schema version, the code's
 *     DATA_SCHEMA_VERSION and the data-cache name move TOGETHER, and every data
 *     file is inside the ONE Workbox precache manifest — so reverting the commit
 *     restores all of them at once and a cached client never mixes versions.
 *     Checked on the working tree AND on the pinned v1 commit (the revert target).
 *     The full `git revert` drill is rollback-drill.test.ts (opt-in, slow).
 * (b) D1 needs no migration for v2: the migrations are the v1 ones and a fresh
 *     database built from the v1 SQL has exactly the schema the v2 server uses.
 *     (Rollback of D1 is therefore a no-op; the survival test proves the same
 *     rows work against v1, v2 and v1 again.)
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { PUBLICATION_SCHEMA_VERSION } from '../../../src/community/schema.ts';
import { APP_CONFIG } from '../../../src/config/index.ts';
import { DATA_SCHEMA_VERSION, manifestSchema } from '../../../src/data/schema.ts';
import { PRECACHE_GLOBS } from '../../../src/offline/pwa-config.ts';
import type { SqlDatabase } from '../../../server/db/types.ts';
import { applyMigrations, migrationFiles, REPO_ROOT, splitSql } from '../helpers/test-db.ts';
import { v1Source, V1_COMMIT, V1_DATASET_VERSION } from './v1-dataset.ts';
import { dataCacheIn, publicationVersionIn, schemaVersionIn } from './version-text.ts';

const DATA = join(REPO_ROOT, 'public', 'data');
const v1 = v1Source();
const gitShow = (path: string): string =>
  execFileSync('git', ['-C', REPO_ROOT, 'show', `${V1_COMMIT}:${path}`], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });

/** Minimal matcher for the flat data globs ('data/*.json', 'data/*.geojson'). */
const precached = (path: string): boolean =>
  PRECACHE_GLOBS.some((g) => {
    const m = /^data\/\*\.(\w+)$/.exec(g);
    return m !== null && new RegExp(`^data/[^/]+\\.${m[1]}$`).test(path);
  });

describe('rollback (a): data, schema version and cache name are one unit — working tree', () => {
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(DATA, 'manifest.json'), 'utf8')));

  it('code, manifest and every versioned data file agree on the schema version', () => {
    expect(manifest.schemaVersion).toBe(DATA_SCHEMA_VERSION);
    expect(schemaVersionIn(readFileSync(join(REPO_ROOT, 'src/data/schema.ts'), 'utf8'))).toBe(
      DATA_SCHEMA_VERSION,
    );
    for (const f of readdirSync(DATA).filter((x) => x.endsWith('.json'))) {
      const j = JSON.parse(readFileSync(join(DATA, f), 'utf8')) as { schemaVersion?: unknown };
      if (j.schemaVersion !== undefined) expect(j.schemaVersion, f).toBe(DATA_SCHEMA_VERSION);
    }
  });

  it('the data-cache name carries the schema version', () => {
    expect(APP_CONFIG.cache.dataCache).toBe(`lpu-atlas-data-v${DATA_SCHEMA_VERSION}`);
  });

  it('every manifest file is precached in the single Workbox manifest, with the content the manifest pins', () => {
    for (const [key, f] of Object.entries(manifest.files)) {
      expect(precached(`data/${f.path}`), `${key} → data/${f.path} must be precached`).toBe(true);
      const body = readFileSync(join(DATA, f.path));
      expect(body.length, f.path).toBe(f.bytes);
      expect(createHash('sha256').update(body).digest('hex'), f.path).toBe(f.sha256);
    }
  });
});

describe.skipIf('skip' in v1)(`rollback (a): the revert target ${V1_COMMIT} is self-consistent v1`, () => {
  it('v1 code, v1 data and the v1 cache name agree', () => {
    expect(schemaVersionIn(gitShow('src/data/schema.ts'))).toBe(1);
    expect(dataCacheIn(gitShow('src/config/index.ts'))).toBe('lpu-atlas-data-v1');
    const m = JSON.parse(gitShow('public/data/manifest.json')) as {
      schemaVersion: number;
      datasetVersion: string;
    };
    expect(m).toMatchObject({ schemaVersion: 1, datasetVersion: V1_DATASET_VERSION });
    for (const f of ['places.json', 'graph.json', 'relations.json'])
      expect((JSON.parse(gitShow(`public/data/${f}`)) as { schemaVersion: number }).schemaVersion, f).toBe(1);
  });

  it('the community publication contract (GET /api/locations) is unchanged by v2', () => {
    expect(publicationVersionIn(gitShow('src/community/schema.ts'))).toBe(PUBLICATION_SCHEMA_VERSION);
  });
});

describe.skipIf('skip' in v1)('rollback (b): D1 needs no migration for v2', () => {
  type Proxy = Awaited<ReturnType<typeof getPlatformProxy<{ DB: SqlDatabase }>>>;
  let proxies: Proxy[] = [];
  const freshDb = async () => {
    const p = await getPlatformProxy<{ DB: SqlDatabase }>({
      configPath: join(REPO_ROOT, 'tests/server/helpers/wrangler.test.toml'),
      persist: false,
    });
    proxies.push(p);
    return p.env.DB;
  };
  const schemaDump = async (db: SqlDatabase) =>
    (
      await db
        .prepare(
          "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type, name",
        )
        .all<{ type: string; name: string; tbl_name: string; sql: string | null }>()
    ).results;

  beforeAll(() => {
    proxies = [];
  });
  afterAll(async () => {
    for (const p of proxies) await p.dispose();
  });

  it('the migration set is exactly the v1 set, byte for byte', () => {
    const v1Files = execFileSync(
      'git',
      ['-C', REPO_ROOT, 'ls-tree', '--name-only', `${V1_COMMIT}`, 'migrations/'],
      {
        encoding: 'utf8',
      },
    )
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => l.replace(/^migrations\//, ''))
      .sort();
    const now = migrationFiles().map((f) => f.split(/[\\/]/).pop()!);
    expect(now).toEqual(v1Files.filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)));
    for (const f of migrationFiles()) {
      const name = f.split(/[\\/]/).pop()!;
      expect(readFileSync(f, 'utf8').replace(/\r\n/g, '\n'), name).toBe(
        gitShow(`migrations/${name}`).replace(/\r\n/g, '\n'),
      );
    }
  });

  it('a database built from the v1 SQL has the identical schema the v2 server runs on', async () => {
    const fromV1 = await freshDb();
    const names = execFileSync('git', ['-C', REPO_ROOT, 'ls-tree', '--name-only', V1_COMMIT, 'migrations/'], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter((l) => /\.sql$/.test(l))
      .sort();
    for (const n of names) for (const s of splitSql(gitShow(n))) await fromV1.prepare(s).run();
    const current = await freshDb();
    await applyMigrations(current);
    expect(await schemaDump(fromV1)).toEqual(await schemaDump(current));
    expect((await schemaDump(current)).length).toBeGreaterThan(0);
  });
});
