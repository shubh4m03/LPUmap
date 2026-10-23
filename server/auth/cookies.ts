/** Session cookie handling. `__Host-` prefix forces Secure, Path=/ and no Domain. */
import { APP_CONFIG } from '../../src/config/index.ts';

export const SESSION_COOKIE = '__Host-atlas_session';
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function sessionMaxAgeS(): number {
  return APP_CONFIG.contributions.sessionHours * 3600;
}

export function sessionCookie(token: string, maxAgeS: number = sessionMaxAgeS()): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(maxAgeS))}`;
}

export function expiredSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

/** Reads the session token from a Cookie header; null unless exactly one well-formed value exists. */
export function readSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  let found: string | null = null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    if (found !== null) return null;
    found = value;
  }
  return found !== null && TOKEN_RE.test(found) ? found : null;
}
