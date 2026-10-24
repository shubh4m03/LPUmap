import { describe, expect, it, vi } from 'vitest';
import { createAdminApi, describeAdminError, isRetryable } from '../../../src/admin/api/index.ts';
import { buildQuery, seg } from '../../../src/admin/api/http.ts';
import { STU_ID } from '../building-studio/fixtures.ts';
import {
  json,
  location,
  mockFetch,
  OWN_ID,
  problem,
  studioDetail,
  studioHead,
  STV_ID,
  SUG_ID,
  suggestion,
  TARGET,
} from './fetch-mock.ts';

const VALIDATION = {
  issues: [
    {
      code: 'boundary-crossing',
      severity: 'warning',
      message: 'The footprint crosses the campus boundary.',
      path: null,
      data: {},
    },
  ],
  errorCount: 0,
  warningCount: 1,
  publishable: true,
  requiredAcknowledgements: ['boundary-crossing'],
};

describe('admin transport: request shape', () => {
  it('sends same-origin, no-store JSON reads without CSRF or body', async () => {
    const m = mockFetch(json({ items: [], nextCursor: null }));
    const api = createAdminApi({ fetch: m.fetch });
    api.setCsrfToken('tok');
    const r = await api.community.listSuggestions({ status: 'pending', q: '', limit: 20 });
    expect(r.ok).toBe(true);
    const c = m.calls[0]!;
    expect(c.method).toBe('GET');
    expect(c.path).toBe('/api/admin/suggestions');
    expect(c.search).toBe('?status=pending&limit=20'); // empty values dropped
    expect(c.init.credentials).toBe('same-origin');
    expect(c.init.cache).toBe('no-store');
    expect(c.init.body).toBeNull();
    expect(c.headers['x-csrf-token']).toBeUndefined();
    expect(c.headers['content-type']).toBeUndefined();
    expect(c.headers.accept).toBe('application/json');
  });

  it('sends writes as JSON with the in-memory CSRF token (password mode) and encodes base ids', async () => {
    const m = mockFetch(json({ override: null }));
    const api = createAdminApi({ fetch: m.fetch });
    api.setCsrfToken('csrf-123');
    await api.community.deleteOverride(TARGET, { revision: 3 });
    const c = m.calls[0]!;
    expect(c.method).toBe('DELETE');
    expect(c.url).toBe('/api/admin/overrides/osm%3Away%2F123456');
    expect(c.headers['content-type']).toBe('application/json');
    expect(c.headers['x-csrf-token']).toBe('csrf-123');
    expect(c.body).toEqual({ revision: 3 });
  });

  it('omits the CSRF header when no token is held (Access mode)', async () => {
    const m = mockFetch(json(location()));
    const api = createAdminApi({ fetch: m.fetch });
    await api.community.hideLocation(OWN_ID, { revision: 1 });
    expect(m.calls[0]!.headers['x-csrf-token']).toBeUndefined();
  });

  it('builds queries and path segments safely', () => {
    expect(buildQuery({ a: 'x y', b: undefined, c: null, d: '', e: 0, f: false })).toBe('?a=x+y&e=0&f=false');
    expect(buildQuery(undefined)).toBe('');
    expect(seg('cur:main-gate')).toBe('cur%3Amain-gate');
    expect(seg('../x')).toBe('..%2Fx');
  });
});

describe('admin transport: never a false success', () => {
  it('parses 2xx bodies with the endpoint schema', async () => {
    const m = mockFetch(json(suggestion({ status: 'rejected', revision: 2 })));
    const r = await createAdminApi({ fetch: m.fetch }).community.rejectSuggestion(SUG_ID, { revision: 1 });
    expect(r).toMatchObject({ ok: true, status: 200, data: { status: 'rejected', revision: 2 } });
  });

  it('treats a 2xx with a wrong shape as bad-response with an unknown outcome for writes', async () => {
    const m = mockFetch(json({ ok: true }));
    const r = await createAdminApi({ fetch: m.fetch }).community.approveSuggestion(SUG_ID, { revision: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('bad-response');
    expect(r.error.outcomeUnknown).toBe(true);
    expect(r.error.message).toMatch(/not known whether/);
  });

  it('treats a 2xx HTML page (SPA fallback, proxy) as bad-response', async () => {
    const m = mockFetch(
      new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );
    const r = await createAdminApi({ fetch: m.fetch }).community.overview();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('bad-response');
      expect(r.error.outcomeUnknown).toBe(false);
    }
  });

  it('reports a network failure; for writes the outcome is unknown', async () => {
    const m = mockFetch(new TypeError('Failed to fetch'));
    const api = createAdminApi({ fetch: m.fetch });
    const read = await api.community.listLocations();
    const write = await api.community.createLocation({
      fields: { name: 'X shop', categoryId: 'shop', location: [75.7, 31.25] },
    });
    expect(read.ok || read.error).toMatchObject({ kind: 'network', outcomeUnknown: false, status: null });
    expect(write.ok || write.error).toMatchObject({ kind: 'network', outcomeUnknown: true });
    if (!write.ok) {
      expect(describeAdminError(write.error)).toMatch(/not known whether the change was saved/);
      expect(isRetryable(write.error)).toBe(true);
    }
  });

  it('reports an aborted request as aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const m = mockFetch(new DOMException('The operation was aborted.', 'AbortError'));
    const r = await createAdminApi({ fetch: m.fetch }).community.overview({ signal: ctrl.signal });
    expect(r.ok || r.error.kind).toBe('aborted');
  });

  it('treats a redirect (identity proxy sign-in) as unauthenticated, not as success', async () => {
    const res = new Response(null, { status: 200 });
    Object.defineProperty(res, 'type', { value: 'opaqueredirect' });
    const onUnauthenticated = vi.fn();
    const m = mockFetch(() => res);
    const r = await createAdminApi({ fetch: m.fetch, onUnauthenticated }).community.overview();
    expect(m.calls[0]!.init.redirect).toBe('manual');
    expect(r.ok || r.error.kind).toBe('unauthenticated');
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });
});

describe('admin transport: error statuses', () => {
  it('401 calls onUnauthenticated and drops the CSRF token', async () => {
    const onUnauthenticated = vi.fn();
    const m = mockFetch(problem(401, 'unauthenticated', 'Authentication required'));
    const api = createAdminApi({ fetch: m.fetch, onUnauthenticated });
    api.setCsrfToken('tok');
    const r = await api.community.listOverrides();
    expect(r.ok || r.error).toMatchObject({ kind: 'unauthenticated', status: 401 });
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    expect(api.getCsrfToken()).toBeNull();
  });

  it('a wrong password (401 on login) does not trigger the session-ended hook', async () => {
    const onUnauthenticated = vi.fn();
    const m = mockFetch(problem(401, 'unauthenticated', 'Incorrect password'));
    const r = await createAdminApi({ fetch: m.fetch, onUnauthenticated }).session.login('nope');
    expect(r.ok || r.error.kind).toBe('unauthenticated');
    expect(onUnauthenticated).not.toHaveBeenCalled();
    expect(m.calls[0]).toMatchObject({
      method: 'POST',
      path: '/api/admin/session',
      body: { password: 'nope' },
    });
  });

  it('403 csrf: re-reads the session token once and repeats the refused write', async () => {
    const m = mockFetch(
      problem(403, 'csrf', 'Missing or invalid CSRF token'),
      json({ actor: 'owner', mode: 'password', csrfToken: 'fresh', expiresAt: '2026-10-24T18:00:00.000Z' }),
      json(location({ status: 'hidden', revision: 2 })),
    );
    const api = createAdminApi({ fetch: m.fetch });
    api.setCsrfToken('stale');
    const r = await api.community.hideLocation(OWN_ID, { revision: 1 });
    expect(r.ok).toBe(true);
    expect(m.calls.map((c) => [c.method, c.path, c.headers['x-csrf-token']])).toEqual([
      ['POST', `/api/admin/locations/${encodeURIComponent(OWN_ID)}/hide`, 'stale'],
      ['GET', '/api/admin/session', undefined],
      ['POST', `/api/admin/locations/${encodeURIComponent(OWN_ID)}/hide`, 'fresh'],
    ]);
    expect(api.getCsrfToken()).toBe('fresh');
  });

  it('403 csrf twice: stops after one retry and reports csrf', async () => {
    const m = mockFetch(
      problem(403, 'csrf', 'Cross-origin request rejected'),
      json({ actor: 'owner', mode: 'password', csrfToken: 'fresh' }),
      problem(403, 'csrf', 'Cross-origin request rejected'),
    );
    const api = createAdminApi({ fetch: m.fetch });
    api.setCsrfToken('stale');
    const r = await api.community.hideLocation(OWN_ID, { revision: 1 });
    expect(r.ok || r.error.kind).toBe('csrf');
    expect(m.calls).toHaveLength(3);
  });

  it('403 forbidden is not retried', async () => {
    const m = mockFetch(problem(403, 'forbidden', 'Not allowed'));
    const r = await createAdminApi({ fetch: m.fetch }).studio.deleteBuilding(STU_ID, {
      revision: 1,
      confirmId: STU_ID,
    });
    expect(r.ok || r.error).toMatchObject({ kind: 'forbidden', message: 'Not allowed' });
    expect(m.calls).toHaveLength(1);
  });

  it('409 conflict (community): exposes the current record and its revision', async () => {
    const current = suggestion({ revision: 4, name: 'Changed elsewhere' });
    const m = mockFetch(
      problem(409, 'conflict', 'This suggestion was changed by someone else since you loaded it.', {
        details: { current },
      }),
    );
    const r = await createAdminApi({ fetch: m.fetch }).community.editSuggestion(SUG_ID, {
      revision: 3,
      fields: { name: 'Mine' },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatchObject({ kind: 'conflict', status: 409, currentRevision: 4 });
    expect(r.error.current).toEqual(current);
    expect(describeAdminError(r.error)).toMatch(/revision 4/);
    expect(isRetryable(r.error)).toBe(false); // re-validate first, never retry blindly
  });

  it('409 conflict (studio): the current head; (templates): the current listing', async () => {
    const head = studioHead({ revision: 7 });
    const m = mockFetch(
      problem(409, 'conflict', 'Changed elsewhere', { details: { current: head } }),
      problem(409, 'conflict', 'Changed elsewhere', { details: { currentTemplate: { revision: 5 } } }),
    );
    const api = createAdminApi({ fetch: m.fetch });
    const a = await api.studio.saveDraft(STU_ID, { revision: 6, draft: studioDetail().draft! });
    const b = await api.studio.retireTemplate(STV_ID, { revision: 4 });
    expect(a.ok || a.error.currentRevision).toBe(7);
    expect(b.ok || b.error.currentRevision).toBe(5);
  });

  it('409 invalid-transition, 404 and 413 map to their kinds', async () => {
    const m = mockFetch(
      problem(409, 'invalid-transition', 'Cannot move a suggestion from "approved" to "rejected".'),
      problem(404, 'not-found', 'Suggestion "sug_x" does not exist.'),
      problem(413, 'too-large', 'Request body is too large'),
    );
    const api = createAdminApi({ fetch: m.fetch });
    const kinds = [
      await api.community.rejectSuggestion(SUG_ID, { revision: 1 }),
      await api.community.getSuggestion(SUG_ID),
      await api.studio.saveDraft(STU_ID, { revision: 1, draft: studioDetail().draft! }),
    ].map((r) => (r.ok ? 'ok' : r.error.kind));
    expect(kinds).toEqual(['invalid-transition', 'not-found', 'too-large']);
  });

  it('422 validation-failed: validation result and missing acknowledgements', async () => {
    const m = mockFetch(
      problem(422, 'validation-failed', 'Acknowledge every warning before publishing.', {
        details: { validation: VALIDATION, missingAcknowledgements: ['boundary-crossing', 'not-a-code'] },
      }),
    );
    const r = await createAdminApi({ fetch: m.fetch }).studio.publish(STU_ID, {
      revision: 2,
      acknowledgements: [],
      changeSummary: 'First version',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('unprocessable');
    expect(r.error.code).toBe('validation-failed');
    expect(r.error.validation?.requiredAcknowledgements).toEqual(['boundary-crossing']);
    expect(r.error.missingAcknowledgements).toEqual(['boundary-crossing']); // unknown codes dropped
  });

  it('400 with issues, 422 outside-area and a refused revert (invalid @422)', async () => {
    const m = mockFetch(
      problem(400, 'invalid', 'Request is invalid', {
        issues: [{ path: 'fields.name', message: 'Too short' }],
      }),
      problem(422, 'outside-area', 'The location is outside the campus area.'),
      problem(422, 'invalid', 'Audit event #9 (location.create, success) cannot be reverted.'),
    );
    const api = createAdminApi({ fetch: m.fetch });
    const a = await api.community.createLocation({
      fields: { name: 'X', categoryId: 'shop', location: [0, 0] },
    });
    const b = await api.community.updateLocation(OWN_ID, { revision: 1, fields: { location: [0, 0] } });
    const c = await api.community.revert(9);
    expect(a.ok || a.error).toMatchObject({
      kind: 'invalid',
      issues: [{ path: 'fields.name', message: 'Too short' }],
    });
    expect(b.ok || b.error).toMatchObject({ kind: 'unprocessable', code: 'outside-area' });
    expect(c.ok || c.error).toMatchObject({ kind: 'unprocessable', code: 'invalid' });
  });

  it('429 carries retryAfterS; 503 not-configured and unavailable are distinct', async () => {
    const m = mockFetch(
      problem(429, 'rate-limited', 'Too many attempts', { retryAfterS: 120 }),
      problem(503, 'not-configured', 'Administration is not configured'),
      problem(503, 'unavailable', 'Database is unavailable'),
      new Response('Bad gateway', { status: 502, headers: { 'Content-Type': 'text/plain' } }),
      new Response('', { status: 429, headers: { 'Retry-After': '30' } }),
    );
    const api = createAdminApi({ fetch: m.fetch });
    const login = await api.session.login('x');
    expect(login.ok || login.error).toMatchObject({ kind: 'rate-limited', retryAfterS: 120 });
    if (!login.ok) expect(describeAdminError(login.error)).toMatch(/120 s/);
    const overview = await api.community.overview();
    expect(overview.ok || overview.error.kind).toBe('not-configured');
    const kinds = [];
    for (const r of [
      await api.community.quality(),
      await api.community.quality(),
      await api.community.quality(),
    ])
      kinds.push(r.ok ? 'ok' : `${r.error.kind}:${r.error.retryAfterS ?? ''}`);
    expect(kinds).toEqual(['unavailable:', 'server:', 'rate-limited:30']);
  });
});
