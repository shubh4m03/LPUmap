/**
 * Shared helpers for the red-team suites: one local D1, password- and
 * Access-mode deps, and small request shortcuts.
 */
import { handleAdmin } from '../../../server/handlers/admin/index.ts';
import { handleContribution } from '../../../server/handlers/contributions.ts';
import { handlePublication } from '../../../server/handlers/publication.ts';
import type { Env } from '../../../server/env.ts';
import type { HandlerDeps } from '../../../server/handlers/deps.ts';
import { accessEnvVars, claims, jwksFetch, makeKey, sign } from '../auth/jwt-fixtures.ts';
import type { TestKey } from '../auth/jwt-fixtures.ts';
import {
  RATE_KEY,
  TEST_PASSWORD,
  cookiePair,
  fileAssets,
  makeDeps,
  passwordEnv,
  req,
} from '../http/fixtures.ts';
import type { ReqOptions } from '../http/fixtures.ts';
import type { TestDb } from '../http/harness.ts';

export const NOW = new Date('2026-10-24T09:00:00.000Z');

export interface Kit {
  t: TestDb;
  key: TestKey;
  pwEnv: Env;
  accessEnv: Env;
}

export async function makeKit(t: TestDb): Promise<Kit> {
  return {
    t,
    key: await makeKey('k1'),
    pwEnv: await passwordEnv(t.db),
    accessEnv: { DB: t.db, ASSETS: fileAssets, RATE_LIMIT_KEY: RATE_KEY, ...accessEnvVars },
  };
}

export const pwDeps = (k: Kit, extra: Partial<Env> = {}, now: () => Date = () => NOW): HandlerDeps =>
  makeDeps({ env: { ...k.pwEnv, ...extra }, now });

export const accessDeps = (k: Kit, extra: Partial<Env> = {}): HandlerDeps =>
  makeDeps({ env: { ...k.accessEnv, ...extra }, now: () => NOW, fetch: jwksFetch([k.key]) });

export const ownerJwt = (k: Kit, over: Record<string, unknown> = {}) => sign(k.key, claims(NOW, over));

/** Owner request in Access mode. */
export async function asOwner(k: Kit, method: string, path: string, o: ReqOptions = {}): Promise<Response> {
  const headers = { 'Cf-Access-Jwt-Assertion': await ownerJwt(k), ...(o.headers ?? {}) };
  return handleAdmin(req(method, `/api/admin${path}`, { ...o, headers }), accessDeps(k));
}

export interface PwSession {
  cookie: string;
  csrf: string;
}

export async function pwLogin(k: Kit, deps: HandlerDeps = pwDeps(k), ip = '203.0.113.7'): Promise<PwSession> {
  const res = await handleAdmin(
    req('POST', '/api/admin/session', { body: { password: TEST_PASSWORD }, ip }),
    deps,
  );
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  const body = (await res.json()) as { csrfToken: string };
  return { cookie: cookiePair(res.headers.get('Set-Cookie')), csrf: body.csrfToken };
}

export const submit = (k: Kit, o: ReqOptions) =>
  handleContribution(req('POST', '/api/contributions/locations', o), pwDeps(k));

export const publication = (k: Kit) => handlePublication(req('GET', '/api/locations'), pwDeps(k));

export async function publicationVersion(k: Kit): Promise<number> {
  return ((await (await publication(k)).json()) as { publicationVersion: number }).publicationVersion;
}
