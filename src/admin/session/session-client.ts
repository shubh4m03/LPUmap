/**
 * Admin session state machine (framework-free; `useAdminSession` binds it to
 * React). Admin controls render ONLY in `signed-in`, which is entered only
 * after the server answered GET /api/admin/session with 200 — never on a
 * guess, a cached value or the login response alone (the login is confirmed
 * by re-reading the session, which proves the browser kept the cookie).
 *
 *   checking ──200──▶ signed-in ──401 on any request──▶ signed-out | access-required
 *      │                  │
 *      │                  └─logout─▶ signed-out (password) | access-logout (Access)
 *      ├─401 + health auth=password ─▶ signed-out (login form)
 *      ├─401 + health auth=access   ─▶ access-required
 *      ├─503 not-configured         ─▶ not-configured
 *      └─network / 5xx / bad body   ─▶ error (retry)
 */
import { clearAllRecovery } from '../../building-studio/local-recovery.ts';
import type { AdminApi } from '../api/index.ts';
import { describeAdminError, type AdminApiError } from '../api/errors.ts';
import { ACCESS_LOGOUT_PATH } from '../api/session.ts';
import type { AuthMode, SessionInfo } from '../api/schemas.ts';

export type AdminSessionState =
  | { status: 'checking' }
  | { status: 'signed-in'; session: SessionInfo }
  /** Password mode: show the login form. `message` explains why (ended session, wrong password…). */
  | { status: 'signed-out'; message: string | null; busy: boolean }
  /** Access mode without a valid Access identity for an owner email. */
  | { status: 'access-required'; message: string }
  | { status: 'not-configured'; message: string }
  /** The session could not be checked (network, 5xx, unexpected response). */
  | { status: 'error'; error: AdminApiError; message: string };

export type LogoutOutcome =
  | { ok: true; removedRecoveryEntries: number; redirectTo: string | null }
  | { ok: false; removedRecoveryEntries: number; message: string };

export const ACCESS_REQUIRED_MESSAGE =
  'This page is protected by Cloudflare Access. Sign in with an owner email through Access, then reload.';
export const NOT_CONFIGURED_MESSAGE =
  'Administration is not configured on this site (see docs/ADMIN_OPERATIONS.md §1).';
export const API_MISSING_MESSAGE =
  'The admin API is not available on this server (no /api/admin). It runs on Cloudflare Pages Functions; see docs/ADMIN_OPERATIONS.md.';
export const SESSION_ENDED_MESSAGE = 'Your session has ended. Sign in again.';
export const COOKIE_NOT_KEPT_MESSAGE =
  'The password was accepted, but this browser did not keep the session cookie. The admin needs HTTPS (or localhost) and cookies enabled.';

export interface AdminSessionClient {
  getState(): AdminSessionState;
  subscribe(listener: () => void): () => void;
  /** (Re)checks the session with the server. */
  check(): Promise<AdminSessionState>;
  /** Password login; resolves to the new state (signed-in only after the server confirms the session). */
  login(password: string): Promise<AdminSessionState>;
  /** Ends the session and clears Studio local-recovery entries. */
  logout(): Promise<LogoutOutcome>;
  /** Called by the API client when any request gets 401. */
  sessionEnded(): void;
}

export interface SessionClientOptions {
  /** Clears Studio crash-recovery entries; injectable for tests. */
  clearRecovery?: () => number;
}

export function createAdminSessionClient(
  api: Pick<AdminApi, 'session' | 'setCsrfToken'>,
  opts: SessionClientOptions = {},
): AdminSessionClient {
  let state: AdminSessionState = { status: 'checking' };
  let lastMode: AuthMode | null = null;
  const listeners = new Set<() => void>();
  const clearRecovery = opts.clearRecovery ?? (() => clearAllRecovery());

  const set = (next: AdminSessionState): AdminSessionState => {
    state = next;
    for (const l of [...listeners]) l();
    return next;
  };

  const signedIn = (session: SessionInfo): AdminSessionState => {
    lastMode = session.mode;
    api.setCsrfToken(session.mode === 'password' ? (session.csrfToken ?? null) : null);
    return set({ status: 'signed-in', session });
  };

  const failed = (error: AdminApiError): AdminSessionState => {
    api.setCsrfToken(null);
    if (error.kind === 'not-configured')
      return set({ status: 'not-configured', message: NOT_CONFIGURED_MESSAGE });
    // No session route at all (static hosting, a dev server without Functions): say so plainly.
    if (error.kind === 'not-found' || (error.kind === 'bad-response' && error.status !== null))
      return set({ status: 'error', error, message: API_MISSING_MESSAGE });
    return set({ status: 'error', error, message: describeAdminError(error) });
  };

  /** 401: which sign-in applies depends on the server's mode (public health check). */
  async function unauthenticated(message: string | null): Promise<AdminSessionState> {
    api.setCsrfToken(null);
    const mode = lastMode ?? (await modeFromHealth());
    if (mode === 'error') return state;
    if (mode === 'not-configured') return set({ status: 'not-configured', message: NOT_CONFIGURED_MESSAGE });
    if (mode === 'access') return set({ status: 'access-required', message: ACCESS_REQUIRED_MESSAGE });
    return set({ status: 'signed-out', message, busy: false });
  }

  async function modeFromHealth(): Promise<AuthMode | 'not-configured' | 'error'> {
    const h = await api.session.health();
    if (!h.ok) {
      failed(h.error);
      return 'error';
    }
    return h.data.auth;
  }

  async function check(): Promise<AdminSessionState> {
    if (state.status !== 'signed-out') set({ status: 'checking' });
    const r = await api.session.getSession();
    if (r.ok) return signedIn(r.data);
    if (r.error.kind === 'unauthenticated')
      return unauthenticated(state.status === 'signed-out' ? state.message : null);
    return failed(r.error);
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    check,

    async login(password) {
      set({ status: 'signed-out', message: null, busy: true });
      const r = await api.session.login(password);
      if (!r.ok) {
        if (r.error.kind === 'not-found') {
          // Login exists only in password mode: the server runs Access (or changed mode).
          lastMode = 'access';
          return set({ status: 'access-required', message: ACCESS_REQUIRED_MESSAGE });
        }
        if (r.error.kind === 'not-configured') return failed(r.error);
        const message =
          r.error.kind === 'unauthenticated' ? 'Incorrect password.' : describeAdminError(r.error);
        return set({ status: 'signed-out', message, busy: false });
      }
      // Confirm with the server: proves the cookie was stored and the session is usable.
      lastMode = 'password';
      api.setCsrfToken(r.data.csrfToken);
      const confirm = await api.session.getSession();
      if (confirm.ok) return signedIn(confirm.data);
      api.setCsrfToken(null);
      if (confirm.error.kind === 'unauthenticated')
        return set({ status: 'signed-out', message: COOKIE_NOT_KEPT_MESSAGE, busy: false });
      return failed(confirm.error);
    },

    async logout() {
      // Unsaved Studio drafts must not outlive the session, whatever the server says.
      const removedRecoveryEntries = clearRecovery();
      const mode = state.status === 'signed-in' ? state.session.mode : lastMode;
      const r = await api.session.logout();
      if (!r.ok && r.error.kind !== 'unauthenticated') {
        return {
          ok: false,
          removedRecoveryEntries,
          message: `Sign-out could not be confirmed by the server, so the session may still be active. ${describeAdminError(r.error)}`,
        };
      }
      api.setCsrfToken(null);
      if (mode === 'access') {
        set({ status: 'access-required', message: ACCESS_REQUIRED_MESSAGE });
        return { ok: true, removedRecoveryEntries, redirectTo: ACCESS_LOGOUT_PATH };
      }
      set({ status: 'signed-out', message: 'You have signed out.', busy: false });
      return { ok: true, removedRecoveryEntries, redirectTo: null };
    },

    sessionEnded() {
      if (state.status !== 'signed-in') return;
      void unauthenticated(SESSION_ENDED_MESSAGE);
    },
  };
}
