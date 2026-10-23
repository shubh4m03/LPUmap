import { describe, expect, it } from 'vitest';
import {
  boundedDamerauLevenshtein,
  maxTypos,
  subsequenceMatch,
  typoDistance,
} from '../../../src/search/fuzzy.ts';

describe('boundedDamerauLevenshtein', () => {
  it('computes small distances including transpositions', () => {
    expect(boundedDamerauLevenshtein('library', 'library', 2)).toBe(0);
    expect(boundedDamerauLevenshtein('libary', 'library', 2)).toBe(1);
    expect(boundedDamerauLevenshtein('lirbary', 'library', 2)).toBe(1);
    expect(boundedDamerauLevenshtein('kitten', 'sitting', 3)).toBe(3);
    expect(boundedDamerauLevenshtein('', 'abc', 5)).toBe(3);
  });

  it('returns max + 1 once the bound is exceeded', () => {
    expect(boundedDamerauLevenshtein('abcdef', 'uvwxyz', 2)).toBe(3);
    expect(boundedDamerauLevenshtein('a', 'abcdefgh', 1)).toBe(2);
  });

  it('is symmetric', () => {
    for (const [a, b] of [
      ['pharmcy', 'pharmacy'],
      ['managment', 'management'],
      ['abc', 'acb'],
    ] as const) {
      expect(boundedDamerauLevenshtein(a, b, 3)).toBe(boundedDamerauLevenshtein(b, a, 3));
    }
  });
});

describe('typo budget', () => {
  it('allows no typos under 4 chars, 1 for 4-7 and 2 for 8+', () => {
    expect([3, 4, 7, 8, 12].map(maxTypos)).toEqual([0, 1, 1, 2, 2]);
  });

  it('matches common misspellings', () => {
    expect(typoDistance('libary', 'library')).toBe(1);
    expect(typoDistance('pharmcy', 'pharmacy')).toBe(1);
    expect(typoDistance('managment', 'management')).toBe(1);
  });

  it('rejects short tokens and distant words', () => {
    expect(typoDistance('lib', 'lab')).toBeNull();
    expect(typoDistance('hostel', 'castle')).toBeNull();
    expect(typoDistance('mngmnt', 'management')).toBeNull();
  });

  it('tolerates a typo in a word that is still being typed', () => {
    expect(typoDistance('manag', 'management')).toBe(0);
    expect(typoDistance('mangem', 'management')).toBe(1);
  });
});

describe('subsequenceMatch', () => {
  it('matches in-order letters starting at a word start', () => {
    const m = subsequenceMatch('lbry', 'library', [0]);
    expect(m?.positions).toEqual([0, 2, 3, 6]);
  });

  it('prefers contiguous matches', () => {
    const tight = subsequenceMatch('lib', 'library', [0])!;
    const loose = subsequenceMatch('lby', 'library', [0])!;
    expect(tight.quality).toBeGreaterThan(loose.quality);
  });

  it('requires a word-start anchor, a bounded span and at least 3 chars', () => {
    expect(subsequenceMatch('ibr', 'library', [0])).toBeNull();
    expect(subsequenceMatch('az', 'abcz', [0])).toBeNull();
    expect(subsequenceMatch('abz', 'abcdefghijklmnopqrstuvwxyz', [0])).toBeNull();
  });
});
