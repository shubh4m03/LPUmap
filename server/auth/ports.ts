/**
 * Persistence ports the auth layer needs. The implementations live in the
 * data layer (server/db, server/domain) and are wired in
 * server/handlers/repos.ts, so auth logic stays testable and decoupled.
 */
import type { SqlDatabase } from '../db/types.ts';

export interface SessionRecord {
  /** HMAC-SHA256 (hex) of the random session token keyed by the password hash; the raw token exists only in the cookie. */
  idHash: string;
  actor: string;
  csrfToken: string;
  createdAt: string;
  expiresAt: string;
}

export interface SessionRepo {
  create(db: SqlDatabase, record: SessionRecord, now: Date): Promise<void>;
  /** Returns the session or null (unknown or expired). */
  get(db: SqlDatabase, idHash: string, now: Date): Promise<SessionRecord | null>;
  delete(db: SqlDatabase, idHash: string): Promise<void>;
  purgeExpired(db: SqlDatabase, now: Date): Promise<void>;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterS: number;
}

export interface RateLimitRepo {
  hit(db: SqlDatabase, bucket: string, limit: number, windowS: number, now: Date): Promise<RateLimitResult>;
}

export interface SaltRepo {
  /** Returns the rate-limit salt for the UTC day of `now`, rotating it when the day changed. */
  dailySalt(db: SqlDatabase, now: Date): Promise<string>;
}
