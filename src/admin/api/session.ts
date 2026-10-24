/**
 * Session endpoints (server/handlers/admin/session.ts) and the public health
 * check used to learn the authentication mode before anyone is signed in:
 *  - GET    /api/admin/session → `{actor, mode, csrfToken?, expiresAt?}` or 401;
 *  - POST   /api/admin/session → password mode only (`{password}`); 404 in Access mode;
 *  - DELETE /api/admin/session → ends a password session; a no-op in Access mode,
 *    where the browser must also visit ACCESS_LOGOUT_PATH;
 *  - GET    /api/health        → `{ok, db, auth: 'access'|'password'|'not-configured'}`.
 */
import { createAdminHttp, type AdminHttp, type AdminHttpOptions, type AdminResult } from './http.ts';
import {
  healthSchema,
  loginResultSchema,
  okSchema,
  sessionInfoSchema,
  type Health,
  type LoginResult,
  type SessionInfo,
} from './schemas.ts';

/** Cloudflare Access ends its own session at this path on the protected host. */
export const ACCESS_LOGOUT_PATH = '/cdn-cgi/access/logout';

export interface SessionApi {
  getSession(o?: { signal?: AbortSignal }): Promise<AdminResult<SessionInfo>>;
  /** 401 = wrong password (the unauthenticated hook is not called); 429 = too many attempts. */
  login(password: string): Promise<AdminResult<LoginResult>>;
  logout(): Promise<AdminResult<{ ok: true }>>;
  health(o?: { signal?: AbortSignal }): Promise<AdminResult<Health>>;
}

export function createSessionApi(
  http: AdminHttp,
  healthOpts: Pick<AdminHttpOptions, 'fetch'> & { apiBase?: string } = {},
): SessionApi {
  const publicHttp = createAdminHttp({ fetch: healthOpts.fetch, baseUrl: healthOpts.apiBase ?? '/api' });
  return {
    getSession: (o) => http.request({ method: 'GET', path: '/session', schema: sessionInfoSchema, ...o }),
    login: (password) =>
      http.request({
        method: 'POST',
        path: '/session',
        body: { password },
        schema: loginResultSchema,
        isLogin: true,
      }),
    logout: () => http.request({ method: 'DELETE', path: '/session', schema: okSchema }),
    health: (o) => publicHttp.request({ method: 'GET', path: '/health', schema: healthSchema, ...o }),
  };
}
