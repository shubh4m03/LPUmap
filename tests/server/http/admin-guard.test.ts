import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetJwksCache } from '../../../server/auth/access.ts';
import { resetSaltMemo } from '../../../server/auth/salt.ts';
import type { Env } from '../../../server/env.ts';
import { ADMIN_ROUTES } from '../../../server/handlers/admin/routes.ts';
import { handleAdmin } from '../../../server/handlers/admin/index.ts';
import { accessEnvVars, claims, jwksFetch, makeKey, sign } from '../auth/jwt-fixtures.ts';
import type { TestKey } from '../auth/jwt-fixtures.ts';
import {
  ORIGIN,
  TEST_PASSWORD,
  cookiePair,
  countingDb,
  errorCode,
  fileAssets,
  makeDeps,
  passwordEnv,
  req,
} from './fixtures.ts';
import { createTestDb, resetTables } from './harness.ts';
import type { TestDb } from './harness.ts';

const SAMPLE: Record<string, string> = {
  ':id': 'sug_aaaaaaaaaaaaaaaaaaaaaaaaaa',
  ':locationId': 'own:aaaaaaaaaaaaaaaaaaaaaaaaaa',
  ':targetId': encodeURIComponent('osm:way/123456'),
  ':buildingId': 'stu:aaaaaaaaaaaaaaaaaaaaaaaaaa',
  ':templateId': 'stv:aaaaaaaaaaaaaaaaaaaaaaaaaa',
};
const concrete = (pattern: string) => `/api/admin${pattern.replace(/:[a-zA-Z]+/g, (m) => SAMPLE[m]!)}`;
const SAMPLE_BODY = { revision: 1 };

/** Every routed endpoint except the password login itself. */
const PROTECTED = ADMIN_ROUTES.filter((r) => r.handler.permission !== null);
const routeCases = PROTECTED.map((r) => [`${r.method} ${r.pattern}`, r.method, concrete(r.pattern)] as const);
const ALL_CASES = ADMIN_ROUTES.map(
  (r) => [`${r.method} ${r.pattern}`, r.method, concrete(r.pattern)] as const,
);

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

const accessDeps = (db = t.db, extra: Partial<Env> = {}) =>
  makeDeps({
    env: { DB: db, ASSETS: fileAssets, ...accessEnvVars, ...extra },
    now: () => now,
    fetch: jwksFetch([key]),
  });

function send(method: string, path: string, o: Parameters<typeof req>[2] = {}) {
  return req(method, path, { ...(method !== 'GET' ? { body: SAMPLE_BODY } : {}), ...o });
}

describe('route table', () => {
  it('only the password login is reachable without authentication', () => {
    const open = ADMIN_ROUTES.filter((r) => r.handler.permission === null);
    expect(open.map((r) => `${r.method} ${r.pattern}`)).toEqual(['POST /session']);
    expect(PROTECTED.length).toBeGreaterThanOrEqual(25);
  });
});

describe('unauthenticated requests → 401 on every admin route', () => {
  it.each(routeCases)('password mode: %s', async (_l, method, path) => {
    const res = await handleAdmin(send(method, path), makeDeps({ env: pwEnv }));
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe('unauthenticated');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it.each(routeCases)(
    'access mode, CF_Authorization cookie alone is not trusted: %s',
    async (_l, method, path) => {
      const jwt = await sign(key, claims(now));
      const res = await handleAdmin(send(method, path, { cookie: `CF_Authorization=${jwt}` }), accessDeps());
      expect(res.status).toBe(401);
    },
  );

  it('unknown admin paths also answer 401 before 404 (no route enumeration)', async () => {
    for (const p of ['/api/admin/nope', '/api/admin', '/api/admin/suggestions/x/y/z']) {
      expect((await handleAdmin(req('GET', p), makeDeps({ env: pwEnv }))).status).toBe(401);
    }
  });
});

describe('fail closed when auth is not configured → 503 not-configured on every route', () => {
  const secretish = 'pbkdf2-sha256$5$c2VjcmV0$c2VjcmV0';
  const configs: Array<[string, Env]> = [
    ['AUTH_MODE missing', {}],
    ['AUTH_MODE unknown ("dev")', { AUTH_MODE: 'dev' }],
    ['AUTH_MODE "none"', { AUTH_MODE: 'none' }],
    ['password mode without hash', { AUTH_MODE: 'password' }],
    ['password mode with invalid hash', { AUTH_MODE: 'password', OWNER_PASSWORD_HASH: secretish }],
    ['access mode without AUD', { ...accessEnvVars, ACCESS_AUD: '' }],
    ['access mode with http team domain', { ...accessEnvVars, ACCESS_TEAM_DOMAIN: 'http://team.example' }],
    ['access mode with bad owner emails', { ...accessEnvVars, OWNER_EMAILS: 'not-an-email' }],
  ];
  for (const [label, vars] of configs) {
    it.each(ALL_CASES)(`${label}: %s`, async (_l, method, path) => {
      const res = await handleAdmin(send(method, path), makeDeps({ env: { DB: t.db, ...vars } }));
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(JSON.parse(text).error.code).toBe('not-configured');
      expect(text).not.toContain('c2VjcmV0');
      expect(text).not.toContain('team.example');
    });
  }

  it('missing DB binding → 503 unavailable (auth configured)', async () => {
    const { DB: _db, ...noDb } = pwEnv;
    for (const [, method, path] of ALL_CASES) {
      const res = await handleAdmin(send(method, path), makeDeps({ env: noDb }));
      expect(res.status).toBe(503);
      expect(await errorCode(res)).toBe('unavailable');
    }
  });
});

describe('same-origin + CSRF on mutating requests', () => {
  let cookie: string;
  let csrf: string;
  const deps = () =>
    makeDeps({ env: { ...pwEnv, PUBLIC_ORIGIN: 'https://atlas.example.org' }, now: () => now });
  const reject = (o: Parameters<typeof req>[2]) =>
    handleAdmin(
      req('POST', '/api/admin/suggestions/sug_aaaaaaaaaaaaaaaaaaaaaaaaaa/reject', {
        body: { revision: 1 },
        ...o,
      }),
      deps(),
    );

  beforeEach(async () => {
    const res = await handleAdmin(
      req('POST', '/api/admin/session', { body: { password: TEST_PASSWORD } }),
      deps(),
    );
    cookie = cookiePair(res.headers.get('Set-Cookie'));
    csrf = ((await res.json()) as { csrfToken: string }).csrfToken;
  });

  it('a fully valid request passes the guard (reaches the domain: unknown id → 404)', async () => {
    const res = await reject({ cookie, csrf });
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe('not-found');
  });

  it('PUBLIC_ORIGIN is accepted as an additional origin', async () => {
    expect((await reject({ cookie, csrf, origin: 'https://atlas.example.org' })).status).toBe(404);
  });

  it.each([
    ['missing Origin', { origin: null }],
    ['foreign Origin', { origin: 'https://evil.example' }],
    ['Origin "null"', { origin: 'null' }],
    ['sibling subdomain', { origin: 'https://evil.atlas.test' }],
    ['http downgrade', { origin: ORIGIN.replace('https', 'http') }],
    ['cross-site fetch metadata', { headers: { 'Sec-Fetch-Site': 'cross-site' } }],
    ['missing X-CSRF-Token', { csrf: undefined }],
    ['wrong X-CSRF-Token', { csrf: 'A'.repeat(43) }],
    ['CSRF token with a trailing character', { csrfSuffix: 'x' }],
  ])('%s → 403 csrf', async (_l, o: Record<string, unknown>) => {
    const opts: Parameters<typeof req>[2] = { cookie, csrf, ...o };
    if ('csrfSuffix' in o) opts.csrf = csrf + String(o.csrfSuffix);
    if ('csrf' in o && o.csrf === undefined) delete opts.csrf;
    const res = await reject(opts);
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('csrf');
  });

  it('GET requests need no Origin or CSRF token', async () => {
    expect((await handleAdmin(req('GET', '/api/admin/session', { cookie }), deps())).status).toBe(200);
  });

  it('access mode also requires a same-origin Origin on writes', async () => {
    const jwt = await sign(key, claims(now));
    const headers = { 'Cf-Access-Jwt-Assertion': jwt };
    const path = '/api/admin/suggestions/sug_aaaaaaaaaaaaaaaaaaaaaaaaaa/reject';
    const bad = await handleAdmin(
      req('POST', path, { body: { revision: 1 }, headers, origin: null }),
      accessDeps(),
    );
    expect(bad.status).toBe(403);
    const good = await handleAdmin(req('POST', path, { body: { revision: 1 }, headers }), accessDeps());
    expect(good.status).toBe(404);
  });
});

describe('request validation (authenticated, Access mode)', () => {
  const auth = async () => ({ 'Cf-Access-Jwt-Assertion': await sign(key, claims(now)) });

  it.each([
    ['GET', '/api/admin/suggestions/not-an-id'],
    ['GET', '/api/admin/suggestions/sug_AAAAAAAAAAAAAAAAAAAAAAAAAA'],
    ['GET', `/api/admin/suggestions/${encodeURIComponent("sug_' OR 1=1 --")}`],
    ['POST', '/api/admin/locations/own:short/hide'],
    ['POST', '/api/admin/locations/osm:way%2F1/hide'],
    ['GET', `/api/admin/overrides/${encodeURIComponent('osm:way/12; DROP TABLE x')}`],
    ['GET', '/api/admin/overrides/%E0%A4%A'],
  ])('%s %s → 400 before any database access', async (method, path) => {
    const counting = countingDb(t.db);
    const res = await handleAdmin(
      req(method, path, { headers: await auth(), ...(method === 'POST' ? { body: { revision: 1 } } : {}) }),
      accessDeps(counting.db),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('invalid');
    expect(counting.prepared).toEqual([]);
  });

  it('body larger than 32 KB → 413 (declared Content-Length and streamed)', async () => {
    const big = JSON.stringify({ revision: 1, reason: 'x'.repeat(40 * 1024) });
    const path = '/api/admin/suggestions/sug_aaaaaaaaaaaaaaaaaaaaaaaaaa/reject';
    const declared = await handleAdmin(
      req('POST', path, { raw: big, headers: { ...(await auth()), 'Content-Length': String(big.length) } }),
      accessDeps(),
    );
    expect(declared.status).toBe(413);
    expect(await errorCode(declared)).toBe('too-large');
    // A lying Content-Length must not smuggle a larger body.
    const lying = await handleAdmin(
      req('POST', path, { raw: big, headers: { ...(await auth()), 'Content-Length': '10' } }),
      accessDeps(),
    );
    expect(lying.status).toBe(413);
  });

  it.each([
    'text/plain',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    'application/json; charset=latin1',
  ])('Content-Type %s → 415', async (ct) => {
    const res = await handleAdmin(
      req('POST', '/api/admin/suggestions/sug_aaaaaaaaaaaaaaaaaaaaaaaaaa/reject', {
        raw: '{"revision":1}',
        headers: { ...(await auth()), 'Content-Type': ct },
      }),
      accessDeps(),
    );
    expect(res.status).toBe(415);
  });

  it('invalid JSON → 400; schema violation → 400 with field issues', async () => {
    const path = '/api/admin/suggestions/sug_aaaaaaaaaaaaaaaaaaaaaaaaaa/reject';
    const bad = await handleAdmin(
      req('POST', path, { raw: '{"revision":', headers: await auth() }),
      accessDeps(),
    );
    expect(bad.status).toBe(400);
    const schema = await handleAdmin(
      req('POST', path, { body: { revision: 'one' }, headers: await auth() }),
      accessDeps(),
    );
    expect(schema.status).toBe(400);
    const body = (await schema.json()) as { error: { issues: Array<{ path: string }> } };
    expect(body.error.issues.map((i) => i.path)).toContain('revision');
  });

  it('wrong method on a known path → 405 with Allow; OPTIONS → 405 and no CORS headers', async () => {
    const res = await handleAdmin(
      req('PUT', '/api/admin/overview', { body: {}, headers: await auth() }),
      accessDeps(),
    );
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET');
    const pre = await handleAdmin(
      req('OPTIONS', '/api/admin/overview', {
        headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
      }),
      accessDeps(),
    );
    expect(pre.status).toBe(405);
    for (const [k] of pre.headers) expect(k.toLowerCase()).not.toMatch(/^access-control-/);
  });

  it('API responses carry hardening headers and never CORS headers', async () => {
    const res = await handleAdmin(req('GET', '/api/admin/session', { headers: await auth() }), accessDeps());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ actor: 'owner@example.org', mode: 'access' });
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Type')).toMatch(/^application\/json/);
    for (const [k] of res.headers) expect(k.toLowerCase()).not.toMatch(/^access-control-/);
  });

  it('a non-owner Access identity gets 403 and never reaches the domain', async () => {
    const counting = countingDb(t.db);
    const jwt = await sign(key, claims(now, { email: 'student@example.org' }));
    const res = await handleAdmin(
      req('GET', '/api/admin/suggestions', { headers: { 'Cf-Access-Jwt-Assertion': jwt } }),
      accessDeps(counting.db),
    );
    expect(res.status).toBe(403);
    expect(counting.prepared).toEqual([]);
  });
});
