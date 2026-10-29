/**
 * JSON response helpers. Every API response carries the same hardening
 * headers; there are deliberately no CORS headers (same-origin only).
 *
 * X-Robots-Tag (G-16): Cloudflare Pages applies public/_headers to static
 * files only, never to responses produced by Pages Functions, so the API's
 * noindex has to come from here.
 */
import { HttpError, isApiErrorLike } from './errors.ts';
import type { ApiErrorLike } from './errors.ts';
import { logError } from './log.ts';

export type CachePolicy = 'no-store' | 'no-cache';

export function apiHeaders(cache: CachePolicy, extra?: Record<string, string>): Headers {
  const h = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  if (extra) for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return h;
}

export interface JsonOptions {
  status?: number;
  cache?: CachePolicy;
  headers?: Record<string, string>;
}

export function json(body: unknown, opts: JsonOptions = {}): Response {
  return new Response(JSON.stringify(body), {
    status: opts.status ?? 200,
    headers: apiHeaders(opts.cache ?? 'no-store', opts.headers),
  });
}

/** Empty-bodied response with API headers (304, 204). */
export function empty(
  status: number,
  opts: { cache?: CachePolicy; headers?: Record<string, string> } = {},
): Response {
  const headers = apiHeaders(opts.cache ?? 'no-store', opts.headers);
  headers.delete('Content-Type');
  return new Response(null, { status, headers });
}

export interface ProblemOptions {
  cache?: CachePolicy;
  /** Include domain `details` (e.g. the current record on 409). Admin responses only. */
  includeDetails?: boolean;
}

export function problem(err: ApiErrorLike, opts: ProblemOptions = {}): Response {
  const error: Record<string, unknown> = { code: err.code, message: err.message };
  if (err.issues && err.issues.length > 0) error.issues = err.issues;
  const headers: Record<string, string> = { ...(err.headers ?? {}) };
  if (err.retryAfterS !== undefined) {
    const s = Math.max(1, Math.ceil(err.retryAfterS));
    error.retryAfterS = s;
    headers['Retry-After'] = String(s);
  }
  if (opts.includeDetails && err.details !== undefined) error.details = err.details;
  return json({ error }, { status: err.status, cache: opts.cache ?? 'no-store', headers });
}

/**
 * Converts anything thrown into a response. Known API errors keep their code
 * and message; everything else becomes a generic 500 without stack traces or
 * internal messages, and is logged in scrubbed form.
 */
export function errorResponse(
  err: unknown,
  opts: ProblemOptions & { route?: string; method?: string } = {},
): Response {
  if (isApiErrorLike(err)) return problem(err, opts);
  logError('unhandled-error', err, { route: opts.route, method: opts.method });
  return problem(new HttpError('internal', 'Internal error'), opts);
}

export function methodNotAllowed(allowed: readonly string[]): HttpError {
  return new HttpError('invalid', 'Method not allowed', {
    status: 405,
    headers: { Allow: allowed.join(', ') },
  });
}
