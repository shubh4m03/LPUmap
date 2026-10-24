import { describe, expect, it, vi } from 'vitest';
import { createAdminServices } from '../../../src/admin/context.ts';
import {
  ACCESS_REQUIRED_MESSAGE,
  API_MISSING_MESSAGE,
  COOKIE_NOT_KEPT_MESSAGE,
  SESSION_ENDED_MESSAGE,
} from '../../../src/admin/session/session-client.ts';
import { json, mockFetch, problem } from './fetch-mock.ts';

const PASSWORD_SESSION = {
  actor: 'owner',
  mode: 'password',
  csrfToken: 'csrf-1',
  expiresAt: '2026-10-24T18:00:00.000Z',
};
const ACCESS_SESSION = { actor: 'owner@example.org', mode: 'access' };
const UNAUTH = problem(401, 'unauthenticated', 'Authentication required');
const health = (auth: string) => json({ ok: true, db: 'ok', auth });

function services(...replies: Parameters<typeof mockFetch>) {
  const m = mockFetch(...replies);
  const clearRecovery = vi.fn(() => 2);
  const svc = createAdminServices({ fetch: m.fetch, clearRecovery });
  return { ...svc, calls: m.calls, clearRecovery };
}

describe('admin session: check', () => {
  it('starts in checking and is signed in only after GET /session answers 200', async () => {
    const s = services(json(PASSWORD_SESSION));
    expect(s.session.getState()).toEqual({ status: 'checking' });
    const listener = vi.fn();
    s.session.subscribe(listener);
    await s.session.check();
    expect(s.session.getState()).toEqual({ status: 'signed-in', session: PASSWORD_SESSION });
    expect(s.api.getCsrfToken()).toBe('csrf-1');
    expect(listener).toHaveBeenCalled();
  });

  it('Access mode: signed in without a CSRF token', async () => {
    const s = services(json(ACCESS_SESSION));
    await s.session.check();
    expect(s.session.getState()).toMatchObject({ status: 'signed-in', session: { mode: 'access' } });
    expect(s.api.getCsrfToken()).toBeNull();
  });

  it('401 + password mode → login form; 401 + Access mode → Access notice', async () => {
    const p = services(UNAUTH, health('password'));
    await p.session.check();
    expect(p.session.getState()).toEqual({ status: 'signed-out', message: null, busy: false });
    expect(p.calls.map((c) => c.path)).toEqual(['/api/admin/session', '/api/health']);

    const a = services(UNAUTH, health('access'));
    await a.session.check();
    expect(a.session.getState()).toEqual({ status: 'access-required', message: ACCESS_REQUIRED_MESSAGE });
  });

  it('503 not-configured → not-configured; network → error with a retry message', async () => {
    const n = services(problem(503, 'not-configured', 'Administration is not configured'));
    await n.session.check();
    expect(n.session.getState().status).toBe('not-configured');

    const e = services(new TypeError('Failed to fetch'));
    await e.session.check();
    const st = e.session.getState();
    expect(st.status).toBe('error');
    if (st.status === 'error') expect(st.message).toMatch(/could not be reached/);
  });

  it('no admin API (404 or an HTML page) → says the API is missing, not "item no longer exists"', async () => {
    const a = services(problem(404, 'not-found', 'Not found'));
    await a.session.check();
    expect(a.session.getState()).toMatchObject({ status: 'error', message: API_MISSING_MESSAGE });
    const b = services(
      new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );
    await b.session.check();
    expect(b.session.getState()).toMatchObject({ status: 'error', message: API_MISSING_MESSAGE });
  });

  it('a failing health check after 401 is an error, not a login form', async () => {
    const s = services(UNAUTH, new TypeError('offline'));
    await s.session.check();
    expect(s.session.getState().status).toBe('error');
  });
});

describe('admin session: login', () => {
  it('confirms the session with the server before signing in', async () => {
    const s = services(
      json({ actor: 'owner', csrfToken: 'csrf-login', expiresAt: PASSWORD_SESSION.expiresAt }),
      json({ ...PASSWORD_SESSION, csrfToken: 'csrf-confirmed' }),
    );
    const st = await s.session.login('correct horse');
    expect(st).toMatchObject({ status: 'signed-in', session: { actor: 'owner' } });
    expect(s.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /api/admin/session',
      'GET /api/admin/session',
    ]);
    expect(s.api.getCsrfToken()).toBe('csrf-confirmed');
  });

  it('wrong password → login form with a message (and busy while sending)', async () => {
    const s = services(problem(401, 'unauthenticated', 'Incorrect password'));
    const seen: string[] = [];
    s.session.subscribe(() => {
      const st = s.session.getState();
      seen.push(st.status === 'signed-out' ? `signed-out:${st.busy}` : st.status);
    });
    const st = await s.session.login('wrong');
    expect(st).toEqual({ status: 'signed-out', message: 'Incorrect password.', busy: false });
    expect(seen).toEqual(['signed-out:true', 'signed-out:false']);
  });

  it('password accepted but the cookie was not kept → explains it, stays signed out', async () => {
    const s = services(
      json({ actor: 'owner', csrfToken: 'x', expiresAt: PASSWORD_SESSION.expiresAt }),
      UNAUTH,
    );
    const st = await s.session.login('pw');
    expect(st).toEqual({ status: 'signed-out', message: COOKIE_NOT_KEPT_MESSAGE, busy: false });
    expect(s.api.getCsrfToken()).toBeNull();
  });

  it('rate limited → message with the wait; 404 (Access mode) → Access notice', async () => {
    const r = services(problem(429, 'rate-limited', 'Too many attempts', { retryAfterS: 60 }));
    const st = await r.session.login('pw');
    expect(st.status === 'signed-out' && st.message).toMatch(/60 s/);

    const a = services(problem(404, 'not-found', 'Not found'));
    expect((await a.session.login('pw')).status).toBe('access-required');
  });
});

describe('admin session: ending', () => {
  it('a 401 on any request returns to the login form with "session ended"', async () => {
    const s = services(json(PASSWORD_SESSION), UNAUTH);
    await s.session.check();
    const r = await s.api.community.overview();
    expect(r.ok).toBe(false);
    await vi.waitFor(() => expect(s.session.getState().status).toBe('signed-out'));
    expect(s.session.getState()).toEqual({
      status: 'signed-out',
      message: SESSION_ENDED_MESSAGE,
      busy: false,
    });
    expect(s.api.getCsrfToken()).toBeNull();
    // The mode was known from the session: no extra health request.
    expect(s.calls.map((c) => c.path)).toEqual(['/api/admin/session', '/api/admin/overview']);
  });

  it('logout (password): clears Studio recovery entries, ends the session, shows the login', async () => {
    const s = services(json(PASSWORD_SESSION), json({ ok: true }));
    await s.session.check();
    const out = await s.session.logout();
    expect(out).toEqual({ ok: true, removedRecoveryEntries: 2, redirectTo: null });
    expect(s.clearRecovery).toHaveBeenCalledTimes(1);
    expect(s.calls[1]).toMatchObject({ method: 'DELETE', path: '/api/admin/session' });
    expect(s.calls[1]!.headers['x-csrf-token']).toBe('csrf-1');
    expect(s.session.getState().status).toBe('signed-out');
    expect(s.api.getCsrfToken()).toBeNull();
  });

  it('logout (Access): also sends the browser to the Access logout', async () => {
    const s = services(json(ACCESS_SESSION), json({ ok: true }));
    await s.session.check();
    expect(await s.session.logout()).toEqual({
      ok: true,
      removedRecoveryEntries: 2,
      redirectTo: '/cdn-cgi/access/logout',
    });
  });

  it('logout that the server cannot confirm says so (recovery is still cleared)', async () => {
    const s = services(json(PASSWORD_SESSION), new TypeError('offline'));
    await s.session.check();
    const out = await s.session.logout();
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/may still be active/);
    expect(s.clearRecovery).toHaveBeenCalledTimes(1);
    expect(s.session.getState().status).toBe('signed-in');
  });
});
