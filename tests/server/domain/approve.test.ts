import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/test-db.ts';
import { fakeBaseData } from '../helpers/base-data.ts';
import { clock, contribution, fixedIds, OWNER } from '../helpers/context.ts';
import {
  approveSuggestion,
  createSuggestion,
  editSuggestion,
  getPublication,
  listAudit,
} from '../../../server/domain/index.ts';
import { getSuggestionRow } from '../../../server/db/suggestions.ts';
import { getLocationRow } from '../../../server/db/locations.ts';
import { DomainError } from '../../../server/errors.ts';
import type { SqlDatabase, SqlStatement } from '../../../server/db/types.ts';

const base = fakeBaseData();

async function domainError(p: Promise<unknown>): Promise<DomainError> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(DomainError);
  return e as DomainError;
}

/** Wraps a database so that the next batch gets a failing statement spliced in after position `at`. */
function failingBatchDb(db: SqlDatabase, at: number): SqlDatabase & { armed: boolean } {
  const wrapper = {
    armed: true,
    prepare: (sql: string) => db.prepare(sql),
    exec: (sql: string) => db.exec(sql),
    batch: <T>(stmts: SqlStatement[]) => {
      if (!wrapper.armed) return db.batch<T>(stmts);
      wrapper.armed = false;
      // NOT NULL violation on meta.value → the whole transaction must roll back.
      const bad = db.prepare("INSERT INTO meta (key, value) VALUES ('boom', NULL)");
      return db.batch<T>([...stmts.slice(0, at), bad, ...stmts.slice(at)]);
    },
  };
  return wrapper;
}

describe('approveSuggestion', () => {
  let t: TestDb;
  const c = clock(base);
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.dispose();
  });
  beforeEach(async () => {
    await t.reset();
  });

  const create = async (over: Record<string, unknown> = {}) =>
    (await createSuggestion(t.db, contribution(over), c.anon())).reference;

  it('atomically approves, creates exactly one com: location, bumps publication and audits', async () => {
    const id = await create();
    const ctx = c.owner();
    const res = await approveSuggestion(t.db, id, { revision: 1 }, ctx);
    expect(res.location.id).toMatch(/^com:[a-z2-7]{26}$/);
    expect(await getSuggestionRow(t.db, id)).toMatchObject({
      status: 'approved',
      publishedLocationId: res.location.id,
      reviewedBy: OWNER,
      revision: 2,
    });
    expect(await getLocationRow(t.db, res.location.id)).toEqual(res.location);
    expect(res.location).toMatchObject({
      origin: 'community',
      suggestionId: id,
      status: 'active',
      accessNodeId: null,
      createdBy: OWNER,
      name: 'Campus Pharmacy',
    });
    const pub = await getPublication(t.db);
    expect(pub.publicationVersion).toBe(1);
    expect(pub.generatedAt).toBe(ctx.now.toISOString());
    expect(pub.locations.map((l) => l.id)).toEqual([res.location.id]);
    // Public shape: no actor, notes or suggestion link.
    expect(JSON.stringify(pub)).not.toMatch(/owner@example|suggestionId|sug_/);
    const audit = await listAudit(t.db, { limit: 10 });
    expect(
      audit.items
        .map((a) => a.action)
        .slice(0, 2)
        .sort(),
    ).toEqual(['location.create', 'suggestion.approve']);
  });

  it('is idempotent: a repeated approve (same or new revision) never creates a second location', async () => {
    const id = await create();
    await approveSuggestion(t.db, id, { revision: 1 }, c.owner());
    expect((await domainError(approveSuggestion(t.db, id, { revision: 1 }, c.owner()))).code).toBe(
      'conflict',
    );
    expect((await domainError(approveSuggestion(t.db, id, { revision: 2 }, c.owner()))).code).toBe(
      'invalid-transition',
    );
    expect(await t.count('locations')).toBe(1);
    expect((await getPublication(t.db)).publicationVersion).toBe(1);
  });

  it('concurrent approvals of the same revision publish exactly once', async () => {
    const id = await create();
    const results = await Promise.allSettled([
      approveSuggestion(t.db, id, { revision: 1 }, c.owner()),
      approveSuggestion(t.db, id, { revision: 1 }, c.owner()),
      approveSuggestion(t.db, id, { revision: 1 }, c.owner()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected'))
      expect(['conflict', 'invalid-transition']).toContain(
        ((r as PromiseRejectedResult).reason as DomainError).code,
      );
    expect(await t.count('locations')).toBe(1);
    expect((await getPublication(t.db)).publicationVersion).toBe(1);
  });

  it.each([1, 2, 3, 4])('leaves no partial state when the batch fails at position %i', async (at) => {
    const id = await create();
    const db = failingBatchDb(t.db, at);
    const e = await domainError(approveSuggestion(db, id, { revision: 1 }, c.owner()));
    expect(e.code).toBe('internal');
    expect(await getSuggestionRow(t.db, id)).toMatchObject({
      status: 'pending',
      revision: 1,
      publishedLocationId: null,
    });
    expect(await t.count('locations')).toBe(0);
    expect((await getPublication(t.db)).publicationVersion).toBe(0);
    const last = (await listAudit(t.db, { limit: 1 })).items[0];
    expect(last).toMatchObject({ action: 'suggestion.approve', outcome: 'failed' });
    // And it can still be approved afterwards.
    await approveSuggestion(t.db, id, { revision: 1 }, c.owner());
    expect(await t.count('locations')).toBe(1);
  });

  it('rolls back on a real constraint violation mid-batch (location id collision)', async () => {
    const a = await create();
    const b = await create({ name: 'Second place' });
    await approveSuggestion(
      t.db,
      a,
      { revision: 1 },
      c.owner({ ids: fixedIds('com:collision0000000000000000') }),
    );
    const e = await domainError(
      approveSuggestion(
        t.db,
        b,
        { revision: 1 },
        c.owner({ ids: fixedIds('com:collision0000000000000000') }),
      ),
    );
    expect(e.code).toBe('internal');
    expect(await getSuggestionRow(t.db, b)).toMatchObject({
      status: 'pending',
      publishedLocationId: null,
      revision: 1,
    });
    expect(await t.count('locations')).toBe(1);
    expect((await getPublication(t.db)).publicationVersion).toBe(1);
  });

  it('persists owner corrections made by editing before approval', async () => {
    const id = await create({ name: 'Pharmcy', categoryId: 'shop' });
    await editSuggestion(
      t.db,
      id,
      { revision: 1, fields: { name: 'Campus Pharmacy', categoryId: 'health' } },
      c.owner(),
    );
    const res = await approveSuggestion(t.db, id, { revision: 2 }, c.owner());
    expect(res.location).toMatchObject({ name: 'Campus Pharmacy', categoryId: 'health' });
    expect((await getPublication(t.db)).locations[0]).toMatchObject({
      name: 'Campus Pharmacy',
      categoryId: 'health',
    });
  });

  it('validates the FINAL record (submission merged with approval fields)', async () => {
    const id = await create();
    const bad = await domainError(
      approveSuggestion(t.db, id, { revision: 1, fields: { name: 'X' } }, c.owner()),
    );
    expect(bad.code).toBe('invalid');
    expect(bad.issues?.[0]?.path).toBe('fields.name');
    const outside = await domainError(
      approveSuggestion(t.db, id, { revision: 1, fields: { location: [76.5, 30.9] } }, c.owner()),
    );
    expect(outside.code).toBe('outside-area');
    expect(await t.count('locations')).toBe(0);
    const ok = await approveSuggestion(
      t.db,
      id,
      {
        revision: 1,
        fields: {
          name: 'LPU Pharmacy',
          openingHours: 'Mo-Sa 09:00-18:00',
          wheelchair: 'yes',
          verificationStatus: 'verified',
        },
      },
      c.owner(),
    );
    expect(ok.location).toMatchObject({
      name: 'LPU Pharmacy',
      openingHours: 'Mo-Sa 09:00-18:00',
      wheelchair: 'yes',
      verificationStatus: 'verified',
      description: 'Small pharmacy next to the library',
    });
  });

  describe('access point', () => {
    it('accepts a walkable node within maxPlaceConnectorM (routable)', async () => {
      const id = await create();
      const res = await approveSuggestion(
        t.db,
        id,
        { revision: 1, accessPoint: { nodeId: 1, note: 'Front door' } },
        c.owner(),
      );
      expect(res.location).toMatchObject({ accessNodeId: 1, accessNote: 'Front door' });
      expect((await getPublication(t.db)).locations[0]?.accessNodeId).toBe(1);
    });

    it.each([
      ['missing node', 99, /does not exist/],
      ['non-walkable node', 3, /not on any walkable path/],
      ['isolated node', 4, /not on any walkable path/],
    ])('rejects a %s with 422 and a clear message', async (_l, nodeId, msg) => {
      const id = await create();
      const e = await domainError(
        approveSuggestion(t.db, id, { revision: 1, accessPoint: { nodeId } }, c.owner()),
      );
      expect(e.status).toBe(422);
      expect(e.message).toMatch(msg);
      expect(await getSuggestionRow(t.db, id)).toMatchObject({ status: 'pending' });
      expect(await t.count('locations')).toBe(0);
    });

    it('rejects a node farther than maxPlaceConnectorM (never snaps to a nearer one)', async () => {
      // Place 120 m west of node 0; node 0 is the nearest walkable node, but too far.
      const id = await create({ location: [75.6987, 31.25] });
      const e = await domainError(
        approveSuggestion(t.db, id, { revision: 1, accessPoint: { nodeId: 0 } }, c.owner()),
      );
      expect(e.status).toBe(422);
      expect(e.message).toMatch(/must be within 60 m/);
      const ok = await approveSuggestion(t.db, id, { revision: 1 }, c.owner());
      expect(ok.location.accessNodeId).toBeNull();
    });

    it('rejects malformed access points', async () => {
      const id = await create();
      for (const accessPoint of [{ nodeId: -1 }, { nodeId: 1.5 }, { nodeId: '1' }, 'node-1']) {
        const e = await domainError(approveSuggestion(t.db, id, { revision: 1, accessPoint }, c.owner()));
        expect(e.code).toBe('invalid');
      }
    });
  });
});
