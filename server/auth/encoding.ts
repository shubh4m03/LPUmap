/** Byte/text encoding helpers built on Web-standard APIs only (atob/btoa, TextEncoder). */

export function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Strict standard base64 decode; returns null on malformed input. */
export function b64ToBytes(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) return null;
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function bytesToB64url(bytes: Uint8Array): string {
  return bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Strict base64url (unpadded) decode; returns null on malformed input. */
export function b64urlToBytes(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return b64ToBytes(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function utf8(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(n));
  crypto.getRandomValues(out);
  return out;
}

/** Random URL-safe token with `bytes` of entropy (default 32 bytes = 256 bits). */
export function randomToken(bytes = 32): string {
  return bytesToB64url(randomBytes(bytes));
}

export async function sha256Hex(text: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(text))));
}

export async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', utf8(key), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC', k, utf8(message))));
}

/**
 * Constant-time comparison: always walks the full length of `a`; a length
 * mismatch still costs a full pass and returns false.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const other = a.length === b.length ? b : a;
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ other[i]!;
  return diff === 0;
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  return timingSafeEqual(utf8(a), utf8(b));
}
