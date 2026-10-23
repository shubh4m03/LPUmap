/**
 * Privacy-preserving rate limiting. A bucket id is
 * HMAC-SHA256(key, scope | client | windowIndex) where the key is the
 * RATE_LIMIT_KEY secret or, without one, a salt rotated daily in D1. The
 * client is CF-Connecting-IP (set by Cloudflare's edge, not spoofable by the
 * caller) — X-Forwarded-For and similar headers are ignored. IPv6 clients are
 * keyed by their /64 so address rotation inside one subscriber prefix does not
 * reset the limit. Raw IPs are
 * never stored or logged; only the HMAC reaches the database.
 */
import type { SqlDatabase } from '../db/types.ts';
import { HttpError } from '../http/errors.ts';
import { canonicalClient } from './client-ip.ts';
import { hmacSha256Hex } from './encoding.ts';
import type { RateLimitRepo, SaltRepo } from './ports.ts';

export interface RateRule {
  scope: string;
  limit: number;
  windowS: number;
  /** true → one bucket for everyone (global cap). */
  global?: boolean;
}

export interface RateLimitDeps {
  db: SqlDatabase;
  repo: RateLimitRepo;
  salts: SaltRepo;
  rateLimitKey: string | null;
  now: Date;
}

/** Canonical client key (IPv6 → its /64; see client-ip.ts). Never stored or logged raw. */
export function clientIdentifier(request: Request): string {
  const ip = request.headers.get('CF-Connecting-IP')?.trim();
  return ip && ip.length <= 64 ? canonicalClient(ip) : 'unknown';
}

export async function bucketFor(request: Request, rule: RateRule, deps: RateLimitDeps): Promise<string> {
  const windowIndex = Math.floor(deps.now.getTime() / 1000 / rule.windowS);
  const key = deps.rateLimitKey ?? (await deps.salts.dailySalt(deps.db, deps.now));
  const client = rule.global ? '*' : clientIdentifier(request);
  return `rl:${await hmacSha256Hex(key, `${rule.scope}|${client}|${rule.windowS}|${windowIndex}`)}`;
}

/**
 * Applies the rules in order and stops at the first exhausted one (so a
 * client already over its own limit does not also consume the global cap).
 * Throws 429 with Retry-After.
 */
export async function enforceRateLimits(
  request: Request,
  rules: readonly RateRule[],
  deps: RateLimitDeps,
): Promise<void> {
  for (const rule of rules) {
    const bucket = await bucketFor(request, rule, deps);
    const res = await deps.repo.hit(deps.db, bucket, rule.limit, rule.windowS, deps.now);
    if (!res.allowed) {
      throw new HttpError('rate-limited', 'Too many requests. Please try again later.', {
        retryAfterS: Math.max(1, Math.ceil(res.retryAfterS)),
      });
    }
  }
}
