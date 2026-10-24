/**
 * Text and source-URL safety rules for the Building Studio wire contracts
 * (docs/BUILDING_STUDIO_DESIGN.md §5). Pure; shared by the browser, the admin
 * app and the server, so erasable syntax only and no DOM/Node APIs.
 *
 * The control-character rule matches src/community/schema.ts. It is repeated
 * here rather than imported because src/community/schema.ts imports the
 * studio schema (publication v2); importing back would create a module cycle.
 */
import { z } from 'zod';

/** Bidi embedding/override (U+202A–202E) and isolate (U+2066–2069) controls: display spoofing. */
const isBidiControl = (c: number) => (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);

/**
 * True when `s` contains a C0/C1 control character, DEL, a bidi
 * embedding/override/isolate control or an unpaired UTF-16 surrogate, except
 * the listed allowed code points. ZWJ/ZWNJ and LRM/RLM stay allowed.
 */
export function hasControlChars(s: string, allowed: readonly number[] = []): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) return true;
    if ((c < 0x20 || (c >= 0x7f && c <= 0x9f) || isBidiControl(c)) && !allowed.includes(c)) return true;
  }
  return false;
}

/** ZWNJ (U+200C) and ZWJ (U+200D): needed inside Indic, Arabic-script and other non-Latin words. */
const isJoiner = (c: number) => c === 0x200c || c === 0x200d;

/**
 * Invisible or line-breaking code points that have no place in a name: they
 * make two names that look identical compare different (search, duplicate
 * and alias-uniqueness checks) or break a one-line label. ZWSP, word joiner,
 * invisible math operators, BOM/ZWNBSP, Mongolian vowel separator, soft
 * hyphen, combining grapheme joiner, Hangul fillers and the Unicode LINE /
 * PARAGRAPH SEPARATORS (U+2028/2029).
 */
const isInvisibleInName = (c: number) =>
  c === 0x200b ||
  (c >= 0x2060 && c <= 0x2064) ||
  c === 0xfeff ||
  c === 0x180e ||
  c === 0x00ad ||
  c === 0x034f ||
  c === 0x115f ||
  c === 0x1160 ||
  c === 0x3164 ||
  c === 0xffa0 ||
  c === 0x2028 ||
  c === 0x2029;

const NON_ASCII_LETTER_OR_MARK = /^[\p{L}\p{M}]$/u;
const joinsLetters = (cp: number | undefined) =>
  cp !== undefined && cp > 0x7f && NON_ASCII_LETTER_OR_MARK.test(String.fromCodePoint(cp));

/** Whitespace after a joiner: the joiner then shapes the end of the preceding word only. */
const isSpace = (cp: number | undefined) => cp !== undefined && /^\s$/u.test(String.fromCodePoint(cp));

/**
 * True when a NAME (or alias) holds an invisible character (see
 * isInvisibleInName) or a misplaced ZWJ/ZWNJ. A joiner is allowed only right
 * after a non-ASCII letter or mark, and only when it is followed by another
 * non-ASCII letter or mark, by whitespace or by the end of the name: that is
 * how Indic and Arabic-script text uses it (e.g. Devanagari KA + VIRAMA + ZWJ
 * + SSA, or a ZWNJ ending a word). A joiner after Latin letters, digits or a
 * space, at the start, or before an ASCII character is an invisible spoof
 * ("Block" + ZWJ + "34" looks like "Block34") and is rejected.
 */
export function hasInvisibleNameChars(s: string): boolean {
  const cps = Array.from(s, (ch) => ch.codePointAt(0)!);
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i]!;
    if (isInvisibleInName(c)) return true;
    if (!isJoiner(c)) continue;
    const next = cps[i + 1];
    if (!joinsLetters(cps[i - 1]) || !(next === undefined || isSpace(next) || joinsLetters(next)))
      return true;
  }
  return false;
}

/**
 * Most combining marks one character may carry. Real text stays well below it
 * (Indic conjuncts, pointed Hebrew and Vietnamese use at most 3–4 in a row);
 * a long run ("Zalgo" text) stacks glyphs far above and below the line and
 * paints over neighbouring UI, e.g. the owner's moderation queue.
 */
export const MAX_COMBINING_MARKS = 5;

const COMBINING_MARK = /^\p{M}$/u;
const FORMAT_CHAR = /^\p{Cf}$/u;

/**
 * True when `s` has more than `max` combining marks in a row. Format
 * characters (ZWJ, ZWNJ, LRM…) between marks do not end the run, so they
 * cannot be interleaved to get around the limit.
 */
export function hasCombiningMarkFlood(s: string, max: number = MAX_COMBINING_MARKS): boolean {
  let run = 0;
  for (const ch of s) {
    if (COMBINING_MARK.test(ch)) {
      run += 1;
      if (run > max) return true;
    } else if (!FORMAT_CHAR.test(ch)) {
      run = 0;
    }
  }
  return false;
}

/** http(s) URL without credentials. */
export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password;
  } catch {
    return false;
  }
}

export const PROHIBITED_SOURCE_MESSAGE =
  'Google Maps, Google Earth and Street View cannot be a source: their terms forbid deriving map data from them (docs/GEODATA_SOURCES_AND_LICENSES.md §7). Cite an allowed source or record a site survey.';

/** google.<tld> or google.<sld>.<cc>, with any subdomain (www.google.com, maps.google.co.in, …). */
const GOOGLE_HOST = /^(?:[a-z0-9-]+\.)*google\.[a-z]{2,3}(?:\.[a-z]{2})?$/;
const GOOGLE_MAP_PATH = /^\/(?:maps|earth|streetview)(?:[/@;,.]|$)/;
const GOOGLE_MAP_SUBDOMAIN = /^(?:maps|earth|streetview|mts?\d*|khms?\d*|cbks?\d*)\./;
/**
 * Google Maps place and contributor photos on googleusercontent.com
 * (lh3.googleusercontent.com/p/AF1Qip…, /gps-cs-s/…, /gps-proxy/…).
 */
const MAPS_PHOTO_PATH = /^\/(?:p|gps-cs-s|gps-proxy)\//;
/** Street View image endpoints (cbk0.google.com/cbk, geo0.ggpht.com/cbk). */
const STREET_VIEW_PATH = /^\/cbk(?:[/?]|$)/;
/** A URL embedded in a query value or path (redirect, consent and archive wrappers). */
const EMBEDDED_URL = /https?:\/\/?[^\s]+/i;
/** Wrappers are unwrapped this many levels deep. */
const MAX_WRAP_DEPTH = 3;

/** Percent-decoded path with repeated slashes collapsed (`//maps`, `/%6Daps` → `/maps`). */
function normalizedPath(u: URL): string {
  let path = u.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep the raw path when it is not valid percent-encoding
  }
  return path.toLowerCase().replace(/\/{2,}/g, '/');
}

function prohibitedUrl(value: string, depth: number): boolean {
  const raw = value.trim();
  if (raw === '') return false;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return false;
  }
  // Trailing dots (fully-qualified `google.com.`, or `google.com..`) name the same host.
  const host = u.hostname
    .toLowerCase()
    .replace(/\.+$/, '')
    .replace(/^www\./, '');
  const path = normalizedPath(u);
  if (GOOGLE_HOST.test(host)) {
    if (GOOGLE_MAP_SUBDOMAIN.test(host) || GOOGLE_MAP_PATH.test(path) || STREET_VIEW_PATH.test(path))
      return true;
    // Google Search's map results (…/search?tbm=map).
    if (path === '/search' && u.searchParams.get('tbm') === 'map') return true;
  }
  if (host === 'maps.app.goo.gl' || host === 'earth.app.goo.gl' || host === 'g.page') return true;
  if (host === 'goo.gl' && GOOGLE_MAP_PATH.test(path)) return true;
  if (host === 'maps.gstatic.com') return true;
  if (/(?:^|\.)googleusercontent\.com$/.test(host) && MAPS_PHOTO_PATH.test(path)) return true;
  if (/(?:^|\.)ggpht\.com$/.test(host) && STREET_VIEW_PATH.test(path)) return true;
  if (
    /(?:^|\.)googleapis\.com$/.test(host) &&
    (GOOGLE_MAP_SUBDOMAIN.test(host) || host.includes('streetview') || GOOGLE_MAP_PATH.test(path))
  )
    return true;
  // A Maps URL wrapped by a redirect, consent or archive link (google.com/url?q=…, web.archive.org/web/…/https://…).
  if (depth < MAX_WRAP_DEPTH) {
    for (const v of u.searchParams.values()) {
      const inner = EMBEDDED_URL.exec(v);
      if (inner && prohibitedUrl(inner[0], depth + 1)) return true;
    }
    const inPath = EMBEDDED_URL.exec(path);
    if (inPath && prohibitedUrl(inPath[0].replace(/^(https?:)\/?/i, '$1//'), depth + 1)) return true;
  }
  return false;
}

/**
 * True for a Google Maps / Google Earth / Street View URL (including short
 * links, tile servers, Street View image endpoints and the Maps APIs), also
 * when it is wrapped in a redirect, consent or archive link, percent-encoded
 * or written with repeated slashes. Google Open Buildings
 * (sites.research.google, storage.googleapis.com/open-buildings-data) is a
 * separately licensed dataset and is NOT matched. A value without a scheme is
 * read as https.
 */
export function isProhibitedSourceUrl(value: string): boolean {
  return prohibitedUrl(value, 0);
}

/**
 * URL-like tokens in free text: with or without a scheme (`maps.app.goo.gl/x`,
 * `https://…`). Label separators include the ideographic and full-width full
 * stops the URL parser maps to '.', and trailing dots after the TLD
 * (`www.google.com./maps`) stay part of the token, so neither splits a host
 * from its path.
 */
const URLISH =
  /(?:https?:\/\/)?(?:[a-z0-9-]+[.\u3002\uff0e\uff61])+[a-z]{2,}[.\u3002\uff0e\uff61]*(?::\d+)?(?:[/?#][^\s<>"'`)\]]*)?/gi;

/** True when free text contains a prohibited source URL (see isProhibitedSourceUrl). */
export function containsProhibitedSourceUrl(s: string): boolean {
  for (const m of s.matchAll(URLISH)) if (isProhibitedSourceUrl(m[0])) return true;
  return false;
}

const CONTROL_MESSAGE = 'Control characters are not allowed';

/** Single-line text: trimmed, no control characters. */
export const line = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((s) => !hasControlChars(s), { message: CONTROL_MESSAGE });

/** Multi-line text: trimmed; tab, LF and CR allowed, other control characters rejected. */
export const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((s) => !hasControlChars(s, [0x09, 0x0a, 0x0d]), { message: CONTROL_MESSAGE });

const INVISIBLE_NAME_MESSAGE =
  'Invisible characters (zero-width spaces, joiners outside a non-Latin word, line or paragraph separators) are not allowed in names';

/** Stacked combining marks ("Zalgo" text) paint over the surrounding UI; see hasCombiningMarkFlood. */
export const MARK_FLOOD_MESSAGE = `Too many combining marks (accents) on one character (at most ${MAX_COMBINING_MARKS})`;

/**
 * A name or alias: a single line that additionally rejects invisible characters
 * (hasInvisibleNameChars) and stacked combining-mark floods (more than
 * MAX_COMBINING_MARKS in a row, the same rule as public suggestions).
 */
export const nameLine = (max: number) =>
  line(max)
    .refine((s) => !hasInvisibleNameChars(s), { message: INVISIBLE_NAME_MESSAGE })
    .refine((s) => !hasCombiningMarkFlood(s), { message: MARK_FLOOD_MESSAGE });

/**
 * A field that documents provenance (or is free text that can cite a source,
 * such as a description or notes): additionally rejects Google
 * Maps/Earth/Street View URLs.
 */
export const provenanceLine = (max: number) =>
  line(max).refine((s) => !containsProhibitedSourceUrl(s), { message: PROHIBITED_SOURCE_MESSAGE });
export const provenanceText = (max: number) =>
  text(max).refine((s) => !containsProhibitedSourceUrl(s), { message: PROHIBITED_SOURCE_MESSAGE });
