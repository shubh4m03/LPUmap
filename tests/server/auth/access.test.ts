import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JWKS_TTL_MS, resetJwksCache, verifyAccessJwt } from '../../../server/auth/access.ts';
import type { AccessConfig } from '../../../server/auth/access.ts';
import { bytesToB64url, utf8 } from '../../../server/auth/encoding.ts';
import { AUD, OWNER, TEAM, claims, jwksFetch, makeKey, sign } from './jwt-fixtures.ts';
import type { TestKey } from './jwt-fixtures.ts';

const config: AccessConfig = { teamDomain: TEAM, aud: AUD, ownerEmails: new Set([OWNER.toLowerCase()]) };
const now = new Date('2026-10-24T10:00:00.000Z');

let key: TestKey;
let otherKey: TestKey;

beforeAll(async () => {
  key = await makeKey('kid-1');
  otherKey = await makeKey('kid-1'); // same kid, different key material
});
beforeEach(() => resetJwksCache());

async function verify(token: string, opts: { at?: Date; keys?: TestKey[] } = {}) {
  return verifyAccessJwt(token, config, { fetch: jwksFetch(opts.keys ?? [key]), now: opts.at ?? now });
}

async function rejection(p: Promise<unknown>): Promise<{ code: string; status: number }> {
  try {
    await p;
  } catch (e) {
    const err = e as { code: string; status: number };
    return { code: err.code, status: err.status };
  }
  throw new Error('expected rejection');
}

describe('Cloudflare Access JWT verification', () => {
  it('accepts a valid token and returns the lower-cased email', async () => {
    const id = await verify(await sign(key, claims(now)));
    expect(id).toEqual({ email: OWNER.toLowerCase() });
  });

  it('accepts aud as a string as well as an array', async () => {
    await expect(verify(await sign(key, claims(now, { aud: AUD })))).resolves.toBeTruthy();
  });

  it.each([
    ['wrong aud', { aud: ['other-aud'] }],
    ['aud missing', { aud: undefined }],
    ['wrong iss', { iss: 'https://evil.cloudflareaccess.com' }],
    ['iss with trailing slash', { iss: `${TEAM}/` }],
    ['expired beyond skew', { exp: Math.floor(now.getTime() / 1000) - 61 }],
    ['exp missing', { exp: undefined }],
    ['exp not a number', { exp: '9999999999' }],
    ['nbf in the future beyond skew', { nbf: Math.floor(now.getTime() / 1000) + 61 }],
    ['iat in the future beyond skew', { iat: Math.floor(now.getTime() / 1000) + 3600 }],
  ])('rejects %s with 401', async (_label, over) => {
    const r = await rejection(verify(await sign(key, claims(now, over))));
    expect(r).toEqual({ code: 'unauthenticated', status: 401 });
  });

  it('tolerates clock skew up to 60 s on exp and nbf', async () => {
    const t = Math.floor(now.getTime() / 1000);
    await expect(verify(await sign(key, claims(now, { exp: t - 59 })))).resolves.toBeTruthy();
    await expect(verify(await sign(key, claims(now, { nbf: t + 59 })))).resolves.toBeTruthy();
  });

  it('rejects a token signed by a different key with the same kid', async () => {
    const r = await rejection(verify(await sign(otherKey, claims(now))));
    expect(r.status).toBe(401);
  });

  it('rejects an unknown kid', async () => {
    const stranger = await makeKey('kid-unknown');
    expect((await rejection(verify(await sign(stranger, claims(now))))).status).toBe(401);
  });

  it('rejects alg "none" and an empty signature', async () => {
    const h = bytesToB64url(utf8(JSON.stringify({ alg: 'none', kid: 'kid-1' })));
    const p = bytesToB64url(utf8(JSON.stringify(claims(now))));
    expect((await rejection(verify(`${h}.${p}.`))).status).toBe(401);
    // Even with an RS256 header, an empty signature never verifies.
    const h2 = bytesToB64url(utf8(JSON.stringify({ alg: 'RS256', kid: 'kid-1' })));
    expect((await rejection(verify(`${h2}.${p}.`))).status).toBe(401);
  });

  it('rejects HS256 (algorithm confusion) even when "signed" with the public key material', async () => {
    const r = await rejection(verify(await sign(key, claims(now), { alg: 'HS256' })));
    expect(r.status).toBe(401);
  });

  it('rejects a tampered payload (email swapped after signing)', async () => {
    const token = await sign(key, claims(now, { email: 'intruder@example.org' }));
    const [h, , s] = token.split('.');
    const forged = bytesToB64url(utf8(JSON.stringify(claims(now))));
    expect((await rejection(verify(`${h}.${forged}.${s}`))).status).toBe(401);
  });

  it.each(['', 'a.b', 'a.b.c.d', '!!!.###.$$$', `${'a'.repeat(17000)}.b.c`])(
    'rejects malformed token %#',
    async (token) => {
      expect((await rejection(verify(token))).status).toBe(401);
    },
  );

  it('returns 403 when the verified email is not an allowlisted owner', async () => {
    const r = await rejection(verify(await sign(key, claims(now, { email: 'student@example.org' }))));
    expect(r).toEqual({ code: 'forbidden', status: 403 });
    const none = await rejection(verify(await sign(key, claims(now, { email: undefined }))));
    expect(none.status).toBe(403);
  });

  it('caches the JWKS for up to 1 h, then refetches', async () => {
    const fetch = jwksFetch([key]);
    const token = await sign(key, claims(now, { exp: Math.floor(now.getTime() / 1000) + 3 * 3600 }));
    await verifyAccessJwt(token, config, { fetch, now });
    await verifyAccessJwt(token, config, { fetch, now: new Date(now.getTime() + 30 * 60 * 1000) });
    expect(fetch.calls).toEqual([`${TEAM}/cdn-cgi/access/certs`]);
    await verifyAccessJwt(token, config, { fetch, now: new Date(now.getTime() + JWKS_TTL_MS + 1000) });
    expect(fetch.calls).toHaveLength(2);
  });

  it('picks up a rotated key (unknown kid triggers a rate-limited refetch)', async () => {
    const rotated = await makeKey('kid-2');
    const keys = [key];
    const fetch = jwksFetch(keys);
    await verifyAccessJwt(await sign(key, claims(now)), config, { fetch, now });
    keys.push(rotated);
    const later = new Date(now.getTime() + 31_000);
    await expect(
      verifyAccessJwt(await sign(rotated, claims(later)), config, { fetch, now: later }),
    ).resolves.toBeTruthy();
    expect(fetch.calls).toHaveLength(2);
  });

  it('fails closed with 503 when the JWKS endpoint is unreachable', async () => {
    const failing = async () => {
      throw new Error('network down');
    };
    const token = await sign(key, claims(now));
    const err = await rejection(verifyAccessJwt(token, config, { fetch: failing, now }));
    expect(err).toEqual({ code: 'unavailable', status: 503 });
    const bad = async () => new Response('oops', { status: 500 });
    expect((await rejection(verifyAccessJwt(token, config, { fetch: bad, now }))).status).toBe(503);
  });
});
