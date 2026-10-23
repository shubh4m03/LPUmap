import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/test-db.ts';
import { fakeBaseData } from '../helpers/base-data.ts';
import { clock, OWNER } from '../helpers/context.ts';
import {
  createLocation,
  deleteLocation,
  getPublication,
  hideLocation,
  listAudit,
  listLocations,
  restoreLocation,
  revertAuditEvent,
  updateLocation,
} from '../../../server/domain/index.ts';
import { getLocationRow } from '../../../server/db/locations.ts';
import type { LocationRecord } from '../../../server/db/records.ts';
import { DomainError } from '../../../server/errors.ts';

const base = fakeBaseData();

async function domainError(p: Promise<unknown>): Promise<DomainError> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(DomainError);
  return e as DomainError;
}

const FIELDS = {
  name: 'Central ATM',
  categoryId: 'finance',
  location: [75.7005, 31.2501],
  description: 'Two machines',
};

describe('owner locations', () => {
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

  const create = (over: Record<string, unknown> = {}, accessPoint?: unknown) =>
    createLocation(
      t.db,
      { fields: { ...FIELDS, ...over }, ...(accessPoint ? { accessPoint } : {}) },
      c.owner(),
    );

  const pubVersion = async () => (await getPublication(t.db)).publicationVersion;

  it('creates an active own: location with defaults, publication bump and audit', async () => {
    const loc = await create({}, { nodeId: 1 });
    expect(loc).toMatchObject({
      origin: 'owner',
      status: 'active',
      revision: 1,
      wheelchair: 'unknown',
      verificationStatus: 'unverified',
      accessNodeId: 1,
      createdBy: OWNER,
      suggestionId: null,
    });
    expect(loc.id).toMatch(/^own:[a-z2-7]{26}$/);
    expect(await pubVersion()).toBe(1);
    expect((await getPublication(t.db)).locations.map((l) => l.id)).toEqual([loc.id]);
    const audit = await listAudit(t.db, { entity: 'location', entityId: loc.id });
    expect(audit.items.map((a) => a.action)).toEqual(['location.create']);
  });

  it('ignores client-supplied id/status/actor and validates fields', async () => {
    const loc = await createLocation(
      t.db,
      { fields: FIELDS, id: 'own:mine', status: 'hidden', createdBy: 'mallory', origin: 'community' },
      c.owner(),
    );
    expect(loc).toMatchObject({ status: 'active', createdBy: OWNER, origin: 'owner' });
    expect(loc.id).not.toBe('own:mine');
    expect((await domainError(create({ categoryId: 'other' }))).code).toBe('invalid');
    expect((await domainError(create({ location: [0, 0] }))).code).toBe('outside-area');
    expect((await domainError(create({}, { nodeId: 3 }))).status).toBe(422);
    expect((await domainError(createLocation(t.db, { fields: FIELDS }, c.anon()))).code).toBe(
      'unauthenticated',
    );
    expect(await t.count('locations')).toBe(1);
  });

  it('updates with optimistic concurrency; stale revision → conflict with current record, no bump', async () => {
    const loc = await create();
    const v1 = await pubVersion();
    const upd = await updateLocation(
      t.db,
      loc.id,
      { revision: 1, fields: { name: 'Main ATM', wheelchair: 'yes' } },
      c.owner(),
    );
    expect(upd).toMatchObject({
      name: 'Main ATM',
      wheelchair: 'yes',
      revision: 2,
      description: 'Two machines',
    });
    expect(await pubVersion()).toBe(v1 + 1);
    const e = await domainError(
      updateLocation(t.db, loc.id, { revision: 1, fields: { name: 'Stale' } }, c.owner()),
    );
    expect(e.code).toBe('conflict');
    expect((e.details as { current: LocationRecord }).current.name).toBe('Main ATM');
    expect(await pubVersion()).toBe(v1 + 1);
    expect((await getLocationRow(t.db, loc.id))?.name).toBe('Main ATM');
  });

  it('handles access points on update: set, keep (revalidated on move), clear', async () => {
    const loc = await create();
    const a = await updateLocation(
      t.db,
      loc.id,
      { revision: 1, fields: {}, accessPoint: { nodeId: 1 } },
      c.owner(),
    );
    expect(a.accessNodeId).toBe(1);
    // Moving 150 m away while keeping node 1 → refused (would fabricate a route).
    const e = await domainError(
      updateLocation(t.db, loc.id, { revision: 2, fields: { location: [75.7021, 31.2505] } }, c.owner()),
    );
    expect(e.status).toBe(422);
    expect(e.message).toMatch(/no longer valid/);
    const cleared = await updateLocation(
      t.db,
      loc.id,
      { revision: 2, fields: { location: [75.7021, 31.2505] }, accessPoint: null },
      c.owner(),
    );
    expect(cleared).toMatchObject({ accessNodeId: null, location: [75.7021, 31.2505] });
  });

  it('hide → restore are reversible, each bumps publication; repeating is an invalid transition', async () => {
    const loc = await create();
    const v = await pubVersion();
    const hidden = await hideLocation(t.db, loc.id, { revision: 1 }, c.owner());
    expect(hidden.status).toBe('hidden');
    expect((await getPublication(t.db)).locations).toEqual([]);
    expect(await pubVersion()).toBe(v + 1);
    expect((await domainError(hideLocation(t.db, loc.id, { revision: 2 }, c.owner()))).code).toBe(
      'invalid-transition',
    );
    await restoreLocation(t.db, loc.id, { revision: 2 }, c.owner());
    expect((await getPublication(t.db)).locations.map((l) => l.id)).toEqual([loc.id]);
    expect(await pubVersion()).toBe(v + 2);
    expect((await listLocations(t.db, { status: 'active' })).items).toHaveLength(1);
    expect((await listLocations(t.db, { status: 'bogus' })).items).toHaveLength(1);
  });

  it('delete requires hidden status and the exact current name; audit keeps the before snapshot', async () => {
    const loc = await create();
    let e = await domainError(
      deleteLocation(t.db, loc.id, { revision: 1, confirmName: 'Central ATM' }, c.owner()),
    );
    expect(e.code).toBe('invalid-transition');
    await hideLocation(t.db, loc.id, { revision: 1 }, c.owner());
    e = await domainError(
      deleteLocation(t.db, loc.id, { revision: 2, confirmName: 'central atm' }, c.owner()),
    );
    expect(e.code).toBe('invalid');
    e = await domainError(deleteLocation(t.db, loc.id, { revision: 2 }, c.owner()));
    expect(e.code).toBe('invalid');
    e = await domainError(
      deleteLocation(t.db, loc.id, { revision: 1, confirmName: 'Central ATM' }, c.owner()),
    );
    expect(e.code).toBe('conflict');
    expect(await t.count('locations')).toBe(1);
    const v = await pubVersion();
    expect(
      await deleteLocation(t.db, loc.id, { revision: 2, confirmName: 'Central ATM' }, c.owner()),
    ).toEqual({
      deleted: loc.id,
    });
    expect(await t.count('locations')).toBe(0);
    expect(await pubVersion()).toBe(v);
    const ev = (await listAudit(t.db, { action: 'location.delete', limit: 1 })).items[0];
    expect(ev).toMatchObject({ outcome: 'success', after: null });
    expect(ev?.before).toMatchObject({ id: loc.id, name: 'Central ATM', status: 'hidden' });
  });

  describe('revertAuditEvent', () => {
    const lastEvent = async (action: string) => (await listAudit(t.db, { action, limit: 1 })).items[0]!;

    it('restores the before snapshot of an edit as a new revision and audits it', async () => {
      const loc = await create();
      await updateLocation(
        t.db,
        loc.id,
        { revision: 1, fields: { name: 'Wrong Name', description: null } },
        c.owner(),
      );
      const ev = await lastEvent('location.update');
      const res = await revertAuditEvent(t.db, ev.id, c.owner());
      expect(res.record).toMatchObject({ name: 'Central ATM', description: 'Two machines', revision: 3 });
      expect(await getLocationRow(t.db, loc.id)).toMatchObject({ name: 'Central ATM', revision: 3 });
      expect((await lastEvent('location.revert')).detail).toContain(`#${ev.id}`);
      expect((await getPublication(t.db)).locations[0]?.name).toBe('Central ATM');
    });

    it('refuses with conflict when the record changed since the event', async () => {
      const loc = await create();
      await updateLocation(t.db, loc.id, { revision: 1, fields: { name: 'Second' } }, c.owner());
      const ev = await lastEvent('location.update');
      await updateLocation(t.db, loc.id, { revision: 2, fields: { name: 'Third' } }, c.owner());
      expect((await domainError(revertAuditEvent(t.db, ev.id, c.owner()))).code).toBe('conflict');
      expect((await getLocationRow(t.db, loc.id))?.name).toBe('Third');
    });

    it('restores a permanently deleted location (hidden) from the audit snapshot', async () => {
      const loc = await create();
      await hideLocation(t.db, loc.id, { revision: 1 }, c.owner());
      await deleteLocation(t.db, loc.id, { revision: 2, confirmName: 'Central ATM' }, c.owner());
      const ev = await lastEvent('location.delete');
      const res = await revertAuditEvent(t.db, ev.id, c.owner());
      expect(res.record).toMatchObject({ id: loc.id, status: 'hidden', name: 'Central ATM', revision: 3 });
      expect(await getLocationRow(t.db, loc.id)).toMatchObject({ status: 'hidden' });
      // Reverting the same deletion twice is refused.
      expect((await domainError(revertAuditEvent(t.db, ev.id, c.owner()))).code).toBe('conflict');
    });

    it('re-validates a restored access node against the current base data', async () => {
      const loc = await create({}, { nodeId: 1 });
      await updateLocation(t.db, loc.id, { revision: 1, fields: {}, accessPoint: null }, c.owner());
      const ev = await lastEvent('location.update');
      // A rebuild made node 1 non-walkable.
      const rebuilt = fakeBaseData({ datasetVersion: 'synthetic-v2', footEdges: [false, false, false] });
      const e = await domainError(revertAuditEvent(t.db, ev.id, c.owner({ base: rebuilt })));
      expect(e.status).toBe(422);
      expect((await getLocationRow(t.db, loc.id))?.accessNodeId).toBeNull();
    });

    it('refuses non-revertable, failed, unknown or malformed events', async () => {
      const loc = await create();
      const createEv = await lastEvent('location.create');
      expect((await domainError(revertAuditEvent(t.db, createEv.id, c.owner()))).status).toBe(422);
      await domainError(updateLocation(t.db, loc.id, { revision: 9, fields: {} }, c.owner()));
      const rejectedEv = (await listAudit(t.db, { action: 'location.update', limit: 1 })).items[0]!;
      expect(rejectedEv.outcome).toBe('rejected');
      expect((await domainError(revertAuditEvent(t.db, rejectedEv.id, c.owner()))).status).toBe(422);
      expect((await domainError(revertAuditEvent(t.db, 999999, c.owner()))).code).toBe('not-found');
      expect((await domainError(revertAuditEvent(t.db, 'abc', c.owner()))).code).toBe('invalid');
      expect((await domainError(revertAuditEvent(t.db, createEv.id, c.anon()))).code).toBe('unauthenticated');
    });
  });
});
