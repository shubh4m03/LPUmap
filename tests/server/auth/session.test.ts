import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE, readSessionToken } from '../../../server/auth/cookies.ts';
import { parsePasswordHash } from '../../../server/auth/password.ts';
import { sessionBinding, sessionIdHash } from '../../../server/auth/session.ts';
import { resetSaltMemo } from '../../../server/auth/salt.ts';
import { handleAdmin } from '../../../server/handlers/admin/index.ts';
import { createTestDb, resetTables } from '../http/harness.ts';
import type { TestDb } from '../http/harness.ts';
import { TEST_PASSWORD, cookiePair, errorCode, makeDeps, passwordEnv, req } from '../http/fixtures.ts';
import type { Env } from '../../../server/env.ts';

let t: TestDb;
let env: Env;
let clock: Date;
const deps = () => makeDeps({ env, now: () => clock });
const call = (r: Request) => handleAdmin(r, deps());
const login = (password = TEST_PASSWORD, ip = '203.0.113.9', headers: Record<string, string> = {}) =>
  call(req('POST', '/api/admin/session', { body: { password }, ip, headers }));

beforeAll(async () => {
  t = await createTestDb();
  env = await passwordEnv(t.db);
});
afterAll(async () => t.dispose());
beforeEach(async () => {
  await resetTables(t.db);
  resetSaltMemo();
  clock = new Date('2026-10-24T08:00:00.000Z');
});

describe('session cookie parsing', () => {
  const tok = 'A'.repeat(43);
  it('reads exactly one well-formed __Host- cookie', () => {
    expect(readSessionToken(`a=b; ${SESSION_COOKIE}=${tok}; c=d`)).toBe(tok);
    expect(readSessionToken(null)).toBeNull();
    expect(readSessionToken(`${SESSION_COOKIE}=short`)).toBeNull();
    expect(readSessionToken(`${SESSION_COOKIE}=${tok}; ${SESSION_COOKIE}=${tok}`)).toBeNull(); // cookie tossing
    expect(readSessionToken(`atlas_session=${tok}`)).toBeNull(); // prefix required
  });
});

describe('password-mode session lifecycle', () => {
  it('login sets a hardened __Host- cookie and stores only the password-bound HMAC of the token', async () => {
    const res = await login();
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('Set-Cookie')!;
    expect(setCookie).toMatch(/^__Host-atlas_session=[A-Za-z0-9_-]{43}; /);
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=28800']) {
      expect(setCookie).toContain(attr);
    }
    expect(setCookie).not.toMatch(/Domain=/i);
    const body = (await res.json()) as { actor: string; csrfToken: string; expiresAt: string };
    expect(body.actor).toBe('owner');
    expect(body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.expiresAt).toBe('2026-10-24T16:00:00.000Z');
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    const token = cookiePair(setCookie).split('=')[1]!;
    const rows = await t.db.prepare('SELECT id_hash, csrf_token FROM sessions').all<{ id_hash: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]!.id_hash).toBe(
      await sessionIdHash(sessionBinding(parsePasswordHash(env.OWNER_PASSWORD_HASH)!), token),
    );
    expect(JSON.stringify(rows.results)).not.toContain(token);
  });

  it('GET /session returns the actor and csrf token; logout deletes the row and expires the cookie', async () => {
    const res = await login();
    const { csrfToken } = (await res.json()) as { csrfToken: string };
    const cookie = cookiePair(res.headers.get('Set-Cookie'));

    const who = await call(req('GET', '/api/admin/session', { cookie }));
    expect(who.status).toBe(200);
    expect(await who.json()).toMatchObject({ actor: 'owner', mode: 'password', csrfToken });

    const noCsrf = await call(req('DELETE', '/api/admin/session', { cookie }));
    expect(noCsrf.status).toBe(403);
    expect(await errorCode(noCsrf)).toBe('csrf');
    expect(await t.count('sessions')).toBe(1);

    const out = await call(req('DELETE', '/api/admin/session', { cookie, csrf: csrfToken }));
    expect(out.status).toBe(200);
    expect(out.headers.get('Set-Cookie')).toMatch(/^__Host-atlas_session=; .*Max-Age=0/);
    expect(await t.count('sessions')).toBe(0);

    const replay = await call(req('GET', '/api/admin/session', { cookie }));
    expect(replay.status).toBe(401);
  });

  it('enforces the absolute 8 h expiry and purges expired rows on the next login', async () => {
    const res = await login();
    const cookie = cookiePair(res.headers.get('Set-Cookie'));
    clock = new Date('2026-10-24T15:59:59.000Z');
    expect((await call(req('GET', '/api/admin/session', { cookie }))).status).toBe(200);
    clock = new Date('2026-10-24T16:00:00.000Z');
    expect((await call(req('GET', '/api/admin/session', { cookie }))).status).toBe(401);
    await login(TEST_PASSWORD, '203.0.113.10');
    expect(await t.count('sessions')).toBe(1); // the expired one was purged
  });

  it('a session token for one session cannot be paired with another session’s CSRF token', async () => {
    const a = await login();
    const b = await login(TEST_PASSWORD, '203.0.113.11');
    const cookieA = cookiePair(a.headers.get('Set-Cookie'));
    const { csrfToken: csrfB } = (await b.json()) as { csrfToken: string };
    const r = await call(req('DELETE', '/api/admin/session', { cookie: cookieA, csrf: csrfB }));
    expect(r.status).toBe(403);
    expect(await t.count('sessions')).toBe(2);
  });

  it('rejects a wrong password with 401 and creates no session', async () => {
    const res = await login('not the right password');
    expect(res.status).toBe(401);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(await t.count('sessions')).toBe(0);
  });

  it('a forged cookie value is rejected', async () => {
    const r = await call(req('GET', '/api/admin/session', { cookie: `${SESSION_COOKIE}=${'B'.repeat(43)}` }));
    expect(r.status).toBe(401);
  });

  it('login requires a same-origin Origin header', async () => {
    const noOrigin = await call(
      req('POST', '/api/admin/session', { body: { password: TEST_PASSWORD }, origin: null }),
    );
    expect(noOrigin.status).toBe(403);
    const foreign = await call(
      req('POST', '/api/admin/session', { body: { password: TEST_PASSWORD }, origin: 'https://evil.test' }),
    );
    expect(foreign.status).toBe(403);
    expect(await t.count('sessions')).toBe(0);
  });

  it('rate-limits login to 5 attempts / 15 min per client; spoofed X-Forwarded-For does not help', async () => {
    for (let i = 0; i < 5; i++) expect((await login('wrong password!!')).status).toBe(401);
    const blocked = await login(TEST_PASSWORD); // even the right password is refused now
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    const body = (await blocked.json()) as { error: { code: string; retryAfterS: number } };
    expect(body.error.code).toBe('rate-limited');
    expect(body.error.retryAfterS).toBe(Number(blocked.headers.get('Retry-After')));

    const spoofed = await login(TEST_PASSWORD, '203.0.113.9', {
      'X-Forwarded-For': '198.51.100.1',
      'X-Real-IP': '198.51.100.2',
      'True-Client-IP': '198.51.100.3',
    });
    expect(spoofed.status).toBe(429);
    expect(await t.count('sessions')).toBe(0);

    expect((await login(TEST_PASSWORD, '198.51.100.77')).status).toBe(200); // a different client is unaffected

    clock = new Date(clock.getTime() + 15 * 60 * 1000 + 1000);
    expect((await login(TEST_PASSWORD)).status).toBe(200); // window elapsed

    const buckets = await t.db.prepare('SELECT * FROM rate_limits').all();
    const dump = JSON.stringify(buckets.results);
    expect(dump).not.toContain('203.0.113.9');
    expect(dump).not.toContain('198.51.100');
  });

  it('in Access mode there is no password login (404)', async () => {
    const accessEnv: Env = {
      DB: t.db,
      AUTH_MODE: 'access',
      ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com',
      ACCESS_AUD: 'aud',
      OWNER_EMAILS: 'owner@example.org',
    };
    const r = await handleAdmin(
      req('POST', '/api/admin/session', { body: { password: TEST_PASSWORD } }),
      makeDeps({ env: accessEnv }),
    );
    expect(r.status).toBe(404);
    expect(await t.count('sessions')).toBe(0);
  });
});
