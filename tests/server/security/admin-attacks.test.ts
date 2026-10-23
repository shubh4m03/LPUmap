/**
 * Red-team: attacks on /api/admin/** — auth bypass, session abuse, CSRF,
 * method/path tricks, injection, replay/race, error leaks, audit forging.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../../../server/auth/password.ts';
import { resetJwksCache } from '../../../server/auth/access.ts';
import { resetSaltMemo } from '../../../server/auth/salt.ts';
import { bytesToB64url, utf8 } from '../../../server/auth/encoding.ts';
import { handleAdmin } from '../../../server/handlers/admin/index.ts';
import { setLogSink } from '../../../server/http/log.ts';
import type { SqlDatabase } from '../../../server/db/types.ts';
import { claims, sign } from '../auth/jwt-fixtures.ts';
import { ORIGIN, TEST_PASSWORD, countingDb, errorCode, req, validSuggestion } from '../http/fixtures.ts';
import { createTestDb, resetTables } from '../http/harness.ts';
import {
  NOW,
  accessDeps,
  asOwner,
  makeKit,
  ownerJwt,
  publicationVersion,
  pwDeps,
  pwLogin,
  submit,
} from './helpers.ts';
import type { Kit } from './helpers.ts';

let k: Kit;

beforeAll(async () => {
  k = await makeKit(await createTestDb());
});
afterAll(async () => k.t.dispose());
beforeEach(async () => {
  await resetTables(k.t.db);
  resetSaltMemo();
  resetJwksCache();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

async function pendingSuggestion(name = 'Target Spot'): Promise<string> {
  const res = await submit(k, {
    body: validSuggestion({ name }),
    ip: `198.51.100.${Math.floor(Math.random() * 250)}`,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { reference: string }).reference;
}

const APPROVE = (id: string) => `/api/admin/suggestions/${id}/approve`;

describe('auth configuration fails closed', () => {
  it.each([
    ['AUTH_MODE unset', { AUTH_MODE: undefined }],
    ['AUTH_MODE typo', { AUTH_MODE: 'passwrod' }],
    ['AUTH_MODE wrong case', { AUTH_MODE: 'Password' }],
    ['AUTH_MODE none', { AUTH_MODE: 'none' }],
    ['AUTH_MODE disabled', { AUTH_MODE: 'off' }],
    ['hash malformed', { OWNER_PASSWORD_HASH: 'pbkdf2-sha256$100000$AAAA$BBBB' }],
    [
      'hash with low iterations',
      {
        OWNER_PASSWORD_HASH:
          'pbkdf2-sha256$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      },
    ],
    ['hash is plaintext', { OWNER_PASSWORD_HASH: TEST_PASSWORD }],
    ['hash empty', { OWNER_PASSWORD_HASH: '   ' }],
  ])('%s → 503 on login and on approve; nothing written', async (_l, extra) => {
    const id = await pendingSuggestion();
    const deps = pwDeps(k, extra as Record<string, string>);
    const login = await handleAdmin(
      req('POST', '/api/admin/session', { body: { password: TEST_PASSWORD } }),
      deps,
    );
    expect(login.status).toBe(503);
    expect(login.headers.get('Set-Cookie')).toBeNull();
    const approve = await handleAdmin(req('POST', APPROVE(id), { body: { revision: 1 } }), deps);
    expect(approve.status).toBe(503);
    expect(await k.t.count('sessions')).toBe(0);
    expect(await k.t.count('locations')).toBe(0);
    const text = await login.text();
    expect(text).not.toContain(TEST_PASSWORD);
    expect(text).not.toContain('pbkdf2');
  });

  it.each([
    ['OWNER_EMAILS empty', { OWNER_EMAILS: '' }],
    ['OWNER_EMAILS only commas', { OWNER_EMAILS: ' , ,' }],
    ['OWNER_EMAILS wildcard', { OWNER_EMAILS: '*' }],
    ['ACCESS_AUD missing', { ACCESS_AUD: undefined }],
    ['team domain http', { ACCESS_TEAM_DOMAIN: 'http://lpu-team.cloudflareaccess.com' }],
  ])('Access mode with %s → 503 even with a valid token', async (_l, extra) => {
    const res = await handleAdmin(
      req('GET', '/api/admin/overview', { headers: { 'Cf-Access-Jwt-Assertion': await ownerJwt(k) } }),
      accessDeps(k, extra as Record<string, string>),
    );
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe('not-configured');
  });
});

describe('Access JWT bypass attempts', () => {
  const overview = async (headers: Record<string, string>) =>
    handleAdmin(req('GET', '/api/admin/overview', { headers }), accessDeps(k));

  it('a valid token only in the CF_Authorization cookie is not accepted', async () => {
    const res = await overview({ Cookie: `CF_Authorization=${await ownerJwt(k)}` });
    expect(res.status).toBe(401);
  });

  it('a valid token in Authorization: Bearer is not accepted', async () => {
    const res = await overview({ Authorization: `Bearer ${await ownerJwt(k)}` });
    expect(res.status).toBe(401);
  });

  it.each([
    ['expired beyond skew', { exp: Math.floor(NOW.getTime() / 1000) - 61 }],
    ['wrong audience', { aud: ['other-app'] }],
    ['wrong issuer', { iss: 'https://evil.cloudflareaccess.com' }],
    [
      'email with different case is still matched, but a look-alike is not',
      { email: 'owner@example.org.evil' },
    ],
    ['no email (service token)', { email: undefined }],
  ])('%s → rejected', async (_l, over) => {
    const res = await overview({ 'Cf-Access-Jwt-Assertion': await sign(k.key, claims(NOW, over)) });
    expect([401, 403]).toContain(res.status);
  });

  it('alg confusion: HS256 / none headers with a forged body → 401', async () => {
    const enc = (v: unknown) => bytesToB64url(utf8(JSON.stringify(v)));
    for (const alg of ['none', 'HS256', 'RS512', 'PS256']) {
      const token = `${enc({ alg, kid: 'k1' })}.${enc(claims(NOW))}.${alg === 'none' ? '' : 'c2ln'}`;
      expect((await overview({ 'Cf-Access-Jwt-Assertion': token })).status).toBe(401);
    }
  });

  it('a kid of "__proto__"/"constructor" does not resolve to a key', async () => {
    for (const kid of ['__proto__', 'constructor', 'toString']) {
      const token = await sign(k.key, claims(NOW), { kid });
      expect((await overview({ 'Cf-Access-Jwt-Assertion': token })).status).toBe(401);
    }
  });

  it('password mode ignores an Access header entirely', async () => {
    const res = await handleAdmin(
      req('GET', '/api/admin/overview', { headers: { 'Cf-Access-Jwt-Assertion': await ownerJwt(k) } }),
      pwDeps(k),
    );
    expect(res.status).toBe(401);
  });

  it('403 for a non-owner does not reveal the owner list', async () => {
    const res = await overview({
      'Cf-Access-Jwt-Assertion': await sign(k.key, claims(NOW, { email: 'x@y.org' })),
    });
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).not.toMatch(/example\.org|someone@else/);
  });
});

describe('password sessions', () => {
  it('session fixation: a client-chosen cookie is never adopted at login', async () => {
    const planted = `__Host-atlas_session=${'A'.repeat(43)}`;
    const res = await handleAdmin(
      req('POST', '/api/admin/session', { body: { password: TEST_PASSWORD }, cookie: planted }),
      pwDeps(k),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).not.toContain('A'.repeat(43));
    const probe = await handleAdmin(req('GET', '/api/admin/session', { cookie: planted }), pwDeps(k));
    expect(probe.status).toBe(401);
  });

  it('a logged-out session cannot be replayed, for reads or writes', async () => {
    const s = await pwLogin(k);
    const out = await handleAdmin(
      req('DELETE', '/api/admin/session', { cookie: s.cookie, csrf: s.csrf }),
      pwDeps(k),
    );
    expect(out.status).toBe(200);
    const id = await pendingSuggestion();
    expect(
      (await handleAdmin(req('GET', '/api/admin/overview', { cookie: s.cookie }), pwDeps(k))).status,
    ).toBe(401);
    const approve = await handleAdmin(
      req('POST', APPROVE(id), { body: { revision: 1 }, cookie: s.cookie, csrf: s.csrf }),
      pwDeps(k),
    );
    expect(approve.status).toBe(401);
    expect(await k.t.count('locations')).toBe(0);
  });

  it('an expired session is refused even if its row still exists', async () => {
    const s = await pwLogin(k);
    const later = () => new Date(NOW.getTime() + 8 * 3600 * 1000 + 1000);
    const res = await handleAdmin(
      req('GET', '/api/admin/overview', { cookie: s.cookie }),
      pwDeps(k, {}, later),
    );
    expect(res.status).toBe(401);
  });

  it('rotating OWNER_PASSWORD_HASH revokes every existing session', async () => {
    const s = await pwLogin(k);
    expect(
      (await handleAdmin(req('GET', '/api/admin/overview', { cookie: s.cookie }), pwDeps(k))).status,
    ).toBe(200);
    const rotated = { OWNER_PASSWORD_HASH: await hashPassword('a completely new passphrase') };
    const id = await pendingSuggestion();
    const read = await handleAdmin(
      req('GET', '/api/admin/overview', { cookie: s.cookie }),
      pwDeps(k, rotated),
    );
    expect(read.status).toBe(401);
    const write = await handleAdmin(
      req('POST', APPROVE(id), { body: { revision: 1 }, cookie: s.cookie, csrf: s.csrf }),
      pwDeps(k, rotated),
    );
    expect(write.status).toBe(401);
    expect(await k.t.count('locations')).toBe(0);
  });

  it('the stored session id is neither the raw token nor its bare SHA-256', async () => {
    const s = await pwLogin(k);
    const token = s.cookie.split('=')[1]!;
    const { sha256Hex } = await import('../../../server/auth/encoding.ts');
    const row = await k.t.db.prepare('SELECT id_hash FROM sessions').first<{ id_hash: string }>();
    expect(row?.id_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.id_hash).not.toBe(token);
    expect(row?.id_hash).not.toBe(await sha256Hex(token));
  });
});

describe('CSRF on admin writes (password mode)', () => {
  it.each([
    ['no Origin', { origin: null }],
    ['Origin null', { origin: 'null' }],
    ['Origin with trailing slash', { origin: `${ORIGIN}/` }],
    ['Origin upper-case host', { origin: ORIGIN.toUpperCase() }],
    ['Origin with port', { origin: `${ORIGIN}:443x` }],
    ['sibling subdomain', { origin: 'https://evil.atlas.test' }],
    ['Sec-Fetch-Site same-site', { headers: { 'Sec-Fetch-Site': 'same-site' } }],
    ['Sec-Fetch-Site cross-site', { headers: { 'Sec-Fetch-Site': 'cross-site' } }],
    ['no CSRF token', { csrf: undefined }],
    ['CSRF token of different length', { csrf: 'x' }],
    ['CSRF token with one char changed', { mutateCsrf: true }],
  ] as const)('%s → 403 and nothing published', async (_l, o) => {
    const s = await pwLogin(k);
    const id = await pendingSuggestion();
    const v0 = await publicationVersion(k);
    const csrf = 'mutateCsrf' in o ? `${s.csrf.slice(0, -1)}${s.csrf.endsWith('A') ? 'B' : 'A'}` : s.csrf;
    const { mutateCsrf: _m, ...opts } = { mutateCsrf: false, csrf, ...o };
    const res = await handleAdmin(
      req('POST', APPROVE(id), { body: { revision: 1 }, cookie: s.cookie, ...opts }),
      pwDeps(k),
    );
    expect(res.status).toBe(403);
    expect(await publicationVersion(k)).toBe(v0);
    expect(await k.t.count('locations')).toBe(0);
  });

  it('cross-site text/plain form POST with the cookie → rejected, nothing published', async () => {
    const s = await pwLogin(k);
    const id = await pendingSuggestion();
    const res = await handleAdmin(
      req('POST', APPROVE(id), {
        raw: '{"revision":1}',
        headers: { 'Content-Type': 'text/plain' },
        origin: 'https://evil.example',
        cookie: s.cookie,
      }),
      pwDeps(k),
    );
    expect(res.status).toBe(403);
    expect(await k.t.count('locations')).toBe(0);
  });

  it('a PUBLIC_ORIGIN that does not match the caller does not open the door', async () => {
    const s = await pwLogin(k);
    const id = await pendingSuggestion();
    const res = await handleAdmin(
      req('POST', APPROVE(id), {
        body: { revision: 1 },
        cookie: s.cookie,
        csrf: s.csrf,
        origin: 'https://evil.example',
      }),
      pwDeps(k, { PUBLIC_ORIGIN: 'https://atlas.example.org' }),
    );
    expect(res.status).toBe(403);
  });

  it('an invalid PUBLIC_ORIGIN (http, path, wildcard) is ignored rather than trusted', async () => {
    const s = await pwLogin(k);
    const id = await pendingSuggestion();
    for (const bad of ['http://evil.example', 'https://evil.example/x', '*', 'null']) {
      const res = await handleAdmin(
        req('POST', APPROVE(id), {
          body: { revision: 1 },
          cookie: s.cookie,
          csrf: s.csrf,
          origin: bad === '*' ? 'https://evil.example' : bad,
        }),
        pwDeps(k, { PUBLIC_ORIGIN: bad }),
      );
      expect(res.status).toBe(403);
    }
    expect(await k.t.count('locations')).toBe(0);
  });
});

describe('method and path tricks', () => {
  it('method-override headers and query parameters are ignored', async () => {
    const created = await asOwner(k, 'POST', '/locations', {
      body: { fields: { name: 'Keep Me', categoryId: 'food', location: [75.7049, 31.2536] } },
    });
    const id = ((await created.json()) as { id: string }).id;
    for (const [path, headers] of [
      [`/locations/${id}`, { 'X-HTTP-Method-Override': 'DELETE' }],
      [`/locations/${id}`, { 'X-HTTP-Method': 'DELETE', 'X-Method-Override': 'DELETE' }],
      [`/locations/${id}?_method=DELETE`, {}],
    ] as const) {
      const res = await asOwner(k, 'POST', path, { body: { revision: 1, confirmName: 'Keep Me' }, headers });
      expect(res.status).toBe(405);
    }
    expect(await k.t.count('locations')).toBe(1);
  });

  it.each(['HEAD', 'OPTIONS', 'TRACE', 'CONNECT', 'get'])('%s is never routed', async (method) => {
    if (method === 'CONNECT' || method === 'TRACE') {
      // Not constructible with the Fetch API; exercise the dispatcher's guard directly.
      const fake = {
        method,
        url: `${ORIGIN}/api/admin/overview`,
        headers: new Headers(),
      } as unknown as Request;
      expect((await handleAdmin(fake, accessDeps(k))).status).toBe(405);
      return;
    }
    const res = await handleAdmin(
      req(method, '/api/admin/overview', { headers: { 'Cf-Access-Jwt-Assertion': await ownerJwt(k) } }),
      accessDeps(k),
    );
    if (method === 'get')
      expect(res.status).toBe(200); // fetch normalises the method name
    else expect(res.status).toBe(405);
  });

  it.each([
    '/suggestions/..%2F..%2Fsessions',
    '/suggestions/sug_aaaaaaaaaaaaaaaaaaaaaaaaaa%00',
    '/suggestions/sug_aaaaaaaaaaaaaaaaaaaaaaaaaa%2Fapprove',
    "/suggestions/sug_aaaa'%20OR%20'1'%3D'1",
    '/suggestions/%E0%A4%A',
    '/locations/own:..%2F..%2Fx',
    '/locations/OWN:aaaaaaaaaaaaaaaaaaaaaaaaaa',
    '/overrides/osm%3Away%2F1%2F..%2F2',
    '/overrides/osm%3Away%2F-1',
    '/overrides/cur%3A..',
    `/overrides/cur%3A${'a'.repeat(200)}`,
  ])('malformed id %s → 400 with zero SQL', async (path) => {
    const counting = countingDb(k.t.db);
    const deps = accessDeps(k, { DB: counting.db });
    const method = path.startsWith('/locations/') ? 'PATCH' : 'GET';
    const res = await handleAdmin(
      req(method, `/api/admin${path}`, {
        headers: { 'Cf-Access-Jwt-Assertion': await ownerJwt(k) },
        ...(method === 'PATCH' ? { body: { revision: 1, fields: {} } } : {}),
      }),
      deps,
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('invalid');
    expect(counting.prepared).toEqual([]);
  });

  it.each([
    '/api/admin//overview',
    '/api/admin/overview/..',
    '/api/adminx/overview',
    '/api/admin/./overview',
  ])('path normalisation trick %s cannot reach a route without auth', async (path) => {
    const res = await handleAdmin(new Request(`${ORIGIN}${path}`), accessDeps(k));
    expect([401, 404]).toContain(res.status);
  });
});

describe('injection through filters, search, sort and cursors', () => {
  async function seed(): Promise<void> {
    for (const name of ['Alpha Hall', 'Beta 100% Hall', 'Gamma_Hall', "O'Brien Hall"])
      await pendingSuggestion(name);
  }
  const list = async (qs: string) => asOwner(k, 'GET', `/suggestions?${qs}`);
  const names = async (res: Response) =>
    ((await res.json()) as { items: Array<{ name: string }> }).items.map((i) => i.name).sort();

  it.each(["q=' OR 1=1 --", 'q=%25', 'q=_', 'q=%5C', "q=Hall') UNION SELECT * FROM sessions --"])(
    'search %s is a literal substring match',
    async (qs) => {
      await seed();
      const res = await list(qs);
      expect(res.status).toBe(200);
      const q = new URLSearchParams(qs).get('q')!;
      const expected = ['Alpha Hall', 'Beta 100% Hall', 'Gamma_Hall', "O'Brien Hall"].filter((n) =>
        n.includes(q),
      );
      expect(await names(res)).toEqual(expected.sort());
    },
  );

  it.each([
    "status=pending' OR '1'='1",
    'status=pending;DROP TABLE suggestions',
    'sort=name; DROP TABLE suggestions',
    'sort=created_at',
    'category=library%27--',
    'limit=1;DELETE',
    'limit=-1',
    'limit=1e9',
  ])('filter %s → 400 (whitelisted)', async (qs) => {
    await seed();
    const res = await list(qs);
    expect(res.status).toBe(400);
    expect(await k.t.count('suggestions')).toBe(4);
  });

  it('a forged keyset cursor carrying SQL is bound as data', async () => {
    await seed();
    const forged = bytesToB64url(utf8(JSON.stringify(["9999' OR 1=1 --", "x') OR ('1'='1"])));
    const res = await list(`cursor=${forged}`);
    expect(res.status).toBe(200);
    expect(await names(res)).toHaveLength(4); // string compare: every created_at < "9999…"
    const garbage = await list('cursor=%%%%');
    expect([200, 400]).toContain(garbage.status);
    expect(await k.t.count('suggestions')).toBe(4);
  });

  it.each(['cursor=1%20OR%201%3D1', 'cursor=-1', 'entity=suggestion%27--', 'limit=999999'])(
    'audit filter %s → 400',
    async (qs) => {
      expect((await asOwner(k, 'GET', `/audit?${qs}`)).status).toBe(400);
    },
  );

  it("audit entityId/action are bound literally (' OR '1'='1 matches nothing)", async () => {
    await seed();
    const res = await asOwner(
      k,
      'GET',
      `/audit?entityId=${encodeURIComponent("' OR '1'='1")}&action=${encodeURIComponent("x' OR 1=1 --")}`,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { items: unknown[] }).items).toEqual([]);
  });

  it('locations search escapes LIKE wildcards', async () => {
    await asOwner(k, 'POST', '/locations', {
      body: { fields: { name: 'Plain Name', categoryId: 'food', location: [75.7049, 31.2536] } },
    });
    for (const q of ['%', '_', '%%', '\\']) {
      const res = await asOwner(k, 'GET', `/locations?q=${encodeURIComponent(q)}`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { items: unknown[] }).items).toEqual([]);
    }
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'a query key named %s is ignored like any unknown key (not a 400, no prototype effects)',
    async (key) => {
      await seed();
      const res = await list(`${key}=1`);
      expect(res.status).toBe(200);
      expect(await names(res)).toHaveLength(4);
    },
  );

  it('a repeated query key is still rejected as ambiguous', async () => {
    expect((await list('status=pending&status=approved')).status).toBe(400);
  });
});

describe('replay and races', () => {
  it('replaying an approve request after success → 409 and no second location', async () => {
    const id = await pendingSuggestion();
    const v0 = await publicationVersion(k);
    const first = await asOwner(k, 'POST', `/suggestions/${id}/approve`, { body: { revision: 1 } });
    expect(first.status).toBe(200);
    for (let i = 0; i < 3; i++) {
      const again = await asOwner(k, 'POST', `/suggestions/${id}/approve`, { body: { revision: 1 } });
      expect(again.status).toBe(409);
    }
    expect(await k.t.count('locations')).toBe(1);
    expect(await publicationVersion(k)).toBe(v0 + 1);
  });

  it('10 concurrent approvals over HTTP publish exactly one location', async () => {
    const id = await pendingSuggestion();
    const v0 = await publicationVersion(k);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        asOwner(k, 'POST', `/suggestions/${id}/approve`, { body: { revision: 1 } }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);
    expect(await k.t.count('locations')).toBe(1);
    expect(await publicationVersion(k)).toBe(v0 + 1);
    const audit = await k.t.db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_events WHERE action = 'suggestion.approve' AND entity_id = ? AND outcome = 'success'",
      )
      .bind(id)
      .first<{ n: number }>();
    expect(Number(audit?.n)).toBe(1);
  });

  it('concurrent approve + reject: exactly one wins, state is consistent', async () => {
    const id = await pendingSuggestion();
    const [a, r] = await Promise.all([
      asOwner(k, 'POST', `/suggestions/${id}/approve`, { body: { revision: 1 } }),
      asOwner(k, 'POST', `/suggestions/${id}/reject`, { body: { revision: 1 } }),
    ]);
    expect([a.status, r.status].sort()).toEqual([200, 409]);
    const row = await k.t.db
      .prepare('SELECT status, published_location_id FROM suggestions WHERE id = ?')
      .bind(id)
      .first<{ status: string; published_location_id: string | null }>();
    expect(await k.t.count('locations')).toBe(row?.status === 'approved' ? 1 : 0);
  });
});

describe('information leaks and audit integrity', () => {
  const secretEnv = { RATE_LIMIT_KEY: 'S3CR3T-RATE-KEY-0123456789abcdefghijklmnop' };

  function explodingDb(db: SqlDatabase): SqlDatabase {
    return {
      prepare(sql) {
        if (/FROM suggestions/.test(sql))
          throw new Error(`D1_ERROR: near "SELECT": syntax error in ${sql} key=${secretEnv.RATE_LIMIT_KEY}`);
        return db.prepare(sql);
      },
      batch: (s) => db.batch(s),
      exec: (s) => db.exec(s),
    };
  }

  it('an internal DB error returns a generic 500 with no SQL, stack, env value or path', async () => {
    const lines: string[] = [];
    const restore = setLogSink((_lvl, line) => lines.push(line));
    try {
      const res = await handleAdmin(
        req('GET', '/api/admin/suggestions', { headers: { 'Cf-Access-Jwt-Assertion': await ownerJwt(k) } }),
        accessDeps(k, { DB: explodingDb(k.t.db), ...secretEnv }),
      );
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: { code: 'internal', message: 'Internal error' } });
      expect(text).not.toMatch(/SELECT|D1_ERROR|S3CR3T|at |\.ts/);
    } finally {
      restore();
    }
    const joined = lines.join('\n');
    expect(joined).not.toContain('S3CR3T-RATE-KEY');
    expect(joined).not.toContain('owner@example.org');
  });

  it('validation errors never echo the submitted values', async () => {
    const marker = 'ECHO-MARKER-<script>';
    const res = await submit(k, {
      body: validSuggestion({
        categoryId: marker,
        location: [marker, marker],
        evidenceUrl: `javascript:${marker}`,
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain('ECHO-MARKER');
  });

  it('login failure does not reveal whether a hash is configured or how close the guess was', async () => {
    const wrong = await handleAdmin(
      req('POST', '/api/admin/session', { body: { password: 'nope' }, ip: '192.0.2.1' }),
      pwDeps(k),
    );
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: { code: 'unauthenticated', message: 'Incorrect password' } });
  });

  it('an approve body cannot forge the audit actor, outcome or timestamps', async () => {
    const id = await pendingSuggestion();
    const res = await asOwner(k, 'POST', `/suggestions/${id}/approve`, {
      body: {
        revision: 1,
        actor: 'mallory',
        reviewedBy: 'mallory',
        createdBy: 'mallory',
        outcome: 'failed',
        at: '1999-01-01T00:00:00.000Z',
        fields: { name: 'Target Spot', createdBy: 'mallory' },
      },
    });
    expect(res.status).toBe(200);
    const loc = ((await res.json()) as { location: { id: string } }).location.id;
    const rows = await k.t.db
      .prepare('SELECT actor, outcome, at, after_json FROM audit_events WHERE entity_id IN (?, ?)')
      .bind(id, loc)
      .all<{ actor: string; outcome: string; at: string; after_json: string }>();
    const own = rows.results.filter((r) => r.actor !== 'public');
    expect(own).toHaveLength(2);
    expect(rows.results.filter((r) => r.actor === 'public')).toHaveLength(1);
    for (const r of own) {
      expect(r.actor).toBe('owner@example.org');
      expect(r.outcome).toBe('success');
      expect(r.at).toBe(NOW.toISOString());
      expect(r.after_json).not.toContain('mallory');
    }
  });

  it('no admin route can modify or delete audit events, and the DB refuses it directly', async () => {
    await pendingSuggestion();
    const before = await k.t.count('audit_events');
    for (const [m, p] of [
      ['DELETE', '/audit'],
      ['PATCH', '/audit'],
      ['PUT', '/audit'],
      ['POST', '/audit'],
      ['DELETE', '/audit/1'],
    ] as const) {
      const res = await asOwner(k, m, p, { body: { id: 1 } });
      expect([404, 405]).toContain(res.status);
    }
    await expect(k.t.db.prepare("UPDATE audit_events SET actor = 'mallory'").run()).rejects.toThrow(
      /append-only/,
    );
    await expect(k.t.db.prepare('DELETE FROM audit_events').run()).rejects.toThrow(/append-only/);
    expect(await k.t.count('audit_events')).toBe(before);
  });

  it('the audit log of a password-mode flow holds no password, cookie, CSRF token or IP', async () => {
    const s = await pwLogin(k, pwDeps(k), '203.0.113.77');
    const id = await pendingSuggestion();
    const res = await handleAdmin(
      req('POST', APPROVE(id), { body: { revision: 1 }, cookie: s.cookie, csrf: s.csrf, ip: '203.0.113.77' }),
      pwDeps(k),
    );
    expect(res.status).toBe(200);
    const all = JSON.stringify((await k.t.db.prepare('SELECT * FROM audit_events').all()).results);
    expect(all).not.toContain(TEST_PASSWORD);
    expect(all).not.toContain(s.cookie.split('=')[1]!);
    expect(all).not.toContain(s.csrf);
    expect(all).not.toContain('203.0.113.77');
    const sessions = JSON.stringify((await k.t.db.prepare('SELECT * FROM sessions').all()).results);
    expect(sessions).not.toContain(s.cookie.split('=')[1]!);
    const rl = JSON.stringify((await k.t.db.prepare('SELECT * FROM rate_limits').all()).results);
    expect(rl).not.toContain('203.0.113');
  });
});
