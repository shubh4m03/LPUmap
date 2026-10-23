import { describe, expect, it } from 'vitest';
import { normalize, tokenize } from '../../../src/search/index.ts';
import { analyze, keyRangeToOriginal } from '../../../src/search/normalize.ts';

describe('normalize', () => {
  it('lowercases, strips diacritics and collapses whitespace', () => {
    expect(normalize('  Café   Délice ')).toBe('cafe delice');
    expect(normalize('ÅNGSTRÖM')).toBe('angstrom');
  });

  it('unifies punctuation, hyphens and ampersand', () => {
    expect(normalize('B-34')).toBe('b 34');
    expect(normalize('ATM & Bank')).toBe('atm and bank');
    expect(normalize('ATM&Bank')).toBe('atm and bank');
    expect(normalize('Food/Drink — Court, (Main)')).toBe('food drink court main');
    expect(normalize('Uni–Mall')).toBe('uni mall');
  });

  it("drops apostrophes so possessives match ('women's' → 'womens')", () => {
    expect(normalize("Women's Hostel")).toBe('womens hostel');
    expect(normalize('Women’s Hostel')).toBe('womens hostel');
  });

  it('keeps digits, including compatibility forms', () => {
    expect(normalize('Block 34')).toBe('block 34');
    expect(normalize('Ｂ３４')).toBe('b34');
  });

  it('turns emoji and symbols into separators and handles empty input', () => {
    expect(normalize('🍕 pizza 🍕')).toBe('pizza');
    expect(normalize('')).toBe('');
    expect(normalize('!!!')).toBe('');
  });
});

describe('tokenize', () => {
  it('splits letters from digits', () => {
    expect(tokenize(normalize('b34')).map((t) => t.text)).toEqual(['b', '34']);
    expect(tokenize(normalize('block-34')).map((t) => t.text)).toEqual(['block', '34']);
    expect(tokenize(normalize('BH4A')).map((t) => t.text)).toEqual(['bh', '4', 'a']);
  });

  it('reports offsets into the normalised text', () => {
    const toks = tokenize('ab 12');
    expect(toks).toEqual([
      { text: 'ab', start: 0, end: 2 },
      { text: '12', start: 3, end: 5 },
    ]);
  });
});

describe('analyze', () => {
  it('builds equal keys and compacts for spelling variants of a code', () => {
    for (const v of ['B34', 'b-34', 'B 34', 'b.34']) {
      expect(analyze(v).key).toBe('b 34');
      expect(analyze(v).compact).toBe('b34');
    }
  });

  it('maps key ranges back to original positions across diacritics and ampersands', () => {
    const original = 'Crème & Café';
    const a = analyze(original);
    expect(a.key).toBe('creme and cafe');
    const cafeStart = a.key.indexOf('cafe');
    const r = keyRangeToOriginal(a, cafeStart, cafeStart + 4);
    expect(r).not.toBeNull();
    expect(original.slice(r![0], r![1])).toBe('Café');
    const andStart = a.key.indexOf('and');
    const r2 = keyRangeToOriginal(a, andStart, andStart + 3);
    expect(original.slice(r2![0], r2![1])).toBe('&');
  });

  it('maps decomposed characters (combining marks in the source) back to the full grapheme', () => {
    const original = 'Café X';
    const a = analyze(original);
    expect(a.key).toBe('cafe x');
    const r = keyRangeToOriginal(a, 0, 4)!;
    expect(original.slice(r[0], r[1])).toBe('Cafe');
  });

  it('rejects out-of-range key ranges', () => {
    const a = analyze('abc');
    expect(keyRangeToOriginal(a, 2, 1)).toBeNull();
    expect(keyRangeToOriginal(a, 0, 99)).toBeNull();
    expect(keyRangeToOriginal(a, -1, 2)).toBeNull();
  });
});
