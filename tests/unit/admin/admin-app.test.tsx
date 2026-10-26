import { act, cleanup, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp } from '../../../src/admin/AdminApp.tsx';
import { createAdminServices } from '../../../src/admin/context.ts';
import { navigateAdmin } from '../../../src/admin/router.ts';
import { ToastProvider } from '../../../src/components/ui/Toast.tsx';
import { json, mockFetch, problem, type Call, type Reply } from './fetch-mock.ts';

// Sections load lazily; under a full parallel run the first render can take longer than 1 s.
configure({ asyncUtilTimeout: 5000 });

const SESSION = { actor: 'owner', mode: 'password', csrfToken: 'c1', expiresAt: '2026-10-24T18:00:00.000Z' };

const isSessionCall = (c: Call) => c.path === '/api/admin/session' || c.path === '/api/health';

/** Data the sections load once the shell is shown (empty, valid answers). */
function sectionData(c: Call): Response {
  if (c.path === '/api/admin/overview')
    return json({
      suggestions: { pending: 0, needs_information: 0, approved: 0, rejected: 0, duplicate: 0 },
      locations: { owner: { active: 0, hidden: 0 }, community: { active: 0, hidden: 0 } },
      overrides: { total: 0, hidden: 0, withFields: 0, withAccessPoint: 0, orphan: 0 },
      auditLast7Days: 0,
      qualityWarnings: 0,
      publicationVersion: 0,
      datasetVersion: 'v',
    });
  if (c.path === '/api/admin/suggestions' || c.path === '/api/admin/audit')
    return json({ items: [], nextCursor: null });
  return problem(404, 'not-found', 'Not mocked');
}

/** `replies` answer the session / health calls in order (the last repeats); sections get empty data. */
function setup(...replies: Reply[]) {
  let i = 0;
  const m = mockFetch((call) => {
    if (!isSessionCall(call)) return sectionData(call);
    const r = replies[Math.min(i, replies.length - 1)]!;
    i++;
    const out = typeof r === 'function' ? r(call) : r;
    return out instanceof Response ? out.clone() : out;
  });
  const clearRecovery = vi.fn(() => 0);
  const services = createAdminServices({ fetch: m.fetch, clearRecovery });
  const view = render(
    <ToastProvider>
      <AdminApp services={services} />
    </ToastProvider>,
  );
  const sessionCalls = () => m.calls.filter(isSessionCall);
  return { ...view, calls: m.calls, sessionCalls, services, clearRecovery };
}

beforeEach(() => window.history.replaceState(null, '', '/admin'));
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('AdminApp shell', () => {
  it('shows no admin controls until the server confirms a session, then the shell', async () => {
    setup(json(SESSION));
    expect(screen.getByRole('status')).toHaveTextContent(/Checking your admin session/);
    expect(screen.queryByRole('navigation', { name: 'Admin sections' })).toBeNull();
    const nav = await screen.findByRole('navigation', { name: 'Admin sections' });
    const links = within(nav)
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(links).toEqual([
      'Moderation queue',
      'Locations',
      'Base-place overrides',
      'Building Studio',
      'Templates',
      'Artwork',
      'History',
      'Quality',
    ]);
    expect(within(nav).getByRole('link', { name: 'Moderation queue' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByText('owner')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Moderation queue' })).toBeInTheDocument();
    expect(document.title).toBe('Admin · LPU Campus Atlas');
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  });

  it('password mode: login form, then the shell only after the session is confirmed', async () => {
    const user = userEvent.setup();
    const { sessionCalls } = setup(
      problem(401, 'unauthenticated', 'Authentication required'),
      json({ ok: true, db: 'ok', auth: 'password' }),
      json({ actor: 'owner', csrfToken: 'c1', expiresAt: SESSION.expiresAt }),
      json(SESSION),
    );
    const field = await screen.findByLabelText('Owner password');
    expect(screen.queryByRole('navigation', { name: 'Admin sections' })).toBeNull();
    await user.type(field, 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('navigation', { name: 'Admin sections' });
    expect(sessionCalls().map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /api/admin/session',
      'GET /api/health',
      'POST /api/admin/session',
      'GET /api/admin/session',
    ]);
  });

  it('wrong password keeps the form and announces why', async () => {
    const user = userEvent.setup();
    setup(
      problem(401, 'unauthenticated', 'Authentication required'),
      json({ ok: true, db: 'ok', auth: 'password' }),
      problem(401, 'unauthenticated', 'Incorrect password'),
    );
    await user.type(await screen.findByLabelText('Owner password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect password.');
    expect(screen.getByLabelText('Owner password')).toHaveValue('');
  });

  it('Access mode without identity and not-configured show explanations, never a blank page', async () => {
    const a = setup(problem(401, 'unauthenticated', 'x'), json({ ok: true, db: 'ok', auth: 'access' }));
    expect(await screen.findByRole('heading', { name: 'Sign-in required' })).toBeInTheDocument();
    a.unmount();
    setup(problem(503, 'not-configured', 'Administration is not configured'));
    expect(await screen.findByRole('heading', { name: 'Administration unavailable' })).toBeInTheDocument();
  });

  it('network failure while checking offers a retry that re-checks', async () => {
    const user = userEvent.setup();
    const { sessionCalls } = setup(new TypeError('offline'), json(SESSION));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be reached/);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('navigation', { name: 'Admin sections' });
    expect(sessionCalls()).toHaveLength(2);
  });

  it('navigates between sections with the History API and replaces unknown paths', async () => {
    const user = userEvent.setup();
    setup(json(SESSION));
    const nav = await screen.findByRole('navigation', { name: 'Admin sections' });
    await user.click(within(nav).getByRole('link', { name: 'History' }));
    expect(window.location.pathname).toBe('/admin/audit');
    expect(await screen.findByRole('heading', { name: 'History', level: 1 })).toBeInTheDocument();
    act(() => navigateAdmin('/admin/unknown-section'));
    await waitFor(() => expect(window.location.pathname).toBe('/admin/queue'));
    act(() => window.history.back());
  });

  it('sign out clears Studio recovery and returns to the login form', async () => {
    const user = userEvent.setup();
    const { clearRecovery, sessionCalls } = setup(json(SESSION), json({ ok: true }));
    await screen.findByRole('navigation', { name: 'Admin sections' });
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByLabelText('Owner password')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('You have signed out.');
    expect(clearRecovery).toHaveBeenCalledTimes(1);
    expect(sessionCalls()[1]).toMatchObject({ method: 'DELETE', path: '/api/admin/session' });
  });
});
