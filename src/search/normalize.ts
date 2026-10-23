/**
 * Text normalisation shared by indexing and querying. Every normalised
 * character remembers the [start, end) range of the original string it came
 * from, so highlight ranges can be mapped back onto the untouched title even
 * when diacritics were stripped or '&' was expanded to 'and'.
 */

/** Words that never produce a match on their own. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'at',
  'for',
  'in',
  'near',
  'of',
  'on',
  'the',
  'to',
]);

/**
 * Words so common in campus names that they must not outrank a specific token:
 * for 'boys hall 4', a doc matching only 'hall' ranks below one matching 'boys'.
 */
export const GENERIC_WORDS: ReadonlySet<string> = new Set([
  'hall',
  'block',
  'building',
  'shop',
  'gate',
  'room',
  'office',
  'centre',
  'center',
  'area',
]);

const APOSTROPHES = new Set(["'", '’', '‘', '`', '´']);
const WORD_CHAR = /[\p{L}\p{N}]/u;
const MARKS = /\p{M}/gu;
const ASCII_KEEP = /^[a-z0-9]$/;
const ASCII_UPPER = /^[A-Z]$/;

export interface NormalizedText {
  text: string;
  /** origin[2i], origin[2i+1] = original [start, end) of text[i]. */
  origin: Int32Array;
}

export function normalizeDetailed(input: string): NormalizedText {
  const out: string[] = [];
  const origin: number[] = [];
  const emit = (ch: string, start: number, end: number): void => {
    if (ch === ' ') {
      if (out.length === 0 || out[out.length - 1] === ' ') return;
    }
    out.push(ch);
    origin.push(start, end);
  };

  let i = 0;
  for (const cp of input) {
    const start = i;
    const end = i + cp.length;
    i = end;
    if (ASCII_KEEP.test(cp)) {
      emit(cp, start, end);
    } else if (ASCII_UPPER.test(cp)) {
      emit(cp.toLowerCase(), start, end);
    } else if (cp === '&') {
      emit(' ', start, end);
      for (const ch of 'and') emit(ch, start, end);
      emit(' ', start, end);
    } else if (APOSTROPHES.has(cp)) {
      continue;
    } else {
      const decomposed = cp.normalize('NFKD').toLowerCase().normalize('NFKD').replace(MARKS, '');
      if (decomposed.length === 0) continue;
      for (const ch of decomposed) emit(WORD_CHAR.test(ch) ? ch : ' ', start, end);
    }
  }
  if (out[out.length - 1] === ' ') {
    out.pop();
    origin.length -= 2;
  }
  return { text: out.join(''), origin: Int32Array.from(origin) };
}

/** Lowercase, strip diacritics, '&' → 'and', punctuation → space, collapse whitespace. Digits are kept. */
export function normalize(s: string): string {
  return normalizeDetailed(s).text;
}

export interface Token {
  text: string;
  /** [start, end) in the normalised text. */
  start: number;
  end: number;
}

const TOKEN_RE = /\p{L}+|\p{N}+/gu;

/** Splits normalised text into words, also separating letters from digits ('b34' → 'b', '34'). */
export function tokenize(normalized: string): Token[] {
  const tokens: Token[] = [];
  for (const m of normalized.matchAll(TOKEN_RE)) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

export function isDigitToken(token: string): boolean {
  return /^\p{N}+$/u.test(token);
}

/**
 * A string analysed for matching. `key` is the tokens joined by single spaces
 * ('B-34' and 'b34' both give 'b 34'); `compact` joins them with nothing.
 */
export interface AnalyzedText {
  key: string;
  compact: string;
  tokens: string[];
  /** Offset of each token inside `key`. */
  tokenKeyStarts: number[];
  /** keyOrigin[2i], keyOrigin[2i+1] = original [start, end) of key[i]; separators are zero-width. */
  keyOrigin: Int32Array;
}

export function analyze(input: string): AnalyzedText {
  const { text, origin } = normalizeDetailed(input);
  const toks = tokenize(text);
  const parts: string[] = [];
  const tokenKeyStarts: number[] = [];
  const keyOrigin: number[] = [];
  let pos = 0;
  toks.forEach((t, idx) => {
    if (idx > 0) {
      const prevEnd = origin[(t.start - 1) * 2 + 1] ?? 0;
      keyOrigin.push(prevEnd, prevEnd);
      pos += 1;
    }
    tokenKeyStarts.push(pos);
    for (let c = t.start; c < t.end; c++) keyOrigin.push(origin[c * 2] ?? 0, origin[c * 2 + 1] ?? 0);
    pos += t.text.length;
    parts.push(t.text);
  });
  return {
    key: parts.join(' '),
    compact: parts.join(''),
    tokens: parts,
    tokenKeyStarts,
    keyOrigin: Int32Array.from(keyOrigin),
  };
}

/** Maps a [start, end) range of `analyzed.key` back to the original string. */
export function keyRangeToOriginal(
  analyzed: AnalyzedText,
  start: number,
  end: number,
): [number, number] | null {
  if (end <= start || start < 0 || end > analyzed.key.length) return null;
  const s = analyzed.keyOrigin[start * 2];
  const e = analyzed.keyOrigin[(end - 1) * 2 + 1];
  if (s === undefined || e === undefined || e <= s) return null;
  return [s, e];
}
