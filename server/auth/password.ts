/**
 * Owner password hashing: PBKDF2-HMAC-SHA256, stored as
 * `pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>`.
 *
 * Iterations are fixed at 100 000: the contract requires ≥ 100 000 and the
 * Cloudflare Workers runtime rejects PBKDF2 above 100 000 iterations, so a
 * larger value would make every login fail with an internal error. The
 * parser therefore treats any other count as a misconfiguration (fail closed).
 */
import { b64ToBytes, bytesToB64, randomBytes, timingSafeEqual, utf8 } from './encoding.ts';

export const PBKDF2_ITERATIONS = 100_000;
export const MIN_PASSWORD_LENGTH = 12;
/** Upper bound on accepted password length (bounds the work per attempt). */
export const MAX_PASSWORD_LENGTH = 1024;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

export interface PasswordHash {
  iterations: number;
  salt: Uint8Array<ArrayBuffer>;
  hash: Uint8Array;
}

export function parsePasswordHash(value: string | undefined | null): PasswordHash | null {
  if (typeof value !== 'string') return null;
  const parts = value.trim().split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return null;
  if (!/^\d{1,9}$/.test(parts[1]!)) return null;
  const iterations = Number(parts[1]);
  if (iterations !== PBKDF2_ITERATIONS) return null;
  const salt = b64ToBytes(parts[2]!);
  const hash = b64ToBytes(parts[3]!);
  if (!salt || salt.length < SALT_BYTES || !hash || hash.length !== HASH_BYTES) return null;
  return { iterations, salt: new Uint8Array(salt), hash };
}

async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) throw new Error('Password is too long');
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${bytesToB64(salt)}$${bytesToB64(hash)}`;
}

/** Used when no (valid) hash is configured so the failure path costs the same work. */
const DUMMY: PasswordHash = {
  iterations: PBKDF2_ITERATIONS,
  salt: new Uint8Array(new ArrayBuffer(SALT_BYTES)).fill(7),
  hash: new Uint8Array(HASH_BYTES),
};

/**
 * Verifies a password. With `stored === null` it still derives against a
 * dummy hash (equal timing) and always returns false — fail closed.
 */
export async function verifyPassword(password: string, stored: PasswordHash | null): Promise<boolean> {
  const target = stored ?? DUMMY;
  const candidate = password.length > MAX_PASSWORD_LENGTH ? password.slice(0, MAX_PASSWORD_LENGTH) : password;
  const derived = await derive(candidate, target.salt, target.iterations);
  const equal = timingSafeEqual(derived, target.hash);
  return stored !== null && password.length <= MAX_PASSWORD_LENGTH && equal;
}
