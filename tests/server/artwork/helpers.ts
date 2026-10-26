/**
 * Artwork-verification test kit: the REAL handlers over an isolated local D1
 * (wrangler getPlatformProxy, persist: false), the real base dataset
 * (public/data) and the real published artwork manifest
 * (public/isometric-art/manifest.json) served through a fake ASSETS binding,
 * password-mode sessions (cookie + CSRF) and Access-mode owner requests.
 * Never touches a remote or persisted database.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clearArtworkManifestCache } from '../../../server/artwork-manifest.ts';
import { resetJwksCache } from '../../../server/auth/access.ts';
import type { AssetFetcher, Env } from '../../../server/env.ts';
import { handleAdmin } from '../../../server/handlers/admin/index.ts';
import type { HandlerDeps } from '../../../server/handlers/deps.ts';
import { handlePublication } from '../../../server/handlers/publication.ts';
import { isometricArtManifestSchema, type IsometricArtManifest } from '../../../src/isometric-art/schema.ts';
import { accessEnvVars, claims, jwksFetch, makeKey, sign, type TestKey } from '../auth/jwt-fixtures.ts';
import {
  RATE_KEY,
  TEST_PASSWORD,
  cookiePair,
  fileAssets,
  makeDeps,
  passwordEnv,
  req,
  type ReqOptions,
} from '../http/fixtures.ts';
import { REPO_ROOT } from '../helpers/test-db.ts';

export const NOW = new Date('2026-10-24T09:00:00.000Z');
export const TODAY = '2026-10-24';
export const OWNER_EMAIL = 'owner@example.org';

export const MANIFEST_PATH = join(REPO_ROOT, 'public', 'isometric-art', 'manifest.json');
let manifestMemo: IsometricArtManifest | null = null;
/** The real published manifest (parsed, memoised; never written). */
export function realManifest(): IsometricArtManifest {
  manifestMemo ??= isometricArtManifestSchema.parse(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')));
  return manifestMemo;
}

/** fileAssets (/data/*) plus /isometric-art/manifest.json (what env.ASSETS serves in production). */
export const artAssets = (manifestBody: () => string | null = () => readFileSync(MANIFEST_PATH, 'utf8')) =>
  ({
    async fetch(input) {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.pathname === '/isometric-art/manifest.json') {
        const body = manifestBody();
        return body === null
          ? new Response('not found', { status: 404 })
          : new Response(body, { headers: { 'Content-Type': 'application/json' } });
      }
      return fileAssets.fetch(input);
    },
  }) satisfies AssetFetcher;

export interface ArtKit {
  db: Env['DB'];
  key: TestKey;
  pwEnv: Env;
  accessEnv: Env;
}

export async function makeArtKit(db: NonNullable<Env['DB']>): Promise<ArtKit> {
  clearArtworkManifestCache();
  // Each kit signs with a fresh key under the same kid: forget the JWKS cached for the previous one.
  resetJwksCache();
  return {
    db,
    key: await makeKey('k1'),
    pwEnv: { ...(await passwordEnv(db)), ASSETS: artAssets() },
    accessEnv: { DB: db, ASSETS: artAssets(), RATE_LIMIT_KEY: RATE_KEY, ...accessEnvVars },
  };
}

export const pwDeps = (k: ArtKit, extra: Partial<Env> = {}, now: () => Date = () => NOW): HandlerDeps =>
  makeDeps({ env: { ...k.pwEnv, ...extra }, now });

export const accessDeps = (k: ArtKit, extra: Partial<Env> = {}, now: () => Date = () => NOW): HandlerDeps =>
  makeDeps({ env: { ...k.accessEnv, ...extra }, now, fetch: jwksFetch([k.key]) });

/** Owner request in Access mode (no CSRF token in Access mode; Origin is still required on writes). */
export async function asOwner(
  k: ArtKit,
  method: string,
  path: string,
  o: ReqOptions = {},
  extra: Partial<Env> = {},
): Promise<Response> {
  const jwt = await sign(k.key, claims(NOW));
  const headers = { 'Cf-Access-Jwt-Assertion': jwt, ...(o.headers ?? {}) };
  return handleAdmin(req(method, `/api/admin${path}`, { ...o, headers }), accessDeps(k, extra));
}

export interface PwSession {
  cookie: string;
  csrf: string;
}

export async function pwLogin(k: ArtKit, ip = '203.0.113.7'): Promise<PwSession> {
  const res = await handleAdmin(
    req('POST', '/api/admin/session', { body: { password: TEST_PASSWORD }, ip }),
    pwDeps(k),
  );
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  const body = (await res.json()) as { csrfToken: string };
  return { cookie: cookiePair(res.headers.get('Set-Cookie')), csrf: body.csrfToken };
}

export const assocPath = (subjectId: string) => `/artwork/associations/${encodeURIComponent(subjectId)}`;

export async function publication(k: ArtKit) {
  const res = await handlePublication(req('GET', '/api/locations'), pwDeps(k));
  return { res, text: await res.clone().text(), body: (await res.json()) as Record<string, unknown> };
}

/** A real campus building of the base dataset that is a reviewed candidate of some subject. */
export function approximateBaseline() {
  const a = realManifest().associations.find((x) => x.status === 'approximate' && x.buildingId);
  if (!a?.buildingId) throw new Error('fixture: no approximate baseline');
  return a as typeof a & { buildingId: string };
}

export const siteSign = (over: Record<string, unknown> = {}) => ({
  kind: 'site-sign',
  description: 'Photo of the sign at the main entrance reading "Block 34".',
  date: '2026-10-20',
  ...over,
});

export const officialDoc = (over: Record<string, unknown> = {}) => ({
  kind: 'official-document',
  description: 'University campus directory, page 4.',
  url: 'https://www.lpu.in/example-directory.pdf',
  date: '2026-10-01',
  ...over,
});

export const ownerStatement = (over: Record<string, unknown> = {}) => ({
  kind: 'owner-statement',
  description: 'Owner confirmed on site visit.',
  date: '2026-10-22',
  ...over,
});

export const PRIVATE_NOTE = 'PRIVATE-ARTWORK-NOTE-4c1e never public';

export async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export async function auditRows(db: NonNullable<Env['DB']>, subjectId?: string) {
  const sql = subjectId
    ? "SELECT * FROM audit_events WHERE entity_type = 'artwork' AND entity_id = ? ORDER BY id"
    : "SELECT * FROM audit_events WHERE entity_type = 'artwork' ORDER BY id";
  const s = db.prepare(sql);
  return (await (subjectId ? s.bind(subjectId) : s).all<Record<string, unknown>>()).results;
}

export { TEST_PASSWORD, req, handleAdmin };
