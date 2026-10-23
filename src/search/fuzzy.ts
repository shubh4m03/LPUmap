/** Typo budget per token length: none below 4 chars, 1 for 4–7, 2 for 8 or more. */
export function maxTypos(length: number): number {
  if (length < 4) return 0;
  return length <= 7 ? 1 : 2;
}

/**
 * Optimal-string-alignment Damerau-Levenshtein distance, bounded: returns
 * `max + 1` as soon as the distance is known to exceed `max`.
 */
export function boundedDamerauLevenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;

  let prevPrev = new Array<number>(lb + 1).fill(0);
  let prev = new Array<number>(lb + 1);
  let curr = new Array<number>(lb + 1).fill(0);
  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cb = b.charCodeAt(j - 1);
      const cost = ca === cb ? 0 : 1;
      let v = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && ca === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === cb) {
        v = Math.min(v, (prevPrev[j - 2] ?? 0) + 1);
      }
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const recycled = prevPrev;
    prevPrev = prev;
    prev = curr;
    curr = recycled;
  }
  const d = prev[lb] ?? max + 1;
  return d > max ? max + 1 : d;
}

/**
 * Typo distance between a query token and an indexed word, allowing the word
 * to be longer (the user may still be typing): compares against the word's
 * prefixes of similar length too. Returns null when beyond the typo budget.
 */
export function typoDistance(token: string, word: string): number | null {
  const max = maxTypos(token.length);
  if (max === 0) return null;
  let best = boundedDamerauLevenshtein(token, word, max);
  if (token.length >= 5 && word.length > token.length) {
    for (let len = token.length - 1; len <= token.length + 1 && len < word.length; len++) {
      if (best === 0) break;
      best = Math.min(best, boundedDamerauLevenshtein(token, word.slice(0, len), max));
    }
  }
  return best <= max ? best : null;
}

export interface SubsequenceMatch {
  /** Matched character positions in the target. */
  positions: number[];
  /** 0..1, 1 = contiguous match at the very start. */
  quality: number;
}

/**
 * In-order subsequence match ('lbry' in 'library'). The first query character
 * must start a word of the target (word starts given as offsets) to avoid
 * matching random letters; the matched span may be at most 3× the query length.
 */
export function subsequenceMatch(
  query: string,
  target: string,
  wordStarts: readonly number[],
): SubsequenceMatch | null {
  if (query.length < 3 || query.length > target.length) return null;
  let best: SubsequenceMatch | null = null;
  for (const startAt of wordStarts) {
    if (target[startAt] !== query[0]) continue;
    const positions = [startAt];
    let ti = startAt + 1;
    for (let qi = 1; qi < query.length; qi++) {
      const ch = query[qi];
      while (ti < target.length && target[ti] !== ch) ti++;
      if (ti >= target.length) break;
      positions.push(ti);
      ti++;
    }
    if (positions.length !== query.length) continue;
    const span = (positions[positions.length - 1] ?? startAt) - startAt + 1;
    if (span > query.length * 3) continue;
    const gaps = span - query.length;
    const quality = (query.length / span) * (1 / (1 + startAt / 10)) * (gaps === 0 ? 1 : 0.9);
    if (!best || quality > best.quality) best = { positions, quality };
  }
  return best;
}
