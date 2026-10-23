export interface HighlightSegment {
  text: string;
  match: boolean;
}

/** Clamps, sorts and merges overlapping or touching [start, end) ranges; drops invalid ones. */
export function mergeRanges(
  ranges: ReadonlyArray<readonly [number, number]>,
  length: number,
): Array<[number, number]> {
  const clean: Array<[number, number]> = [];
  for (const r of ranges) {
    if (!Array.isArray(r)) continue;
    const [a, b] = r;
    if (typeof a !== 'number' || typeof b !== 'number' || Number.isNaN(a) || Number.isNaN(b)) continue;
    const s = Math.max(0, Math.min(length, Math.floor(a)));
    const e = Math.max(0, Math.min(length, Math.ceil(b)));
    if (e > s) clean.push([s, e]);
  }
  clean.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const merged: Array<[number, number]> = [];
  for (const r of clean) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/**
 * Splits `text` into alternating plain/matched segments for rendering.
 * Safe with overlapping, unsorted, out-of-range or non-finite ranges.
 */
export function highlightSegments(text: string, ranges: Array<[number, number]>): HighlightSegment[] {
  const str = typeof text === 'string' ? text : '';
  if (str.length === 0) return [];
  const merged = mergeRanges(Array.isArray(ranges) ? ranges : [], str.length);
  const segments: HighlightSegment[] = [];
  let pos = 0;
  for (const [s, e] of merged) {
    if (s > pos) segments.push({ text: str.slice(pos, s), match: false });
    segments.push({ text: str.slice(s, e), match: true });
    pos = e;
  }
  if (pos < str.length) segments.push({ text: str.slice(pos), match: false });
  return segments;
}
