/**
 * Concurrency: two writers that both read revision R. The competing write is
 * injected deterministically between the operation's read and its batch
 * (racingDb), so the lost-update window is exercised on every run rather than
 * by chance. Exactly one writer may win; the other gets 409 and leaves no
 * trace except a 'rejected' audit row — in particular no 'success' audit row
 * describing a change that never happened, and no extra publication bump.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/test-db.ts';
import { fakeBaseData, LIBRARY } from '../helpers/base-data.ts';
import { clock, contribution } from '../helpers/context.ts';
import {
  approveSuggestion,
  createLocation,
  createSuggestion,
  deleteLocation,
  editSuggestion,
  getPublication,
  hideLocation,
  hideOverride,
  listAudit,
  putOverride,
  rejectSuggestion,
  revertAuditEvent,
  updateLocation,
} from '../../../server/domain/index.ts';
import { getLocationRow } from '../../../server/db/locations.ts';
import { getOverrideRow } from '../../../server/db/overrides.ts';
import { getSuggestionRow } from '../../../server/db/suggestions.ts';
import { domainError, newAudit, racingDb, snapshot } from './helpers.ts';

const base = fakeBaseData();
const FIELDS = { name: 'Central ATM', categoryId: 'finance', location: [75.7005, 31.2501] };

describe('concurrent writers: exactly one wins, the loser gets 409 and leaves no false audit', () => {
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
  // Audit rows survive t.reset() (append-only) and override targets repeat across tests, so only rows
  // written by the current test count.
  let auditFloor = 0;
  beforeEach(async () => {
    auditFloor = (await listAudit(t.db, { limit: 1 })).items[0]?.id ?? 0;
  });
  const rowsOf = async (entityId: string, action: string) =>
    (await listAudit(t.db, { entityId, action, limit: 200 })).items.filter((e) => e.id > auditFloor);
  const successRows = async (entityId: string, action: string) =>
    (await rowsOf(entityId, action)).filter((e) => e.outcome === 'success');

  it('two location edits from the same revision: one wins, no lost update, one success audit row', async () => {
    const loc = await createLocation(t.db, { fields: FIELDS }, c.owner());
    const v0 = await pubVersion();
    const db = racingDb(t.db, () =>
      updateLocation(t.db, loc.id, { revision: 1, fields: { name: 'Winner ATM' } }, c.owner()),
    );
    const e = await domainError(
      updateLocation(db, loc.id, { revision: 1, fields: { name: 'Loser ATM' } }, c.owner()),
    );
    expect(db.competitorRan).toBe(true);
    expect(e.code).toBe('conflict');
    expect(await getLocationRow(t.db, loc.id)).toMatchObject({ name: 'Winner ATM', revision: 2 });
    expect(await pubVersion()).toBe(v0 + 1);
    const ok = await successRows(loc.id, 'location.update');
    expect(ok).toHaveLength(1);
    expect(ok[0]!.after).toMatchObject({ name: 'Winner ATM', revision: 2 });
    const all = await rowsOf(loc.id, 'location.update');
    expect(all.map((x) => x.outcome).sort()).toEqual(['rejected', 'success']);
  });

  it('hide racing an edit: the stale hide is refused and never audited as a success', async () => {
    const loc = await createLocation(t.db, { fields: FIELDS }, c.owner());
    const db = racingDb(t.db, () =>
      updateLocation(t.db, loc.id, { revision: 1, fields: { description: 'edited' } }, c.owner()),
    );
    expect((await domainError(hideLocation(db, loc.id, { revision: 1 }, c.owner()))).code).toBe('conflict');
    expect(await getLocationRow(t.db, loc.id)).toMatchObject({ status: 'active', revision: 2 });
    expect(await successRows(loc.id, 'location.hide')).toHaveLength(0);
  });

  it('delete racing a restore: the location survives, and no delete is audited', async () => {
    const loc = await createLocation(t.db, { fields: FIELDS }, c.owner());
    await hideLocation(t.db, loc.id, { revision: 1 }, c.owner());
    const db = racingDb(t.db, () =>
      updateLocation(t.db, loc.id, { revision: 2, fields: { description: 'x' } }, c.owner()),
    );
    const e = await domainError(
      deleteLocation(db, loc.id, { revision: 2, confirmName: FIELDS.name }, c.owner()),
    );
    expect(e.code).toBe('conflict');
    expect(await getLocationRow(t.db, loc.id)).toMatchObject({ status: 'hidden', revision: 3 });
    expect(await successRows(loc.id, 'location.delete')).toHaveLength(0);
  });

  it('approve vs reject of the same revision: exactly one transition happens', async () => {
    const { reference: id } = await createSuggestion(t.db, contribution(), c.anon());
    const db = racingDb(t.db, () => rejectSuggestion(t.db, id, { revision: 1, reason: 'spam' }, c.owner()));
    const e = await domainError(approveSuggestion(db, id, { revision: 1 }, c.owner()));
    expect(e.code).toBe('conflict');
    expect(await getSuggestionRow(t.db, id)).toMatchObject({
      status: 'rejected',
      publishedLocationId: null,
      revision: 2,
    });
    expect(await t.count('locations')).toBe(0);
    expect(await pubVersion()).toBe(0);
    expect(await successRows(id, 'suggestion.approve')).toHaveLength(0);
  });

  it('reject vs approve (approve first): the suggestion stays published exactly once', async () => {
    const { reference: id } = await createSuggestion(t.db, contribution(), c.anon());
    const db = racingDb(t.db, () => approveSuggestion(t.db, id, { revision: 1 }, c.owner()));
    const e = await domainError(rejectSuggestion(db, id, { revision: 1 }, c.owner()));
    expect(e.code).toBe('conflict');
    expect(await getSuggestionRow(t.db, id)).toMatchObject({ status: 'approved', revision: 2 });
    expect(await t.count('locations')).toBe(1);
    expect(await pubVersion()).toBe(1);
    expect(await successRows(id, 'suggestion.reject')).toHaveLength(0);
  });

  it('owner edit vs approve: approval of a revision that was edited meanwhile is refused', async () => {
    const { reference: id } = await createSuggestion(t.db, contribution(), c.anon());
    const db = racingDb(t.db, () =>
      editSuggestion(t.db, id, { revision: 1, fields: { name: 'Corrected Pharmacy' } }, c.owner()),
    );
    expect((await domainError(approveSuggestion(db, id, { revision: 1 }, c.owner()))).code).toBe('conflict');
    expect(await t.count('locations')).toBe(0);
    expect(await getSuggestionRow(t.db, id)).toMatchObject({ status: 'pending', name: 'Corrected Pharmacy' });
  });

  it('two override edits from the same revision: one wins, one success audit row, one bump', async () => {
    await putOverride(
      t.db,
      LIBRARY.id,
      { revision: null, hidden: false, fields: { description: 'a' } },
      c.owner(),
    );
    const v0 = await pubVersion();
    const db = racingDb(t.db, () =>
      putOverride(
        t.db,
        LIBRARY.id,
        { revision: 1, hidden: false, fields: { description: 'win' } },
        c.owner(),
      ),
    );
    const e = await domainError(
      putOverride(db, LIBRARY.id, { revision: 1, hidden: false, fields: { description: 'lose' } }, c.owner()),
    );
    expect(e.code).toBe('conflict');
    expect(await getOverrideRow(t.db, LIBRARY.id)).toMatchObject({
      fields: { description: 'win' },
      revision: 2,
    });
    expect(await pubVersion()).toBe(v0 + 1);
    const ok = await successRows(LIBRARY.id, 'override.put');
    expect(ok.map((x) => (x.after as { fields: unknown }).fields)).toEqual([
      { description: 'win' },
      { description: 'a' },
    ]);
  });

  it('two first-time override creates (revision null): one insert wins, the other is a conflict', async () => {
    const db = racingDb(t.db, () => hideOverride(t.db, LIBRARY.id, { revision: null }, c.owner()));
    const e = await domainError(
      putOverride(db, LIBRARY.id, { revision: null, hidden: false, fields: { name: 'Renamed' } }, c.owner()),
    );
    expect(e.code).toBe('conflict');
    expect(await getOverrideRow(t.db, LIBRARY.id)).toMatchObject({ hidden: true, fields: {}, revision: 1 });
    expect(await successRows(LIBRARY.id, 'override.put')).toHaveLength(0);
  });

  it('revert racing a newer edit is refused (no lost update, no false audit)', async () => {
    const loc = await createLocation(t.db, { fields: FIELDS }, c.owner());
    await updateLocation(t.db, loc.id, { revision: 1, fields: { name: 'Second Name' } }, c.owner());
    const ev = (await listAudit(t.db, { action: 'location.update', entityId: loc.id, limit: 1 })).items[0]!;
    const db = racingDb(t.db, () =>
      updateLocation(t.db, loc.id, { revision: 2, fields: { name: 'Third Name' } }, c.owner()),
    );
    expect((await domainError(revertAuditEvent(db, ev.id, c.owner()))).code).toBe('conflict');
    expect(await getLocationRow(t.db, loc.id)).toMatchObject({ name: 'Third Name', revision: 3 });
    expect(await successRows(loc.id, 'location.revert')).toHaveLength(0);
  });

  it('two reverts of the same permanent delete: one restores, the other is a 409 (not a 500)', async () => {
    const loc = await createLocation(t.db, { fields: FIELDS }, c.owner());
    await hideLocation(t.db, loc.id, { revision: 1 }, c.owner());
    await deleteLocation(t.db, loc.id, { revision: 2, confirmName: FIELDS.name }, c.owner());
    const ev = (await listAudit(t.db, { action: 'location.delete', entityId: loc.id, limit: 1 })).items[0]!;
    const db = racingDb(t.db, () => revertAuditEvent(t.db, ev.id, c.owner()));
    const before = await snapshot(t.db);
    const e = await domainError(revertAuditEvent(db, ev.id, c.owner()));
    expect(db.competitorRan).toBe(true);
    expect(e.code).toBe('conflict');
    expect(await t.count('locations')).toBe(1);
    expect(await successRows(loc.id, 'location.revert')).toHaveLength(1);
    const after = await snapshot(t.db);
    // The competitor's success + this attempt's 'rejected' row; nothing 'failed'.
    expect(newAudit(before, after).map((a) => a.outcome)).toEqual(['success', 'rejected']);
  });
});
