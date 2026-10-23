/**
 * Builders for links rendered from dataset values (OSM tags, curated records).
 * Each returns null instead of a link when the input is not clearly safe, so
 * the UI can show the value as plain text or omit it.
 */

const MAX_URL_LENGTH = 2048;
const MAX_EMAIL_LENGTH = 254;
const MIN_PHONE_DIGITS = 6;
/** E.164 maximum. */
const MAX_PHONE_DIGITS = 15;

/** Whitespace, control (Cc) and invisible format (Cf, e.g. zero-width) characters, and backslashes. */
const UNSAFE_CHARS_RE = /[\s\p{Cc}\p{Cf}\\]/u;

/** Only plain spaces are trimmed; tabs, newlines and other controls make the value unsafe. */
const trimSpaces = (s: string) => s.replace(/^ +| +$/g, '');

/** Absolute http(s) URL without credentials, normalised; null for anything else. */
export function safeExternalUrl(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = trimSpaces(raw);
  if (value === '' || value.length > MAX_URL_LENGTH || UNSAFE_CHARS_RE.test(value)) return null;
  // Requires an explicit scheme, which rules out relative and protocol-relative URLs.
  if (!/^https?:\/\/[^/]/i.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '' || url.hostname === '') return null;
  return url.href;
}

/** `tel:` link keeping a leading + and digits; separators (space - . ( )) are dropped. */
export function telHref(phone: string): string | null {
  if (typeof phone !== 'string') return null;
  const value = trimSpaces(phone);
  if (!/^\+?[0-9 ().-]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) return null;
  return `tel:${value.startsWith('+') ? '+' : ''}${digits}`;
}

const LOCAL_PART_RE = /^[A-Za-z0-9!#$'*+/=^_`{|}~-]+(?:\.[A-Za-z0-9!#$'*+/=^_`{|}~-]+)*$/;
const DOMAIN_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

/** `mailto:` link for a single plain address; rejects anything that could add headers or recipients. */
export function mailHref(email: string): string | null {
  if (typeof email !== 'string') return null;
  const value = trimSpaces(email);
  if (value === '' || value.length > MAX_EMAIL_LENGTH || UNSAFE_CHARS_RE.test(value)) return null;
  // '?' starts mailto headers, '&' separates them, '%' could smuggle encoded newlines, ',' adds recipients.
  if (/[?&%,;:<>"]/.test(value)) return null;
  const at = value.lastIndexOf('@');
  if (at <= 0 || value.indexOf('@') !== at) return null;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length > 64 || !LOCAL_PART_RE.test(local) || !DOMAIN_RE.test(domain)) return null;
  return `mailto:${encodeURIComponent(local)}@${domain.toLowerCase()}`;
}
