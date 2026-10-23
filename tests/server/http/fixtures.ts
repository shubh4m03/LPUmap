/**
 * Shared fixtures for HTTP/auth tests: real base dataset (public/data) served
 * through a fake ASSETS binding, handler deps over a local D1, request builders.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../../../server/auth/password.ts';
import type { SqlDatabase } from '../../../server/db/types.ts';
import type { AssetFetcher, Env } from '../../../server/env.ts';
import type { HandlerDeps } from '../../../server/handlers/deps.ts';
import { realServices } from '../../../server/handlers/repos.ts';
import type { Services } from '../../../server/handlers/ports.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export const ORIGIN = 'https://atlas.test';
export const TEST_PASSWORD = 'correct horse battery staple';
export const RATE_KEY = 'k'.repeat(40);

/** Serves /data/<file> from public/data (what env.ASSETS does in production). */
export const fileAssets: AssetFetcher = {
  async fetch(input) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const m = /^\/data\/([a-z-]+\.(json|geojson))$/.exec(url.pathname);
    if (!m) return new Response('not found', { status: 404 });
    try {
      return new Response(readFileSync(join(root, 'public', 'data', m[1]!)), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  },
};

let hashMemo: Promise<string> | null = null;
export const testPasswordHash = (): Promise<string> => (hashMemo ??= hashPassword(TEST_PASSWORD));

export async function passwordEnv(db: SqlDatabase, extra: Partial<Env> = {}): Promise<Env> {
  return {
    DB: db,
    ASSETS: fileAssets,
    AUTH_MODE: 'password',
    OWNER_PASSWORD_HASH: await testPasswordHash(),
    RATE_LIMIT_KEY: RATE_KEY,
    ...extra,
  };
}

export interface DepsOptions {
  env: Env;
  now?: () => Date;
  fetch?: HandlerDeps['fetch'];
  services?: Partial<Services>;
}

export function makeDeps(o: DepsOptions): HandlerDeps {
  return {
    env: o.env,
    services: { ...realServices, ...o.services },
    ...(o.now ? { now: o.now } : {}),
    ...(o.fetch ? { fetch: o.fetch } : {}),
  };
}

export interface ReqOptions {
  body?: unknown;
  /** Raw body string (sent as-is). */
  raw?: string;
  headers?: Record<string, string>;
  /** Origin header; null omits it. Default: ORIGIN for mutating methods. */
  origin?: string | null;
  cookie?: string;
  csrf?: string;
  ip?: string;
}

export function req(method: string, path: string, o: ReqOptions = {}): Request {
  const headers = new Headers(o.headers);
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const origin = o.origin === undefined ? (mutating ? ORIGIN : null) : o.origin;
  if (origin !== null) headers.set('Origin', origin);
  if (o.cookie) headers.set('Cookie', o.cookie);
  if (o.csrf) headers.set('X-CSRF-Token', o.csrf);
  if (o.ip) headers.set('CF-Connecting-IP', o.ip);
  let body: string | undefined;
  if (o.raw !== undefined) body = o.raw;
  else if (o.body !== undefined) body = JSON.stringify(o.body);
  if (body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return new Request(`${ORIGIN}${path}`, { method, headers, ...(body !== undefined ? { body } : {}) });
}

export async function errorCode(res: Response): Promise<string | undefined> {
  const body = (await res.clone().json()) as { error?: { code?: string } };
  return body.error?.code;
}

/** Extracts `name=value` from a Set-Cookie header. */
export function cookiePair(setCookie: string | null): string {
  if (!setCookie) throw new Error('no Set-Cookie');
  return setCookie.split(';')[0]!;
}

/** Counts every SQL statement prepared through the wrapped database. */
export function countingDb(db: SqlDatabase): { db: SqlDatabase; prepared: string[] } {
  const prepared: string[] = [];
  return {
    prepared,
    db: {
      prepare(sql) {
        prepared.push(sql);
        return db.prepare(sql);
      },
      batch: (s) => db.batch(s),
      exec: (sql) => {
        prepared.push(sql);
        return db.exec(sql);
      },
    },
  };
}

/** A point well inside the campus (and inside APP_CONFIG.map.maxBounds). */
export const ON_CAMPUS: [number, number] = [75.7049, 31.2536];

export const validSuggestion = (over: Record<string, unknown> = {}) => ({
  name: 'Quiet Study Corner',
  categoryId: 'library',
  location: ON_CAMPUS,
  description: 'Small reading room on the ground floor.',
  ...over,
});
