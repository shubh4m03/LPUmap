import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/test-db.ts';
import { fakeBaseData, LIBRARY } from '../helpers/base-data.ts';
import { clock, contribution, OWNER } from '../helpers/context.ts';
import {
  approveSuggestion,
  createSuggestion,
  editSuggestion,
  getPublication,
  getSuggestion,
  listAudit,
  listSuggestions,
  markDuplicate,
  rejectSuggestion,
  reopenSuggestion,
  requestInformation,
} from '../../../server/domain/index.ts';
import { getSuggestionRow } from '../../../server/db/suggestions.ts';
import { DomainError } from '../../../server/errors.ts';
import { SUGGESTION_TRANSITIONS, type SuggestionStatus } from '../../../src/community/schema.ts';
import type { DomainContext } from '../../../server/domain/context.ts';
import type { SqlDatabase } from '../../../server/db/types.ts';

const base = fakeBaseData();

async function expectDomainError(p: Promise<unknown>, code: string, status?: number): Promise<DomainError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DomainError);
  const de = err as DomainError;
  expect(de.code).toBe(code);
  if (status !== undefined) expect(de.status).toBe(status);
  return de;
}

describe('createSuggestion (public)', () => {
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

  it('always stores pending with server-assigned id/timestamps, ignoring client status fields', async () => {
    const ctx = c.anon();
    const res = await createSuggestion(
      t.db,
      {
        ...contribution(),
        status: 'approved',
        publishedLocationId: 'com:evil',
        reviewedBy: 'attacker',
        revision: 99,
        id: 'sug_chosenbyclient',
        isAdmin: true,
      },
      ctx,
    );
    expect(res.reference).toMatch(/^sug_[a-z2-7]{26}$/);
    const row = await getSuggestionRow(t.db, res.reference);
    expect(row).toMatchObject({
      status: 'pending',
      publishedLocationId: null,
      reviewedBy: null,
      revision: 1,
      createdAt: ctx.now.toISOString(),
      name: 'Campus Pharmacy',
    });
    expect(await t.count('locations')).toBe(0);
    const pub = await getPublication(t.db);
    expect(pub.locations).toEqual([]);
    expect(pub.publicationVersion).toBe(0);
    const audit = await listAudit(t.db, { entity: 'suggestion', entityId: res.reference });
    expect(audit.items.map((a) => [a.action, a.actor, a.outcome])).toEqual([
      ['suggestion.create', 'public', 'success'],
    ]);
  });

  it('rejects locations outside the contribution area with 422 outside-area', async () => {
    await expectDomainError(
      createSuggestion(t.db, contribution({ location: [77.2, 28.6] }), c.anon()),
      'outside-area',
      422,
    );
    expect(await t.count('suggestions')).toBe(0);
  });

  it.each([
    ['unknown category', { categoryId: 'nuclear-reactor' }],
    ['placeholder category', { categoryId: 'building' }],
    ['too-short name', { name: 'A' }],
    ['control characters', { name: 'Bad\u0000Name' }],
    ['javascript URL', { evidenceUrl: 'javascript:alert(1)' }],
    ['URL with credentials', { evidenceUrl: 'https://user:pw@example.org/' }],
    ['non-numeric coordinates', { location: ['75.7', '31.25'] }],
  ])('rejects %s as invalid', async (_l, over) => {
    const e = await expectDomainError(createSuggestion(t.db, contribution(over), c.anon()), 'invalid', 400);
    expect(e.issues?.length).toBeGreaterThan(0);
    expect(await t.count('suggestions')).toBe(0);
  });

  it('reports public-safe possible duplicates (base places) but never other pending submissions', async () => {
    await createSuggestion(t.db, contribution({ name: 'Secret Pending Spot', categoryId: 'food' }), c.anon());
    const res = await createSuggestion(
      t.db,
      contribution({ name: 'Main Library', categoryId: 'library', location: [75.7007, 31.2502] }),
      c.anon(),
    );
    expect(res.possibleDuplicates.map((d) => d.id)).toEqual([LIBRARY.id]);
    const res2 = await createSuggestion(
      t.db,
      contribution({ name: 'Secret Pending Spot', categoryId: 'food' }),
      c.anon(),
    );
    expect(res2.possibleDuplicates.some((d) => d.kind === 'suggestion')).toBe(false);
  });
});

describe('moderation transitions', () => {
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

  const create = async () => (await createSuggestion(t.db, contribution(), c.anon())).reference;

  /** Drives a fresh suggestion into `status` through allowed transitions. */
  async function inStatus(status: SuggestionStatus): Promise<{ id: string; revision: number }> {
    const id = await create();
    if (status === 'pending') return { id, revision: 1 };
    if (status === 'approved') {
      await approveSuggestion(t.db, id, { revision: 1 }, c.owner());
      return { id, revision: 2 };
    }
    if (status === 'rejected') await rejectSuggestion(t.db, id, { revision: 1 }, c.owner());
    if (status === 'duplicate')
      await markDuplicate(t.db, id, { revision: 1, duplicateOf: LIBRARY.id }, c.owner());
    if (status === 'needs_information') await requestInformation(t.db, id, { revision: 1 }, c.owner());
    return { id, revision: 2 };
  }

  const ACTIONS: Record<
    Exclude<SuggestionStatus, never>,
    (db: SqlDatabase, id: string, revision: number, ctx: DomainContext) => Promise<unknown>
  > = {
    approved: (db, id, revision, ctx) => approveSuggestion(db, id, { revision }, ctx),
    rejected: (db, id, revision, ctx) => rejectSuggestion(db, id, { revision, reason: 'spam' }, ctx),
    duplicate: (db, id, revision, ctx) => markDuplicate(db, id, { revision, duplicateOf: LIBRARY.id }, ctx),
    needs_information: (db, id, revision, ctx) =>
      requestInformation(db, id, { revision, note: 'Which floor?' }, ctx),
    pending: (db, id, revision, ctx) => reopenSuggestion(db, id, { revision }, ctx),
  };

  const STATUSES = Object.keys(SUGGESTION_TRANSITIONS) as SuggestionStatus[];
  const matrix = STATUSES.flatMap((from) =>
    STATUSES.filter((to) => to !== from).map(
      (to) => [from, to, SUGGESTION_TRANSITIONS[from].includes(to)] as const,
    ),
  );

  it.each(matrix)('%s → %s allowed=%s', async (from, to, allowed) => {
    const { id, revision } = await inStatus(from);
    const before = await getSuggestionRow(t.db, id);
    const pubBefore = (await getPublication(t.db)).publicationVersion;
    const run = ACTIONS[to](t.db, id, revision, c.owner());
    if (allowed) {
      await run;
      const after = await getSuggestionRow(t.db, id);
      expect(after?.status).toBe(to);
      expect(after?.revision).toBe(revision + 1);
      expect(after?.reviewedBy).toBe(OWNER);
    } else {
      await expectDomainError(run, 'invalid-transition', 409);
      expect(await getSuggestionRow(t.db, id)).toEqual(before);
      expect((await getPublication(t.db)).publicationVersion).toBe(pubBefore);
      const audit = await listAudit(t.db, { entity: 'suggestion', entityId: id, limit: 1 });
      expect(audit.items[0]).toMatchObject({ outcome: 'rejected', actor: OWNER });
    }
  });

  it('refuses every privileged action without an authenticated actor', async () => {
    const id = await create();
    for (const to of STATUSES) {
      await expectDomainError(ACTIONS[to](t.db, id, 1, c.anon()), 'unauthenticated', 401);
      await expectDomainError(ACTIONS[to](t.db, id, 1, c.anon({ actor: 'public' })), 'unauthenticated', 401);
    }
    expect((await getSuggestionRow(t.db, id))?.status).toBe('pending');
  });

  it('rejected and duplicate suggestions never reach the publication', async () => {
    const a = await inStatus('rejected');
    const b = await inStatus('duplicate');
    const pub = await getPublication(t.db);
    expect(pub.locations).toEqual([]);
    expect(pub.publicationVersion).toBe(0);
    expect((await getSuggestionRow(t.db, b.id))?.duplicateOf).toBe(LIBRARY.id);
    expect((await getSuggestionRow(t.db, a.id))?.reviewNote).toBeNull();
  });

  it('stores reject reasons and info requests privately and clears duplicateOf on reopen', async () => {
    const id = await create();
    await rejectSuggestion(t.db, id, { revision: 1, reason: 'Not a real place' }, c.owner());
    expect((await getSuggestionRow(t.db, id))?.reviewNote).toBe('Not a real place');
    await reopenSuggestion(t.db, id, { revision: 2 }, c.owner());
    const d = await create();
    await markDuplicate(t.db, d, { revision: 1, duplicateOf: id }, c.owner());
    await reopenSuggestion(t.db, d, { revision: 2 }, c.owner());
    expect(await getSuggestionRow(t.db, d)).toMatchObject({ status: 'pending', duplicateOf: null });
    expect(JSON.stringify(await getPublication(t.db))).not.toContain('Not a real place');
  });

  it('markDuplicate requires an existing target other than itself', async () => {
    const id = await create();
    await expectDomainError(
      markDuplicate(t.db, id, { revision: 1, duplicateOf: id }, c.owner()),
      'invalid',
      400,
    );
    await expectDomainError(
      markDuplicate(t.db, id, { revision: 1, duplicateOf: 'osm:way/does-not-exist' }, c.owner()),
      'invalid',
      422,
    );
    await expectDomainError(markDuplicate(t.db, id, { revision: 1, duplicateOf: '' }, c.owner()), 'invalid');
    const other = await create();
    await markDuplicate(t.db, id, { revision: 1, duplicateOf: other }, c.owner());
    expect((await getSuggestionRow(t.db, id))?.duplicateOf).toBe(other);
  });

  it('optimistic concurrency: a stale revision → 409 conflict carrying the current record; nothing written', async () => {
    const id = await create();
    await requestInformation(t.db, id, { revision: 1 }, c.owner());
    const auditBefore = (await listAudit(t.db, { limit: 200 })).items.length;
    const e = await expectDomainError(
      rejectSuggestion(t.db, id, { revision: 1 }, c.owner()),
      'conflict',
      409,
    );
    expect((e.details as { current: { revision: number; status: string } }).current).toMatchObject({
      revision: 2,
      status: 'needs_information',
    });
    expect((await getSuggestionRow(t.db, id))?.status).toBe('needs_information');
    const after = await listAudit(t.db, { limit: 200 });
    // Exactly one new row: the rejected attempt — no success row.
    expect(after.items.length).toBe(auditBefore + 1);
    expect(after.items[0]).toMatchObject({ outcome: 'rejected', action: 'suggestion.reject' });
  });

  it('rejects malformed bodies and unknown ids', async () => {
    const id = await create();
    await expectDomainError(rejectSuggestion(t.db, id, { revision: 'one' }, c.owner()), 'invalid');
    await expectDomainError(rejectSuggestion(t.db, id, null, c.owner()), 'invalid');
    await expectDomainError(rejectSuggestion(t.db, id, { revision: 0 }, c.owner()), 'invalid');
    await expectDomainError(rejectSuggestion(t.db, 'sug_nope', { revision: 1 }, c.owner()), 'not-found', 404);
  });
});

describe('editSuggestion, getSuggestion, listSuggestions', () => {
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

  it('edits pending suggestions with validation, revision bump and audit', async () => {
    const { reference: id } = await createSuggestion(t.db, contribution({ name: 'Pharmcy' }), c.anon());
    const edited = await editSuggestion(
      t.db,
      id,
      { revision: 1, fields: { name: 'Pharmacy', landmark: 'Near B34' } },
      c.owner(),
    );
    expect(edited).toMatchObject({ name: 'Pharmacy', landmark: 'Near B34', revision: 2, status: 'pending' });
    await expectDomainError(
      editSuggestion(t.db, id, { revision: 2, fields: { location: [80, 20] } }, c.owner()),
      'outside-area',
    );
    await expectDomainError(
      editSuggestion(t.db, id, { revision: 2, fields: { categoryId: 'other' } }, c.owner()),
      'invalid',
    );
    await expectDomainError(
      editSuggestion(t.db, id, { revision: 1, fields: { name: 'Again' } }, c.owner()),
      'conflict',
    );
    // null clears an optional field
    const cleared = await editSuggestion(t.db, id, { revision: 2, fields: { landmark: null } }, c.owner());
    expect(cleared.landmark).toBeNull();
    const view = await getSuggestion(t.db, id, c.owner());
    expect(view.history.map((h) => [h.action, h.outcome])).toEqual([
      ['suggestion.create', 'success'],
      ['suggestion.edit', 'success'],
      ['suggestion.edit', 'rejected'],
      ['suggestion.edit', 'rejected'],
      ['suggestion.edit', 'rejected'],
      ['suggestion.edit', 'success'],
    ]);
    expect(view.history[1]?.before).toMatchObject({ name: 'Pharmcy' });
    expect(view.history[1]?.after).toMatchObject({ name: 'Pharmacy' });
  });

  it('cannot edit an approved suggestion', async () => {
    const { reference: id } = await createSuggestion(t.db, contribution(), c.anon());
    await approveSuggestion(t.db, id, { revision: 1 }, c.owner());
    await expectDomainError(
      editSuggestion(t.db, id, { revision: 2, fields: { name: 'Changed' } }, c.owner()),
      'invalid-transition',
    );
  });

  it('getSuggestion includes other open suggestions as possible duplicates for the owner', async () => {
    const a = (
      await createSuggestion(t.db, contribution({ name: 'Night Canteen', categoryId: 'food' }), c.anon())
    ).reference;
    const b = (
      await createSuggestion(t.db, contribution({ name: 'Night Canteen', categoryId: 'food' }), c.anon())
    ).reference;
    const view = await getSuggestion(t.db, a, c.owner());
    expect(view.possibleDuplicates.map((d) => [d.id, d.kind])).toEqual([[b, 'suggestion']]);
    await expectDomainError(getSuggestion(t.db, 'sug_missing', c.owner()), 'not-found');
  });

  it('lists the queue filtered by status', async () => {
    const a = (await createSuggestion(t.db, contribution(), c.anon())).reference;
    await createSuggestion(t.db, contribution({ name: 'Another place' }), c.anon());
    await rejectSuggestion(t.db, a, { revision: 1 }, c.owner());
    expect((await listSuggestions(t.db, { status: 'pending' })).items).toHaveLength(1);
    expect((await listSuggestions(t.db, { status: 'rejected' })).items.map((s) => s.id)).toEqual([a]);
  });
});
