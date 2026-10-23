/** Query-time analysis: tokens, their weights and a per-vocabulary-word match table. */
import { typoDistance } from './fuzzy.ts';
import { analyze, GENERIC_WORDS, isDigitToken, STOPWORDS, type AnalyzedText } from './normalize.ts';
import type { Vocabulary } from './prepare.ts';

/** Queries are truncated to this many characters (code points) before analysis. */
export const MAX_QUERY_LENGTH = 100;
/** Only this many distinct meaningful tokens take part in token matching. */
export const MAX_QUERY_TOKENS = 8;

// Word match codes (lower is better; NONE means no match).
export const NONE = 0;
export const EXACT = 1;
export const PREFIX = 2;
export const TYPO1 = 3;
export const TYPO2 = 4;

/** Weight of a generic word relative to a specific one when scoring partial matches. */
export const GENERIC_WEIGHT = 0.25;

export interface QueryToken {
  text: string;
  generic: boolean;
  weight: number;
  /** Match code of this token against every vocabulary word, by word id. */
  codes: Uint8Array;
}

export interface PreparedQuery {
  analyzed: AnalyzedText;
  meaningful: QueryToken[];
  hasSpecific: boolean;
  /**
   * The query consists only of stopwords. Its last token then acts purely as the
   * prefix of a longer, non-stopword word ('at' while typing 'atm', 'the' for
   * 'theatre'), so incremental typing works without ever matching on a stopword.
   */
  onlyStopwords: boolean;
}

export function truncateQuery(raw: string): string {
  const head = raw.slice(0, MAX_QUERY_LENGTH * 2);
  return Array.from(head).slice(0, MAX_QUERY_LENGTH).join('');
}

function wordCode(token: string, word: string, isLast: boolean, multiToken: boolean): number {
  if (token === word) return EXACT;
  if (isDigitToken(token)) return isLast && word.startsWith(token) ? PREFIX : NONE;
  const prefixAllowed = token.length >= 2 || (isLast && multiToken);
  if (prefixAllowed && word.startsWith(token)) return PREFIX;
  if (isDigitToken(word)) return NONE;
  const d = typoDistance(token, word);
  if (d === null) return NONE;
  return d === 1 ? TYPO1 : TYPO2;
}

export function prepareQuery(raw: string, vocab: Vocabulary): PreparedQuery | null {
  if (typeof raw !== 'string') return null;
  const analyzed = analyze(truncateQuery(raw));
  if (analyzed.key === '') return null;
  const all = analyzed.tokens;
  const lastToken = all[all.length - 1];
  const seen = new Set<string>();
  const meaningful: QueryToken[] = [];
  all.forEach((text, i) => {
    if (STOPWORDS.has(text) || seen.has(text) || meaningful.length >= MAX_QUERY_TOKENS) return;
    seen.add(text);
    const isLast = i === all.length - 1 || text === lastToken;
    const codes = new Uint8Array(vocab.words.length);
    vocab.words.forEach((w, id) => {
      codes[id] = wordCode(text, w, isLast, all.length > 1);
    });
    const generic = GENERIC_WORDS.has(text);
    meaningful.push({ text, generic, weight: generic ? GENERIC_WEIGHT : 1, codes });
  });
  const onlyStopwords = meaningful.length === 0;
  if (onlyStopwords && lastToken !== undefined) {
    const codes = new Uint8Array(vocab.words.length);
    vocab.words.forEach((w, id) => {
      const longer = w.length > lastToken.length && w.startsWith(lastToken) && !STOPWORDS.has(w);
      codes[id] = longer ? PREFIX : NONE;
    });
    meaningful.push({ text: lastToken, generic: false, weight: 1, codes });
  }
  return { analyzed, meaningful, hasSpecific: meaningful.some((t) => !t.generic), onlyStopwords };
}

/** Best (lowest non-zero) code of a token over a list of word ids; NONE when nothing matches. */
export function bestCode(token: QueryToken, wordIds: readonly number[]): number {
  let best = NONE;
  for (const id of wordIds) {
    const c = token.codes[id] ?? NONE;
    if (c !== NONE && (best === NONE || c < best)) {
      best = c;
      if (best === EXACT) break;
    }
  }
  return best;
}
