/**
 * Renders the whole admin (session → shell → section) against a route-based
 * fetch mock, inside the providers main.tsx gives it. Component tests mock
 * the map (MapLibre needs WebGL) and the campus dataset themselves.
 */
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { AdminApp } from '../../../src/admin/AdminApp.tsx';
import { QUALITY_WARNING_KINDS } from '../../../src/admin/api/schemas.ts';
import { createAdminServices } from '../../../src/admin/context.ts';
import { ToastProvider } from '../../../src/components/ui/Toast.tsx';
import { json, mockFetch, problem, type Call } from './fetch-mock.ts';

export const SESSION = {
  actor: 'owner',
  mode: 'password',
  csrfToken: 'c1',
  expiresAt: '2026-10-24T18:00:00.000Z',
};

export const OVERVIEW = {
  suggestions: { pending: 2, needs_information: 0, approved: 1, rejected: 0, duplicate: 0 },
  locations: { owner: { active: 1, hidden: 0 }, community: { active: 1, hidden: 0 } },
  overrides: { total: 0, hidden: 0, withFields: 0, withAccessPoint: 0, orphan: 0 },
  auditLast7Days: 3,
  qualityWarnings: 0,
  publicationVersion: 4,
  datasetVersion: 'abc123',
};

export type Route = (call: Call) => Response | Error | undefined;

/** `routes` answer first; then the session, overview and empty lists; anything else is a 404. */
export function renderAdmin(path: string, routes: Route = () => undefined) {
  window.history.replaceState(null, '', path);
  const m = mockFetch((call) => {
    const r = routes(call);
    if (r) return r;
    const key = `${call.method} ${call.path}`;
    if (key === 'GET /api/admin/session') return json(SESSION);
    if (key === 'DELETE /api/admin/session') return json({ ok: true });
    if (key === 'GET /api/admin/overview') return json(OVERVIEW);
    if (key === 'GET /api/admin/suggestions') return json({ items: [], nextCursor: null });
    if (key === 'GET /api/admin/locations') return json({ items: [] });
    if (key === 'GET /api/admin/overrides') return json({ items: [] });
    if (key === 'GET /api/admin/audit') return json({ items: [], nextCursor: null });
    if (key === 'GET /api/admin/quality')
      return json({ warnings: [], counts: Object.fromEntries(QUALITY_WARNING_KINDS.map((k) => [k, 0])) });
    return problem(404, 'not-found', `No mock for ${key}`);
  });
  const clearRecovery = vi.fn(() => 0);
  const services = createAdminServices({ fetch: m.fetch, clearRecovery });
  const view = render(
    <ToastProvider>
      <AdminApp services={services} />
    </ToastProvider>,
  );
  const writes = () => m.calls.filter((c) => c.method !== 'GET');
  return { ...view, calls: m.calls, writes, services, clearRecovery };
}
