import { describe, expect, it } from 'vitest';
import { createSearchIndex, highlightSegments } from '../../../src/search/index.ts';
import { doc } from './helpers.ts';

describe('highlightSegments', () => {
  it('splits text into plain and matched segments', () => {
    expect(highlightSegments('Central Library', [[8, 15]])).toEqual([
      { text: 'Central ', match: false },
      { text: 'Library', match: true },
    ]);
  });

  it('merges overlapping, touching and unsorted ranges', () => {
    expect(
      highlightSegments('abcdefgh', [
        [5, 7],
        [0, 2],
        [1, 3],
        [3, 4],
      ]),
    ).toEqual([
      { text: 'abcd', match: true },
      { text: 'e', match: false },
      { text: 'fg', match: true },
      { text: 'h', match: false },
    ]);
  });

  it('is safe with out-of-range, inverted and non-finite input', () => {
    const ranges = [
      [-5, 2],
      [6, 100],
      [4, 3],
      [Number.NaN, 2],
      [1, Number.POSITIVE_INFINITY],
    ] as Array<[number, number]>;
    const segs = highlightSegments('abcdef', ranges);
    expect(segs.map((s) => s.text).join('')).toBe('abcdef');
    expect(segs).toEqual([{ text: 'abcdef', match: true }]);
    expect(highlightSegments('abc', [[10, 20]])).toEqual([{ text: 'abc', match: false }]);
    expect(highlightSegments('', [[0, 1]])).toEqual([]);
    expect(highlightSegments('abc', [])).toEqual([{ text: 'abc', match: false }]);
  });

  it('always reassembles the original text', () => {
    const text = 'Lovely Institute of Management';
    const segs = highlightSegments(text, [
      [0, 3],
      [7, 12],
      [20, 30],
    ]);
    expect(segs.map((s) => s.text).join('')).toBe(text);
  });
});

describe('search highlights map to the original title', () => {
  const matched = (title: string, ranges: Array<[number, number]>): string[] =>
    highlightSegments(title, ranges)
      .filter((s) => s.match)
      .map((s) => s.text);

  it('highlights a prefix including stripped diacritics', () => {
    const index = createSearchIndex([doc('a', 'Café Coffee Day')]);
    const [hit] = index.search('cafe');
    expect(hit?.matchKind).toBe('prefix');
    expect(matched('Café Coffee Day', hit!.highlights)).toEqual(['Café']);
  });

  it('highlights a word-boundary match after an ampersand expansion', () => {
    const title = 'Tea & Café Corner';
    const index = createSearchIndex([doc('a', title)]);
    const [hit] = index.search('and cafe');
    expect(hit?.matchKind).toBe('word');
    expect(matched(title, hit!.highlights)).toEqual(['& Café']);
  });

  it('highlights each matched word for multiword queries in any order', () => {
    const title = 'Lovely Institute of Management';
    const index = createSearchIndex([doc('a', title)]);
    const [hit] = index.search('manag lovely');
    expect(hit?.matchKind).toBe('multiword');
    expect(matched(title, hit!.highlights)).toEqual(['Lovely', 'Manag']);
  });

  it('highlights the initials of an initialism match', () => {
    const title = 'Lovely Institute of Management';
    const index = createSearchIndex([doc('a', title)]);
    const [hit] = index.search('LIM');
    expect(hit?.matchKind).toBe('code');
    expect(matched(title, hit!.highlights)).toEqual(['L', 'I', 'M']);
  });

  it('highlights whole words for typo matches', () => {
    const title = 'Central Library';
    const index = createSearchIndex([doc('a', title)]);
    const [hit] = index.search('libary');
    expect(hit?.matchKind).toBe('fuzzy');
    expect(matched(title, hit!.highlights)).toEqual(['Library']);
  });

  it('highlights only words a query token actually matched', () => {
    // '3' is not the last token, so it must match a whole number exactly; '345' is not highlighted.
    const title = 'Block 345 Annexe';
    const index = createSearchIndex([doc('a', title)]);
    const [hit] = index.search('block 3 annexe');
    expect(hit).toBeDefined();
    expect(matched(title, hit!.highlights)).toEqual(['Block', 'Annexe']);
  });

  it('keeps highlights inside the title even for a whole-title exact match', () => {
    const title = '  Block   34 ';
    const index = createSearchIndex([doc('a', title)]);
    const [hit] = index.search('block 34');
    expect(hit?.matchKind).toBe('exact');
    for (const [s, e] of hit!.highlights) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(title.length);
    }
    expect(matched(title, hit!.highlights)).toEqual(['Block   34']);
  });
});
