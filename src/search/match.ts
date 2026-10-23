/** Scores one prepared doc against one prepared query, walking the ranking tiers top-down. */
import { subsequenceMatch } from './fuzzy.ts';
import { keyRangeToOriginal, type AnalyzedText } from './normalize.ts';
import type { Initialism, PreparedDoc } from './prepare.ts';
import { bestCode, NONE, PREFIX, TYPO1, type PreparedQuery } from './query.ts';
import { TIER_SCORES, type MatchKind } from './types.ts';

export interface DocMatch {
  score: number;
  matchKind: MatchKind;
  highlights: Array<[number, number]>;
}

/** Within-tier adjustment in [0, 39]: earlier match position and higher coverage score higher. */
function adjust(position: number, matchedLen: number, targetLen: number): number {
  const pos = 20 * (1 - Math.min(position, 40) / 40);
  const coverage = targetLen > 0 ? 19 * Math.min(1, matchedLen / targetLen) : 0;
  return pos + coverage;
}

function keyHighlight(title: AnalyzedText, start: number, end: number): Array<[number, number]> {
  const r = keyRangeToOriginal(title, start, end);
  return r ? [r] : [];
}

/**
 * Highlights title words that a query token actually matched (per its word
 * match code): the typed prefix for exact/prefix matches, the whole word for typos.
 */
function tokenHighlights(pd: PreparedDoc, q: PreparedQuery): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  pd.title.tokens.forEach((word, i) => {
    const start = pd.title.tokenKeyStarts[i] ?? 0;
    const id = pd.titleWordIds[i] ?? -1;
    let len = 0;
    for (const t of q.meaningful) {
      const c = t.codes[id] ?? NONE;
      if (c === NONE) continue;
      len = Math.max(len, c >= TYPO1 ? word.length : Math.min(t.text.length, word.length));
    }
    if (len > 0) out.push(...keyHighlight(pd.title, start, start + len));
  });
  return out;
}

function initialismHighlights(pd: PreparedDoc, ini: Initialism): Array<[number, number]> {
  return ini.tokenIndexes.flatMap((i) => {
    const start = pd.title.tokenKeyStarts[i] ?? 0;
    const word = pd.title.tokens[i] ?? '';
    const len = /^\p{N}+$/u.test(word) ? word.length : 1;
    return keyHighlight(pd.title, start, start + len);
  });
}

function wordBoundaryIndex(key: string, needle: string): number {
  let idx = key.indexOf(needle);
  while (idx !== -1) {
    if (idx === 0 || key[idx - 1] === ' ') return idx;
    idx = key.indexOf(needle, idx + 1);
  }
  return -1;
}

function hit(score: number, matchKind: MatchKind, highlights: Array<[number, number]>): DocMatch {
  return { score, matchKind, highlights };
}

export function matchDoc(pd: PreparedDoc, q: PreparedQuery): DocMatch | null {
  const title = pd.title;
  const qk = q.analyzed.key;

  if (title.key === qk) return hit(TIER_SCORES.exact + 39, 'exact', keyHighlight(title, 0, title.key.length));
  if (pd.aliases.some((a) => a.key === qk))
    return hit(TIER_SCORES.exact + 20, 'alias', tokenHighlights(pd, q));
  // A doc never matches solely on stopwords.
  if (q.meaningful.length === 0) return null;
  // Whole-string tiers would match 'the' against 'The Mall'; only word-prefix matching applies.
  if (q.onlyStopwords) return tokenTiers(pd, q);

  const qc = q.analyzed.compact;
  if (pd.codes.includes(qc)) return hit(TIER_SCORES.code + 30, 'code', tokenHighlights(pd, q));
  const ini = pd.initialisms.find((i) => i.code === qc);
  if (ini) {
    const hl = ini.tokenIndexes.length > 0 ? initialismHighlights(pd, ini) : [];
    return hit(TIER_SCORES.code + 20, 'code', hl);
  }

  if (title.key.startsWith(qk)) {
    return hit(
      TIER_SCORES.prefix + adjust(0, qk.length, title.key.length),
      'prefix',
      keyHighlight(title, 0, qk.length),
    );
  }
  let aliasPrefix = -1;
  for (const a of pd.aliases) {
    if (a.key.startsWith(qk)) aliasPrefix = Math.max(aliasPrefix, adjust(0, qk.length, a.key.length));
  }
  if (aliasPrefix >= 0) return hit(TIER_SCORES.aliasPrefix + aliasPrefix, 'alias', tokenHighlights(pd, q));

  const wb = wordBoundaryIndex(title.key, qk);
  if (wb > 0) {
    return hit(
      TIER_SCORES.word + adjust(wb, qk.length, title.key.length),
      'word',
      keyHighlight(title, wb, wb + qk.length),
    );
  }

  return tokenTiers(pd, q);
}

function tokenTiers(pd: PreparedDoc, q: PreparedQuery): DocMatch | null {
  const n = q.meaningful.length;
  let matchedAll = true;
  let typoSum = 0;
  let inTitleOrAlias = 0;
  let inTitle = 0;
  let firstTitleIdx = Number.POSITIVE_INFINITY;
  let matchedWeight = 0;
  let matchedSpecific = 0;
  let totalWeight = 0;

  for (const t of q.meaningful) {
    totalWeight += t.weight;
    const ct = bestCode(t, pd.titleWordIds);
    const ca = bestCode(t, pd.aliasWordIds);
    const ck = bestCode(t, pd.keywordWordIds);
    const codes = [ct, ca, ck].filter((c) => c !== NONE);
    if (codes.length === 0) {
      matchedAll = false;
      continue;
    }
    const best = Math.min(...codes);
    if (best >= TYPO1) typoSum += best - PREFIX;
    if (ct !== NONE || ca !== NONE) inTitleOrAlias++;
    if (ct !== NONE) {
      inTitle++;
      const idx = pd.titleWordIds.findIndex((id) => (t.codes[id] ?? NONE) !== NONE);
      if (idx >= 0) firstTitleIdx = Math.min(firstTitleIdx, idx);
    }
    matchedWeight += best >= TYPO1 ? t.weight * 0.7 : t.weight;
    if (!t.generic) matchedSpecific++;
  }

  const posAdj = Number.isFinite(firstTitleIdx) ? 20 / (1 + firstTitleIdx) : 0;
  const coverageAdj = 19 * (inTitle / n);

  if (matchedAll && typoSum === 0 && inTitleOrAlias > 0) {
    return hit(TIER_SCORES.multiword + posAdj + coverageAdj, 'multiword', tokenHighlights(pd, q));
  }

  const qk = q.analyzed.key;
  let phrase = -1;
  // A stopword-only query must not match a keyword phrase that merely starts with the stopword.
  for (const k of q.onlyStopwords ? [] : pd.keywordKeys) {
    if (k === qk) phrase = Math.max(phrase, 39);
    else if (qk.length >= 2 && k.startsWith(qk)) phrase = Math.max(phrase, adjust(0, qk.length, k.length));
  }
  // Every token matched a keyword word (any order), even if no keyword phrase matched as a whole.
  if (matchedAll && typoSum === 0) phrase = Math.max(phrase, 10);
  if (phrase >= 0) return hit(TIER_SCORES.synonym + phrase, 'synonym', []);

  if (matchedAll) {
    const score = TIER_SCORES.fuzzyMax - 10 - 25 * typoSum - (inTitleOrAlias > 0 ? 0 : 40) + coverageAdj / 2;
    return hit(Math.max(150, Math.min(TIER_SCORES.fuzzyMax, score)), 'fuzzy', tokenHighlights(pd, q));
  }

  if (n >= 2 && matchedWeight > 0) {
    const ratio = matchedWeight / totalWeight;
    // Generic-only matches sink below every doc that matched a specific token.
    const score = q.hasSpecific && matchedSpecific === 0 ? 10 + 20 * ratio : 60 + 80 * ratio;
    return hit(score, 'fuzzy', tokenHighlights(pd, q));
  }

  return q.onlyStopwords ? null : subsequenceTier(pd, q);
}

function subsequenceTier(pd: PreparedDoc, q: PreparedQuery): DocMatch | null {
  const letters = q.analyzed.compact;
  const m = subsequenceMatch(letters, pd.title.compact, pd.compactWordStarts);
  if (!m) return null;
  // Map compact positions back to key positions (key = compact + one space per word boundary).
  const highlights: Array<[number, number]> = [];
  for (const p of m.positions) {
    let wordIdx = 0;
    while (wordIdx + 1 < pd.compactWordStarts.length && (pd.compactWordStarts[wordIdx + 1] ?? 0) <= p)
      wordIdx++;
    const keyPos = p + wordIdx;
    highlights.push(...keyHighlight(pd.title, keyPos, keyPos + 1));
  }
  return hit(40 + 100 * m.quality, 'fuzzy', highlights);
}
