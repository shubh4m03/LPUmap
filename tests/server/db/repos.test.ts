import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/test-db.ts';
import { decodeCursor, encodeCursor, likeContains } from '../../../server/db/sql.ts';
import {
  insertSuggestionStmt,
  listSuggestionRows,
  getSuggestionRow,
} from '../../../server/db/suggestions.ts';
import type { SuggestionRecord } from '../../../server/db/records.ts';
import {
  createSession,
  deleteSession,
  getSession,
  purgeExpiredSessions,
} from '../../../server/db/sessions.ts';
import { hit } from '../../../server/db/rate-limits.ts';
import { base32, ID_PATTERNS, randomIds } from '../../../server/ids.ts';

const at = (s: number) => new Date(Date.parse('2026-10-01T10:00:00.000Z') + s * 1000);

function suggestion(
  id: string,
  name: string,
  createdAtS: number,
  over: Partial<SuggestionRecord> = {},
): SuggestionRecord {
  const iso = at(createdAtS).toISOString();
  return {
    id,
    status: 'pending',
    name,
    categoryId: 'food',
    location: [75.7, 31.25],
    description: null,
    landmark: null,
    evidenceUrl: null,
    details: null,
    duplicateOf: null,
    reviewNote: null,
    reviewedBy: null,
    reviewedAt: null,
    publishedLocationId: null,
    createdAt: iso,
    updatedAt: iso,
    revision: 1,
    ...over,
  };
}

describe('repositories', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.dispose();
  });
  beforeEach(async () => {
    await t.reset();
  });

  it('stores SQL-injection strings literally and leaves the schema intact', async () => {
    const evil = "Robert'); DROP TABLE suggestions; --";
    await insertSuggestionStmt(
      t.db,
      suggestion('sug_evil0001', evil, 1, { description: "' OR 1=1 --" }),
    ).run();
    const back = await getSuggestionRow(t.db, 'sug_evil0001');
    expect(back?.name).toBe(evil);
    expect(back?.description).toBe("' OR 1=1 --");
    expect(await t.count('suggestions')).toBe(1);
    // Searching with injection text matches literally, not as SQL.
    const r = await listSuggestionRows(t.db, { q: "' OR '1'='1" });
    expect(r.items).toEqual([]);
    const r2 = await listSuggestionRows(t.db, { q: 'DROP TABLE' });
    expect(r2.items.map((s) => s.id)).toEqual(['sug_evil0001']);
  });

  it('escapes LIKE wildcards in search', async () => {
    await insertSuggestionStmt(t.db, suggestion('sug_pct00001', '100% Juice', 1)).run();
    await insertSuggestionStmt(t.db, suggestion('sug_plain0001', '1000 Juices', 2)).run();
    await insertSuggestionStmt(t.db, suggestion('sug_under0001', 'Block_A canteen', 3)).run();
    await insertSuggestionStmt(t.db, suggestion('sug_under0002', 'BlockXA canteen', 4)).run();
    expect((await listSuggestionRows(t.db, { q: '100%' })).items.map((s) => s.id)).toEqual(['sug_pct00001']);
    expect((await listSuggestionRows(t.db, { q: '%' })).items.map((s) => s.id)).toEqual(['sug_pct00001']);
    expect((await listSuggestionRows(t.db, { q: 'Block_A' })).items.map((s) => s.id)).toEqual([
      'sug_under0001',
    ]);
    expect(likeContains('a%b_c\\')).toBe('%a\\%b\\_c\\\\%');
  });

  it('filters by status/category, ignores unknown sort keys and paginates with a keyset cursor', async () => {
    for (let i = 0; i < 5; i++)
      await insertSuggestionStmt(t.db, suggestion(`sug_page000${i}`, `Place ${i}`, i)).run();
    await insertSuggestionStmt(
      t.db,
      suggestion('sug_health01', 'Clinic', 10, { categoryId: 'health' }),
    ).run();
    const page1 = await listSuggestionRows(t.db, { limit: 2, sort: 'name; DROP TABLE suggestions' });
    expect(page1.items.map((s) => s.id)).toEqual(['sug_health01', 'sug_page0004']);
    const page2 = await listSuggestionRows(t.db, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.items.map((s) => s.id)).toEqual(['sug_page0003', 'sug_page0002']);
    const asc = await listSuggestionRows(t.db, { sort: 'created_asc', limit: 1 });
    expect(asc.items[0]?.id).toBe('sug_page0000');
    expect((await listSuggestionRows(t.db, { category: 'health' })).items).toHaveLength(1);
    expect((await listSuggestionRows(t.db, { status: 'approved' })).items).toHaveLength(0);
    // A garbage cursor is ignored rather than breaking the query.
    expect((await listSuggestionRows(t.db, { cursor: "'; DROP TABLE x" })).items).toHaveLength(6);
    expect(await t.count('suggestions')).toBe(6);
  });

  it('round-trips cursors and rejects malformed ones', () => {
    expect(decodeCursor(encodeCursor('2026-01-01T00:00:00.000Z', 'sug_x'))).toEqual([
      '2026-01-01T00:00:00.000Z',
      'sug_x',
    ]);
    expect(decodeCursor('not-base64!!')).toBeNull();
    expect(decodeCursor(btoa('{"a":1}'))).toBeNull();
    expect(decodeCursor(42)).toBeNull();
  });

  it('sessions: only live sessions are returned, expired ones are purged, delete works', async () => {
    await createSession(t.db, {
      idHash: 'h'.repeat(64),
      actor: 'owner',
      csrfToken: 'c'.repeat(32),
      now: at(0),
      expiresAt: at(3600),
    });
    expect((await getSession(t.db, 'h'.repeat(64), at(10)))?.actor).toBe('owner');
    expect(await getSession(t.db, 'h'.repeat(64), at(3600))).toBeNull();
    expect(await purgeExpiredSessions(t.db, at(3601))).toBe(1);
    await createSession(t.db, {
      idHash: 'k'.repeat(64),
      actor: 'owner',
      csrfToken: 'c'.repeat(32),
      now: at(0),
      expiresAt: at(60),
    });
    expect(await deleteSession(t.db, 'k'.repeat(64))).toBe(true);
    expect(await getSession(t.db, 'k'.repeat(64), at(1))).toBeNull();
  });

  it('rate limits: allows up to the limit per window, then reports Retry-After; window resets', async () => {
    const bucket = 'hmac-bucket-0001';
    for (let i = 1; i <= 3; i++) expect((await hit(t.db, bucket, 3, 600, at(i))).allowed).toBe(true);
    const blocked = await hit(t.db, bucket, 3, 600, at(10));
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterS).toBe(591);
    expect((await hit(t.db, 'other-bucket-01', 3, 600, at(10))).allowed).toBe(true);
    expect((await hit(t.db, bucket, 3, 600, at(602))).allowed).toBe(true);
    const rows = await t.rows<{ bucket: string }>('rate_limits');
    expect(rows.every((r) => !/\d+\.\d+\.\d+\.\d+/.test(r.bucket))).toBe(true);
  });
});

describe('ids', () => {
  it('are ≥128-bit random base32 with the contract prefixes', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const s = randomIds.next('suggestion');
      expect(s).toMatch(ID_PATTERNS.suggestion);
      seen.add(s);
    }
    expect(seen.size).toBe(200);
    expect(randomIds.next('owner')).toMatch(ID_PATTERNS.owner);
    expect(randomIds.next('community')).toMatch(ID_PATTERNS.community);
  });

  it('base32-encodes per RFC 4648 (lower case, no padding)', () => {
    expect(base32(new TextEncoder().encode('foobar'))).toBe('mzxw6ytboi');
  });
});
