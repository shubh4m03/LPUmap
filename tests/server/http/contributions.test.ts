import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetJwksCache } from '../../../server/auth/access.ts';
import { enforceRateLimits } from '../../../server/auth/rate-limit.ts';
import { resetSaltMemo, d1SaltRepo } from '../../../server/auth/salt.ts';
import type { Env } from '../../../server/env.ts';
import { handleAdmin } from '../../../server/handlers/admin/index.ts';
import {
  DECOY_TIMING,
  PENDING_MESSAGE,
  decoyWaitMs,
  handleContribution,
  resetDecoyTiming,
} from '../../../server/handlers/contributions.ts';
import { handlePublication } from '../../../server/handlers/publication.ts';
import { d1RateLimits } from '../../../server/handlers/repos.ts';
import { contributionResponseSchema, publicationSchema } from '../../../src/community/schema.ts';
import { accessEnvVars, claims, jwksFetch, makeKey, sign } from '../auth/jwt-fixtures.ts';
import type { TestKey } from '../auth/jwt-fixtures.ts';
import { RATE_KEY, countingDb, errorCode, fileAssets, makeDeps, req, validSuggestion } from './fixtures.ts';
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
  resetDecoyTiming();
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

  it('honeypot filled → a decoy indistinguishable from a real 201; nothing stored, no rate-limit row', async () => {
    const audit = await t.count('audit_events');
    const res = await submit(validSuggestion({ website: 'http://spam.example' }));
    expect(res.status).toBe(201);
    const body = contributionResponseSchema.parse(await res.json());
    expect(Object.keys(body).sort()).toEqual(['message', 'possibleDuplicates', 'reference', 'status']);
    expect(body).toMatchObject({ status: 'pending', message: PENDING_MESSAGE, possibleDuplicates: [] });
    expect(body.reference).toMatch(/^sug_[a-z2-7]{26}$/);
    expect(await t.count('suggestions')).toBe(0);
    expect(await t.count('rate_limits')).toBe(0);
    expect(await t.count('audit_events')).toBe(audit);

    // Same status, headers and body shape as a real acceptance from another client.
    const real = await submit(validSuggestion(), { ip: '192.0.2.99' });
    expect(real.status).toBe(res.status);
    const headers = (r: Response) => [...r.headers].filter(([k]) => k.toLowerCase() !== 'date');
    expect(headers(res)).toEqual(headers(real));
    const realBody = contributionResponseSchema.parse(await real.json());
    expect(Object.keys(realBody).sort()).toEqual(Object.keys(body).sort());
    expect(realBody.reference).toMatch(/^sug_[a-z2-7]{26}$/);
    expect(realBody.reference).not.toBe(body.reference);
    expect(await t.count('suggestions')).toBe(1);
  });

  it('the decoy does the same read work as a real submission (duplicates) and prepares no write', async () => {
    // A real campus place, so the duplicate lookup has something to find.
    const dup = validSuggestion({
      name: 'School of Design',
      categoryId: 'academic',
      location: [75.7070146, 31.2566354],
    });
    const counting = countingDb(t.db);
    const decoyDeps = makeDeps({ env: { ...env, DB: counting.db }, now: () => clock });
    const decoy = await handleContribution(
      req('POST', '/api/contributions/locations', { body: { ...dup, website: 'x' }, ip: '192.0.2.50' }),
      decoyDeps,
    );
    expect(decoy.status).toBe(201);
    const decoyBody = contributionResponseSchema.parse(await decoy.json());
    expect(counting.prepared.length).toBeGreaterThan(0);
    for (const sql of counting.prepared) expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE)\b/i);

    const real = contributionResponseSchema.parse(await (await submit(dup, { ip: '192.0.2.51' })).json());
    expect(real.possibleDuplicates.length).toBeGreaterThan(0);
    expect(decoyBody.possibleDuplicates).toEqual(real.possibleDuplicates);
    expect(await t.count('suggestions')).toBe(1);
  });

  it('decoy wait: tracks real acceptances (memory only), with jitter, never beyond the cap', () => {
    resetDecoyTiming();
    const { initialMs, jitter, maxMs } = DECOY_TIMING;
    expect(decoyWaitMs(0, 0.5)).toBe(initialMs);
    expect(decoyWaitMs(0, 0)).toBe(Math.round(initialMs * (1 - jitter)));
    expect(decoyWaitMs(10, 0.5)).toBe(initialMs - 10);
    expect(decoyWaitMs(10_000, 0.5)).toBe(0);
    expect(decoyWaitMs(0, 0.999_999)).toBeLessThanOrEqual(maxMs);
  });

  it('a decoy takes about as long as a real acceptance (median within ±40 %)', async () => {
    resetDecoyTiming();
    const time = async (body: unknown, ip: string) => {
      const s = performance.now();
      const res = await submit(body, { ip });
      expect(res.status).toBe(201);
      return performance.now() - s;
    };
    const real: number[] = [];
    const decoy: number[] = [];
    for (let i = 0; i < 24; i++) {
      // A fresh client per real request so the per-client limit is never reached.
      real.push(await time(validSuggestion({ name: `Timing spot ${i}` }), `198.51.100.${i + 1}`));
      decoy.push(await time(validSuggestion({ name: `Timing spot ${i}`, website: 'x' }), '192.0.2.77'));
    }
    const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
    // The first half warms the estimate; compare the second half.
    const ratio = median(decoy.slice(12)) / median(real.slice(12));
    // The property that matters is "a decoy is not visibly faster than a real write"
    // (the pre-fix decoy ran at ~0.2×). The upper side is bounded by DECOY_TIMING.maxMs,
    // unit-tested above; a wall-clock upper bound made this test fail on loaded CI hosts.
    expect(ratio).toBeGreaterThan(0.6);
    expect(await t.count('suggestions')).toBe(24);
  });

  it('with the honeypot filled, invalid or outside-area input gets the same error as without it', async () => {
    for (const over of [{ name: 'x' }, { categoryId: 'secret-lab' }, { location: [77.209, 28.6139] }]) {
      const plain = await submit(validSuggestion(over));
      const trapped = await submit(validSuggestion({ ...over, website: 'http://spam.example' }));
      expect(trapped.status).toBe(plain.status);
      expect(await trapped.json()).toEqual(await plain.json());
    }
    expect(await t.count('suggestions')).toBe(0);
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
  it('ETag W/"pub-v<schema>-<n>", If-None-Match → 304, Cache-Control no-cache', async () => {
    const first = await publication();
    expect(first.status).toBe(200);
    const etag = first.headers.get('ETag')!;
    expect(etag).toMatch(/^W\/"pub-v\d+-\d+"$/);
    expect(first.headers.get('Cache-Control')).toBe('no-cache');
    const pub = publicationSchema.parse(await first.json());
    expect(etag).toBe(`W/"pub-v${pub.schemaVersion}-${pub.publicationVersion}"`);

    const again = await publication(etag);
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
    expect(again.headers.get('ETag')).toBe(etag);
    expect((await publication('W/"pub-v2-999999"')).status).toBe(200);
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
