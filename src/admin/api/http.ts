/**
 * Transport for /api/admin/** (docs/COMMUNITY_MODULE_CONTRACTS.md "Endpoints",
 * docs/BUILDING_STUDIO_DESIGN.md §7). Same-origin JSON only:
 *  - every request: `credentials: 'same-origin'`, `cache: 'no-store'`,
 *    `Accept: application/json`;
 *  - writes (POST/PUT/PATCH/DELETE): JSON body with `Content-Type:
 *    application/json` and, in password mode, `X-CSRF-Token` (the browser adds
 *    `Origin` itself);
 *  - 401 (except the login attempt) calls `onUnauthenticated` so the app shows
 *    the login again;
 *  - a 403 `csrf` in password mode re-reads the session token once and repeats
 *    the request: the server refuses such a request before it runs, so the
 *    retry cannot apply a change twice;
 *  - every 2xx body is parsed with the endpoint's schema; a mismatch is a
 *    `bad-response` error, never a success.
 * The CSRF token is held in memory only (never in browser storage).
 */
import type { z } from 'zod';
import {
  abortedError,
  badResponseError,
  errorFromResponse,
  networkError,
  signInRedirectError,
  type AdminApiError,
} from './errors.ts';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export const ADMIN_API_BASE = '/api/admin';
export const CSRF_HEADER = 'X-CSRF-Token';

export type AdminResult<T> = { ok: true; status: number; data: T } | { ok: false; error: AdminApiError };

export type QueryValue = string | number | boolean | null | undefined;

export interface AdminRequest<T> {
  method: HttpMethod;
  /** Path below the base, starting with '/'. Ids must already be encoded (see `seg`). */
  path: string;
  query?: Readonly<Record<string, QueryValue>>;
  /** JSON body (writes). Omitted → no body. */
  body?: unknown;
  /** Schema of the 2xx body. */
  schema: z.ZodType<T>;
  signal?: AbortSignal;
  /** The login attempt: a 401 means a wrong password, not an ended session. */
  isLogin?: boolean;
}

export interface AdminHttpOptions {
  fetch?: typeof fetch;
  /** Default `/api/admin`. */
  baseUrl?: string;
  /** Current CSRF token (password mode), or null (Access mode / not signed in). */
  csrfToken?: () => string | null;
  /** A request (other than the login) answered 401: the session has ended. */
  onUnauthenticated?: (error: AdminApiError) => void;
  /** After a 403 `csrf`: re-read the session and return the fresh token (or null). */
  refreshCsrfToken?: () => Promise<string | null>;
}

export interface AdminHttp {
  request<T>(req: AdminRequest<T>): Promise<AdminResult<T>>;
}

const WRITE_METHODS: ReadonlySet<HttpMethod> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Encodes one path segment (base ids contain '/' and ':' — `osm:way/1` → `osm%3Away%2F1`). */
export const seg = (id: string): string => encodeURIComponent(id);

export function buildQuery(query: Readonly<Record<string, QueryValue>> | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

function isJsonResponse(res: Response): boolean {
  const type = res.headers.get('Content-Type') ?? '';
  return /^application\/(?:[\w.+-]+\+)?json\b/i.test(type);
}

async function readJson(res: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  if (!isJsonResponse(res)) return { ok: false };
  try {
    return { ok: true, value: (await res.json()) as unknown };
  } catch {
    return { ok: false };
  }
}

const isAbort = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';

export function createAdminHttp(opts: AdminHttpOptions = {}): AdminHttp {
  const base = (opts.baseUrl ?? ADMIN_API_BASE).replace(/\/+$/, '');
  const doFetch: typeof fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function send<T>(req: AdminRequest<T>, csrf: string | null): Promise<AdminResult<T>> {
    const isWrite = WRITE_METHODS.has(req.method);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (req.body !== undefined) headers['Content-Type'] = 'application/json';
    if (isWrite && csrf) headers[CSRF_HEADER] = csrf;
    let res: Response;
    try {
      res = await doFetch(`${base}${req.path}${buildQuery(req.query)}`, {
        method: req.method,
        headers,
        body: req.body === undefined ? null : JSON.stringify(req.body),
        credentials: 'same-origin',
        cache: 'no-store',
        // The API never redirects; a redirect is an identity proxy (Cloudflare Access) asking to sign in.
        redirect: 'manual',
        signal: req.signal ?? null,
      });
    } catch (e) {
      if (isAbort(e) || req.signal?.aborted) return { ok: false, error: abortedError() };
      return { ok: false, error: networkError(isWrite) };
    }
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      return { ok: false, error: signInRedirectError() };
    }

    const body = await readJson(res);
    if (res.status >= 200 && res.status < 300) {
      if (!body.ok) return { ok: false, error: badResponseError(res.status, isWrite, 'Not JSON') };
      const parsed = req.schema.safeParse(body.value);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        const where = first ? `${first.path.map(String).join('.') || '(root)'}: ${first.message}` : undefined;
        return { ok: false, error: badResponseError(res.status, isWrite, where) };
      }
      return { ok: true, status: res.status, data: parsed.data };
    }
    const error = errorFromResponse(res.status, body.ok ? body.value : null, res.headers.get('Retry-After'));
    return { ok: false, error };
  }

  return {
    async request<T>(req: AdminRequest<T>): Promise<AdminResult<T>> {
      const csrf = opts.csrfToken?.() ?? null;
      let result = await send(req, csrf);
      if (
        !result.ok &&
        result.error.kind === 'csrf' &&
        WRITE_METHODS.has(req.method) &&
        !req.isLogin &&
        opts.refreshCsrfToken
      ) {
        const fresh = await opts.refreshCsrfToken();
        if (fresh && fresh !== csrf) result = await send(req, fresh);
      }
      if (!result.ok && result.error.kind === 'unauthenticated' && !req.isLogin) {
        opts.onUnauthenticated?.(result.error);
      }
      return result;
    },
  };
}
