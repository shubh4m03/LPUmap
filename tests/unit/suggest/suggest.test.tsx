/**
 * "Suggest a missing place": validation (the server's own schema), the
 * request outcome mapping, map placement while the panel is open, and the
 * panel's steps — "submitted for review" only after the server confirmed it.
 */
import { act, cleanup, configure, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveRegion } from '../../../src/accessibility/index.ts';
import { useAppStore } from '../../../src/app/store/index.ts';
import { submitSuggestion, waitText } from '../../../src/components/suggest/submit.ts';
import { SuggestPanel } from '../../../src/components/suggest/SuggestPanel.tsx';
import {
  EMPTY_SUGGEST_FORM,
  MARK_FLOOD_FIELD_MESSAGE,
  OUTSIDE_AREA_MESSAGE,
  serverIssueErrors,
  validateSuggestion,
} from '../../../src/components/suggest/suggest-model.ts';
import { useSuggestStore } from '../../../src/components/suggest/suggest-store.ts';
import { useSuggestEditing } from '../../../src/components/suggest/useSuggestEditing.ts';
import { ToastProvider } from '../../../src/components/ui/index.ts';
import { APP_CONFIG } from '../../../src/config/index.ts';

// Sections load lazily; under a full parallel run the first render can take longer than 1 s.
configure({ asyncUtilTimeout: 5000 });

const ON_CAMPUS: [number, number] = [75.7032, 31.2533];
const initialApp = useAppStore.getState();

const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? 'x' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': body === null ? 'text/html' : 'application/json', ...headers },
  });
const accepted = {
  reference: 'sug_abc',
  status: 'pending',
  message:
    'Your location suggestion has been submitted for review. It will not appear on the public map until it is approved.',
  possibleDuplicates: [
    { id: 'osm:node/1', kind: 'place', name: 'Tea Point', distanceM: 14.2, reason: 'Similar name' },
  ],
};

beforeEach(() => {
  useSuggestStore.getState().reset();
  useAppStore.setState(initialApp, true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('validation', () => {
  const ok = { ...EMPTY_SUGGEST_FORM, name: 'Tea point', categoryId: 'food' };
  it('accepts a complete suggestion and sends only the contract fields', () => {
    const v = validateSuggestion({ ...ok, description: '  hot tea  ', evidenceUrl: '' }, ON_CAMPUS);
    expect(v).toEqual({
      ok: true,
      body: { name: 'Tea point', categoryId: 'food', location: ON_CAMPUS, description: 'hot tea' },
    });
  });
  it('requires a point inside the covered area, a name and a category; checks the link', () => {
    const v = validateSuggestion({ ...EMPTY_SUGGEST_FORM, evidenceUrl: 'javascript:alert(1)' }, null);
    expect(v.ok).toBe(false);
    if (!v.ok)
      expect(Object.keys(v.errors).sort()).toEqual(['categoryId', 'evidenceUrl', 'location', 'name']);
    const [w, s] = APP_CONFIG.map.maxBounds;
    const out = validateSuggestion(ok, [w - 0.01, s - 0.01]);
    expect(out.ok ? null : out.errors.location).toBe(OUTSIDE_AREA_MESSAGE);
  });
  it('refuses stacked combining marks ("Zalgo") with a message that says so', () => {
    const zalgo = `A${'́'.repeat(40)}`;
    const v = validateSuggestion(
      { ...ok, name: `Tea ${zalgo}`, description: zalgo, landmark: zalgo },
      ON_CAMPUS,
    );
    expect(v.ok).toBe(false);
    if (!v.ok)
      expect(v.errors).toEqual({
        name: MARK_FLOOD_FIELD_MESSAGE,
        description: MARK_FLOOD_FIELD_MESSAGE,
        landmark: MARK_FLOOD_FIELD_MESSAGE,
      });
  });
  it('passes the honeypot through to the server (which discards the submission)', () => {
    const v = validateSuggestion({ ...ok, website: 'http://spam' }, ON_CAMPUS);
    expect(v.ok && v.body.website).toBe('http://spam');
  });
  it('maps server issues onto the fields', () => {
    expect(
      serverIssueErrors([
        { path: 'name', message: 'Too small' },
        { path: 'x', message: 'y' },
      ]),
    ).toEqual({
      name: "Enter the place's name (2–120 characters).",
    });
  });
});

describe('submission outcome', () => {
  const body = { name: 'Tea point', categoryId: 'food', location: ON_CAMPUS };
  const run = (r: Response | Error) =>
    submitSuggestion(body, { fetch: async () => (r instanceof Error ? Promise.reject(r) : r) });

  it('reports "submitted" only for the documented pending answer', async () => {
    expect(await run(res(201, accepted))).toMatchObject({ kind: 'submitted', reference: 'sug_abc' });
    expect(await run(res(202, accepted))).toMatchObject({ kind: 'submitted' });
    expect(await run(res(201, { reference: 'x', status: 'approved' }))).toEqual({ kind: 'unknown' });
    expect(await run(res(200, null))).toEqual({ kind: 'unknown' });
  });
  it('maps every failure to what happened', async () => {
    expect(await run(res(429, { error: { code: 'rate-limited', message: 'x', retryAfterS: 120 } }))).toEqual({
      kind: 'rate-limited',
      retryAfterS: 120,
    });
    expect(await run(res(429, null, { 'Retry-After': '30' }))).toEqual({
      kind: 'rate-limited',
      retryAfterS: 30,
    });
    expect(await run(res(422, { error: { code: 'outside-area', message: 'x' } }))).toEqual({
      kind: 'outside-area',
    });
    expect(
      await run(
        res(400, { error: { code: 'invalid', message: 'x', issues: [{ path: 'name', message: 'm' }] } }),
      ),
    ).toEqual({
      kind: 'invalid',
      issues: [{ path: 'name', message: 'm' }],
    });
    expect(await run(res(413, { error: { code: 'too-large', message: 'x' } }))).toEqual({
      kind: 'too-large',
    });
    expect(await run(res(403, { error: { code: 'csrf', message: 'x' } }))).toEqual({ kind: 'refused' });
    expect(await run(res(503, { error: { code: 'unavailable', message: 'x' } }))).toEqual({
      kind: 'unavailable',
    });
    expect(await run(res(404, null))).toEqual({ kind: 'no-api' });
    expect(await run(res(405, { error: { code: 'invalid', message: 'Method not allowed' } }))).toEqual({
      kind: 'no-api',
    });
    expect(await run(res(500, { error: { code: 'internal', message: 'x' } }))).toEqual({ kind: 'unknown' });
    expect(await run(new TypeError('offline'))).toEqual({ kind: 'unknown' });
  });
  it('sends JSON to the same-origin endpoint', async () => {
    const f = vi.fn(async () => res(201, accepted));
    await submitSuggestion(body, { fetch: f });
    expect(f).toHaveBeenCalledWith(
      '/api/contributions/locations',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: JSON.stringify(body) }),
    );
  });
  it('words the wait', () => {
    expect(waitText(null)).toBe('a while');
    expect(waitText(30)).toBe('about 30 seconds');
    expect(waitText(600)).toBe('about 10 minutes');
  });
});

describe('map placement', () => {
  it('is off unless the suggest panel is open; a click places the point and the handle drags it', () => {
    const { result, rerender } = renderHook(() => useSuggestEditing());
    expect(result.current).toBeNull();
    act(() => useAppStore.getState().openPanel('suggest'));
    rerender();
    expect(result.current?.input).toBe('pointer');
    expect(result.current?.handles).toEqual([]);
    act(() =>
      result.current!.onPointer!({ type: 'click', lngLat: [75.70321234567, 31.2533], placeId: 'osm:way/1' }),
    );
    expect(useSuggestStore.getState().point).toEqual([75.7032123, 31.2533]);
    rerender();
    expect(result.current?.handles[0]).toMatchObject({ kind: 'move', position: [75.7032123, 31.2533] });
    const drag = {
      handleId: 'move',
      kind: 'move' as const,
      start: [75.7032123, 31.2533] as [number, number],
      modifiers: { shift: false, alt: false },
    };
    act(() => result.current!.onHandleDrag!({ ...drag, phase: 'end', current: [75.704, 31.254] }));
    expect(useSuggestStore.getState().point).toEqual([75.704, 31.254]);
    act(() => result.current!.onHandleDrag!({ ...drag, phase: 'cancel', current: drag.start }));
    expect(useSuggestStore.getState().point).toEqual(drag.start);
    act(() => useSuggestStore.getState().setStep('submitted'));
    rerender();
    expect(result.current).toBeNull();
  });

  it('phones use the centre pin on the placement step', () => {
    vi.stubGlobal(
      'matchMedia',
      (q: string) =>
        ({
          matches: q.includes('max-width'),
          media: q,
          addEventListener() {},
          removeEventListener() {},
        }) as unknown as MediaQueryList,
    );
    act(() => useAppStore.getState().openPanel('suggest'));
    const { result } = renderHook(() => useSuggestEditing());
    expect(result.current?.input).toBe('reticle');
    act(() => result.current!.onReticleChange!([75.70299999999, 31.25]));
    expect(useSuggestStore.getState().reticleCenter).toEqual([75.703, 31.25]);
    // A tap on the map does not move the point on phones.
    act(() => result.current!.onPointer!({ type: 'click', lngLat: [75.71, 31.26], placeId: null }));
    expect(useSuggestStore.getState().point).toBeNull();
  });
});

function renderPanel() {
  act(() => useAppStore.getState().openPanel('suggest'));
  return render(
    <ToastProvider>
      <SuggestPanel />
      <LiveRegion />
    </ToastProvider>,
  );
}

describe('suggest panel', () => {
  it('walks from placement to a truthful "submitted for review"', async () => {
    const user = userEvent.setup();
    const fetch = vi.fn(async () => res(201, accepted));
    vi.stubGlobal('fetch', fetch);
    renderPanel();
    expect(screen.getByRole('heading', { name: /Where is it\?/ })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    act(() => useSuggestStore.getState().setPoint(ON_CAMPUS));
    expect(screen.getByText('Marker at 31.253300, 75.703200.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: /About the place/ })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Send for review' }));
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(screen.getByText('Choose what kind of place it is.')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Name'), 'Tea point');
    await user.selectOptions(screen.getByLabelText('Kind of place'), 'food');
    await user.click(screen.getByRole('button', { name: 'Send for review' }));
    const heading = await screen.findByRole('heading', { name: 'Submitted for review' });
    const done = heading.closest('[role="status"]') as HTMLElement;
    expect(done).not.toBeNull();
    expect(done).toHaveTextContent('It will not appear on the public map until it is approved.');
    expect(done).toHaveTextContent('Reference: sug_abc');
    expect(done).toHaveTextContent('Tea Point (14 m away)');
    expect(done).not.toHaveTextContent(/published|now on the map/i);
  });

  it('a rate limit says nothing was saved and how long to wait; the form is kept', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res(429, { error: { code: 'rate-limited', message: 'x', retryAfterS: 300 } })),
    );
    act(() => {
      useSuggestStore.getState().setPoint(ON_CAMPUS);
      useSuggestStore.getState().setStep('details');
      useSuggestStore.getState().setValues({ name: 'Tea point', categoryId: 'food' });
    });
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Send for review' }));
    const form = screen.getByRole('button', { name: 'Send for review' }).closest('form')!;
    const alert = await within(form).findByRole('alert');
    expect(alert).toHaveTextContent('Too many suggestions from this connection');
    expect(alert).toHaveTextContent('Nothing was saved. Please try again in about 5 minutes.');
    expect(screen.getByLabelText('Name')).toHaveValue('Tea point');
    expect(screen.queryByText('Submitted for review')).toBeNull();
  });

  it('without a server it says suggestions are unavailable here; a lost answer is "unknown", not success', async () => {
    const user = userEvent.setup();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(404, null))
      .mockRejectedValueOnce(new TypeError('offline'));
    vi.stubGlobal('fetch', fetch);
    act(() => {
      useSuggestStore.getState().setPoint(ON_CAMPUS);
      useSuggestStore.getState().setStep('details');
      useSuggestStore.getState().setValues({ name: 'Tea point', categoryId: 'food' });
    });
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Send for review' }));
    const form = screen.getByRole('button', { name: 'Send for review' }).closest('form')!;
    expect(
      await within(form).findByText('Suggestions are not available on this version of the site'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send for review' }));
    expect(await within(form).findByText('No confirmation received')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send again' })).toBeInTheDocument();
  });

  it('the honeypot is hidden from people and assistive technology', () => {
    act(() => {
      useSuggestStore.getState().setPoint(ON_CAMPUS);
      useSuggestStore.getState().setStep('details');
    });
    const { container } = renderPanel();
    const trap = container.querySelector('input[name="website"]')!;
    expect(trap).toHaveAttribute('tabindex', '-1');
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Leave this field empty' })).toBeNull();
  });

  it('in the overview it asks to show the map first', async () => {
    act(() => useAppStore.getState().setViewMode('isometric'));
    renderPanel();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show the map' })).toBeInTheDocument());
  });
});
