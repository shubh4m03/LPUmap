/**
 * Fixed-window rate limiting in D1. `bucket` must already be an opaque key
 * (HMAC of client + scope + window, computed by the caller) — raw IPs are
 * never passed here or stored. Expired rows are purged on every hit, which
 * also restarts an expired bucket's window.
 */
import type { SqlDatabase } from './types.ts';
import { stmt } from './sql.ts';

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  /** Seconds until the window resets (0 when allowed). */
  retryAfterS: number;
}

export async function hit(
  db: SqlDatabase,
  bucket: string,
  limit: number,
  windowS: number,
  now: Date,
): Promise<RateLimitResult> {
  const nowIso = now.toISOString();
  const expiresIso = new Date(now.getTime() + windowS * 1000).toISOString();
  const [, upsert] = await db.batch<{ count: number; expires_at: string }>([
    stmt(db, 'DELETE FROM rate_limits WHERE expires_at <= ?', nowIso),
    stmt(
      db,
      `INSERT INTO rate_limits (bucket, count, window_start, expires_at) VALUES (?, 1, ?, ?)
       ON CONFLICT (bucket) DO UPDATE SET count = count + 1
       RETURNING count, expires_at`,
      bucket,
      nowIso,
      expiresIso,
    ),
  ]);
  const row = upsert?.results[0];
  const count = Number(row?.count ?? Number.MAX_SAFE_INTEGER);
  const allowed = count <= limit;
  const resetMs = row ? Date.parse(String(row.expires_at)) - now.getTime() : windowS * 1000;
  return { allowed, count, retryAfterS: allowed ? 0 : Math.max(1, Math.ceil(resetMs / 1000)) };
}

export async function purgeExpiredRateLimits(db: SqlDatabase, now: Date): Promise<number> {
  const r = await stmt(db, 'DELETE FROM rate_limits WHERE expires_at <= ?', now.toISOString()).run();
  return r.meta.changes ?? 0;
}
