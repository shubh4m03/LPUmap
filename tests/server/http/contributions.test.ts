import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetJwksCache } from '../../../server/auth/access.ts';
import { enforceRateLimits } from '../../../server/auth/rate-limit.ts';
import { resetSaltMemo, d1SaltRepo } from '../../../server/auth/salt.ts';
import type { Env } from '../../../server/env.ts';
import { handleAdmin } from '../../../server/handlers/admin/index.ts';
import { PENDING_MESSAGE, handleContribution } from '../../../server/handlers/contributions.ts';
import { handlePublication } from '../../../server/handlers/publication.ts';
import { d1RateLimits } from '../../../server/handlers/repos.ts';
import { contributionResponseSchema, publicationSchema } from '../../../src/community/schema.ts';
import { accessEnvVars, claims, jwksFetch, makeKey, sign } from '../auth/jwt-fixtures.ts';
import type { TestKey } from '../auth/jwt-fixtures.ts';
import { RATE_KEY, errorCode, fileAssets, makeDeps, req, validSuggestion } from './fixtures.ts';
import { createTestDb, resetTables } from './harness.ts';
import type { TestDb } from './harness.ts';

let t: TestDb;
let env: Env;
let key: TestKey;
let clock: Date;

beforeAll(async () => {
  t = await createTestDb();
  key = await makeKey('k1');
  env = { DB: t.db, ASSETS: fileAssets, RATE_LIMIT_KEY: RATE_KEY, ...accessEnvVars };
});
afterAll(async () => t.dispose());
beforeEach(async () => {
  await resetTables(t.db);
  resetSaltMemo();
  resetJwksCache();
  clock = new Date('2026-10-24T06:00:00.000Z');
});

const deps = (e: Env = env) => makeDeps({ env: e, now: () => clock, fetch: jwksFetch([key]) });
const submit = (body: unknown, o: Parameters<typeof req>[2] = {}) =>
  handleContribution(req('POST', '/api/contributions/locations', { body, ip: '192.0.2.44', ...o }), deps());
const admin = async (method: string, path: string, body?: unknown) =>
  handleAdmin(
    req(method, `/api/admin${path}`, {
      headers: { 'Cf-Access-Jwt-Assertion': await sign(key, claims(clock)) },
      ...(body !== undefined ? { body } : {}),
    }),
    deps(),
  );
const publication = (inm?: string) =>
  handlePublication(req('GET', '/api/locations', inm ? { headers: { 'If-None-Match': inm } } : {}), deps());

describe('POST /api/contributions/locations', () => {
  it('stores a pending suggestion and answers 201 with the truthful message', async () => {
    const res = await submit(validSuggestion());
    expect(res.status).toBe(201);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = contributionResponseSchema.parse(await res.json());
    expect(body.status).toBe('pending');
    expect(body.message).toBe(
      'Your location suggestion has been submitted for review. It will not appear on the public map until it is approved.',
    );
    expect(body.reference).toMatch(/^sug_[a-z2-7]{26}$/);
    const row = await t.db.prepare('SELECT * FROM suggestions WHERE id = ?').bind(body.reference).first();
    expect(row).toMatchObject({
      status: 'pending',
      name: 'Quiet Study Corner',
      reviewed_by: null,
      published_location_id: null,
    });
  });

  it('ignores client-supplied status/approval/admin fields: stored as pending, never published', async () => {
    const res = await submit(
      validSuggestion({
        status: 'approved',
        approved: true,
        isAdmin: true,
        reviewer: 'owner',
        reviewed_by: 'owner',
        reviewedBy: 'owner@example.org',
        published_location_id: 'com:aaaaaaaaaaaaaaaaaaaaaaaaaa',
        revision: 99,
        id: 'sug_bbbbbbbbbbbbbbbbbbbbbbbbbb',
        createdAt: '2000-01-01T00:00:00.000Z',
      }),
    );
    expect(res.status).toBe(201);
    const { reference } = (await res.json()) as { reference: string };
    expect(reference).not.toBe('sug_bbbbbbbbbbbbbbbbbbbbbbbbbb');
    const row = (await t.db.prepare('SELECT * FROM suggestions WHERE id = ?').bind(reference).first())!;
    expect(row.status).toBe('pending');
    expect(row.reviewed_by).toBeNull();
    expect(row.reviewed_at).toBeNull();
    expect(row.published_location_id).toBeNull();
    expect(row.revision).toBe(1);
    expect(row.created_at).toBe(clock.toISOString());
    expect(JSON.stringify(row)).not.toMatch(/isAdmin|approved"?:\s*true/);
    expect(await t.count('locations')).toBe(0);
    const pub = publicationSchema.parse(await (await publication()).json());
    expect(pub.locations).toEqual([]);
  });

  it('honeypot filled → 202 with an indistinguishable decoy; nothing stored, no rate-limit row', async () => {
    const audit = await t.count('audit_events');
    const res = await submit(validSuggestion({ website: 'http://spam.example' }));
    expect(res.status).toBe(202);
    const body = contributionResponseSchema.parse(await res.json());
    expect(Object.keys(body).sort()).toEqual(['message', 'possibleDuplicates', 'reference', 'status']);
    expect(body).toMatchObject({ status: 'pending', message: PENDING_MESSAGE, possibleDuplicates: [] });
    expect(body.reference).toMatch(/^sug_[a-z2-7]{26}$/);
    expect(await t.count('suggestions')).toBe(0);
    expect(await t.count('rate_limits')).toBe(0);
    expect(await t.count('audit_events')).toBe(audit);
  });

  it('an empty honeypot is treated as a normal submission', async () => {
    expect((await submit(validSuggestion({ website: '  ' }))).status).toBe(201);
  });

  it.each([
    ['missing name', { name: undefined }],
    ['name too short', { name: 'x' }],
    ['control characters', { name: 'Bad\u0000Name' }],
    ['unknown category', { categoryId: 'secret-lab' }],
    ['generic category', { categoryId: 'building' }],
    ['javascript: evidence URL', { evidenceUrl: 'javascript:alert(1)' }],
    ['location not a pair', { location: [75.7] }],
    ['location out of range', { location: [500, 31.25] }],
  ])('invalid input (%s) → 400 and nothing stored', async (_l, over) => {
    const res = await submit(validSuggestion(over));
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('invalid');
    expect(await t.count('suggestions')).toBe(0);
  });

  it('location outside the campus area → 422 outside-area', async () => {
    const res = await submit(validSuggestion({ location: [77.209, 28.6139] }));
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('outside-area');
    expect(await t.count('suggestions')).toBe(0);
  });

  it('body > 8 KB → 413; wrong content type → 415; invalid JSON → 400; non-object → 400', async () => {
    const big = await submit(validSuggestion({ details: 'x'.repeat(9000) }));
    expect(big.status).toBe(413);
    const ct = await submit(undefined, {
      raw: JSON.stringify(validSuggestion()),
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(ct.status).toBe(415);
    expect((await submit(undefined, { raw: '{"name":' })).status).toBe(400);
    expect((await submit([validSuggestion()])).status).toBe(400);
    expect(await t.count('suggestions')).toBe(0);
  });

  it('rejects a cross-site Origin with 403 (same-origin API)', async () => {
    const res = await submit(validSuggestion(), { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(await t.count('suggestions')).toBe(0);
  });

  it('GET and OPTIONS → 405, never CORS headers', async () => {
    for (const m of ['GET', 'OPTIONS', 'PUT']) {
      const res = await handleContribution(req(m, '/api/contributions/locations'), deps());
      expect(res.status).toBe(405);
      for (const [k] of res.headers) expect(k.toLowerCase()).not.toMatch(/^access-control-/);
    }
  });

  it('missing DB binding → 503 unavailable', async () => {
    const { DB: _db, ...noDb } = env;
    const res = await handleContribution(
      req('POST', '/api/contributions/locations', { body: validSuggestion() }),
      deps(noDb),
    );
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe('unavailable');
  });

  it('rate limit 5 / 10 min per client → 429 with Retry-After; XFF spoofing ignored; other clients unaffected', async () => {
    for (let i = 0; i < 5; i++)
      expect((await submit(validSuggestion({ name: `Spot ${i} here` }))).status).toBe(201);
    const blocked = await submit(validSuggestion());
    expect(blocked.status).toBe(429);
    const retry = Number(blocked.headers.get('Retry-After'));
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(600);
    const spoof = await submit(validSuggestion(), {
      headers: { 'X-Forwarded-For': '10.1.2.3', Forwarded: 'for=10.1.2.4', 'X-Real-IP': '10.1.2.5' },
    });
    expect(spoof.status).toBe(429);
    expect((await submit(validSuggestion(), { ip: '192.0.2.45' })).status).toBe(201);
    expect(await t.count('suggestions')).toBe(6);
    const dump = JSON.stringify((await t.db.prepare('SELECT * FROM rate_limits').all()).results);
    expect(dump).not.toContain('192.0.2.4');
  });

  it('daily cap 20 per client across windows', async () => {
    for (let i = 0; i < 20; i++) {
      if (i > 0 && i % 5 === 0) clock = new Date(clock.getTime() + 11 * 60 * 1000);
      expect((await submit(validSuggestion({ name: `Daily spot ${i}` }))).status).toBe(201);
    }
    clock = new Date(clock.getTime() + 11 * 60 * 1000);
    const res = await submit(validSuggestion());
    expect(res.status).toBe(429);
    expect(await t.count('suggestions')).toBe(20);
  });

  it('a global rule caps all clients together (shared bucket)', async () => {
    const rules = [{ scope: 'test:global', limit: 3, windowS: 86_400, global: true }];
    const d = { db: t.db, repo: d1RateLimits, salts: d1SaltRepo, rateLimitKey: null, now: clock };
    for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
      await enforceRateLimits(req('POST', '/x', { ip }), rules, d);
    }
    await expect(enforceRateLimits(req('POST', '/x', { ip: '4.4.4.4' }), rules, d)).rejects.toMatchObject({
      code: 'rate-limited',
      status: 429,
    });
  });
});

describe('GET /api/locations + moderation flow', () => {
  it('ETag W/"pub-<n>", If-None-Match → 304, Cache-Control no-cache', async () => {
    const first = await publication();
    expect(first.status).toBe(200);
    const etag = first.headers.get('ETag')!;
    expect(etag).toMatch(/^W\/"pub-\d+"$/);
    expect(first.headers.get('Cache-Control')).toBe('no-cache');
    const pub = publicationSchema.parse(await first.json());
    expect(etag).toBe(`W/"pub-${pub.publicationVersion}"`);

    const again = await publication(etag);
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
    expect(again.headers.get('ETag')).toBe(etag);
    expect((await publication('W/"pub-999999"')).status).toBe(200);
  });

  it('a suggestion appears publicly only after authenticated approval; approval is not repeatable', async () => {
    const { reference } = (await (await submit(validSuggestion())).json()) as { reference: string };
    const before = await publication();
    const etag = before.headers.get('ETag')!;
    expect(publicationSchema.parse(await before.json()).locations).toEqual([]);

    // Unauthenticated approval attempt changes nothing.
    const anon = await handleAdmin(
      req('POST', `/api/admin/suggestions/${reference}/approve`, { body: { revision: 1 } }),
      deps(),
    );
    expect(anon.status).toBe(401);
    expect((await publication(etag)).status).toBe(304);

    const approved = await admin('POST', `/suggestions/${reference}/approve`, { revision: 1 });
    expect(approved.status).toBe(200);

    const after = await publication(etag);
    expect(after.status).toBe(200);
    expect(after.headers.get('ETag')).not.toBe(etag);
    const pub = publicationSchema.parse(await after.json());
    expect(pub.locations).toHaveLength(1);
    expect(pub.locations[0]).toMatchObject({
      origin: 'community',
      name: 'Quiet Study Corner',
      accessNodeId: null,
    });
    expect(JSON.stringify(pub)).not.toMatch(/owner@example\.org|sug_|review/);

    const twice = await admin('POST', `/suggestions/${reference}/approve`, { revision: 2 });
    expect(twice.status).toBe(409);
    expect(await errorCode(twice)).toBe('invalid-transition');
    expect(await t.count('locations')).toBe(1);

    const stale = await admin('POST', `/suggestions/${reference}/reject`, { revision: 1 });
    expect(stale.status).toBe(409);
    expect(await errorCode(stale)).toBe('conflict');
  });

  it('the audit actor is the verified Access identity, never a body field', async () => {
    const { reference } = (await (await submit(validSuggestion())).json()) as { reference: string };
    await admin('POST', `/suggestions/${reference}/reject`, {
      revision: 1,
      actor: 'mallory',
      reviewedBy: 'mallory',
    });
    const rows = await t.db
      .prepare('SELECT actor FROM audit_events WHERE entity_id = ?')
      .bind(reference)
      .all<{ actor: string }>();
    expect(rows.results.map((r) => r.actor)).toContain('owner@example.org');
    expect(JSON.stringify(rows.results)).not.toContain('mallory');
  });

  it('missing DB → 503 on GET /api/locations', async () => {
    const { DB: _db, ...noDb } = env;
    const res = await handlePublication(req('GET', '/api/locations'), deps(noDb));
    expect(res.status).toBe(503);
  });
});
