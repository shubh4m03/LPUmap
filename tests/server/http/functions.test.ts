/** The Pages Functions files are thin adapters: they route to handlers and never leak internals. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest as adminFn } from '../../../functions/api/admin/[[path]].ts';
import { onRequest as contributionFn } from '../../../functions/api/contributions/locations.ts';
import { onRequest as healthFn } from '../../../functions/api/health.ts';
import { onRequest as locationsFn } from '../../../functions/api/locations.ts';
import type { SqlDatabase } from '../../../server/db/types.ts';
import { resetSaltMemo } from '../../../server/auth/salt.ts';
import { TEST_PASSWORD, errorCode, passwordEnv, req, validSuggestion } from './fixtures.ts';
import { createTestDb, resetTables } from './harness.ts';
import type { TestDb } from './harness.ts';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => t.dispose());
beforeEach(async () => {
  await resetTables(t.db);
  resetSaltMemo();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

const exploding: SqlDatabase = {
  prepare() {
    throw new Error('SQLITE_CORRUPT: secret internals /var/db/atlas.sqlite');
  },
  batch: () => Promise.reject(new Error('boom')),
  exec: () => Promise.reject(new Error('boom')),
};

describe('functions/api/**', () => {
  it('health reports configuration state without values', async () => {
    const res = await healthFn({ request: req('GET', '/api/health'), env: await passwordEnv(t.db) });
    expect(await res.json()).toEqual({ ok: true, db: 'ok', auth: 'password' });
    const bare = await healthFn({ request: req('GET', '/api/health'), env: { AUTH_MODE: 'access' } });
    expect(await bare.json()).toEqual({ ok: false, db: 'unavailable', auth: 'not-configured' });
    const broken = await healthFn({ request: req('GET', '/api/health'), env: { DB: exploding } });
    expect(await broken.json()).toEqual({ ok: false, db: 'unavailable', auth: 'not-configured' });
  });

  it('locations: database failure → 500 internal, no internals leaked', async () => {
    const res = await locationsFn({ request: req('GET', '/api/locations'), env: { DB: exploding } });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toMatch(/SQLITE|sqlite|secret/);
    expect(JSON.parse(text).error.code).toBe('internal');
  });

  it('locations: works with a real DB', async () => {
    const res = await locationsFn({ request: req('GET', '/api/locations'), env: { DB: t.db } });
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toMatch(/^W\/"pub-v\d+-\d+"$/);
  });

  it('contributions: submits through the adapter and stores pending', async () => {
    const env = await passwordEnv(t.db);
    const res = await contributionFn({
      request: req('POST', '/api/contributions/locations', { body: validSuggestion(), ip: '192.0.2.1' }),
      env,
    });
    expect(res.status).toBe(201);
    const row = await t.db.prepare('SELECT status FROM suggestions').first<{ status: string }>();
    expect(row?.status).toBe('pending');
    const noEnv = await contributionFn({
      request: req('POST', '/api/contributions/locations', { body: validSuggestion() }),
      env: {},
    });
    expect(noEnv.status).toBe(503);
  });

  it('admin catch-all: fail closed without config, 401 without auth, login works with config', async () => {
    const r1 = await adminFn({ request: req('GET', '/api/admin/overview'), env: { DB: t.db } });
    expect(r1.status).toBe(503);
    expect(await errorCode(r1)).toBe('not-configured');
    const env = await passwordEnv(t.db);
    expect((await adminFn({ request: req('GET', '/api/admin/overview'), env })).status).toBe(401);
    const login = await adminFn({
      request: req('POST', '/api/admin/session', { body: { password: TEST_PASSWORD } }),
      env,
    });
    expect(login.status).toBe(200);
  });
});
