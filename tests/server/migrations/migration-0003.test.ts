/**
 * Migration 0003 (artwork verification) and its rollback script, on isolated
 * local D1 databases only (wrangler getPlatformProxy, persist: false). Never
 * touches a remote or persisted database.
 *
 * - fresh 0001 + 0002 + 0003: table, indexes, CHECKs, audit entity 'artwork';
 * - 0002 → 0003 on a POPULATED database (suggestions, locations, overrides,
 *   sessions, rate limits, studio buildings/templates, audit rows): every row
 *   of every table preserved exactly, the audit sequence carried over;
 * - a failing 0003 applied atomically leaves the database untouched;
 * - docs/db/0003_down.sql is NON-destructive: artwork decisions stay (inert),
 *   every audit row is kept ('artwork' → 'system'), the publication version
 *   is bumped and 0003 is forgotten in d1_migrations;
 * - re-applying 0003 restores the exact 0003 schema, the same decisions and
 *   the 'artwork' audit history — across repeated apply/rollback cycles;
 * - the v3 publication carries the decisions without private notes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { publicationSchema } from '../../../src/community/schema.ts';
import { createSession } from '../../../server/db/sessions.ts';
import { hit } from '../../../server/db/rate-limits.ts';
import type { SqlDatabase } from '../../../server/db/types.ts';
import {
  approveSuggestion,
  createLocation,
  createSuggestion,
  getPublication,
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
const M3 = fileNamed('0003_artwork_associations.sql');
const DOWN3 = join(REPO_ROOT, 'docs/db/0003_down.sql');
const D1_MIGRATIONS = `CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)`;

async function applyFile(db: SqlDatabase, file: string): Promise<void> {
  for (const s of splitSql(readFileSync(file, 'utf8'))) await db.prepare(s).run();
}
/** One batch = one transaction, the way `wrangler d1 migrations apply` runs a file. */
async function applyFileAtomically(db: SqlDatabase, file: string): Promise<void> {
  await db.batch(splitSql(readFileSync(file, 'utf8')).map((s) => db.prepare(s)));
}
const all = async <T = Record<string, unknown>>(db: SqlDatabase, sql: string) =>
  (await db.prepare(sql).all<T>()).results;

const NOW = '2026-10-24T10:00:00.000Z';
const STU = `stu:${'a'.repeat(26)}`;
const STU_PUBLISHED = `stu:${'c'.repeat(26)}`;
const STV = `stv:${'b'.repeat(26)}`;

/** Tables of 0001+0002 and their keys (artwork_associations is checked separately). */
const ORDER: Record<string, string> = {
  suggestions: 'id',
  locations: 'id',
  overrides: 'target_id',
  sessions: 'id_hash',
  rate_limits: 'bucket',
  meta: 'key',
  audit_events: 'id',
  studio_templates: 'id',
  studio_template_versions: 'template_id, version',
  studio_buildings: 'id',
  studio_building_versions: 'building_id, version',
};
async function dataOf(db: SqlDatabase) {
  const out: Record<string, unknown[]> = {};
  for (const [t, o] of Object.entries(ORDER)) out[t] = await all(db, `SELECT * FROM ${t} ORDER BY ${o}`);
  out.sequence = await all(db, "SELECT name, seq FROM sqlite_sequence WHERE name = 'audit_events'");
  return out;
}

/** Schema objects normalized so a renamed rebuild compares equal to a direct CREATE. */
async function schemaOf(db: SqlDatabase) {
  const rows = await all<{ type: string; name: string; tbl_name: string; sql: string | null }>(
    db,
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type, name",
  );
  return rows.map((r) => ({
    ...r,
    sql: (r.sql ?? '')
      .replace(/"(\w+)"/g, '$1')
      .replace(/\s+/g, ' ')
      .replace(/\( /g, '(')
      .replace(/ \)/g, ')')
      .trim(),
  }));
}

/** Every 0001 and 0002 table gets rows, through the real domain code where it exists. */
async function seedThrough0002(db: SqlDatabase): Promise<void> {
  const base = fakeBaseData();
  const c = clock(base);
  const s1 = await createSuggestion(db, contribution(), c.anon());
  await createSuggestion(db, contribution({ name: 'Second Kiosk', location: [75.7006, 31.2502] }), c.anon());
  await approveSuggestion(db, s1.reference, { revision: 1 }, c.owner());
  await createLocation(
    db,
    { fields: { name: 'Central ATM', categoryId: 'finance', location: [75.7005, 31.2501] } },
    c.owner(),
  );
  await putOverride(
    db,
    [...base.places.keys()][0]!,
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
  await hit(db, 'bucket-0003-seed', 5, 900, c.now);
  await db.batch([
    db
      .prepare(
        "INSERT INTO studio_templates (id, name, latest_version, created_by, created_at, updated_by, updated_at) VALUES (?, 'Variant', 1, 'owner', ?, 'owner', ?)",
      )
      .bind(STV, NOW, NOW),
    db
      .prepare(
        "INSERT INTO studio_template_versions (template_id, version, definition_json, generator_id, generator_version, created_by, created_at) VALUES (?, 1, '{}', 'box', 1, 'owner', ?)",
      )
      .bind(STV, NOW),
    db
      .prepare(
        "INSERT INTO studio_buildings (id, status, draft_json, draft_revision, draft_saved_by, draft_saved_at, created_by, created_at, updated_by, updated_at) VALUES (?, 'draft', '{}', 1, 'owner', ?, 'owner', ?, 'owner', ?)",
      )
      .bind(STU, NOW, NOW, NOW),
    db
      .prepare(
        "INSERT INTO studio_buildings (id, status, published_version, created_by, created_at, updated_by, updated_at) VALUES (?, 'published', 1, 'owner', ?, 'owner', ?)",
      )
      .bind(STU_PUBLISHED, NOW, NOW),
    db
      .prepare(
        `INSERT INTO studio_building_versions (building_id, version, record_json, footprint_json, footprint_area_m2, membership_json,
           validation_json, change_summary, model_config_version, generator_id, generator_version, accuracy_class, published_by, published_at)
         VALUES (?, 1, '{"model":{}}', '{"type":"Polygon","coordinates":[]}', 100, '{}', '{}', 'First publish', 1, 'box', 1, 'generic-prefab', 'owner', ?)`,
      )
      .bind(STU_PUBLISHED, NOW),
    db
      .prepare(
        "INSERT INTO audit_events (at, actor, action, entity_type, entity_id, outcome) VALUES (?, 'owner', 'building.create', 'building', ?, 'success')",
      )
      .bind(NOW, STU),
  ]);
}

const evidence = JSON.stringify([
  { kind: 'site-sign', description: 'Sign at the entrance reads Block 25.', date: '2026-10-24' },
]);

const insertDecision = (
  db: SqlDatabase,
  subjectId: string,
  status: string,
  buildingId: string | null,
  evidenceJson = '[]',
  note: string | null = null,
) =>
  db
    .prepare(
      `INSERT INTO artwork_associations (subject_id, status, building_id, evidence_json, note, created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, 'owner', ?, 'owner', ?)`,
    )
    .bind(subjectId, status, buildingId, evidenceJson, note, NOW, NOW)
    .run();

const audit = (
  db: SqlDatabase,
  entityType: string,
  entityId: string,
  action: string,
  after: unknown = null,
) =>
  db
    .prepare(
      "INSERT INTO audit_events (at, actor, action, entity_type, entity_id, after_json, outcome) VALUES (?, 'owner', ?, ?, ?, ?, 'success')",
    )
    .bind(NOW, action, entityType, entityId, after === null ? null : JSON.stringify(after))
    .run();

const rejects = async (p: Promise<unknown>, pattern: RegExp) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, 'statement should have been rejected').toBeInstanceOf(Error);
  expect(String((err as Error).message)).toMatch(pattern);
};

describe('0003 on a fresh database (0001 + 0002 + 0003)', () => {
  it('creates artwork_associations with its indexes and keeps the audit indexes and append-only triggers', async () => {
    const db = await emptyDb();
    for (const f of [M1, M2, M3]) await applyFile(db, f);
    const names = (await schemaOf(db)).map((r) => `${r.type}:${r.name}`);
    for (const n of [
      'table:artwork_associations',
      'index:artwork_associations_building',
      'index:artwork_associations_status',
      'index:audit_entity',
      'index:audit_at',
      'index:audit_action',
      'trigger:audit_events_no_update',
      'trigger:audit_events_no_delete',
    ])
      expect(names).toContain(n);
    expect(names).not.toContain('table:audit_events_0003');
  });

  it('enforces ids, statuses, the building rule, evidence for verified and the audit entity type', async () => {
    const db = await emptyDb();
    for (const f of [M1, M2, M3]) await applyFile(db, f);
    await insertDecision(db, 'art:num-25', 'approximate', 'osm:way/422823421');
    await insertDecision(db, 'art:num-21a', 'unresolved', null);
    await insertDecision(db, 'art:scene-091', 'verified', 'osm:way/1', evidence);
    await insertDecision(db, 'art:area-scene-pavilion', 'verified', STU, evidence);
    await rejects(insertDecision(db, 'art:num-25', 'unresolved', null), /UNIQUE|PRIMARY/);
    await rejects(insertDecision(db, 'block-25', 'unresolved', null), /CHECK/);
    await rejects(insertDecision(db, 'art:num-25X', 'unresolved', null), /CHECK/);
    await rejects(insertDecision(db, 'art:foo-1', 'unresolved', null), /CHECK/);
    await rejects(insertDecision(db, 'art:num-26', 'official', 'osm:way/1'), /CHECK/);
    await rejects(insertDecision(db, 'art:num-26', 'unresolved', 'osm:way/1'), /CHECK/);
    await rejects(insertDecision(db, 'art:num-26', 'approximate', null), /CHECK/);
    await rejects(insertDecision(db, 'art:num-26', 'verified', 'osm:way/1'), /CHECK/);
    await rejects(insertDecision(db, 'art:num-26', 'approximate', 'osm:node/1'), /CHECK/);
    await rejects(insertDecision(db, 'art:num-26', 'approximate', 'Block 26'), /CHECK/);
    await rejects(insertDecision(db, 'art:num-26', 'unresolved', null, '{}'), /CHECK/);
    await rejects(insertDecision(db, 'art:num-26', 'unresolved', null, '[]', 'x'.repeat(1001)), /CHECK/);

    await audit(db, 'artwork', 'art:num-25', 'artwork.put');
    await rejects(audit(db, 'art', 'art:num-25', 'artwork.put'), /CHECK/);
    await rejects(db.prepare("UPDATE audit_events SET actor = 'x'").run(), /append-only/);
    await rejects(db.prepare('DELETE FROM audit_events').run(), /append-only/);
  });
});

describe('0002 → 0003 on a populated database', () => {
  it('preserves every row and id of every table and the audit sequence', async () => {
    const db = await emptyDb();
    await applyFile(db, M1);
    await applyFile(db, M2);
    await seedThrough0002(db);
    const before = await dataOf(db);
    for (const t of Object.keys(ORDER)) expect(before[t]!.length, `${t} seeded`).toBeGreaterThan(0);
    const maxId = Math.max(...(before.audit_events as { id: number }[]).map((r) => r.id));

    await applyFileAtomically(db, M3);

    expect(await dataOf(db)).toEqual(before);
    expect(await all(db, 'SELECT * FROM artwork_associations')).toEqual([]);
    await audit(db, 'artwork', 'art:num-25', 'artwork.put');
    const last = await db.prepare('SELECT MAX(id) AS id FROM audit_events').first<{ id: number }>();
    expect(last?.id).toBe(maxId + 1);
  });

  it('a failing 0003 (applied atomically) leaves the 0002 database untouched', async () => {
    const db = await emptyDb();
    await applyFile(db, M1);
    await applyFile(db, M2);
    await seedThrough0002(db);
    const before = await dataOf(db);
    const schema = await schemaOf(db);
    const statements = splitSql(readFileSync(M3, 'utf8'));
    const at = statements.findIndex((s) => /^DROP TABLE audit_events/.test(s)) + 1;
    expect(at).toBeGreaterThan(0);
    const broken = [
      ...statements.slice(0, at),
      'INSERT INTO meta (key, value) VALUES (NULL, NULL)',
      ...statements.slice(at),
    ];
    await rejects(db.batch(broken.map((s) => db.prepare(s))), /NOT NULL/);
    expect(await dataOf(db)).toEqual(before);
    expect(await schemaOf(db)).toEqual(schema);
  });
});

describe('docs/db/0003_down.sql and re-applying 0003', () => {
  async function populated0003() {
    const db = await emptyDb();
    await db.prepare(D1_MIGRATIONS).run();
    await applyFile(db, M1);
    await applyFile(db, M2);
    await db
      .prepare("INSERT INTO d1_migrations (name) VALUES ('0001_initial.sql'), ('0002_building_studio.sql')")
      .run();
    await seedThrough0002(db);
    await applyFileAtomically(db, M3);
    await db.prepare("INSERT INTO d1_migrations (name) VALUES ('0003_artwork_associations.sql')").run();
    await insertDecision(
      db,
      'art:num-37',
      'verified',
      'osm:way/422556249',
      evidence,
      'private: checked with estate office',
    );
    await insertDecision(db, 'art:num-25', 'approximate', 'osm:way/422823421');
    await insertDecision(db, 'art:num-9', 'unresolved', null);
    await audit(db, 'artwork', 'art:num-37', 'artwork.put', { status: 'verified' });
    await audit(db, 'artwork', 'art:num-25', 'artwork.put', { status: 'approximate' });
    await audit(db, 'artwork', 'art:num-12', 'artwork.reset');
    await db.prepare("UPDATE meta SET value = '41' WHERE key = 'publication_version'").run();
    return db;
  }

  it('rolls back without losing a decision or an audit row, and re-applies to the exact 0003 state', async () => {
    const ref0002 = await emptyDb();
    await ref0002.prepare(D1_MIGRATIONS).run();
    await applyFile(ref0002, M1);
    await applyFile(ref0002, M2);
    const ref0003 = await emptyDb();
    await ref0003.prepare(D1_MIGRATIONS).run();
    for (const f of [M1, M2, M3]) await applyFile(ref0003, f);

    const db = await populated0003();
    const decisions = await all(db, 'SELECT * FROM artwork_associations ORDER BY subject_id');
    const auditBefore = await all<Record<string, unknown>>(db, 'SELECT * FROM audit_events ORDER BY id');
    const dataBefore = await dataOf(db);
    expect(decisions).toHaveLength(3);

    await applyFileAtomically(db, DOWN3);

    // audit_events has the 0002 definition again; the decisions table is kept, inert
    const schema = await schemaOf(db);
    const artworkObjects = schema.filter((r) => r.tbl_name === 'artwork_associations');
    expect(schema.filter((r) => r.tbl_name !== 'artwork_associations')).toEqual(await schemaOf(ref0002));
    expect(artworkObjects.map((r) => r.name).sort()).toEqual([
      'artwork_associations',
      'artwork_associations_building',
      'artwork_associations_status',
    ]);
    expect(await all(db, 'SELECT * FROM artwork_associations ORDER BY subject_id')).toEqual(decisions);
    expect(await all(db, 'SELECT * FROM audit_events ORDER BY id')).toEqual(
      auditBefore.map((r) => (r.entity_type === 'artwork' ? { ...r, entity_type: 'system' } : r)),
    );
    await rejects(audit(db, 'artwork', 'art:num-1', 'artwork.put'), /CHECK/);
    await rejects(db.prepare("UPDATE audit_events SET actor = 'x'").run(), /append-only/);
    const after = await dataOf(db);
    for (const t of Object.keys(ORDER).filter((x) => x !== 'meta' && x !== 'audit_events'))
      expect(after[t], t).toEqual(dataBefore[t]);
    expect(after.sequence).toEqual(dataBefore.sequence);
    const meta = Object.fromEntries(
      (after.meta as { key: string; value: string }[]).map((r) => [r.key, r.value]),
    );
    expect(meta.publication_version).toBe('42');
    expect(await all(db, 'SELECT name FROM d1_migrations ORDER BY id')).toEqual([
      { name: '0001_initial.sql' },
      { name: '0002_building_studio.sql' },
    ]);

    // re-apply: identical schema to a fresh 0003 database, same decisions, 'artwork' history restored
    await applyFileAtomically(db, M3);
    expect(await schemaOf(db)).toEqual(await schemaOf(ref0003));
    expect(await all(db, 'SELECT * FROM artwork_associations ORDER BY subject_id')).toEqual(decisions);
    expect(await all(db, 'SELECT * FROM audit_events ORDER BY id')).toEqual(auditBefore);
    expect(await dataOf(db)).toEqual({ ...dataBefore, meta: after.meta });
    await audit(db, 'artwork', 'art:num-9', 'artwork.put');
  });

  it('survives repeated rollback / re-apply cycles unchanged', async () => {
    const db = await populated0003();
    const decisions = await all(db, 'SELECT * FROM artwork_associations ORDER BY subject_id');
    const auditBefore = await all(db, 'SELECT * FROM audit_events ORDER BY id');
    const schema = await schemaOf(db);
    for (let i = 0; i < 3; i++) {
      await applyFileAtomically(db, DOWN3);
      await applyFileAtomically(db, M3);
      await db.prepare("INSERT INTO d1_migrations (name) VALUES ('0003_artwork_associations.sql')").run();
    }
    expect(await schemaOf(db)).toEqual(schema);
    expect(await all(db, 'SELECT * FROM artwork_associations ORDER BY subject_id')).toEqual(decisions);
    expect(await all(db, 'SELECT * FROM audit_events ORDER BY id')).toEqual(auditBefore);
  });
});

describe('publication v3 on a 0003 database', () => {
  it('publishes every valid decision in subject order without the private note, and drops a corrupt one', async () => {
    const db = await emptyDb();
    for (const f of [M1, M2, M3]) await applyFile(db, f);
    await insertDecision(db, 'art:num-37', 'verified', 'osm:way/422556249', evidence, 'private note');
    await insertDecision(db, 'art:num-25', 'approximate', 'osm:way/422823421');
    // valid JSON for the CHECK, but not valid evidence: verified with no usable evidence must not be published
    await insertDecision(db, 'art:num-13', 'verified', 'osm:relation/7099162', '[{"kind":"rumour"}]');
    const pub = publicationSchema.parse(await getPublication(db));
    expect(pub.schemaVersion).toBe(3);
    expect(pub.artworkAssociations?.map((a) => a.subjectId)).toEqual(['art:num-25', 'art:num-37']);
    expect(JSON.stringify(pub)).not.toContain('private note');
    expect(pub.artworkAssociations?.[1]).toEqual({
      subjectId: 'art:num-37',
      status: 'verified',
      buildingId: 'osm:way/422556249',
      evidence: JSON.parse(evidence),
      revision: 1,
      updatedAt: NOW,
    });
  });
});
