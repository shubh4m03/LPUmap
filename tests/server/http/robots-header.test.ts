/**
 * G-16 (server half): every API response is noindex. Cloudflare Pages applies
 * public/_headers to static files only, never to Pages Functions responses, so
 * the header must come from the shared API response helpers.
 */
import { describe, expect, it, vi } from 'vitest';
import { onRequest as adminFn } from '../../../functions/api/admin/[[path]].ts';
import { onRequest as healthFn } from '../../../functions/api/health.ts';
import { onRequest as locationsFn } from '../../../functions/api/locations.ts';
import type { SqlDatabase } from '../../../server/db/types.ts';
import { HttpError } from '../../../server/http/errors.ts';
import { empty, errorResponse, json, problem } from '../../../server/http/response.ts';
import { req } from './fixtures.ts';

const NOINDEX = /\bnoindex\b/;

const exploding: SqlDatabase = {
  prepare() {
    throw new Error('boom');
  },
  batch: () => Promise.reject(new Error('boom')),
  exec: () => Promise.reject(new Error('boom')),
};

describe('API responses carry X-Robots-Tag: noindex', () => {
  it('on every response helper (200, 204/304, problem, unexpected error)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const responses = [
      json({ ok: true }),
      empty(304),
      problem(new HttpError('invalid', 'Bad input')),
      errorResponse(new Error('unexpected')),
    ];
    for (const res of responses) expect(res.headers.get('X-Robots-Tag')).toMatch(NOINDEX);
  });

  it('through the real Pages Functions adapters, success and failure alike', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const responses = [
      await healthFn({ request: req('GET', '/api/health'), env: { AUTH_MODE: 'access' } }),
      await locationsFn({ request: req('GET', '/api/locations'), env: { DB: exploding } }),
      await adminFn({ request: req('GET', '/api/admin/session'), env: { AUTH_MODE: 'access' } }),
    ];
    for (const res of responses) expect(res.headers.get('X-Robots-Tag')).toMatch(NOINDEX);
  });
});
