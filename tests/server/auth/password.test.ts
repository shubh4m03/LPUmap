import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { timingSafeEqual, timingSafeEqualStr, utf8 } from '../../../server/auth/encoding.ts';
import {
  MIN_PASSWORD_LENGTH,
  PBKDF2_ITERATIONS,
  hashPassword,
  parsePasswordHash,
  verifyPassword,
} from '../../../server/auth/password.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PW = 'a sufficiently long passphrase';
const FORMAT = /^pbkdf2-sha256\$(\d+)\$([A-Za-z0-9+/]+=*)\$([A-Za-z0-9+/]+=*)$/;

describe('password hashing', () => {
  it('produces pbkdf2-sha256$<iter>$<salt>$<hash> with >= 100000 iterations and a random salt', async () => {
    const a = await hashPassword(PW);
    const b = await hashPassword(PW);
    const m = FORMAT.exec(a);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(100_000);
    expect(a).not.toBe(b); // salted
    expect(a).not.toContain(PW);
  });

  it('verifies the right password and rejects wrong ones', async () => {
    const stored = parsePasswordHash(await hashPassword(PW))!;
    expect(stored).not.toBeNull();
    expect(await verifyPassword(PW, stored)).toBe(true);
    expect(await verifyPassword(`${PW} `, stored)).toBe(false);
    expect(await verifyPassword(PW.toUpperCase(), stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it(`refuses passwords shorter than ${MIN_PASSWORD_LENGTH} characters`, async () => {
    await expect(hashPassword('short-pw')).rejects.toThrow(/at least 12/);
  });

  it.each([
    ['empty', ''],
    ['wrong scheme', 'bcrypt$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='],
    [
      'too few iterations',
      'pbkdf2-sha256$99999$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    ],
    [
      'non-numeric iterations',
      'pbkdf2-sha256$1e5$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    ],
    ['short salt', 'pbkdf2-sha256$100000$AAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='],
    ['wrong hash length', 'pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAA'],
    [
      'bad base64',
      'pbkdf2-sha256$100000$!!!!AAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    ],
    [
      'extra segment',
      'pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=$x',
    ],
  ])('rejects a malformed configured hash (%s) — fail closed', (_l, value) => {
    expect(parsePasswordHash(value)).toBeNull();
  });

  it('with no configured hash still derives a key (equal work) and always fails', async () => {
    const spy = vi.spyOn(crypto.subtle, 'deriveBits');
    expect(await verifyPassword(PW, null)).toBe(false);
    expect(await verifyPassword('', null)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);
    const params = spy.mock.calls[0]![0] as Pbkdf2Params;
    expect(params.iterations).toBe(PBKDF2_ITERATIONS);
  });

  it('caps over-long passwords (bounded work) and rejects them', async () => {
    const stored = parsePasswordHash(await hashPassword(PW))!;
    const spy = vi.spyOn(crypto.subtle, 'importKey');
    expect(await verifyPassword(PW + 'x'.repeat(5000), stored)).toBe(false);
    const raw = spy.mock.calls.find((c) => c[0] === 'raw')![1] as Uint8Array;
    expect(raw.byteLength).toBeLessThanOrEqual(1024 * 4);
  });
});

describe('constant-time comparison', () => {
  it('compares equal and unequal inputs, including length mismatch', () => {
    expect(timingSafeEqual(utf8('abc'), utf8('abc'))).toBe(true);
    expect(timingSafeEqual(utf8('abc'), utf8('abd'))).toBe(false);
    expect(timingSafeEqual(utf8('abc'), utf8('abcd'))).toBe(false);
    expect(timingSafeEqual(utf8(''), utf8('a'))).toBe(false);
    expect(timingSafeEqualStr('token', 'token')).toBe(true);
  });

  it('walks the whole input instead of returning at the first difference', () => {
    let reads = 0;
    const a = new Proxy(utf8('x'.repeat(64)), {
      get(t, p) {
        if (typeof p === 'string' && /^\d+$/.test(p)) reads++;
        return Reflect.get(t, p, t) as unknown;
      },
    });
    expect(timingSafeEqual(a, utf8(`y${'x'.repeat(63)}`))).toBe(false);
    expect(reads).toBe(64);
  });
});

describe('npm run admin:hash-password (scripts/admin-hash-password.ts)', () => {
  const run = (input: string) =>
    spawnSync(process.execPath, ['scripts/admin-hash-password.ts'], { cwd: root, input, encoding: 'utf8' });

  it('reads a piped password and prints only a verifiable hash', async () => {
    const r = run(`${PW}\n`);
    expect(r.status).toBe(0);
    const out = r.stdout.trim();
    expect(out.split('\n')).toHaveLength(1);
    expect(out).toMatch(FORMAT);
    expect(r.stdout + r.stderr).not.toContain(PW);
    expect(await verifyPassword(PW, parsePasswordHash(out))).toBe(true);
  });

  it('refuses a password shorter than 12 characters and prints no hash', () => {
    const r = run('tooshort\n');
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/at least 12/);
    expect(r.stderr).not.toContain('tooshort');
  });
});
