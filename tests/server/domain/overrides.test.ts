import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/test-db.ts';
import { BLOCK_34, FOOD_COURT, fakeBaseData, LIBRARY, PLACES, UNNAMED } from '../helpers/base-data.ts';
import { clock, contribution } from '../helpers/context.ts';
import {
  approveSuggestion,
  createLocation,
  createSuggestion,
  deleteOverride,
  getOverride,
  getOverview,
  getPublication,
  getQualityWarnings,
  hideOverride,
  listAudit,
  listOverrides,
  putOverride,
  revertAuditEvent,
  unhideOverride,
} from '../../../server/domain/index.ts';
import { getOverrideRow } from '../../../server/db/overrides.ts';
import { DomainError } from '../../../server/errors.ts';
import { mergePublication } from '../../../src/community/merge.ts';
import { syntheticCampus } from '../../unit/community/synthetic-campus.ts';

const base = fakeBaseData();

async function domainError(p: Promise<unknown>): Promise<DomainError> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(DomainError);
  return e as DomainError;
}

describe('overrides', () => {
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

  const pubVersion = async () => (await getPublication(t.db)).publicationVersion;

  it('creates an override storing only fields that differ from the base, with dataset version', async () => {
    const { override } = await putOverride(
      t.db,
      LIBRARY.id,
      {
        revision: null,
        hidden: false,
        fields: {
          name: 'Main Library', // equal to base → dropped
          wheelchair: 'yes', // equal → dropped
          openingHours: 'Mo-Su 08:00-22:00',
          description: '  Central library  ',
        },
        note: 'Checked at the desk',
      },
      c.owner(),
    );
    expect(override).toMatchObject({
      targetId: LIBRARY.id,
      fields: { openingHours: 'Mo-Su 08:00-22:00', description: 'Central library' },
      hidden: false,
      revision: 1,
      baseDatasetVersion: 'synthetic-v1',
      note: 'Checked at the desk',
    });
    expect(Object.keys(override!.fields).sort()).toEqual(['description', 'openingHours']);
    expect(await pubVersion()).toBe(1);
    const pub = await getPublication(t.db);
    expect(pub.overrides).toHaveLength(1);
    expect(JSON.stringify(pub)).not.toContain('Checked at the desk');
  });

  it('accepts unchanged non-assignable base category (building) but rejects assigning it', async () => {
    const r = await putOverride(
      t.db,
      UNNAMED.id,
      { revision: null, hidden: false, fields: { categoryId: 'building', name: 'Block 99' } },
      c.owner(),
    );
    expect(r.override?.fields).toEqual({ name: 'Block 99' });
    const e = await domainError(
      putOverride(
        t.db,
        BLOCK_34.id,
        { revision: null, hidden: false, fields: { categoryId: 'building' } },
        c.owner(),
      ),
    );
    expect(e.code).toBe('invalid');
  });

  it('rejects unknown targets, malformed bodies and outside-area moves', async () => {
    expect(
      (
        await domainError(
          putOverride(t.db, 'osm:way/404', { revision: null, hidden: true, fields: {} }, c.owner()),
        )
      ).code,
    ).toBe('not-found');
    expect(
      (await domainError(putOverride(t.db, LIBRARY.id, { revision: null, fields: {} }, c.owner()))).code,
    ).toBe('invalid');
    expect(
      (
        await domainError(
          putOverride(
            t.db,
            LIBRARY.id,
            { revision: null, hidden: false, fields: { location: [70, 20] } },
            c.owner(),
          ),
        )
      ).code,
    ).toBe('outside-area');
    expect(await t.count('overrides')).toBe(0);
  });

  it('optimistic concurrency: create-when-exists and stale revision → conflict', async () => {
    await putOverride(
      t.db,
      LIBRARY.id,
      { revision: null, hidden: false, fields: { description: 'A' } },
      c.owner(),
    );
    const e1 = await domainError(
      putOverride(
        t.db,
        LIBRARY.id,
        { revision: null, hidden: false, fields: { description: 'B' } },
        c.owner(),
      ),
    );
    expect(e1.code).toBe('conflict');
    await putOverride(
      t.db,
      LIBRARY.id,
      { revision: 1, hidden: false, fields: { description: 'C' } },
      c.owner(),
    );
    const e2 = await domainError(
      putOverride(t.db, LIBRARY.id, { revision: 1, hidden: false, fields: { description: 'D' } }, c.owner()),
    );
    expect(e2.code).toBe('conflict');
    expect((await getOverrideRow(t.db, LIBRARY.id))?.fields.description).toBe('C');
  });

  it('an override equal to the base (empty) deletes the row', async () => {
    await putOverride(
      t.db,
      LIBRARY.id,
      { revision: null, hidden: false, fields: { description: 'A' } },
      c.owner(),
    );
    const r = await putOverride(
      t.db,
      LIBRARY.id,
      { revision: 1, hidden: false, fields: { name: 'Main Library' } },
      c.owner(),
    );
    expect(r.override).toBeNull();
    expect(await t.count('overrides')).toBe(0);
    // Creating an empty override is a no-op.
    const v = await pubVersion();
    expect(
      (await putOverride(t.db, BLOCK_34.id, { revision: null, hidden: false, fields: {} }, c.owner()))
        .override,
    ).toBeNull();
    expect(await pubVersion()).toBe(v);
  });

  it('validates override access points (exists, walkable, within range of the effective location)', async () => {
    const ok = await putOverride(
      t.db,
      LIBRARY.id,
      { revision: null, hidden: false, fields: {}, accessPoint: { nodeId: 2 } },
      c.owner(),
    );
    expect(ok.override?.accessNodeId).toBe(2);
    for (const nodeId of [3, 4, 77]) {
      const e = await domainError(
        putOverride(
          t.db,
          LIBRARY.id,
          { revision: 1, hidden: false, fields: {}, accessPoint: { nodeId } },
          c.owner(),
        ),
      );
      expect(e.status).toBe(422);
    }
    // Node 0 is 61 m from the library: too far.
    expect(
      (
        await domainError(
          putOverride(
            t.db,
            LIBRARY.id,
            { revision: 1, hidden: false, fields: {}, accessPoint: { nodeId: 0 } },
            c.owner(),
          ),
        )
      ).message,
    ).toMatch(/within 60 m/);
    // Moving the place away while keeping node 2 is refused.
    expect(
      (
        await domainError(
          putOverride(
            t.db,
            LIBRARY.id,
            { revision: 1, hidden: false, fields: { location: [75.6985, 31.2505] } },
            c.owner(),
          ),
        )
      ).status,
    ).toBe(422);
  });

  it('hide → unhide round-trip; hide without an existing override creates one; unhide of empty deletes', async () => {
    const h = await hideOverride(t.db, BLOCK_34.id, { revision: null }, c.owner());
    expect(h.override).toMatchObject({ hidden: true, fields: {}, revision: 1 });
    expect((await domainError(hideOverride(t.db, BLOCK_34.id, { revision: 1 }, c.owner()))).code).toBe(
      'invalid-transition',
    );
    const u = await unhideOverride(t.db, BLOCK_34.id, { revision: 1 }, c.owner());
    expect(u.override).toBeNull();
    expect(await t.count('overrides')).toBe(0);
    expect((await domainError(unhideOverride(t.db, BLOCK_34.id, { revision: 1 }, c.owner()))).code).toBe(
      'not-found',
    );
    // Hide keeps existing field edits, unhide restores them.
    await putOverride(
      t.db,
      LIBRARY.id,
      { revision: null, hidden: false, fields: { description: 'X' } },
      c.owner(),
    );
    await hideOverride(t.db, LIBRARY.id, { revision: 1 }, c.owner());
    const back = await unhideOverride(t.db, LIBRARY.id, { revision: 2 }, c.owner());
    expect(back.override).toMatchObject({ hidden: false, fields: { description: 'X' }, revision: 3 });
    expect(await pubVersion()).toBe(5);
  });

  it('deleteOverride reverts to base and is revertable from the audit log', async () => {
    await putOverride(
      t.db,
      LIBRARY.id,
      { revision: null, hidden: false, fields: { description: 'X' }, note: 'n' },
      c.owner(),
    );
    await deleteOverride(t.db, LIBRARY.id, { revision: 1 }, c.owner());
    expect(await t.count('overrides')).toBe(0);
    const ev = (await listAudit(t.db, { action: 'override.delete', limit: 1 })).items[0]!;
    const res = await revertAuditEvent(t.db, ev.id, c.owner());
    expect(res.record).toMatchObject({ fields: { description: 'X' }, note: 'n', revision: 2 });
    expect((await getOverrideRow(t.db, LIBRARY.id))?.fields).toEqual({ description: 'X' });
  });

  it('revert of an override edit restores the before snapshot; refuses after further changes', async () => {
    await putOverride(
      t.db,
      LIBRARY.id,
      { revision: null, hidden: false, fields: { description: 'Good' } },
      c.owner(),
    );
    await putOverride(
      t.db,
      LIBRARY.id,
      { revision: 1, hidden: true, fields: { description: 'Bad' } },
      c.owner(),
    );
    const ev = (await listAudit(t.db, { action: 'override.put', limit: 1 })).items[0]!;
    const res = await revertAuditEvent(t.db, ev.id, c.owner());
    expect(res.record).toMatchObject({ hidden: false, fields: { description: 'Good' }, revision: 3 });
    expect((await domainError(revertAuditEvent(t.db, ev.id, c.owner()))).code).toBe('conflict');
    // Reverting the creation removes the override.
    const created = (await listAudit(t.db, { action: 'override.put', limit: 2 })).items[1]!;
    expect(created.before).toBeNull();
    expect((await domainError(revertAuditEvent(t.db, created.id, c.owner()))).code).toBe('conflict');
  });

  it('getOverride / listOverrides expose base context and orphan status', async () => {
    await putOverride(t.db, FOOD_COURT.id, { revision: null, hidden: true, fields: {} }, c.owner());
    const one = await getOverride(t.db, FOOD_COURT.id, c.owner());
    expect(one).toMatchObject({ orphan: false, place: { id: FOOD_COURT.id }, override: { hidden: true } });
    expect(await getOverride(t.db, BLOCK_34.id, c.owner())).toMatchObject({ override: null, orphan: false });
    expect((await domainError(getOverride(t.db, 'osm:way/404', c.owner()))).code).toBe('not-found');
    const list = await listOverrides(t.db, c.owner());
    expect(list.items.map((o) => [o.targetId, o.orphan, o.baseName])).toEqual([
      [FOOD_COURT.id, false, 'Food Court'],
    ]);
  });
});

describe('base data rebuilds, quality warnings and overview', () => {
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

  // Rebuild: the library vanished from OSM, and edges changed so node 2 is no longer walkable.
  const rebuilt = fakeBaseData({
    datasetVersion: 'synthetic-v2',
    places: PLACES.filter((p) => p.id !== LIBRARY.id),
    footEdges: [true, false, false],
  });

  it('overrides survive a base-data swap; vanished targets become orphans (reported, not applied)', async () => {
    await putOverride(
      t.db,
      LIBRARY.id,
      { revision: null, hidden: false, fields: { description: 'Renovated' } },
      c.owner(),
    );
    await hideOverride(t.db, BLOCK_34.id, { revision: null }, c.owner());

    const after = c.owner({ base: rebuilt });
    const list = await listOverrides(t.db, after);
    expect(list.items.map((o) => [o.targetId, o.orphan])).toEqual(
      [
        [LIBRARY.id, true],
        [BLOCK_34.id, false],
      ].sort(),
    );
    const q = await getQualityWarnings(t.db, after);
    expect(q.warnings.filter((w) => w.kind === 'orphan-override').map((w) => w.id)).toEqual([LIBRARY.id]);
    expect(q.warnings[0]?.message).toContain('synthetic-v1');
    // Orphans cannot be edited, but can be deleted.
    expect(
      (await domainError(putOverride(t.db, LIBRARY.id, { revision: 1, hidden: true, fields: {} }, after)))
        .code,
    ).toBe('not-found');
    await deleteOverride(t.db, LIBRARY.id, { revision: 1 }, after);
    expect((await getQualityWarnings(t.db, after)).counts['orphan-override']).toBe(0);

    // The hidden base place stays excluded after the simulated rebuild (merge on the rebuilt campus).
    const campus = syntheticCampus({ places: PLACES.filter((p) => p.id !== LIBRARY.id) });
    const merged = mergePublication(campus, await getPublication(t.db));
    expect(merged.data.places.some((p) => p.id === BLOCK_34.id)).toBe(false);
    expect(merged.data.buildings.features.some((f) => f.properties.id === BLOCK_34.id)).toBe(false);
  });

  it('flags access nodes that stopped validating after a rebuild, unroutable and off-boundary locations', async () => {
    await putOverride(
      t.db,
      FOOD_COURT.id,
      { revision: null, hidden: false, fields: {}, accessPoint: { nodeId: 2 } },
      c.owner(),
    );
    const routable = await createLocation(
      t.db,
      {
        fields: { name: 'Water Cooler', categoryId: 'water', location: [75.7009, 31.2501] },
        accessPoint: { nodeId: 2 },
      },
      c.owner(),
    );
    const mapOnly = await createLocation(
      t.db,
      { fields: { name: 'Law Gate Xerox', categoryId: 'printing', location: [75.715, 31.26] } },
      c.owner(),
    );
    const before = await getQualityWarnings(t.db, c.owner());
    expect(before.warnings.map((w) => [w.kind, w.id]).sort()).toEqual(
      [
        ['location-not-routable', mapOnly.id],
        ['location-outside-boundary', mapOnly.id],
      ].sort(),
    );
    const afterRebuild = await getQualityWarnings(t.db, c.owner({ base: rebuilt }));
    expect(afterRebuild.counts['override-access-invalid']).toBe(1);
    expect(
      afterRebuild.warnings
        .filter((w) => w.kind === 'location-not-routable')
        .map((w) => w.id)
        .sort(),
    ).toEqual([routable.id, mapOnly.id].sort());
  });

  it('flags possible duplicates among published data and stale pending suggestions', async () => {
    await createLocation(
      t.db,
      { fields: { name: 'Main Library', categoryId: 'library', location: [75.7006, 31.2503] } },
      c.owner(),
    );
    const stale = (await createSuggestion(t.db, contribution(), c.anon())).reference;
    c.advance(15 * 86_400_000);
    const fresh = (await createSuggestion(t.db, contribution({ name: 'Another' }), c.anon())).reference;
    const q = await getQualityWarnings(t.db, c.owner());
    expect(q.warnings.filter((w) => w.kind === 'possible-duplicate').map((w) => w.relatedId)).toEqual([
      LIBRARY.id,
    ]);
    const staleIds = q.warnings.filter((w) => w.kind === 'stale-pending').map((w) => w.id);
    expect(staleIds).toEqual([stale]);
    expect(staleIds).not.toContain(fresh);
    // A hidden base place is no longer a duplicate target.
    await hideOverride(t.db, LIBRARY.id, { revision: null }, c.owner());
    expect((await getQualityWarnings(t.db, c.owner())).counts['possible-duplicate']).toBe(0);
  });

  it('overview counts come from the database', async () => {
    const a = (await createSuggestion(t.db, contribution(), c.anon())).reference;
    await createSuggestion(t.db, contribution({ name: 'Second' }), c.anon());
    await approveSuggestion(t.db, a, { revision: 1 }, c.owner());
    await createLocation(
      t.db,
      { fields: { name: 'ATM', categoryId: 'finance', location: [75.7005, 31.2501] } },
      c.owner(),
    );
    await hideOverride(t.db, BLOCK_34.id, { revision: null }, c.owner());
    await putOverride(
      t.db,
      LIBRARY.id,
      { revision: null, hidden: false, fields: { description: 'x' } },
      c.owner(),
    );
    const o = await getOverview(t.db, c.owner());
    expect(o.suggestions).toMatchObject({ pending: 1, approved: 1, rejected: 0 });
    expect(o.locations).toEqual({ owner: { active: 1, hidden: 0 }, community: { active: 1, hidden: 0 } });
    expect(o.overrides).toMatchObject({ total: 2, hidden: 1, withFields: 1, orphan: 0 });
    expect(o.auditLast7Days).toBeGreaterThanOrEqual(6);
    expect(o.publicationVersion).toBe(4);
    expect(o.qualityWarnings).toBe((await getQualityWarnings(t.db, c.owner())).warnings.length);
  });

  it('publication is deterministic, ordered by id and contains only active locations', async () => {
    const ids: string[] = [];
    for (const name of ['Zeta Kiosk', 'Alpha Kiosk', 'Mid Kiosk']) {
      const l = await createLocation(
        t.db,
        { fields: { name, categoryId: 'shop', location: [75.7005, 31.2501] } },
        c.owner(),
      );
      ids.push(l.id);
    }
    await putOverride(t.db, UNNAMED.id, { revision: null, hidden: true, fields: {} }, c.owner());
    await putOverride(
      t.db,
      BLOCK_34.id,
      { revision: null, hidden: false, fields: { description: 'd' } },
      c.owner(),
    );
    const p1 = await getPublication(t.db);
    const p2 = await getPublication(t.db);
    expect(p1).toEqual(p2);
    expect(p1.locations.map((l) => l.id)).toEqual([...ids].sort());
    expect(p1.overrides.map((o) => o.targetId)).toEqual([BLOCK_34.id, UNNAMED.id]);
    for (const l of p1.locations) expect(Object.keys(l)).not.toContain('createdBy');
  });
});
