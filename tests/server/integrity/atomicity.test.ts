/**
 * Atomicity: every multi-statement change is one db.batch. A statement that
 * fails at ANY position of the batch must leave suggestions, locations,
 * overrides and meta (publication_version) exactly as they were, with a single
 * new audit row recording the failed attempt — and the same operation must
 * still succeed afterwards (no stuck or half-written state).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/test-db.ts';
import { fakeBaseData, FOOD_COURT, LIBRARY } from '../helpers/base-data.ts';
import { clock, contribution } from '../helpers/context.ts';
import {
  approveSuggestion,
  createLocation,
  createSuggestion,
  deleteLocation,
  deleteOverride,
  editSuggestion,
  hideLocation,
  hideOverride,
  listAudit,
  markDuplicate,
  putOverride,
  rejectSuggestion,
  reopenSuggestion,
  requestInformation,
  restoreLocation,
  revertAuditEvent,
  unhideOverride,
  updateLocation,
} from '../../../server/domain/index.ts';
import type { SqlDatabase } from '../../../server/db/types.ts';
import { domainError, failingDb, newAudit, snapshot } from './helpers.ts';

const base = fakeBaseData();
const FIELDS = { name: 'Central ATM', categoryId: 'finance', location: [75.7005, 31.2501] };

describe('atomicity: a failure anywhere in a batch leaves no partial state', () => {
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

  const newLocation = async () => (await createLocation(t.db, { fields: FIELDS }, c.owner())).id;
  const hiddenLocation = async () => {
    const id = await newLocation();
    await hideLocation(t.db, id, { revision: 1 }, c.owner());
    return id;
  };
  const suggestion = async () => (await createSuggestion(t.db, contribution(), c.anon())).reference;
  const lastEventId = async (action: string) => (await listAudit(t.db, { action, limit: 1 })).items[0]!.id;

  type Case = {
    name: string;
    setup: () => Promise<string | number>;
    run: (db: SqlDatabase, key: string | number) => Promise<unknown>;
  };
  const S = (k: string | number) => String(k);

  const cases: Case[] = [
    {
      name: 'createLocation',
      setup: async () => '',
      run: (db) => createLocation(db, { fields: FIELDS }, c.owner()),
    },
    {
      name: 'updateLocation',
      setup: newLocation,
      run: (db, id) => updateLocation(db, S(id), { revision: 1, fields: { name: 'Renamed ATM' } }, c.owner()),
    },
    {
      name: 'hideLocation',
      setup: newLocation,
      run: (db, id) => hideLocation(db, S(id), { revision: 1 }, c.owner()),
    },
    {
      name: 'restoreLocation',
      setup: hiddenLocation,
      run: (db, id) => restoreLocation(db, S(id), { revision: 2 }, c.owner()),
    },
    {
      name: 'deleteLocation',
      setup: hiddenLocation,
      run: (db, id) => deleteLocation(db, S(id), { revision: 2, confirmName: FIELDS.name }, c.owner()),
    },
    {
      name: 'revert of a location edit',
      setup: async () => {
        const id = await newLocation();
        await updateLocation(t.db, id, { revision: 1, fields: { name: 'Renamed ATM' } }, c.owner());
        return lastEventId('location.update');
      },
      run: (db, ev) => revertAuditEvent(db, ev, c.owner()),
    },
    {
      name: 'revert of a permanent delete',
      setup: async () => {
        const id = await hiddenLocation();
        await deleteLocation(t.db, id, { revision: 2, confirmName: FIELDS.name }, c.owner());
        return lastEventId('location.delete');
      },
      run: (db, ev) => revertAuditEvent(db, ev, c.owner()),
    },
    {
      name: 'putOverride (insert)',
      setup: async () => LIBRARY.id,
      run: (db, id) =>
        putOverride(db, S(id), { revision: null, hidden: false, fields: { name: 'Big Library' } }, c.owner()),
    },
    {
      name: 'putOverride (update)',
      setup: async () => {
        await putOverride(
          t.db,
          LIBRARY.id,
          { revision: null, hidden: false, fields: { name: 'Ab' } },
          c.owner(),
        );
        return LIBRARY.id;
      },
      run: (db, id) =>
        putOverride(db, S(id), { revision: 1, hidden: false, fields: { name: 'Big Library' } }, c.owner()),
    },
    {
      name: 'putOverride equal to base (delete)',
      setup: async () => {
        await putOverride(
          t.db,
          LIBRARY.id,
          { revision: null, hidden: false, fields: { name: 'Ab' } },
          c.owner(),
        );
        return LIBRARY.id;
      },
      run: (db, id) => putOverride(db, S(id), { revision: 1, hidden: false, fields: {} }, c.owner()),
    },
    {
      name: 'hideOverride',
      setup: async () => FOOD_COURT.id,
      run: (db, id) => hideOverride(db, S(id), { revision: null }, c.owner()),
    },
    {
      name: 'unhideOverride',
      setup: async () => {
        await putOverride(
          t.db,
          FOOD_COURT.id,
          { revision: null, hidden: true, fields: { name: 'Ab' } },
          c.owner(),
        );
        return FOOD_COURT.id;
      },
      run: (db, id) => unhideOverride(db, S(id), { revision: 1 }, c.owner()),
    },
    {
      name: 'deleteOverride',
      setup: async () => {
        await hideOverride(t.db, FOOD_COURT.id, { revision: null }, c.owner());
        return FOOD_COURT.id;
      },
      run: (db, id) => deleteOverride(db, S(id), { revision: 1 }, c.owner()),
    },
    {
      name: 'revert of an override edit',
      setup: async () => {
        await putOverride(t.db, LIBRARY.id, { revision: null, hidden: true, fields: {} }, c.owner());
        return lastEventId('override.put');
      },
      run: (db, ev) => revertAuditEvent(db, ev, c.owner()),
    },
    {
      name: 'approveSuggestion',
      setup: suggestion,
      run: (db, id) => approveSuggestion(db, S(id), { revision: 1 }, c.owner()),
    },
    {
      name: 'rejectSuggestion',
      setup: suggestion,
      run: (db, id) => rejectSuggestion(db, S(id), { revision: 1, reason: 'no' }, c.owner()),
    },
    {
      name: 'requestInformation',
      setup: suggestion,
      run: (db, id) => requestInformation(db, S(id), { revision: 1 }, c.owner()),
    },
    {
      name: 'reopenSuggestion',
      setup: async () => {
        const id = await suggestion();
        await rejectSuggestion(t.db, id, { revision: 1 }, c.owner());
        return id;
      },
      run: (db, id) => reopenSuggestion(db, S(id), { revision: 2 }, c.owner()),
    },
    {
      name: 'markDuplicate',
      setup: suggestion,
      run: (db, id) => markDuplicate(db, S(id), { revision: 1, duplicateOf: LIBRARY.id }, c.owner()),
    },
    {
      name: 'editSuggestion',
      setup: suggestion,
      run: (db, id) => editSuggestion(db, S(id), { revision: 1, fields: { name: 'Fixed name' } }, c.owner()),
    },
  ];

  describe.each(cases)('$name', ({ setup, run }) => {
    it.each([0, 1, 2, 3, 4, 5])('failure injected at batch position %i', async (at) => {
      const key = await setup();
      const before = await snapshot(t.db);
      const db = failingDb(t.db, at);
      const e = await domainError(run(db, key));
      expect(e.code).toBe('internal');
      expect(db.failedAt).toBe(Math.min(at, db.lengths[0]!));
      const after = await snapshot(t.db);
      expect({ ...after, audit: [] }).toEqual({ ...before, audit: [] });
      // Exactly one new audit row: the failed attempt (the success row was rolled back with the change).
      expect(newAudit(before, after).map((a) => a.outcome)).toEqual(['failed']);
      // Nothing is stuck: the same operation succeeds on the healthy database.
      await run(t.db, key);
    });
  });

  it('public submissions are all-or-nothing too (no suggestion without its audit row)', async () => {
    for (const at of [0, 1, 2]) {
      const before = await snapshot(t.db);
      const db = failingDb(t.db, at);
      await expect(createSuggestion(db, contribution(), c.anon())).rejects.toThrow();
      expect(await snapshot(t.db)).toEqual(before);
    }
  });
});
