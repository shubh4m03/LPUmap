/**
 * Building Studio over the real admin dispatcher (handleAdmin) with a local
 * D1 and the real public/data served as ASSETS:
 *  - every studio route (auto-enumerated from STUDIO_ROUTES): unauthenticated
 *    → 401 in password AND Access mode; wrong/missing Origin → 403; missing or
 *    invalid X-CSRF-Token → 403 (password mode) — always before any DB write;
 *  - body limits: > 32 KB → 413, non-finite numbers / deep nesting / huge
 *    arrays → 400, wrong content type → 415;
 *  - the 409/422 wire shapes (details beside error) and a full Access-mode
 *    flow ending in the public GET /api/locations v2.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetJwksCache } from '../../../server/auth/access.ts';
import { resetSaltMemo } from '../../../server/auth/salt.ts';
import type { Env } from '../../../server/env.ts';
import { handleAdmin } from '../../../server/handlers/admin/index.ts';
import { ADMIN_ROUTES } from '../../../server/handlers/admin/routes.ts';
import { STUDIO_ROUTES } from '../../../server/handlers/admin/studio-routes.ts';
import { handlePublication } from '../../../server/handlers/publication.ts';
import {
  publishResponseSchema,
  studioBuildingDetailSchema,
  studioErrorDetailsSchema,
} from '../../../src/building-studio/schema.ts';
import { apiErrorSchema, publicationSchema } from '../../../src/community/schema.ts';
import { accessEnvVars, claims, jwksFetch, makeKey, sign, type TestKey } from '../auth/jwt-fixtures.ts';
import {
  TEST_PASSWORD,
  cookiePair,
  countingDb,
  errorCode,
  fileAssets,
  makeDeps,
  passwordEnv,
  req,
} from '../http/fixtures.ts';
import { createTestDb, resetTables, type TestDb } from '../http/harness.ts';
import { newDraft, PRIVATE_NOTE, publishBody } from './helpers.ts';

const SAMPLE: Record<string, string> = {
  ':buildingId': 'stu:aaaaaaaaaaaaaaaaaaaaaaaaaa',
  ':templateId': 'stv:aaaaaaaaaaaaaaaaaaaaaaaaaa',
};
const concrete = (pattern: string) => `/api/admin${pattern.replace(/:[a-zA-Z]+/g, (m) => SAMPLE[m]!)}`;
const ROUTES = STUDIO_ROUTES.map((r) => [`${r.method} ${r.pattern}`, r.method, concrete(r.pattern)] as const);
const WRITES = ROUTES.filter(([, m]) => m !== 'GET');

let t: TestDb;
let pwEnv: Env;
let key: TestKey;
const now = new Date('2026-10-24T09:00:00.000Z');

beforeAll(async () => {
  t = await createTestDb();
  pwEnv = await passwordEnv(t.db);
  key = await makeKey('k1');
});
afterAll(async () => t.dispose());
beforeEach(async () => {
  await resetTables(t.db);
  resetJwksCache();
  resetSaltMemo();
});

const pwDeps = () => makeDeps({ env: pwEnv, now: () => now });
const accessDeps = (db = t.db, extra: Partial<Env> = {}) =>
  makeDeps({
    env: { DB: db, ASSETS: fileAssets, ...accessEnvVars, ...extra },
    now: () => now,
    fetch: jwksFetch([key]),
  });
const access = async () => ({ 'Cf-Access-Jwt-Assertion': await sign(key, claims(now)) });
const send = (method: string, path: string, o: Parameters<typeof req>[2] = {}) =>
  req(method, path, { ...(method !== 'GET' ? { body: { revision: 1 } } : {}), ...o });

async function login(): Promise<{ cookie: string; csrf: string }> {
  const res = await handleAdmin(
    req('POST', '/api/admin/session', { body: { password: TEST_PASSWORD } }),
    pwDeps(),
  );
  expect(res.status).toBe(200);
  return {
    cookie: cookiePair(res.headers.get('Set-Cookie')),
    csrf: ((await res.json()) as { csrfToken: string }).csrfToken,
  };
}

describe('route table', () => {
  it('registers all 18 studio routes (17 endpoints; retire/unretire are two) behind a permission, existing routes unchanged', () => {
    expect(STUDIO_ROUTES).toHaveLength(18);
    expect(STUDIO_ROUTES.every((r) => r.handler.permission !== null)).toBe(true);
    expect(ADMIN_ROUTES.slice(-STUDIO_ROUTES.length)).toEqual(STUDIO_ROUTES);
    expect(STUDIO_ROUTES.map((r) => `${r.method} ${r.pattern}`)).toEqual([
      'GET /studio/library',
      'POST /studio/templates',
      'PUT /studio/templates/:templateId',
      'POST /studio/templates/:templateId/retire',
      'POST /studio/templates/:templateId/unretire',
      'GET /studio/buildings',
      'GET /studio/buildings/:buildingId',
      'POST /studio/buildings',
      'PUT /studio/buildings/:buildingId/draft',
      'DELETE /studio/buildings/:buildingId/draft',
      'POST /studio/validate',
      'POST /studio/buildings/:buildingId/publish',
      'POST /studio/buildings/:buildingId/archive',
      'POST /studio/buildings/:buildingId/restore',
      'DELETE /studio/buildings/:buildingId',
      'POST /studio/buildings/:buildingId/duplicate',
      'POST /studio/buildings/:buildingId/apply-template',
      'GET /studio/quality',
    ]);
  });
});

describe('authentication on every studio route', () => {
  it.each(ROUTES)('password mode, no session → 401: %s', async (_l, method, path) => {
    const counting = countingDb(t.db);
    const res = await handleAdmin(send(method, path), makeDeps({ env: { ...pwEnv, DB: counting.db } }));
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe('unauthenticated');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(
      counting.prepared.filter((s) => /studio_|INSERT|UPDATE|DELETE/i.test(s) && !/sessions/.test(s)),
    ).toEqual([]);
  });

  it.each(ROUTES)('access mode, no JWT (cookie alone not trusted) → 401: %s', async (_l, method, path) => {
    const jwt = await sign(key, claims(now));
    const res = await handleAdmin(send(method, path, { cookie: `CF_Authorization=${jwt}` }), accessDeps());
    expect(res.status).toBe(401);
  });

  it.each(ROUTES)('access mode, non-owner identity → 403: %s', async (_l, method, path) => {
    const jwt = await sign(key, claims(now, { email: 'student@example.org' }));
    const res = await handleAdmin(
      send(method, path, { headers: { 'Cf-Access-Jwt-Assertion': jwt } }),
      accessDeps(),
    );
    expect(res.status).toBe(403);
  });

  it.each(ROUTES)('AUTH_MODE unset → 503 not-configured (fail closed): %s', async (_l, method, path) => {
    const res = await handleAdmin(send(method, path), makeDeps({ env: { DB: t.db, ASSETS: fileAssets } }));
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe('not-configured');
  });
});

describe('Origin and CSRF on every studio write', () => {
  const cases = [
    ['missing Origin', { origin: null }],
    ['foreign Origin', { origin: 'https://evil.example' }],
    ['cross-site fetch metadata', { headers: { 'Sec-Fetch-Site': 'cross-site' } }],
    ['missing X-CSRF-Token', { dropCsrf: true }],
    ['invalid X-CSRF-Token', { csrf: 'A'.repeat(43) }],
  ] as const;

  for (const [label, o] of cases) {
    it.each(WRITES)(`password mode, ${label} → 403 csrf: %s`, async (_l, method, path) => {
      const { cookie, csrf } = await login();
      const counting = countingDb(t.db);
      const opts: Parameters<typeof req>[2] = { cookie, csrf, ...('dropCsrf' in o ? {} : o) };
      if ('dropCsrf' in o) delete opts.csrf;
      const res = await handleAdmin(
        send(method, path, opts),
        makeDeps({ env: { ...pwEnv, DB: counting.db }, now: () => now }),
      );
      expect(res.status).toBe(403);
      expect(await errorCode(res)).toBe('csrf');
      expect(counting.prepared.filter((s) => /studio_|audit_events/.test(s))).toEqual([]);
    });
  }

  it.each(WRITES)('access mode, missing Origin → 403: %s', async (_l, method, path) => {
    const res = await handleAdmin(
      send(method, path, { headers: await access(), origin: null }),
      accessDeps(),
    );
    expect(res.status).toBe(403);
  });

  it.each(WRITES)(
    'a fully valid write passes the guards and reaches the domain: %s',
    async (_l, method, path) => {
      const { cookie, csrf } = await login();
      const res = await handleAdmin(send(method, path, { cookie, csrf }), pwDeps());
      // reaches body parsing / the domain: never 401/403
      expect([200, 201, 400, 404, 409, 422]).toContain(res.status);
    },
  );
});

describe('body limits and structure', () => {
  const path = '/api/admin/studio/buildings';
  it('> 32 KB → 413 (declared and streamed)', async () => {
    const big = JSON.stringify({ targetId: null, draft: newDraft(), pad: 'x'.repeat(33 * 1024) });
    const declared = await handleAdmin(
      req('POST', path, { raw: big, headers: { ...(await access()), 'Content-Length': String(big.length) } }),
      accessDeps(),
    );
    expect(declared.status).toBe(413);
    const lying = await handleAdmin(
      req('POST', path, { raw: big, headers: { ...(await access()), 'Content-Length': '10' } }),
      accessDeps(),
    );
    expect(lying.status).toBe(413);
  });

  it.each([
    ['an overflowing number (1e999 → Infinity)', '{"targetId":null,"draft":{"model":{"widthM":1e999}}}'],
    ['deep nesting', `${'['.repeat(40)}${']'.repeat(40)}`],
    [
      'a huge array',
      JSON.stringify({
        targetId: null,
        draft: { identity: { aliases: Array.from({ length: 600 }, () => 'a') } },
      }),
    ],
  ])('%s → 400 before the schema and before any DB access', async (_l, raw) => {
    const counting = countingDb(t.db);
    const res = await handleAdmin(
      req('POST', path, { raw, headers: await access() }),
      accessDeps(counting.db),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('invalid');
    expect(counting.prepared.filter((s) => /studio_|audit_events/.test(s))).toEqual([]);
  });

  it('wrong content type → 415; malformed JSON → 400; a malformed id → 400', async () => {
    const ct = await handleAdmin(
      req('POST', path, { raw: '{}', headers: { ...(await access()), 'Content-Type': 'text/plain' } }),
      accessDeps(),
    );
    expect(ct.status).toBe(415);
    const bad = await handleAdmin(
      req('POST', path, { raw: '{"targetId":', headers: await access() }),
      accessDeps(),
    );
    expect(bad.status).toBe(400);
    for (const p of [
      '/api/admin/studio/buildings/stu:short',
      '/api/admin/studio/buildings/own:aaaaaaaaaaaaaaaaaaaaaaaaaa',
      `/api/admin/studio/buildings/${encodeURIComponent("stu:' OR 1=1 --")}`,
    ]) {
      const counting = countingDb(t.db);
      const r = await handleAdmin(req('GET', p, { headers: await access() }), accessDeps(counting.db));
      expect(r.status).toBe(400);
      expect(counting.prepared).toEqual([]);
    }
    // starter templates are code: they have no write routes
    const code = await handleAdmin(
      req('PUT', '/api/admin/studio/templates/academic-block', {
        body: { revision: 1 },
        headers: await access(),
      }),
      accessDeps(),
    );
    expect(code.status).toBe(400);
  });
});

describe('a full Access-mode flow and the wire shapes', () => {
  it('create → save → publish (422 → ack) → public v2 → stale write 409 → archive → gone → restore', async () => {
    const h = await access();
    const call = async (method: string, path: string, body?: unknown) =>
      handleAdmin(
        req(method, `/api/admin/studio${path}`, { headers: h, ...(body === undefined ? {} : { body }) }),
        accessDeps(),
      );

    const created = await call('POST', '/buildings', {
      targetId: null,
      draft: newDraft({ model: { heightM: 14 } }),
    });
    expect(created.status).toBe(201);
    const d = studioBuildingDetailSchema.parse(await created.json());
    const id = d.head.id;

    const saved = await call('PUT', `/buildings/${id}/draft`, {
      revision: 1,
      draft: newDraft({ model: { heightM: 15 } }),
    });
    expect(saved.status).toBe(200);

    const missing = await call('POST', `/buildings/${id}/publish`, publishBody(2));
    expect(missing.status).toBe(422);
    const body = (await missing.json()) as { error: { code: string; details: unknown } };
    expect(apiErrorSchema.parse(body).error.code).toBe('validation-failed');
    const details = studioErrorDetailsSchema.parse(body.error.details);
    expect(details.missingAcknowledgements).toEqual(['height-floors-conflict']);
    expect(details.validation?.requiredAcknowledgements).toEqual(['height-floors-conflict']);

    const pub = await call(
      'POST',
      `/buildings/${id}/publish`,
      publishBody(2, {
        acknowledgements: [{ code: 'height-floors-conflict', reason: 'Double-height ground floor' }],
      }),
    );
    expect(pub.status).toBe(200);
    const pr = publishResponseSchema.parse(await pub.json());
    expect(pr.building.head.status).toBe('published');

    const publication = await handlePublication(req('GET', '/api/locations'), accessDeps());
    expect(publication.status).toBe(200);
    expect(publication.headers.get('ETag')).toBe(`W/"pub-${pr.publicationVersion}"`);
    const text = await publication.text();
    const p = publicationSchema.parse(JSON.parse(text));
    expect(p.schemaVersion).toBe(2);
    expect(p.buildings!.map((b) => b.id)).toEqual([id]);
    expect(text).not.toContain(PRIVATE_NOTE);
    expect(text).not.toContain('Double-height');

    const stale = await call('POST', `/buildings/${id}/archive`, { revision: 1, reason: null });
    expect(stale.status).toBe(409);
    const sb = (await stale.json()) as { error: { code: string; details: unknown } };
    expect(sb.error.code).toBe('conflict');
    expect(studioErrorDetailsSchema.parse(sb.error.details).current).toMatchObject({ id, revision: 3 });

    const arch = await call('POST', `/buildings/${id}/archive`, {
      revision: 3,
      reason: 'Temporarily hidden',
    });
    expect(arch.status).toBe(200);
    const gone = publicationSchema.parse(
      await (await handlePublication(req('GET', '/api/locations'), accessDeps())).json(),
    );
    expect(gone.buildings).toEqual([]);
    const restored = await call('POST', `/buildings/${id}/restore`, {
      revision: 4,
      acknowledgements: [{ code: 'height-floors-conflict', reason: 'Double-height ground floor' }],
    });
    expect(restored.status).toBe(200);
    const back = publicationSchema.parse(
      await (await handlePublication(req('GET', '/api/locations'), accessDeps())).json(),
    );
    expect(back.buildings!.map((b) => b.id)).toEqual([id]);

    for (const [m, p2] of [
      ['GET', '/library'],
      ['GET', '/buildings'],
      ['GET', `/buildings/${id}`],
      ['GET', '/quality'],
    ] as const) {
      const r = await call(m, p2);
      expect(r.status, p2).toBe(200);
      expect(r.headers.get('Cache-Control')).toBe('no-store');
    }
    const audit = await handleAdmin(
      req('GET', `/api/admin/audit?entity=building&entityId=${encodeURIComponent(id)}`, { headers: h }),
      accessDeps(),
    );
    const events = ((await audit.json()) as { items: { action: string; outcome: string; actor: string }[] })
      .items;
    expect(events.map((e) => `${e.action}:${e.outcome}`).reverse()).toEqual([
      'building.create:success',
      'building.save-draft:success',
      'building.publish:rejected',
      'building.publish:success',
      'building.archive:rejected',
      'building.archive:success',
      'building.restore:success',
    ]);
    expect(events.every((e) => e.actor === 'owner@example.org')).toBe(true);
  });

  it('password mode with a session and CSRF token can write', async () => {
    const { cookie, csrf } = await login();
    const res = await handleAdmin(
      req('POST', '/api/admin/studio/validate', {
        cookie,
        csrf,
        body: { targetId: null, recordId: null, draft: newDraft() },
      }),
      pwDeps(),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { errorCount: number }).errorCount).toBe(0);
  });
});
