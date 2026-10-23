/** Locally generated RS256 keys, token signing and a fake JWKS endpoint for Access tests. */
import { bytesToB64url, utf8 } from '../../../server/auth/encoding.ts';
import type { FetchLike } from '../../../server/auth/access.ts';

export const TEAM = 'https://lpu-team.cloudflareaccess.com';
export const AUD = 'aud-tag-0123456789abcdef';
export const OWNER = 'Owner@Example.org';

export interface TestKey {
  kid: string;
  privateKey: CryptoKey;
  jwk: JsonWebKey & { kid: string };
}

export async function makeKey(kid: string): Promise<TestKey> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    kid,
    privateKey: pair.privateKey,
    jwk: { kty: 'RSA', n: pub.n, e: pub.e, alg: 'RS256', use: 'sig', kid },
  };
}

const enc = (v: unknown) => bytesToB64url(utf8(JSON.stringify(v)));

export async function sign(
  key: TestKey,
  payload: Record<string, unknown>,
  header: Record<string, unknown> = {},
): Promise<string> {
  const h = enc({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header });
  const p = enc(payload);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, utf8(`${h}.${p}`));
  return `${h}.${p}.${bytesToB64url(new Uint8Array(sig))}`;
}

export function claims(now: Date, over: Record<string, unknown> = {}): Record<string, unknown> {
  const t = Math.floor(now.getTime() / 1000);
  return { aud: [AUD], iss: TEAM, email: OWNER, sub: 'user-1', iat: t, nbf: t, exp: t + 600, ...over };
}

/** Fake JWKS endpoint; records requested URLs. */
export function jwksFetch(keys: TestKey[]): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const f = async (url: string) => {
    calls.push(url);
    if (url !== `${TEAM}/cdn-cgi/access/certs`) return new Response('nope', { status: 404 });
    return new Response(JSON.stringify({ keys: keys.map((k) => k.jwk) }), {
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return Object.assign(f, { calls });
}

export const accessEnvVars = {
  AUTH_MODE: 'access',
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  OWNER_EMAILS: `someone@else.org, ${OWNER.toLowerCase()}`,
};
