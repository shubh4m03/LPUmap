import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../../server/env.ts';
import { Router } from '../../../server/http/router.ts';
import { etagMatches, publicationEtag } from '../../../server/handlers/publication.ts';
import { accessEnvVars } from '../auth/jwt-fixtures.ts';

describe('Router', () => {
  const r = new Router<string>([
    { method: 'GET', pattern: '/suggestions/:id', handler: 'get' },
    { method: 'PATCH', pattern: '/suggestions/:id', handler: 'patch' },
    { method: 'GET', pattern: '/overrides/:targetId', handler: 'override' },
    { method: 'POST', pattern: '/locations/:locationId/hide', handler: 'hide' },
  ]);
  const id = 'sug_abcdefghijklmnopqrstuvwxyz';

  it('matches method + pattern and validates params', () => {
    expect(r.match('GET', `/suggestions/${id}`)).toMatchObject({ kind: 'match', params: { id } });
    expect(r.match('GET', `/suggestions/${id}/`)).toMatchObject({ kind: 'match' });
    expect(r.match('DELETE', `/suggestions/${id}`)).toEqual({
      kind: 'method-not-allowed',
      allowed: ['GET', 'PATCH'],
    });
    expect(r.match('GET', '/suggestions/sug_short')).toEqual({ kind: 'invalid-param' });
    expect(r.match('GET', '/nothing')).toEqual({ kind: 'not-found' });
    expect(r.match('GET', `/suggestions/${id}/extra`)).toEqual({ kind: 'not-found' });
  });

  it('decodes encoded base place ids and rejects others', () => {
    expect(r.match('GET', '/overrides/osm%3Away%2F123')).toMatchObject({
      params: { targetId: 'osm:way/123' },
    });
    expect(r.match('GET', '/overrides/cur%3Amain-gate')).toMatchObject({
      params: { targetId: 'cur:main-gate' },
    });
    expect(r.match('GET', '/overrides/osm%3Away%2F..%2F1')).toEqual({ kind: 'invalid-param' });
    expect(r.match('GET', '/overrides/own%3Aabc')).toEqual({ kind: 'invalid-param' });
    expect(r.match('POST', '/locations/com:abcdefghijklmnopqrstuvwxyz/hide')).toMatchObject({
      kind: 'match',
    });
    expect(r.match('POST', '/locations/sug_abcdefghijklmnopqrstuvwxyz/hide')).toEqual({
      kind: 'invalid-param',
    });
  });

  it('refuses unknown parameter names at construction', () => {
    expect(() => new Router([{ method: 'GET', pattern: '/x/:anything', handler: 1 }])).toThrow(
      /Unknown route parameter/,
    );
  });
});

describe('parseEnv', () => {
  it('fails closed and names (never echoes) problems', () => {
    expect(parseEnv(undefined).auth).toEqual({ mode: 'not-configured', problems: ['AUTH_MODE'] });
    const p = parseEnv({ AUTH_MODE: 'password', OWNER_PASSWORD_HASH: 'hunter2' });
    expect(p.auth).toEqual({ mode: 'not-configured', problems: ['OWNER_PASSWORD_HASH'] });
    expect(JSON.stringify(p)).not.toContain('hunter2');
    expect(parseEnv({ ...accessEnvVars, ACCESS_AUD: ' ' }).auth.mode).toBe('not-configured');
    expect(parseEnv({ ...accessEnvVars, AUTH_MODE: 'ACCESS' }).auth.mode).toBe('not-configured');
  });

  it('parses access mode with case-insensitive owner emails', () => {
    const p = parseEnv(accessEnvVars);
    expect(p.auth.mode).toBe('access');
    if (p.auth.mode === 'access') {
      expect([...p.auth.access.ownerEmails]).toEqual(['someone@else.org', 'owner@example.org']);
      expect(p.auth.access.teamDomain).toBe('https://lpu-team.cloudflareaccess.com');
    }
  });

  it('ignores a weak RATE_LIMIT_KEY and an invalid PUBLIC_ORIGIN (reported by name only)', () => {
    const p = parseEnv({ RATE_LIMIT_KEY: 'short', PUBLIC_ORIGIN: 'javascript:alert(1)' });
    expect(p.rateLimitKey).toBeNull();
    expect(p.publicOrigin).toBeNull();
    expect(p.warnings).toEqual(['RATE_LIMIT_KEY', 'PUBLIC_ORIGIN']);
    expect(parseEnv({ PUBLIC_ORIGIN: 'https://atlas.example.org/' }).publicOrigin).toBe(
      'https://atlas.example.org',
    );
    expect(parseEnv({ PUBLIC_ORIGIN: 'http://atlas.example.org' }).publicOrigin).toBeNull();
  });

  it('treats a non-database DB binding as missing', () => {
    expect(parseEnv({ DB: {} as never }).db).toBeNull();
  });
});

describe('publication ETag', () => {
  it('uses weak comparison and supports lists and *', () => {
    const e = publicationEtag(7, 2);
    expect(e).toBe('W/"pub-v2-7"');
    expect(etagMatches('W/"pub-v2-7"', e)).toBe(true);
    expect(etagMatches('"pub-v2-7"', e)).toBe(true);
    expect(etagMatches('W/"pub-v2-6", W/"pub-v2-7"', e)).toBe(true);
    expect(etagMatches('*', e)).toBe(true);
    expect(etagMatches('W/"pub-v2-70"', e)).toBe(false);
    expect(etagMatches('W/"pub-7"', e)).toBe(false);
    expect(etagMatches(null, e)).toBe(false);
  });
});
