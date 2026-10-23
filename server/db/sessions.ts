/**
 * Owner session repository (password mode). Only a keyed HMAC of the
 * session token is stored; the raw token lives solely in the HttpOnly cookie.
 * Expiry is absolute: an expired row is never returned and is purged.
 */
import type { SqlDatabase } from './types.ts';
import { stmt } from './sql.ts';

export interface SessionRecord {
  idHash: string;
  actor: string;
  csrfToken: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
}

export interface NewSession {
  idHash: string;
  actor: string;
  csrfToken: string;
  now: Date;
  expiresAt: Date;
}

export async function createSession(db: SqlDatabase, s: NewSession): Promise<SessionRecord> {
  const now = s.now.toISOString();
  const rec: SessionRecord = {
    idHash: s.idHash,
    actor: s.actor,
    csrfToken: s.csrfToken,
    createdAt: now,
    expiresAt: s.expiresAt.toISOString(),
    lastSeenAt: now,
  };
  await stmt(
    db,
    'INSERT INTO sessions (id_hash, actor, csrf_token, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)',
    rec.idHash,
    rec.actor,
    rec.csrfToken,
    rec.createdAt,
    rec.expiresAt,
    rec.lastSeenAt,
  ).run();
  return rec;
}

/** Returns the live session for this token hash, or null when missing/expired. */
export async function getSession(db: SqlDatabase, idHash: string, now: Date): Promise<SessionRecord | null> {
  const row = await stmt(
    db,
    'SELECT id_hash, actor, csrf_token, created_at, expires_at, last_seen_at FROM sessions WHERE id_hash = ? AND expires_at > ?',
    idHash,
    now.toISOString(),
  ).first<Record<string, string>>();
  if (!row) return null;
  return {
    idHash: String(row.id_hash),
    actor: String(row.actor),
    csrfToken: String(row.csrf_token),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    lastSeenAt: String(row.last_seen_at),
  };
}

export async function touchSession(db: SqlDatabase, idHash: string, now: Date): Promise<void> {
  await stmt(db, 'UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?', now.toISOString(), idHash).run();
}

export async function deleteSession(db: SqlDatabase, idHash: string): Promise<boolean> {
  const r = await stmt(db, 'DELETE FROM sessions WHERE id_hash = ?', idHash).run();
  return (r.meta.changes ?? 0) > 0;
}

export async function purgeExpiredSessions(db: SqlDatabase, now: Date): Promise<number> {
  const r = await stmt(db, 'DELETE FROM sessions WHERE expires_at <= ?', now.toISOString()).run();
  return r.meta.changes ?? 0;
}
