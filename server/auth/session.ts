/**
 * Password-mode sessions: a random 32-byte token in the cookie, a per-session
 * CSRF token, absolute expiry (APP_CONFIG.contributions.sessionHours),
 * opportunistic purge on login.
 *
 * The stored id is HMAC-SHA256(key = configured password hash, token), never
 * the token itself. Keying by the password hash binds every session to the
 * credential that created it: rotating OWNER_PASSWORD_HASH (e.g. after a
 * suspected compromise) revokes all existing sessions at once.
 */
import type { SqlDatabase } from '../db/types.ts';
import { HttpError } from '../http/errors.ts';
import { readSessionToken, sessionMaxAgeS } from './cookies.ts';
import { bytesToB64, hmacSha256Hex, randomToken, timingSafeEqualStr } from './encoding.ts';
import type { PasswordHash } from './password.ts';
import type { SessionRecord, SessionRepo } from './ports.ts';

export const PASSWORD_ACTOR = 'owner';

/** Session-binding key derived from the configured password hash (salt + derived key). */
export function sessionBinding(hash: PasswordHash): string {
  return `atlas-session-v1$${hash.iterations}$${bytesToB64(hash.salt)}$${bytesToB64(new Uint8Array(hash.hash))}`;
}

/** Stored session id for `token` under `binding`. */
export function sessionIdHash(binding: string, token: string): Promise<string> {
  return hmacSha256Hex(binding, token);
}

export interface NewSession {
  token: string;
  record: SessionRecord;
}

export async function startSession(
  db: SqlDatabase,
  repo: SessionRepo,
  now: Date,
  binding: string,
): Promise<NewSession> {
  await repo.purgeExpired(db, now);
  const token = randomToken(32);
  const record: SessionRecord = {
    idHash: await sessionIdHash(binding, token),
    actor: PASSWORD_ACTOR,
    csrfToken: randomToken(32),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + sessionMaxAgeS() * 1000).toISOString(),
  };
  await repo.create(db, record, now);
  return { token, record };
}

/** Looks up the session named by the request cookie; null when absent, unknown or expired. */
export async function findSession(
  request: Request,
  db: SqlDatabase,
  repo: SessionRepo,
  now: Date,
  binding: string,
): Promise<SessionRecord | null> {
  const token = readSessionToken(request.headers.get('Cookie'));
  if (!token) return null;
  const record = await repo.get(db, await sessionIdHash(binding, token), now);
  if (!record) return null;
  // Defence in depth: never trust a repo row past its absolute expiry.
  if (!(Date.parse(record.expiresAt) > now.getTime())) return null;
  return record;
}

export async function endSession(
  db: SqlDatabase,
  repo: SessionRepo,
  record: { idHash: string },
): Promise<void> {
  await repo.delete(db, record.idHash);
}

/** Requires `X-CSRF-Token` equal to the session's token (constant-time). */
export function checkCsrf(request: Request, record: { csrfToken: string }): void {
  const sent = request.headers.get('X-CSRF-Token');
  if (!sent || !timingSafeEqualStr(sent, record.csrfToken)) {
    throw new HttpError('csrf', 'Missing or invalid CSRF token');
  }
}
