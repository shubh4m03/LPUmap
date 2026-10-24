/**
 * Server-assigned identifiers: 128 random bits from crypto.getRandomValues,
 * base32 (RFC 4648 alphabet, lower-case, no padding) → 26 characters.
 * Suggestions `sug_…`, owner locations `own:…`, community locations `com:…`,
 * Building Studio buildings `stu:…` and owner templates `stv:…`.
 */

export type IdKind = 'suggestion' | 'owner' | 'community' | 'studio' | 'template';

export interface IdGenerator {
  next(kind: IdKind): string;
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const PREFIX: Record<IdKind, string> = {
  suggestion: 'sug_',
  owner: 'own:',
  community: 'com:',
  studio: 'stu:',
  template: 'stv:',
};

export function base32(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const b of bytes) {
    buffer = (buffer << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

export function randomToken(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base32(bytes);
}

export const randomIds: IdGenerator = {
  next: (kind) => `${PREFIX[kind]}${randomToken(16)}`,
};

export const ID_PATTERNS: Record<IdKind, RegExp> = {
  suggestion: /^sug_[a-z2-7]{26}$/,
  owner: /^own:[a-z2-7]{26}$/,
  community: /^com:[a-z2-7]{26}$/,
  studio: /^stu:[a-z2-7]{26}$/,
  template: /^stv:[a-z2-7]{26}$/,
};
