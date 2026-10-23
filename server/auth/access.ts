/**
 * Cloudflare Access JWT verification (`Cf-Access-Jwt-Assertion` header).
 * RS256 only, keys from `<team domain>/cdn-cgi/access/certs` (cached ≤ 1 h),
 * checks aud, iss, exp, nbf, iat with ≤ 60 s skew, then that the email is an
 * allowlisted owner. The CF_Authorization cookie alone is never trusted.
 */
import { HttpError } from '../http/errors.ts';
import { b64urlToBytes, utf8 } from './encoding.ts';

export interface AccessConfig {
  /** Normalised origin, e.g. https://team.cloudflareaccess.com (no trailing slash). */
  teamDomain: string;
  aud: string;
  /** Lower-cased owner emails. */
  ownerEmails: ReadonlySet<string>;
}

export type FetchLike = (url: string) => Promise<Response>;

export const CLOCK_SKEW_S = 60;
export const JWKS_TTL_MS = 60 * 60 * 1000;
/** Minimum gap between refetches triggered by an unknown `kid` (prevents fetch amplification). */
const UNKNOWN_KID_REFETCH_MS = 30 * 1000;
const MAX_TOKEN_LENGTH = 16 * 1024;

interface CacheEntry {
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

export function resetJwksCache(): void {
  cache.clear();
}

const unauthenticated = (msg = 'Invalid access token') => new HttpError('unauthenticated', msg);

interface Jwk {
  kty?: unknown;
  kid?: unknown;
  n?: unknown;
  e?: unknown;
  alg?: unknown;
  use?: unknown;
}

async function fetchKeys(teamDomain: string, fetchImpl: FetchLike): Promise<Map<string, CryptoKey>> {
  let res: Response;
  try {
    res = await fetchImpl(`${teamDomain}/cdn-cgi/access/certs`);
  } catch {
    throw new HttpError('unavailable', 'Identity provider keys unavailable');
  }
  if (!res.ok) throw new HttpError('unavailable', 'Identity provider keys unavailable');
  let body: { keys?: unknown };
  try {
    body = (await res.json()) as { keys?: unknown };
  } catch {
    throw new HttpError('unavailable', 'Identity provider keys unavailable');
  }
  const keys = new Map<string, CryptoKey>();
  if (!Array.isArray(body.keys)) return keys;
  for (const raw of body.keys as Jwk[]) {
    if (
      raw?.kty !== 'RSA' ||
      typeof raw.kid !== 'string' ||
      typeof raw.n !== 'string' ||
      typeof raw.e !== 'string'
    )
      continue;
    if (raw.alg !== undefined && raw.alg !== 'RS256') continue;
    if (raw.use !== undefined && raw.use !== 'sig') continue;
    try {
      const key = await crypto.subtle.importKey(
        'jwk',
        { kty: 'RSA', n: raw.n, e: raw.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      );
      keys.set(raw.kid, key);
    } catch {
      // Malformed key: skip it rather than failing every login.
    }
  }
  return keys;
}

async function getKey(
  teamDomain: string,
  kid: string,
  fetchImpl: FetchLike,
  nowMs: number,
): Promise<CryptoKey> {
  let entry = cache.get(teamDomain);
  const fresh = entry !== undefined && nowMs - entry.fetchedAt < JWKS_TTL_MS && nowMs >= entry.fetchedAt;
  const needFetch =
    !fresh ||
    (entry !== undefined && !entry.keys.has(kid) && nowMs - entry.fetchedAt >= UNKNOWN_KID_REFETCH_MS);
  if (needFetch) {
    entry = { keys: await fetchKeys(teamDomain, fetchImpl), fetchedAt: nowMs };
    cache.set(teamDomain, entry);
  }
  const key = entry?.keys.get(kid);
  if (!key) throw unauthenticated();
  return key;
}

function decodeJson(segment: string): Record<string, unknown> | null {
  const bytes = b64urlToBytes(segment);
  if (!bytes) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export interface AccessIdentity {
  email: string;
}

export async function verifyAccessJwt(
  token: string,
  config: AccessConfig,
  opts: { fetch: FetchLike; now: Date },
): Promise<AccessIdentity> {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) throw unauthenticated();
  const parts = token.split('.');
  if (parts.length !== 3) throw unauthenticated();
  const [h, p, s] = parts as [string, string, string];
  const header = decodeJson(h);
  if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string') throw unauthenticated();
  if (header.crit !== undefined) throw unauthenticated();
  const signature = b64urlToBytes(s);
  if (!signature || signature.length === 0) throw unauthenticated();

  const nowMs = opts.now.getTime();
  const key = await getKey(config.teamDomain, header.kid, opts.fetch, nowMs);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    new Uint8Array(signature),
    utf8(`${h}.${p}`),
  );
  if (!valid) throw unauthenticated();

  const payload = decodeJson(p);
  if (!payload) throw unauthenticated();
  const nowS = nowMs / 1000;
  const aud = payload.aud;
  const audOk = typeof aud === 'string' ? aud === config.aud : Array.isArray(aud) && aud.includes(config.aud);
  if (!audOk) throw unauthenticated();
  if (payload.iss !== config.teamDomain) throw unauthenticated();
  if (typeof payload.exp !== 'number' || nowS > payload.exp + CLOCK_SKEW_S)
    throw unauthenticated('Access token expired');
  if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || nowS < payload.nbf - CLOCK_SKEW_S))
    throw unauthenticated();
  if (payload.iat !== undefined && (typeof payload.iat !== 'number' || payload.iat > nowS + CLOCK_SKEW_S))
    throw unauthenticated();

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!email || !config.ownerEmails.has(email)) {
    throw new HttpError('forbidden', 'This account is not allowed to administer the atlas');
  }
  return { email };
}
