/**
 * Pages Functions environment and its validation. Validation fails closed:
 * an unknown AUTH_MODE or incomplete auth settings yield `auth.mode =
 * 'not-configured'` (every admin endpoint → 503). Error and log messages
 * name the missing setting but never echo a value.
 */
import type { SqlDatabase } from './db/types.ts';
import type { AccessConfig } from './auth/access.ts';
import { parsePasswordHash } from './auth/password.ts';
import type { PasswordHash } from './auth/password.ts';

export interface AssetFetcher {
  fetch(input: Request | string): Promise<Response>;
}

export interface Env {
  DB?: SqlDatabase;
  ASSETS?: AssetFetcher;
  AUTH_MODE?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  OWNER_EMAILS?: string;
  OWNER_PASSWORD_HASH?: string;
  RATE_LIMIT_KEY?: string;
  PUBLIC_ORIGIN?: string;
}

export type AuthConfig =
  | { mode: 'access'; access: AccessConfig }
  | { mode: 'password'; passwordHash: PasswordHash }
  | { mode: 'not-configured'; problems: string[] };

export interface ParsedEnv {
  db: SqlDatabase | null;
  assets: AssetFetcher | null;
  auth: AuthConfig;
  /** HMAC key for rate-limit buckets; null → daily-rotated salt from D1 `meta`. */
  rateLimitKey: string | null;
  /** Extra allowed Origin (e.g. the production custom domain); null when unset/invalid. */
  publicOrigin: string | null;
  /** Names of settings that were present but ignored as invalid (no values). */
  warnings: string[];
}

export const MIN_RATE_LIMIT_KEY_LENGTH = 32;
const EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function parseHttpsOrigin(v: string | null): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return null;
    if (u.pathname !== '/' && u.pathname !== '') return null;
    return u.origin;
  } catch {
    return null;
  }
}

function parseOrigin(v: string | null): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === 'localhost')) return null;
    if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash || u.username) return null;
    return u.origin;
  } catch {
    return null;
  }
}

function parseAuth(env: Env): AuthConfig {
  const mode = str(env.AUTH_MODE);
  if (mode === 'access') {
    const problems: string[] = [];
    const teamDomain = parseHttpsOrigin(str(env.ACCESS_TEAM_DOMAIN));
    if (!teamDomain) problems.push('ACCESS_TEAM_DOMAIN');
    const aud = str(env.ACCESS_AUD);
    if (!aud) problems.push('ACCESS_AUD');
    const emails = (str(env.OWNER_EMAILS) ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e !== '');
    if (emails.length === 0 || emails.some((e) => !EMAIL_RE.test(e))) problems.push('OWNER_EMAILS');
    if (problems.length > 0 || !teamDomain || !aud) return { mode: 'not-configured', problems };
    return { mode: 'access', access: { teamDomain, aud, ownerEmails: new Set(emails) } };
  }
  if (mode === 'password') {
    const passwordHash = parsePasswordHash(str(env.OWNER_PASSWORD_HASH));
    if (!passwordHash) return { mode: 'not-configured', problems: ['OWNER_PASSWORD_HASH'] };
    return { mode: 'password', passwordHash };
  }
  return { mode: 'not-configured', problems: ['AUTH_MODE'] };
}

function isDb(v: unknown): v is SqlDatabase {
  return (
    v !== null &&
    typeof v === 'object' &&
    typeof (v as { prepare?: unknown }).prepare === 'function' &&
    typeof (v as { batch?: unknown }).batch === 'function'
  );
}

function isAssets(v: unknown): v is AssetFetcher {
  return v !== null && typeof v === 'object' && typeof (v as { fetch?: unknown }).fetch === 'function';
}

export function parseEnv(env: Env | undefined | null): ParsedEnv {
  const e: Env = env ?? {};
  const warnings: string[] = [];
  const rawKey = str(e.RATE_LIMIT_KEY);
  let rateLimitKey: string | null = null;
  if (rawKey !== null) {
    if (rawKey.length >= MIN_RATE_LIMIT_KEY_LENGTH) rateLimitKey = rawKey;
    else warnings.push('RATE_LIMIT_KEY');
  }
  const rawOrigin = str(e.PUBLIC_ORIGIN);
  const publicOrigin = parseOrigin(rawOrigin);
  if (rawOrigin !== null && publicOrigin === null) warnings.push('PUBLIC_ORIGIN');
  return {
    db: isDb(e.DB) ? e.DB : null,
    assets: isAssets(e.ASSETS) ? e.ASSETS : null,
    auth: parseAuth(e),
    rateLimitKey,
    publicOrigin,
    warnings,
  };
}
