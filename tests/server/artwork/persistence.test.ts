/**
 * Gate 4 (migration safety) for the artwork verification workflow, on
 * ISOLATED in-memory local D1 databases only (wrangler getPlatformProxy,
 * persist: false). Owner decisions, their verification evidence and their
 * audit history are written through the REAL admin handlers, then the
 * documented procedure is followed (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md
 * §4.4, docs/db/0003_down.sql):
 *
 *   apply 0001..0003 → owner writes (verify, approximate, update, reset,
 *   a rejected attempt) → rollback with docs/db/0003_down.sql → re-apply
 *   0003 (atomically, as `wrangler d1 migrations apply` does)
 *
 * and asserts that every artwork_associations row (evidence and private note
 * included), every audit row (ids, before/after, outcome) and the published
 * decisions come back EXACTLY, that the re-applied schema equals a fresh
 * one, and that the handlers keep working on the recovered database
 * (revisions continue, 409 still guards stale writes).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { SqlDatabase } from '../../../server/db/types.ts';
import { publicationSchema } from '../../../src/community/schema.ts';
import { migrationFiles, REPO_ROOT, splitSql } from '../helpers/test-db.ts';
import {
  PRIVATE_NOTE,
  approximateBaseline,
  asOwner,
  assocPath,
  json,
  makeArtKit,
  officialDoc,
  ownerStatement,
  publication,
  siteSign,
  type ArtKit,
} from './helpers.ts';

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

const D1_MIGRATIONS =
  'CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)';
const DOWN3 = join(REPO_ROOT, 'docs/db/0003_down.sql');
const M3_NAME = '0003_artwork_associations.sql';
const fileNamed = (name: string) => migrationFiles().find((p) => p.split(/[\\/]/).pop() === name)!;

/** One batch = one transaction, the way `wrangler d1 migrations apply` / `d1 execute --file` run a file. */
async function applyAtomically(db: SqlDatabase, file: string): Promise<void> {
  await db.batch(splitSql(readFileSync(file, 'utf8')).map((s) => db.prepare(s)));
}

/** A database exactly as `wrangler d1 migrations apply` leaves it after 0001..0003. */
async function migratedDb(): Promise<SqlDatabase> {
  const db = await emptyDb();
  await db.prepare(D1_MIGRATIONS).run();
  for (const f of migrationFiles()) {
    await applyAtomically(db, f);
    const name = f.split(/[\\/]/).pop()!;
    await db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(name).run();
  }
  return db;
}

const all = async <T = Record<string, unknown>>(db: SqlDatabase, sql: string) =>
  (await db.prepare(sql).all<T>()).results;

async function schemaOf(db: SqlDatabase) {
  const rows = await all<{ type: string; name: string; sql: string | null }>(
    db,
    "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY type, name",
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

const decisions = (db: SqlDatabase) => all(db, 'SELECT * FROM artwork_associations ORDER BY subject_id');
const artworkAudit = (db: SqlDatabase) =>
  all<Record<string, unknown>>(db, "SELECT * FROM audit_events WHERE action GLOB 'artwork.*' ORDER BY id");
const allAudit = (db: SqlDatabase) =>
  all<Record<string, unknown>>(db, 'SELECT * FROM audit_events ORDER BY id');

const VERIFIED = 'art:num-34';
const BUILDING = 'osm:way/422437890';

/** The owner workflow through the real handlers: verify, update, approximate, reset, re-decide, a rejected attempt. */
async function ownerWorkflow(k: ArtKit) {
  const approx = approximateBaseline();
  const steps: Array<[string, string, unknown, number]> = [
    [
      'PUT',
      VERIFIED,
      {
        expectedRevision: null,
        status: 'verified',
        buildingId: BUILDING,
        evidence: [siteSign()],
        note: PRIVATE_NOTE,
      },
      200,
    ],
    [
      'PUT',
      VERIFIED,
      {
        expectedRevision: 1,
        status: 'verified',
        buildingId: BUILDING,
        evidence: [siteSign(), officialDoc()],
        note: PRIVATE_NOTE,
      },
      200,
    ],
    [
      'PUT',
      approx.subjectId,
      {
        expectedRevision: null,
        status: 'approximate',
        buildingId: approx.buildingId,
        evidence: [],
        note: 'Same as the reviewed candidate; not checked on site.',
      },
      200,
    ],
    ['DELETE', approx.subjectId, { expectedRevision: 1 }, 200],
    [
      'PUT',
      approx.subjectId,
      {
        expectedRevision: null,
        status: 'unresolved',
        buildingId: null,
        evidence: [],
        note: 'Candidate rejected.',
      },
      200,
    ],
    // A refused write (verified without evidence) is part of the audit history too.
    [
      'PUT',
      'art:num-58',
      { expectedRevision: null, status: 'verified', buildingId: BUILDING, evidence: [] },
      422,
    ],
    [
      'PUT',
      'art:num-1',
      { expectedRevision: null, status: 'verified', buildingId: BUILDING, evidence: [ownerStatement()] },
      200,
    ],
  ];
  for (const [method, subject, body, status] of steps) {
    const res = await asOwner(k, method, assocPath(subject), { body });
    expect(res.status, `${method} ${subject}`).toBe(status);
  }
}

describe('artwork decisions survive apply → rollback → re-apply (isolated local D1)', () => {
  it('rows, evidence, notes, audit history and the publication persist exactly; the server keeps working', async () => {
    const db = await migratedDb();
    const k = await makeArtKit(db);
    await ownerWorkflow(k);

    const beforeDecisions = await decisions(db);
    const beforeAudit = await allAudit(db);
    const beforeArtworkAudit = await artworkAudit(db);
    const beforePub = publicationSchema.parse((await publication(k)).body);
    const beforeSeq = await all(db, "SELECT seq FROM sqlite_sequence WHERE name = 'audit_events'");
    expect(beforeDecisions).toHaveLength(3);
    expect(beforeArtworkAudit.map((r) => [r.action, r.outcome, r.entity_type])).toEqual([
      ['artwork.put', 'success', 'artwork'],
      ['artwork.put', 'success', 'artwork'],
      ['artwork.put', 'success', 'artwork'],
      ['artwork.reset', 'success', 'artwork'],
      ['artwork.put', 'success', 'artwork'],
      ['artwork.put', 'rejected', 'artwork'],
      ['artwork.put', 'success', 'artwork'],
    ]);
    expect(beforePub.artworkAssociations?.map((a) => [a.subjectId, a.status, a.revision])).toEqual(
      [
        ['art:num-1', 'verified', 1],
        [approximateBaseline().subjectId, 'unresolved', 1],
        [VERIFIED, 'verified', 2],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );

    // --- Rollback (docs/db/0003_down.sql, one transaction like `d1 execute --file`) ---
    const pubVersionBefore = beforePub.publicationVersion;
    await applyAtomically(db, DOWN3);
    expect(await all(db, 'SELECT name FROM d1_migrations ORDER BY id')).toEqual([
      { name: '0001_initial.sql' },
      { name: '0002_building_studio.sql' },
    ]);
    // Decisions are kept untouched (inert for the pre-0003 server).
    expect(await decisions(db)).toEqual(beforeDecisions);
    // Every audit row is kept with its id; 'artwork' rows are stored as 'system' with the action prefix intact.
    const rolledAudit = await allAudit(db);
    expect(rolledAudit).toEqual(
      beforeAudit.map((r) => (r.entity_type === 'artwork' ? { ...r, entity_type: 'system' } : r)),
    );
    expect(await all(db, "SELECT seq FROM sqlite_sequence WHERE name = 'audit_events'")).toEqual(beforeSeq);
    // The pre-0003 audit CHECK is back: an 'artwork' audit row cannot be written while rolled back.
    await expect(
      db
        .prepare(
          "INSERT INTO audit_events (at, actor, action, entity_type, outcome) VALUES ('2026-10-24T00:00:00Z', 'x', 'artwork.put', 'artwork', 'success')",
        )
        .run(),
    ).rejects.toThrow();
    const rolledVersion = Number(
      (
        await db
          .prepare("SELECT value FROM meta WHERE key = 'publication_version'")
          .first<{ value: string }>()
      )?.value,
    );
    expect(rolledVersion).toBe(pubVersionBefore + 1);

    // --- Re-apply 0003 exactly as wrangler would (atomic file + d1_migrations row) ---
    await applyAtomically(db, fileNamed(M3_NAME));
    await db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(M3_NAME).run();

    expect(await decisions(db)).toEqual(beforeDecisions);
    expect(await allAudit(db)).toEqual(beforeAudit);
    expect(await artworkAudit(db)).toEqual(beforeArtworkAudit);
    expect(await all(db, "SELECT seq FROM sqlite_sequence WHERE name = 'audit_events'")).toEqual(beforeSeq);
    const fresh = await migratedDb();
    expect(await schemaOf(db)).toEqual(await schemaOf(fresh));

    const afterPub = publicationSchema.parse((await publication(k)).body);
    expect(afterPub.artworkAssociations).toEqual(beforePub.artworkAssociations);
    expect(afterPub.publicationVersion).toBeGreaterThan(pubVersionBefore);

    // --- The recovered database keeps working through the real handlers ---
    const stale = await asOwner(k, 'PUT', assocPath(VERIFIED), {
      body: { expectedRevision: 1, status: 'verified', buildingId: BUILDING, evidence: [siteSign()] },
    });
    expect(stale.status).toBe(409);
    const next = await asOwner(k, 'PUT', assocPath(VERIFIED), {
      body: {
        expectedRevision: 2,
        status: 'verified',
        buildingId: BUILDING,
        evidence: [siteSign(), officialDoc(), ownerStatement()],
        note: PRIVATE_NOTE,
      },
    });
    expect(next.status).toBe(200);
    const view = await json<{ decision: { revision: number; createdAt: string } }>(next);
    expect(view.decision.revision).toBe(3);
    const detail = await json<{ history: { id: number; action: string; entityType: string }[] }>(
      await asOwner(k, 'GET', assocPath(VERIFIED)),
    );
    // Full history: the 2 pre-rollback puts, the stale 409 (rejected) and the new put — oldest first.
    expect(detail.history.map((h) => [h.action, h.entityType])).toEqual([
      ['artwork.put', 'artwork'],
      ['artwork.put', 'artwork'],
      ['artwork.put', 'artwork'],
      ['artwork.put', 'artwork'],
    ]);
    const ids = detail.history.map((h) => h.id);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    expect(Math.min(...ids.slice(2))).toBeGreaterThan(Number(beforeSeq[0]!.seq));
  });

  it('three rollback / re-apply cycles keep the same decisions and audit history', async () => {
    const db = await migratedDb();
    const k = await makeArtKit(db);
    await ownerWorkflow(k);
    const d0 = await decisions(db);
    const a0 = await allAudit(db);
    for (let i = 0; i < 3; i++) {
      await applyAtomically(db, DOWN3);
      await applyAtomically(db, fileNamed(M3_NAME));
      await db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(M3_NAME).run();
      expect(await decisions(db)).toEqual(d0);
      expect(await allAudit(db)).toEqual(a0);
    }
    const list = await json<{ items: { subjectId: string; decision: unknown }[] }>(
      await asOwner(k, 'GET', '/artwork/associations'),
    );
    expect(
      list.items
        .filter((i) => i.decision !== null)
        .map((i) => i.subjectId)
        .sort(),
    ).toEqual((d0 as { subject_id: string }[]).map((r) => r.subject_id).sort());
  });

  it('a failing rollback leaves everything untouched (atomic)', async () => {
    const db = await migratedDb();
    const k = await makeArtKit(db);
    await ownerWorkflow(k);
    const d0 = await decisions(db);
    const a0 = await allAudit(db);
    const s0 = await schemaOf(db);
    const broken = splitSql(readFileSync(DOWN3, 'utf8'));
    // Fail at the very end (after the audit rebuild) — the whole batch must roll back.
    broken.push('INSERT INTO no_such_table VALUES (1)');
    await expect(db.batch(broken.map((s) => db.prepare(s)))).rejects.toThrow();
    expect(await decisions(db)).toEqual(d0);
    expect(await allAudit(db)).toEqual(a0);
    expect(await schemaOf(db)).toEqual(s0);
    expect((await all(db, 'SELECT name FROM d1_migrations ORDER BY id')).map((r) => r.name)).toContain(
      M3_NAME,
    );
  });
});
