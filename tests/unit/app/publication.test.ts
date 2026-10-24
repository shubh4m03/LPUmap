/**
 * loadPublication: network-first with a short timeout and a saved copy, and
 * truthful states when the API is absent (static hosting) or failing.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  cacheStorageStore,
  loadPublication,
  parsePublication,
  type PublicationStore,
} from '../../../src/app/data/publication.ts';
import { publicationStatusText } from '../../../src/app/data/publication-status.ts';
import { EMPTY_PUBLICATION, type Publication } from '../../../src/community/schema.ts';

const PUB: Publication = {
  ...EMPTY_PUBLICATION,
  publicationVersion: 12,
  generatedAt: '2026-10-24T05:00:00.000Z',
};
const SAVED_AT = '2026-10-23T10:00:00.000Z';

const json = (body: unknown, status = 200, type = 'application/json; charset=utf-8') =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });

function memoryStore(initial: Publication | null = null): PublicationStore & { saved: Publication | null } {
  const s = {
    saved: initial,
    savedAt: SAVED_AT,
    read: () => Promise.resolve(s.saved ? { savedAt: s.savedAt, publication: s.saved } : null),
    write: (p: Publication, at: string) => {
      s.saved = p;
      s.savedAt = at;
      return Promise.resolve();
    },
  };
  return s;
}

const NOW = () => new Date('2026-10-24T06:00:00.000Z');
const online = () => true;

describe('loadPublication', () => {
  it('live: parses, saves the copy, and asks without cookies with ETag revalidation', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(json(PUB)));
    const store = memoryStore();
    const r = await loadPublication({ fetchImpl, store, online, now: NOW });
    expect(r.status).toEqual({
      kind: 'live',
      publicationVersion: 12,
      generatedAt: PUB.generatedAt,
      buildings: 0,
    });
    expect(r.publication?.publicationVersion).toBe(12);
    expect(store.saved?.publicationVersion).toBe(12);
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(fetchImpl.mock.calls[0]![0]).toBe('/api/locations');
    expect(init).toMatchObject({ credentials: 'omit', cache: 'no-cache' });
  });

  it('API absent (static hosting): 404 or an HTML fallback page → "unavailable", never the saved copy', async () => {
    const store = memoryStore(PUB);
    for (const res of [
      new Response('Not found', { status: 404 }),
      new Response('<!doctype html><title>app</title>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
      new Response('', { status: 405 }),
    ]) {
      const r = await loadPublication({ fetchImpl: () => Promise.resolve(res), store, online });
      expect(r).toEqual({ status: { kind: 'unavailable' }, publication: null });
    }
  });

  it('a server error or invalid body falls back to the saved copy, saying why', async () => {
    const store = memoryStore(PUB);
    const r = await loadPublication({ fetchImpl: () => Promise.resolve(json({}, 503)), store, online });
    expect(r.status).toMatchObject({
      kind: 'saved',
      reason: 'http',
      savedAt: SAVED_AT,
      publicationVersion: 12,
    });
    expect(r.publication).toEqual(PUB);
    const bad = await loadPublication({
      fetchImpl: () => Promise.resolve(json({ schemaVersion: 99 })),
      store,
      online,
    });
    expect(bad.status).toMatchObject({ kind: 'saved', reason: 'invalid' });
  });

  it('fails truthfully with no saved copy (base data only)', async () => {
    const r = await loadPublication({
      fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')),
      store: memoryStore(),
      online,
    });
    expect(r).toEqual({ status: { kind: 'failed', reason: 'network' }, publication: null });
  });

  it('offline: does not send a request at all, uses the saved copy', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const r = await loadPublication({ fetchImpl, store: memoryStore(PUB), online: () => false });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.status).toMatchObject({ kind: 'saved', reason: 'offline' });
  });

  it('slow network: answers from the saved copy after the timeout; the late answer refreshes it', async () => {
    let resolve!: (r: Response) => void;
    const fetchImpl = () => new Promise<Response>((r) => (resolve = r));
    const store = memoryStore({ ...PUB, publicationVersion: 3 });
    const r = await loadPublication({ fetchImpl, store, online, timeoutMs: 5, now: NOW });
    expect(r.status).toMatchObject({ kind: 'saved', reason: 'timeout', publicationVersion: 3 });
    resolve(json(PUB));
    await vi.waitFor(() => expect(store.saved?.publicationVersion).toBe(12));
  });

  it('strips everything outside the public shape before using or saving it', async () => {
    const store = memoryStore();
    const body = { ...PUB, drafts: [{ id: 'x' }], notes: 'private' };
    const r = await loadPublication({ fetchImpl: () => Promise.resolve(json(body)), store, online });
    expect(JSON.stringify(r.publication)).not.toMatch(/drafts|private/);
    expect(JSON.stringify(store.saved)).not.toMatch(/drafts|private/);
  });

  it('has no Cache Storage store where the browser has none (jsdom), and still works', async () => {
    expect(cacheStorageStore()).toBeNull();
    const r = await loadPublication({ fetchImpl: () => Promise.resolve(json(PUB)), online });
    expect(r.status.kind).toBe('live');
  });
});

describe('publicationStatusText', () => {
  it('says when the owner updates last changed, or why only the base dataset is shown', () => {
    expect(
      publicationStatusText({
        kind: 'live',
        publicationVersion: 0,
        generatedAt: PUB.generatedAt,
        buildings: 0,
      }),
    ).toBe('None published yet.');
    expect(
      publicationStatusText({
        kind: 'live',
        publicationVersion: 4,
        generatedAt: PUB.generatedAt,
        buildings: 2,
      }),
    ).toBe('Last updated 24 Oct 2026, 10:30 am · 2 owner-placed buildings.');
    expect(
      publicationStatusText({
        kind: 'saved',
        publicationVersion: 4,
        generatedAt: PUB.generatedAt,
        buildings: 0,
        savedAt: SAVED_AT,
        reason: 'offline',
      }),
    ).toBe(
      'Saved copy from 23 Oct 2026, 3:30 pm (last updated 24 Oct 2026, 10:30 am): could not refresh because you are offline.',
    );
    expect(publicationStatusText({ kind: 'unavailable' })).toMatch(/base dataset only/);
    expect(publicationStatusText({ kind: 'failed', reason: 'http' })).toBe(
      'Could not be loaded because the server reported an error: showing the base dataset only.',
    );
    expect(
      publicationStatusText(
        { kind: 'live', publicationVersion: 4, generatedAt: PUB.generatedAt, buildings: 1 },
        1,
      ),
    ).toMatch(/1 owner-placed building is not shown/);
  });
});

describe('parsePublication', () => {
  it('drops a single malformed record instead of blanking every owner update', () => {
    const good = { ...PUB, locations: [], overrides: [] };
    const body = { ...good, buildings: [{ id: 'stu:not-a-valid-record', draft: true }] };
    expect(parsePublication(body)).toMatchObject({ publicationVersion: 12, buildings: [] });
    expect(parsePublication({ schemaVersion: 3 })).toBeNull();
    expect(parsePublication('nope')).toBeNull();
  });
});
