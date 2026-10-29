// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchSnapshot,
  fetchTextWithRetry,
  FetchFailedError,
  overpassBboxQuery,
  withMargin,
} from '../../../scripts/lib/fetch-osm-lib.ts';
import { RESEARCH_USER_AGENT } from '../../../scripts/lib/http.ts';
import { sourceMetaSchema } from '../../../scripts/lib/source-meta.ts';

const FIXTURE = readFileSync(
  new URL('../../fixtures/osm/synthetic-campus/synthetic-campus.osm', import.meta.url),
  'utf8',
);
const noSleep = { sleep: async () => {}, baseDelayMs: 1 };
const text = (body: string, status = 200) =>
  ({ ok: status < 400, status, text: async () => body }) as Response;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'fetch-osm-'));
  dirs.push(d);
  return d;
};

describe('helpers', () => {
  it('adds a margin and orders Overpass bbox as s,w,n,e', () => {
    expect(withMargin([75.7, 31.25, 75.71, 31.26], 0.005)).toEqual([75.695, 31.245, 75.715, 31.265]);
    expect(overpassBboxQuery([75.695, 31.245, 75.715, 31.265])).toContain('nwr(31.245,75.695,31.265,75.715)');
  });
});

describe('fetchTextWithRetry', () => {
  it('retries 5xx/429/network errors with exponential backoff, then succeeds', async () => {
    const f = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(text('', 503))
      .mockResolvedValueOnce(text('', 429))
      .mockResolvedValueOnce(text('ok'));
    const sleeps: number[] = [];
    const out = await fetchTextWithRetry(
      f as unknown as typeof fetch,
      'https://x',
      {},
      { sleep: async (ms) => void sleeps.push(ms), baseDelayMs: 100 },
    );
    expect(out).toBe('ok');
    expect(sleeps).toEqual([100, 200, 400]);
  });

  it('gives up after the retry budget and does not retry client errors', async () => {
    const f = vi.fn().mockResolvedValue(text('', 502));
    await expect(
      fetchTextWithRetry(f as unknown as typeof fetch, 'https://x', {}, { ...noSleep, retries: 3 }),
    ).rejects.toThrow(FetchFailedError);
    expect(f).toHaveBeenCalledTimes(4);
    const g = vi.fn().mockResolvedValue(text('', 400));
    await expect(fetchTextWithRetry(g as unknown as typeof fetch, 'https://x', {}, noSleep)).rejects.toThrow(
      /HTTP 400/,
    );
    expect(g).toHaveBeenCalledTimes(1);
  });
});

describe('fetchSnapshot', () => {
  const base = {
    relationId: 900001,
    now: () => new Date('2026-05-06T07:08:09.123Z'),
    retry: { ...noSleep, retries: 0 },
  };

  it('does nothing when a snapshot exists and --force is not given', async () => {
    const dir = tmp();
    for (const f of ['boundary-relation-900001.osm', 'campus-bbox.osm', 'SOURCE.json'])
      writeFileSync(join(dir, f), 'x');
    const f = vi.fn();
    expect(
      await fetchSnapshot({ ...base, rawDir: dir, force: false, fetchImpl: f as unknown as typeof fetch }),
    ).toEqual({ status: 'cached' });
    expect(f).not.toHaveBeenCalled();
  });

  it('falls back to the OSM API when Overpass is unreachable and records provenance', async () => {
    const dir = tmp();
    const calls: string[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url}`);
      expect(new Headers(init?.headers).get('User-Agent')).toBe(RESEARCH_USER_AGENT);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (url.includes('overpass')) throw new Error('connect ETIMEDOUT');
      return text(FIXTURE);
    });
    const r = await fetchSnapshot({
      ...base,
      rawDir: dir,
      force: true,
      fetchImpl: f as unknown as typeof fetch,
    });
    expect(r.status).toBe('fetched');
    expect(calls.filter((c) => c.startsWith('GET'))).toEqual([
      'GET https://api.openstreetmap.org/api/0.6/relation/900001/full',
      'GET https://api.openstreetmap.org/api/0.6/map?bbox=75.683,31.233,75.697,31.247',
    ]);
    const meta = sourceMetaSchema.parse(JSON.parse(readFileSync(join(dir, 'SOURCE.json'), 'utf8')));
    expect(meta).toMatchObject({
      method: 'osm-api-map',
      retrievedAt: '2026-05-06T07:08:09Z',
      license: 'ODbL 1.0',
      bbox: [75.683, 31.233, 75.697, 31.247],
    });
    expect(existsSync(join(dir, 'campus-bbox.osm.tmp'))).toBe(false);
    expect(readFileSync(join(dir, 'campus-bbox.osm'), 'utf8')).toBe(FIXTURE);
  });

  it('uses Overpass when it answers', async () => {
    const dir = tmp();
    const f = vi.fn(async () => text(FIXTURE));
    const r = await fetchSnapshot({
      ...base,
      rawDir: dir,
      force: true,
      fetchImpl: f as unknown as typeof fetch,
    });
    expect(r.status === 'fetched' && r.meta.method).toBe('overpass');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('refuses a response without the boundary relation and writes nothing', async () => {
    const dir = tmp();
    const f = vi.fn(async () => text('<osm version="0.6"></osm>'));
    await expect(
      fetchSnapshot({ ...base, rawDir: dir, force: true, fetchImpl: f as unknown as typeof fetch }),
    ).rejects.toThrow(/lacks relation 900001/);
    expect(existsSync(join(dir, 'SOURCE.json'))).toBe(false);
  });
});
