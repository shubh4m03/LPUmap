import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetJwksCache } from '../../../server/auth/access.ts';
import { resetSaltMemo } from '../../../server/auth/salt.ts';
import type { Env } from '../../../server/env.ts';
import { handleAdmin } from '../../../server/handlers/admin/index.ts';
import { handleContribution } from '../../../server/handlers/contributions.ts';
import { handlePublication } from '../../../server/handlers/publication.ts';
import { realServices } from '../../../server/handlers/repos.ts';
import { scrubText } from '../../../server/http/log.ts';
import { accessEnvVars, claims, jwksFetch, makeKey, sign } from '../auth/jwt-fixtures.ts';
import { TEST_PASSWORD, cookiePair, makeDeps, passwordEnv, req, validSuggestion } from './fixtures.ts';
import { createTestDb, resetTables } from './harness.ts';
import type { TestDb } from './harness.ts';

const IP = '198.51.100.123';
const IPV6 = '2001:db8:85a3::8a2e:370:7334';
const COORD: [number, number] = [75.70491, 31.25362];

let t: TestDb;
let env: Env;
let lines: string[];

beforeAll(async () => {
  t = await createTestDb();
  env = await passwordEnv(t.db);
});
afterAll(async () => t.dispose());
beforeEach(async () => {
  await resetTables(t.db);
  resetSaltMemo();
  resetJwksCache();
  lines = [];
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
  }
});

describe('structured logs never contain secrets, cookies, tokens, IPs or coordinates', () => {
  it('across login, session use, CSRF failure, logout and public submissions', async () => {
    const deps = makeDeps({ env });
    const secrets: string[] = [TEST_PASSWORD, IP, IPV6, String(COORD[0]), String(COORD[1])];

    const bad = await handleAdmin(
      req('POST', '/api/admin/session', { body: { password: 'wrong-password-123' }, ip: IP }),
      deps,
    );
    expect(bad.status).toBe(401);
    secrets.push('wrong-password-123');

    const ok = await handleAdmin(
      req('POST', '/api/admin/session', { body: { password: TEST_PASSWORD }, ip: IPV6 }),
      deps,
    );
    const cookie = cookiePair(ok.headers.get('Set-Cookie'));
    const { csrfToken } = (await ok.json()) as { csrfToken: string };
    secrets.push(cookie.split('=')[1]!, csrfToken);

    await handleAdmin(req('GET', '/api/admin/session', { cookie, ip: IP }), deps);
    await handleAdmin(
      req('DELETE', '/api/admin/session', { cookie, csrf: 'forged-token-value-xyz', ip: IP }),
      deps,
    );
    secrets.push('forged-token-value-xyz');
    await handleAdmin(req('DELETE', '/api/admin/session', { cookie, csrf: csrfToken, ip: IP }), deps);

    const sub = await handleContribution(
      req('POST', '/api/contributions/locations', {
        body: validSuggestion({ location: COORD, details: 'phone 9876543210, ask for Ravi' }),
        ip: IP,
      }),
      deps,
    );
    expect(sub.status).toBe(201);
    secrets.push('9876543210', 'Ravi');
    await handleContribution(
      req('POST', '/api/contributions/locations', {
        body: validSuggestion({ location: [10.123456, 10.654321] }),
        ip: IP,
      }),
      deps,
    );
    secrets.push('10.123456', '10.654321');

    expect(lines.length).toBeGreaterThanOrEqual(7);
    const all = lines.join('\n');
    for (const s of secrets) expect(all).not.toContain(s);
    expect(all).not.toMatch(/__Host-atlas_session|Cookie|Set-Cookie|X-CSRF/i);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('Access JWTs and emails are not logged', async () => {
    const key = await makeKey('k1');
    const now = new Date();
    const jwt = await sign(key, claims(now));
    const deps = makeDeps({ env: { DB: t.db, ...accessEnvVars }, fetch: jwksFetch([key]) });
    await handleAdmin(
      req('GET', '/api/admin/session', { headers: { 'Cf-Access-Jwt-Assertion': jwt }, ip: IP }),
      deps,
    );
    const denied = await sign(key, claims(now, { email: 'student@example.org' }));
    await handleAdmin(
      req('GET', '/api/admin/session', { headers: { 'Cf-Access-Jwt-Assertion': denied } }),
      deps,
    );
    const all = lines.join('\n');
    expect(all).not.toContain(jwt.split('.')[1]!);
    expect(all).not.toMatch(/example\.org/i);
    expect(all).not.toContain(IP);
  });

  it('unexpected errors → 500 "internal" without stack or message; the log line is scrubbed', async () => {
    const leaky = new Error(
      `D1_ERROR near SELECT * FROM sessions WHERE ip='${IP}' at ${COORD.join(',')} owner@example.org`,
    );
    const deps = makeDeps({
      env,
      services: { domain: { ...realServices.domain, getPublication: () => Promise.reject(leaky) } },
    });
    const res = await handlePublication(req('GET', '/api/locations'), deps);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: { code: 'internal', message: 'Internal error' } });
    expect(text).not.toMatch(/D1_ERROR|SELECT|at .*\.ts|stack/);
    const all = lines.join('\n');
    expect(all).toContain('unhandled-error');
    expect(all).not.toContain(IP);
    expect(all).not.toContain('75.70491');
    expect(all).not.toContain('owner@example.org');
  });

  it('scrubText removes emails, IPv4/IPv6 addresses, long tokens and numbers', () => {
    const out = scrubText(`a@b.co ${IP} ${IPV6} ${'Z'.repeat(30)} 75.7049`);
    expect(out).not.toMatch(/a@b|198|2001|ZZZZ|75/);
  });
});
