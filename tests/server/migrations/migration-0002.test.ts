/**
 * Migration 0002 (Building Studio) and its rollback script, on isolated local
 * D1 databases only (wrangler getPlatformProxy, persist: false):
 *
 * - fresh 0001 + 0002: every studio table, index and trigger exists and the
 *   CHECK/trigger rules hold (immutability, archived-only delete);
 * - 0001 → 0002 on a POPULATED database: every existing row of every table is
 *   preserved exactly (ids included), the audit AUTOINCREMENT sequence carries
 *   over, and the rebuilt audit_events keeps its indexes and append-only
 *   triggers while accepting the new entity types;
 * - docs/db/0002_down.sql restores the 0001 schema with the 0001 data intact
 *   (studio audit rows kept as entity_type 'system'), bumps the publication
 *   version, forgets 0002 in d1_migrations, and 0002 re-applies cleanly.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { createSession } from '../../../server/db/sessions.ts';
import { hit } from '../../../server/db/rate-limits.ts';
import type { SqlDatabase } from '../../../server/db/types.ts';
import {
  approveSuggestion,
  createLocation,
  createSuggestion,
  hideLocation,
  putOverride,
} from '../../../server/domain/index.ts';
import { fakeBaseData } from '../helpers/base-data.ts';
import { clock, contribution } from '../helpers/context.ts';
import { migrationFiles, REPO_ROOT, splitSql } from '../helpers/test-db.ts';

type Proxy = Awaited<ReturnType<typeof getPlatformProxy<{ DB: SqlDatabase }>>>;
const proxies: Proxy[] = [];
afterAll(async () => {
  for (const p of proxies) await p.dispose();
});

async function emptyDb(): Promise<SqlDatabase> {
  const p = await getPlatformProxy<{ DB: SqlDatabase }>({
    configPath: join(REPO_ROOT, 'tests/server/helpers/wrangler.test.toml'),
    persist: false,
  });
  proxies.push(p);
  return p.env.DB;
}

const fileNamed = (name: string) => {
  const f = migrationFiles().find((p) => p.split(/[\\/]/).pop() === name);
  if (!f) throw new Error(`missing migration ${name}`);
  return f;
};
const M1 = fileNamed('0001_initial.sql');
const M2 = fileNamed('0002_building_studio.sql');
const DOWN = join(REPO_ROOT, 'docs/db/0002_down.sql');

/** Applies a SQL file statement by statement (the server test harness splitter). */
async function applyFile(db: SqlDatabase, file: string): Promise<void> {
  for (const s of splitSql(readFileSync(file, 'utf8'))) await db.prepare(s).run();
}

/**
 * Applies a file as ONE batch (one transaction), the way `wrangler d1
 * migrations apply` runs a migration: a failure leaves nothing half-applied.
 */
async function applyFileAtomically(db: SqlDatabase, file: string): Promise<void> {
  await db.batch(splitSql(readFileSync(file, 'utf8')).map((s) => db.prepare(s)));
}

const all = async <T = Record<string, unknown>>(db: SqlDatabase, sql: string) =>
  (await db.prepare(sql).all<T>()).results;

const MUTABLE_0001 = ['suggestions', 'locations', 'overrides', 'sessions', 'rate_limits', 'meta'] as const;
const ORDER: Record<string, string> = {
  suggestions: 'id',
  locations: 'id',
  overrides: 'target_id',
  sessions: 'id_hash',
  rate_limits: 'bucket',
  meta: 'key',
  audit_events: 'id',
};
const dumpTable = (db: SqlDatabase, t: string) => all(db, `SELECT * FROM ${t} ORDER BY ${ORDER[t]}`);

/** Every 0001 table's rows (audit included) + the AUTOINCREMENT sequence. */
async function data0001(db: SqlDatabase) {
  const out: Record<string, unknown[]> = {};
  for (const t of [...MUTABLE_0001, 'audit_events']) out[t] = await dumpTable(db, t);
  out.sequence = await all(db, "SELECT name, seq FROM sqlite_sequence WHERE name = 'audit_events'");
  return out;
}

/**
 * Schema objects, normalized so a table rebuilt by CREATE … RENAME compares
 * equal to one created directly: SQLite rewrites the name as "quoted" on
 * RENAME, and statements differ in whitespace only.
 */
async function schemaOf(db: SqlDatabase, exclude: readonly string[] = []) {
  const rows = await all<{ type: string; name: string; tbl_name: string; sql: string | null }>(
    db,
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type, name",
  );
  return rows
    .filter((r) => !exclude.includes(r.tbl_name))
    .map((r) => ({
      ...r,
      sql: (r.sql ?? '')
        .replace(/"(\w+)"/g, '$1')
        .replace(/\s+/g, ' ')
        .replace(/\( /g, '(')
        .replace(/ \)/g, ')')
        .trim(),
    }));
}

/** Seeds 0001 data through the real (pre-studio) domain code: every 0001 table gets rows. */
async function seed0001(db: SqlDatabase): Promise<void> {
  const base = fakeBaseData();
  const c = clock(base);
  const s1 = await createSuggestion(db, contribution(), c.anon());
  await createSuggestion(db, contribution({ name: 'Second Kiosk', location: [75.7006, 31.2502] }), c.anon());
  await approveSuggestion(db, s1.reference, { revision: 1 }, c.owner());
  const loc = await createLocation(
    db,
    { fields: { name: 'Central ATM', categoryId: 'finance', location: [75.7005, 31.2501] } },
    c.owner(),
  );
  await hideLocation(db, loc.id, { revision: 1 }, c.owner());
  const target = [...base.places.keys()][0]!;
  await putOverride(
    db,
    target,
    { revision: null, fields: { name: 'Renamed Block' }, hidden: false },
    c.owner(),
  );
  await createSession(db, {
    idHash: 'a'.repeat(64),
    actor: 'owner',
    csrfToken: 'c'.repeat(43),
    now: c.now,
    expiresAt: new Date(c.now.getTime() + 3_600_000),
  });
  await hit(db, 'bucket-0001-seed', 5, 900, c.now);
}

const STUDIO_TABLES = [
  'studio_templates',
  'studio_template_versions',
  'studio_buildings',
  'studio_building_versions',
];
const STU = (n: number) => `stu:${'a'.repeat(25)}${'abcdefghijklmnopqrstuvwxyz'[n]}`;
const STV = `stv:${'b'.repeat(26)}`;
const NOW = '2026-10-24T10:00:00.000Z';

const insertHead = (db: SqlDatabase, id: string, over: Record<string, string | number | null> = {}) => {
  const row: Record<string, string | number | null> = {
    id,
    target_id: null,
    status: 'draft',
    draft_json: '{"model":{}}',
    draft_revision: 1,
    draft_saved_by: 'owner',
    draft_saved_at: NOW,
    published_version: null,
    archived_by: null,
    archived_at: null,
    archive_reason: null,
    created_by: 'owner',
    created_at: NOW,
    updated_by: 'owner',
    updated_at: NOW,
    revision: 1,
    ...over,
  };
  const cols = Object.keys(row);
  return db
    .prepare(`INSERT INTO studio_buildings (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .bind(...cols.map((k) => row[k]!))
    .run();
};

const insertVersion = (
  db: SqlDatabase,
  id: string,
  version: number,
  over: Record<string, string | number> = {},
) => {
  const row: Record<string, string | number> = {
    building_id: id,
    version,
    record_json: '{"model":{}}',
    footprint_json: '{"type":"Polygon","coordinates":[]}',
    footprint_area_m2: 100,
    membership_json: '{}',
    validation_json: '{}',
    acknowledgements_json: '[]',
    change_summary: 'First publish',
    model_config_version: 1,
    generator_id: 'box',
    generator_version: 1,
    accuracy_class: 'generic-prefab',
    position_corrected: 0,
    published_by: 'owner',
    published_at: NOW,
    ...over,
  };
  const cols = Object.keys(row);
  return db
    .prepare(
      `INSERT INTO studio_building_versions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    )
    .bind(...cols.map((k) => row[k]!))
    .run();
};

const auditRow = (db: SqlDatabase, entityType: string, entityId: string, action: string) =>
  db
    .prepare(
      "INSERT INTO audit_events (at, actor, action, entity_type, entity_id, outcome) VALUES (?, 'owner', ?, ?, ?, 'success')",
    )
    .bind(NOW, action, entityType, entityId)
    .run();

const rejects = async (p: Promise<unknown>, pattern: RegExp) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, 'statement should have been rejected').toBeInstanceOf(Error);
  expect(String((err as Error).message)).toMatch(pattern);
};

describe('0002 on a fresh database (0001 + 0002)', () => {
  it('creates every studio table, index and trigger, and keeps the audit indexes and triggers', async () => {
    const db = await emptyDb();
    await applyFile(db, M1);
    await applyFile(db, M2);
    const names = (await schemaOf(db)).map((r) => `${r.type}:${r.name}`);
    for (const t of STUDIO_TABLES) expect(names).toContain(`table:${t}`);
    for (const i of [
      'studio_templates_status',
      'studio_template_versions_generator',
      'studio_buildings_status',
      'studio_buildings_updated',
      'studio_building_versions_generator',
      'audit_entity',
      'audit_at',
      'audit_action',
    ])
      expect(names).toContain(`index:${i}`);
    for (const tr of [
      'studio_template_versions_no_update',
      'studio_template_versions_no_delete',
      'studio_buildings_delete_archived_only',
      'studio_building_versions_no_update',
      'studio_building_versions_delete_archived_only',
      'audit_events_no_update',
      'audit_events_no_delete',
    ])
      expect(names).toContain(`trigger:${tr}`);
    expect(names).not.toContain('table:audit_events_0002');
  });

  it('enforces the studio CHECKs, UNIQUE target, immutability and archived-only delete', async () => {
    const db = await emptyDb();
    await applyFile(db, M1);
    await applyFile(db, M2);
    await rejects(insertHead(db, 'stu:short'), /CHECK/);
    await rejects(insertHead(db, `stu:${'A'.repeat(26)}`), /CHECK/);
    await rejects(insertHead(db, STU(0), { target_id: 'osm:node/1' }), /CHECK/);
    // a draft is never published and always has content
    await rejects(insertHead(db, STU(0), { published_version: 1 }), /CHECK/);
    await rejects(
      insertHead(db, STU(0), { draft_json: null, draft_saved_by: null, draft_saved_at: null }),
      /CHECK/,
    );
    await rejects(insertHead(db, STU(0), { status: 'published' }), /CHECK/);
    await rejects(insertHead(db, STU(0), { status: 'archived' }), /CHECK/);
    await rejects(insertHead(db, STU(0), { draft_json: '[1]' }), /CHECK/);
    await rejects(insertHead(db, STU(0), { draft_json: `{"x":"${'y'.repeat(16400)}"}` }), /CHECK/);

    await insertHead(db, STU(0), { target_id: 'osm:way/123' });
    await rejects(insertHead(db, STU(1), { target_id: 'osm:way/123' }), /UNIQUE/);
    await insertHead(db, STU(2), {
      status: 'published',
      published_version: 1,
      draft_json: null,
      draft_saved_by: null,
      draft_saved_at: null,
    });
    await insertVersion(db, STU(2), 1);
    await rejects(insertVersion(db, STU(2), 2, { footprint_json: '{"type":"Point"}' }), /CHECK/);
    await rejects(insertVersion(db, STU(2), 2, { acknowledgements_json: '{}' }), /CHECK/);
    await rejects(insertVersion(db, STU(2), 2, { accuracy_class: 'surveyed-ish' }), /CHECK/);
    await rejects(insertVersion(db, `stu:${'z'.repeat(26)}`, 1), /FOREIGN KEY/);

    await rejects(
      db.prepare('UPDATE studio_building_versions SET change_summary = ?').bind('x y z').run(),
      /immutable/,
    );
    await rejects(db.prepare('DELETE FROM studio_building_versions').run(), /archived/);
    await rejects(db.prepare('DELETE FROM studio_buildings WHERE id = ?').bind(STU(2)).run(), /archived/);
    await db
      .prepare(
        "UPDATE studio_buildings SET status = 'archived', archived_by = 'owner', archived_at = ?, revision = revision + 1 WHERE id = ?",
      )
      .bind(NOW, STU(2))
      .run();
    await db.batch([
      db.prepare('DELETE FROM studio_building_versions WHERE building_id = ?').bind(STU(2)),
      db.prepare('DELETE FROM studio_buildings WHERE id = ?').bind(STU(2)),
    ]);
    expect(await all(db, 'SELECT id FROM studio_buildings ORDER BY id')).toEqual([{ id: STU(0) }]);

    await db
      .prepare(
        "INSERT INTO studio_templates (id, name, latest_version, created_by, created_at, updated_by, updated_at) VALUES (?, 'Variant', 1, 'owner', ?, 'owner', ?)",
      )
      .bind(STV, NOW, NOW)
      .run();
    await db
      .prepare(
        "INSERT INTO studio_template_versions (template_id, version, definition_json, generator_id, generator_version, created_by, created_at) VALUES (?, 1, '{}', 'box', 1, 'owner', ?)",
      )
      .bind(STV, NOW)
      .run();
    await rejects(db.prepare('UPDATE studio_template_versions SET generator_version = 2').run(), /immutable/);
    await rejects(db.prepare('DELETE FROM studio_template_versions').run(), /immutable/);

    // the rebuilt audit log accepts the studio entity types and is still append-only
    await auditRow(db, 'building', STU(0), 'building.create');
    await auditRow(db, 'template', STV, 'template.create');
    await rejects(auditRow(db, 'studio', STU(0), 'x'), /CHECK/);
    await rejects(db.prepare("UPDATE audit_events SET actor = 'x'").run(), /append-only/);
    await rejects(db.prepare('DELETE FROM audit_events').run(), /append-only/);
  });
});

describe('0001 → 0002 on a populated database', () => {
  it('preserves every row and id of every 0001 table, the audit sequence, indexes and triggers', async () => {
    const db = await emptyDb();
    await applyFile(db, M1);
    await seed0001(db);
    const before = await data0001(db);
    for (const t of MUTABLE_0001) expect(before[t]!.length, `${t} seeded`).toBeGreaterThan(0);
    expect(before.audit_events!.length).toBeGreaterThanOrEqual(5);
    const maxId = Math.max(...(before.audit_events as { id: number }[]).map((r) => r.id));
    const auditIndexes = (await schemaOf(db)).filter((r) => r.tbl_name === 'audit_events');

    await applyFileAtomically(db, M2);

    expect(await data0001(db)).toEqual(before);
    expect((await schemaOf(db)).filter((r) => r.tbl_name === 'audit_events' && r.type !== 'table')).toEqual(
      auditIndexes.filter((r) => r.type !== 'table'),
    );
    // the AUTOINCREMENT sequence carried over: the next id follows the old maximum
    await auditRow(db, 'building', STU(3), 'building.create');
    const last = await db.prepare('SELECT MAX(id) AS id FROM audit_events').first<{ id: number }>();
    expect(last?.id).toBe(maxId + 1);
    await rejects(db.prepare("UPDATE audit_events SET actor = 'x' WHERE id = 1").run(), /append-only/);
    await rejects(db.prepare('DELETE FROM audit_events WHERE id = 1').run(), /append-only/);
    // nothing studio-related exists yet
    for (const t of STUDIO_TABLES) expect(await all(db, `SELECT * FROM ${t}`)).toEqual([]);
  });

  it('a failing 0002 (applied atomically) leaves the 0001 database untouched', async () => {
    const db = await emptyDb();
    await applyFile(db, M1);
    await seed0001(db);
    const before = await data0001(db);
    const schema = await schemaOf(db);
    const statements = splitSql(readFileSync(M2, 'utf8'));
    // fail right after audit_events was dropped: the worst place to stop
    const at = statements.findIndex((s) => /^DROP TABLE audit_events/.test(s)) + 1;
    expect(at).toBeGreaterThan(0);
    const broken = [
      ...statements.slice(0, at),
      'INSERT INTO meta (key, value) VALUES (NULL, NULL)',
      ...statements.slice(at),
    ];
    await rejects(db.batch(broken.map((s) => db.prepare(s))), /NOT NULL/);
    expect(await data0001(db)).toEqual(before);
    expect(await schemaOf(db)).toEqual(schema);
  });
});

describe('docs/db/0002_down.sql', () => {
  const D1_MIGRATIONS = `CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)`;

  it('restores the 0001 schema with all 0001 data, keeps every audit row and re-applies cleanly', async () => {
    // Reference: a database that only ever had 0001 (+ the wrangler bookkeeping table).
    const ref = await emptyDb();
    await ref.prepare(D1_MIGRATIONS).run();
    await applyFile(ref, M1);

    const db = await emptyDb();
    await db.prepare(D1_MIGRATIONS).run();
    await applyFile(db, M1);
    await db.prepare("INSERT INTO d1_migrations (name) VALUES ('0001_initial.sql')").run();
    await seed0001(db);
    const before = await data0001(db);
    await applyFile(db, M2);
    await db.prepare("INSERT INTO d1_migrations (name) VALUES ('0002_building_studio.sql')").run();

    // studio data + studio audit rows
    await insertHead(db, STU(4), {
      status: 'published',
      published_version: 1,
      draft_json: null,
      draft_saved_by: null,
      draft_saved_at: null,
    });
    await insertVersion(db, STU(4), 1);
    await auditRow(db, 'building', STU(4), 'building.publish');
    await auditRow(db, 'template', STV, 'template.create');
    await db.prepare("UPDATE meta SET value = '41' WHERE key = 'publication_version'").run();
    const auditBefore = await dumpTable(db, 'audit_events');

    await applyFileAtomically(db, DOWN);

    expect(await schemaOf(db)).toEqual(await schemaOf(ref));
    const after = await data0001(db);
    for (const t of ['suggestions', 'locations', 'overrides', 'sessions', 'rate_limits'])
      expect(after[t], t).toEqual(before[t]);
    const meta = Object.fromEntries(
      (after.meta as { key: string; value: string }[]).map((r) => [r.key, r.value]),
    );
    expect(meta.publication_version).toBe('42');
    expect(meta.publication_updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // every audit row kept with its id; studio rows become 'system' with action and entity id unchanged
    expect(after.audit_events).toEqual(
      auditBefore.map((r) =>
        ['building', 'template'].includes(String(r.entity_type)) ? { ...r, entity_type: 'system' } : r,
      ),
    );
    expect(after.sequence).toEqual([
      { name: 'audit_events', seq: Math.max(...auditBefore.map((r) => Number(r.id))) },
    ]);
    await rejects(db.prepare("UPDATE audit_events SET actor = 'x'").run(), /append-only/);
    await rejects(auditRow(db, 'building', STU(4), 'x'), /CHECK/);
    expect(await all(db, 'SELECT name FROM d1_migrations ORDER BY id')).toEqual([
      { name: '0001_initial.sql' },
    ]);

    // 0002 applies again on the rolled-back database
    await applyFileAtomically(db, M2);
    for (const t of STUDIO_TABLES) expect(await all(db, `SELECT * FROM ${t}`)).toEqual([]);
    await auditRow(db, 'building', STU(5), 'building.create');
  });
});
