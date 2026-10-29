// @vitest-environment node
// G-08: every network fetch in scripts/ has a timeout, bounded retries with
// backoff and the neutral research User-Agent (no personal identifier).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { scanSource } from '../../../scripts/lib/fetch-footprints-lib.ts';
import {
  FetchFailedError,
  fetchResponseWithRetry,
  fetchTextWithRetry,
  openStream,
  politeInit,
  RESEARCH_USER_AGENT,
  ROBOTS_PRODUCT_TOKEN,
} from '../../../scripts/lib/http.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const noSleep = { sleep: async () => {}, baseDelayMs: 1 };

/** A fetch that never answers until its signal aborts (a hung server). */
const hangingFetch = vi.fn(
  (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason as Error));
    }),
);

describe('User-Agent', () => {
  it('is the neutral research agent, carries no contact, and cannot be overridden', () => {
    expect(RESEARCH_USER_AGENT).toBe('LPU-Campus-Atlas-research/0.1');
    expect(RESEARCH_USER_AGENT).not.toMatch(/@|\+|contact|mailto/i);
    expect(RESEARCH_USER_AGENT.startsWith(`${ROBOTS_PRODUCT_TOKEN}/`)).toBe(true);
    const init = politeInit({ headers: { 'User-Agent': 'me@example.org', Accept: 'text/html' } });
    const headers = new Headers(init.headers);
    expect(headers.get('User-Agent')).toBe(RESEARCH_USER_AGENT);
    expect(headers.get('Accept')).toBe('text/html');
  });

  it('is what every request sends', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => new Response('ok'));
    await fetchTextWithRetry(f as unknown as typeof fetch, 'https://x', {
      headers: { 'User-Agent': 'someone' },
    });
    const init = f.mock.calls[0]![1]!;
    expect(new Headers(init.headers).get('User-Agent')).toBe(RESEARCH_USER_AGENT);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('fetchTextWithRetry / fetchResponseWithRetry', () => {
  it('retries a 503 and then succeeds, with exponential backoff', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('done'));
    const sleeps: number[] = [];
    const out = await fetchTextWithRetry(
      f as unknown as typeof fetch,
      'https://x',
      {},
      { sleep: async (ms) => void sleeps.push(ms), baseDelayMs: 50 },
    );
    expect(out).toBe('done');
    expect(sleeps).toEqual([50, 100]);
  });

  it('times out a hung request and gives up after the bounded budget', async () => {
    hangingFetch.mockClear();
    await expect(
      fetchTextWithRetry(
        hangingFetch as unknown as typeof fetch,
        'https://hang',
        {},
        {
          ...noSleep,
          retries: 2,
          timeoutMs: 20,
        },
      ),
    ).rejects.toThrow(/https:\/\/hang: .*gave up after 3 attempts/);
    expect(hangingFetch).toHaveBeenCalledTimes(3);
  });

  it('never retries a 404 and rejects a retry budget outside 0..5', async () => {
    const f = vi.fn(async () => new Response('', { status: 404 }));
    await expect(fetchTextWithRetry(f as unknown as typeof fetch, 'https://x', {}, noSleep)).rejects.toThrow(
      FetchFailedError,
    );
    expect(f).toHaveBeenCalledTimes(1);
    const r = await fetchResponseWithRetry(f as unknown as typeof fetch, 'https://x', {}, noSleep);
    expect(r).toMatchObject({ status: 404, text: '' });
    await expect(
      fetchTextWithRetry(f as unknown as typeof fetch, 'https://x', {}, { retries: 50 }),
    ).rejects.toThrow(RangeError);
  });
});

const GZ = gzipSync('a\nb\nc\n');
/** A body that delivers `first` bytes and then nothing, ever. */
const stalledBody = (first: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(first);
    },
  });

describe('streaming downloads (fetch-footprints)', () => {
  it('fails on missing response headers instead of waiting forever', async () => {
    await expect(
      openStream(hangingFetch as unknown as typeof fetch, 'https://tile', { timeoutMs: 20 }),
    ).rejects.toThrow(/no response headers within 20 ms/);
  });

  it('aborts a stalled download and restarts it from scratch', async () => {
    let calls = 0;
    const f = vi.fn(async () => {
      calls++;
      return calls === 1 ? new Response(stalledBody(GZ.subarray(0, 8))) : new Response(GZ);
    });
    const r = await scanSource('https://tile', undefined, f as unknown as typeof fetch, (l) => l !== 'b', {
      ...noSleep,
      stallTimeoutMs: 30,
    });
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.kept).toEqual(['a', 'c']);
    expect(r.stats).toMatchObject({ lines: 3, bytes: GZ.length });
    const init = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init[1].headers).get('User-Agent')).toBe(RESEARCH_USER_AGENT);
  });

  it('gives up on a download that keeps stalling', async () => {
    const f = vi.fn(async () => new Response(stalledBody(GZ.subarray(0, 8))));
    await expect(
      scanSource('https://tile', undefined, f as unknown as typeof fetch, () => true, {
        ...noSleep,
        retries: 1,
        stallTimeoutMs: 20,
      }),
    ).rejects.toThrow(/download stalled: no data for 20 ms.*gave up after 2 attempts/);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('retries a 503 tile answer, but not a 404', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(GZ));
    const r = await scanSource('https://tile', undefined, f as unknown as typeof fetch, () => true, noSleep);
    expect(r.kept).toEqual(['a', 'b', 'c']);
    const g = vi.fn(async () => new Response('', { status: 404 }));
    await expect(
      scanSource('https://tile', undefined, g as unknown as typeof fetch, () => true, noSleep),
    ).rejects.toThrow(/HTTP 404/);
    expect(g).toHaveBeenCalledTimes(1);
  });
});

describe('scripts use the shared client', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
    });
  const scripts = files(join(ROOT, 'scripts')).map((p) => ({
    path: relative(ROOT, p).replaceAll('\\', '/'),
    text: readFileSync(p, 'utf8'),
  }));

  it('never call fetch directly except in the shared client and the local admin smoke test', () => {
    // A bare `fetch(` call bypasses timeout, retry and User-Agent; pass `fetch` to the helpers instead.
    const allowed = new Set(['scripts/lib/http.ts', 'scripts/admin-http-smoke.ts']);
    const offenders = scripts
      .filter((s) => !allowed.has(s.path) && /(^|[^\w.])fetch\(/m.test(s.text))
      .map((s) => s.path);
    expect(offenders).toEqual([]);
    const smoke = scripts.find((s) => s.path === 'scripts/admin-http-smoke.ts')!;
    expect(smoke.text).toMatch(/signal: AbortSignal\.timeout\(/);
  });

  it('never put a contact or personal identifier in a User-Agent', () => {
    const offenders = scripts
      .filter((s) => /DATA_FETCH_CONTACT|'User-Agent'\s*:/.test(s.text))
      .map((s) => s.path)
      .filter((p) => p !== 'scripts/lib/http.ts');
    expect(offenders).toEqual([]);
  });
});
