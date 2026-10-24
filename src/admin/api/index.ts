/**
 * Typed client for every /api/admin/** route (community + Building Studio)
 * plus the session endpoints. One instance per admin app; the CSRF token of
 * the current password session lives in this object's memory only.
 *
 *   const api = createAdminApi({ onUnauthenticated: () => session.expired() });
 *   const r = await api.community.listSuggestions({ status: 'pending' });
 *   if (r.ok) show(r.data.items); else showError(describeAdminError(r.error));
 */
import { createCommunityApi, type CommunityApi } from './community.ts';
import type { AdminApiError } from './errors.ts';
import { createAdminHttp, type AdminHttp } from './http.ts';
import { createSessionApi, type SessionApi } from './session.ts';
import { createStudioApi, type StudioApi } from './studio.ts';

export interface AdminApiOptions {
  fetch?: typeof fetch;
  /** Default '/api/admin'. */
  baseUrl?: string;
  /** Default '/api' (for /api/health). */
  apiBase?: string;
  /** A request other than the login got 401: the session has ended. */
  onUnauthenticated?: (error: AdminApiError) => void;
}

export interface AdminApi {
  readonly http: AdminHttp;
  readonly session: SessionApi;
  readonly community: CommunityApi;
  readonly studio: StudioApi;
  /** The CSRF token sent with writes (password mode); null in Access mode or when signed out. */
  getCsrfToken(): string | null;
  setCsrfToken(token: string | null): void;
}

export function createAdminApi(opts: AdminApiOptions = {}): AdminApi {
  let csrfToken: string | null = null;
  // Filled below: refreshing the token needs the session API built on this same transport.
  let session: SessionApi | null = null;
  const http = createAdminHttp({
    fetch: opts.fetch,
    baseUrl: opts.baseUrl,
    csrfToken: () => csrfToken,
    onUnauthenticated: (e) => {
      csrfToken = null;
      opts.onUnauthenticated?.(e);
    },
    refreshCsrfToken: async () => {
      const r = await session?.getSession();
      if (!r?.ok) return null;
      csrfToken = r.data.csrfToken ?? null;
      return csrfToken;
    },
  });
  session = createSessionApi(http, { fetch: opts.fetch, apiBase: opts.apiBase });
  return {
    http,
    session,
    community: createCommunityApi(http),
    studio: createStudioApi(http),
    getCsrfToken: () => csrfToken,
    setCsrfToken: (token) => {
      csrfToken = token;
    },
  };
}

export * from './errors.ts';
export * from './schemas.ts';
export type * from './community.ts';
export type { StudioApi, StudioRevisionBody } from './studio.ts';
export type { SessionApi } from './session.ts';
export { ACCESS_LOGOUT_PATH } from './session.ts';
export { ADMIN_API_BASE, CSRF_HEADER, buildQuery, seg } from './http.ts';
export type { AdminHttp, AdminRequest, AdminResult, HttpMethod } from './http.ts';
export { createCommunityApi } from './community.ts';
export { createStudioApi } from './studio.ts';
export { createSessionApi } from './session.ts';
export { createAdminHttp } from './http.ts';
