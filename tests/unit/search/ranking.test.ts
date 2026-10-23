import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';
import { createSearchIndex, TIER_SCORES, type SearchDoc } from '../../../src/search/index.ts';
import { doc, ids } from './helpers.ts';

describe('tier ordering', () => {
  const docs: SearchDoc[] = [
    doc('prefix', 'Library Annexe'),
    doc('exact', 'Library'),
    doc('word', 'Central Library'),
    doc('alias', 'Knowledge Centre', { aliases: ['Library'] }),
    doc('aliasPrefix', 'Reading Hub', { aliases: ['Library Reading Hub'] }),
    doc('keyword', 'Study Pod', { keywords: ['library', 'study'] }),
    doc('fuzzy', 'Libary Lane Kiosk'),
  ];
  const index = createSearchIndex(docs);

  it('ranks exact → alias exact → prefix → alias prefix → word → synonym → fuzzy', () => {
    const hits = index.search('library');
    expect(ids(hits)).toEqual(['exact', 'alias', 'prefix', 'aliasPrefix', 'word', 'keyword', 'fuzzy']);
    expect(hits.map((h) => h.matchKind)).toEqual([
      'exact',
      'alias',
      'prefix',
      'alias',
      'word',
      'synonym',
      'fuzzy',
    ]);
  });

  it('keeps every score inside its tier band', () => {
    const hits = index.search('library');
    const band = (kind: string): [number, number] => {
      switch (kind) {
        case 'exact':
          return [TIER_SCORES.exact, TIER_SCORES.exact + 50];
        case 'prefix':
          return [TIER_SCORES.prefix, TIER_SCORES.prefix + 50];
        case 'word':
          return [TIER_SCORES.word, TIER_SCORES.word + 50];
        case 'synonym':
          return [TIER_SCORES.synonym, TIER_SCORES.synonym + 50];
        case 'fuzzy':
          return [0, TIER_SCORES.fuzzyMax];
        default:
          return [TIER_SCORES.aliasPrefix, TIER_SCORES.exact + 50];
      }
    };
    for (const h of hits) {
      const [lo, hi] = band(h.matchKind);
      expect(h.score).toBeGreaterThanOrEqual(lo);
      expect(h.score).toBeLessThan(hi);
    }
  });

  it('puts an exact title above a longer prefix match', () => {
    const idx = createSearchIndex([doc('long', 'Block 34 Annexe'), doc('short', 'Block 34')]);
    expect(ids(idx.search('block 34'))).toEqual(['short', 'long']);
  });
});

describe('codes and abbreviations', () => {
  const index = createSearchIndex([
    doc('b34', 'Academic Block Thirty-Four', { codes: ['B34'], aliases: ['Block 34'] }),
    doc('lim', 'Lovely Institute of Management'),
    doc('b3', 'Block 3'),
    doc('other', 'Boys Hostel 4'),
  ]);

  it.each(['b34', 'B-34', 'B 34', 'b.34'])('finds the coded doc for %s first, as a code match', (q) => {
    const [first] = index.search(q);
    expect(first?.doc.id).toBe('b34');
    expect(first?.matchKind).toBe('code');
  });

  it("matches 'block 34' as an exact alias", () => {
    const [first] = index.search('block 34');
    expect(first?.doc.id).toBe('b34');
    expect(first?.matchKind).toBe('alias');
  });

  it('derives initialisms from multiword titles, ignoring stopwords', () => {
    const [first] = index.search('lim');
    expect(first?.doc.id).toBe('lim');
    expect(first?.matchKind).toBe('code');
    expect(index.search('liom').map((h) => h.doc.id)).not.toContain('lim');
  });

  it('includes numbers in initialisms', () => {
    const [first] = index.search('bh4');
    expect(first?.doc.id).toBe('other');
    expect(first?.matchKind).toBe('code');
  });
});

describe('misspellings', () => {
  const index = createSearchIndex([
    doc('lib', 'Central Library'),
    doc('pharm', 'Campus Pharmacy'),
    doc('mgmt', 'School of Management'),
    doc('noise', 'Main Gate'),
  ]);

  it.each([
    ['libary', 'lib'],
    ['pharmcy', 'pharm'],
    ['managment', 'mgmt'],
    ['centrl libary', 'lib'],
  ])('%s → %s', (q, expected) => {
    const hits = index.search(q);
    expect(hits[0]?.doc.id).toBe(expected);
    expect(hits[0]?.matchKind).toBe('fuzzy');
    expect(hits[0]!.score).toBeLessThanOrEqual(TIER_SCORES.fuzzyMax);
  });

  it('does not fuzz-match short tokens into unrelated docs', () => {
    expect(index.search('lab')).toEqual([]);
    expect(index.search('xyzzy')).toEqual([]);
  });

  it('supports in-order subsequence matching as a last resort', () => {
    const [hit] = index.search('phrmcy');
    expect(hit?.doc.id).toBe('pharm');
  });
});

describe('multiword queries', () => {
  const index = createSearchIndex([
    doc('lim', 'Lovely Institute of Management'),
    doc('lib', 'Lovely Library'),
    doc('mgmt', 'Management Office', { aliases: ['Admin Block'] }),
  ]);

  it('matches all tokens in any order', () => {
    const hits = index.search('management lovely');
    expect(hits[0]?.doc.id).toBe('lim');
    expect(hits[0]?.matchKind).toBe('multiword');
  });

  it('matches tokens across title and aliases', () => {
    const hits = index.search('admin management');
    expect(hits[0]?.doc.id).toBe('mgmt');
    expect(hits[0]?.matchKind).toBe('multiword');
  });

  it('ignores stopwords in the query', () => {
    expect(index.search('the lovely management')[0]?.doc.id).toBe('lim');
  });
});

describe('generic-word suppression', () => {
  const index = createSearchIndex([
    doc('hall1', 'Hall 1'),
    doc('main-hall', 'Main Hall'),
    doc('boys4', 'Boys Hall 4'),
    doc('boys-hostel', 'Boys Hostel'),
    doc('girls4', 'Girls Hostel 4'),
  ]);

  it("ranks the specific match first for 'boys hall 4'", () => {
    const hits = index.search('boys hall 4');
    expect(hits[0]?.doc.id).toBe('boys4');
    const pos = (id: string): number => ids(hits).indexOf(id);
    expect(pos('boys-hostel')).toBeGreaterThan(-1);
    expect(pos('girls4')).toBeGreaterThan(-1);
    for (const genericOnly of ['hall1', 'main-hall']) {
      expect(pos(genericOnly)).toBeGreaterThan(pos('boys-hostel'));
      expect(pos(genericOnly)).toBeGreaterThan(pos('girls4'));
    }
  });

  it("still lists every hall for the bare generic query 'hall'", () => {
    const hits = index.search('hall');
    expect(new Set(ids(hits))).toEqual(new Set(['hall1', 'main-hall', 'boys4']));
    expect(hits[0]?.doc.id).toBe('hall1');
  });

  it('never matches a doc solely on a stopword', () => {
    const idx = createSearchIndex([doc('a', 'The Mall'), doc('b', 'Hall of Fame')]);
    expect(idx.search('the')).toEqual([]);
    expect(idx.search('of')).toEqual([]);
    expect(idx.search('of the')).toEqual([]);
  });

  it('treats a stopword-only query as the prefix of a longer word while typing', () => {
    const idx = createSearchIndex([
      doc('mall', 'The Mall'),
      doc('fame', 'Hall of Fame'),
      doc('theatre', 'Open Theatre'),
      doc('atm', 'ATM & bank', { kind: 'category' }),
      doc('office', 'Office of Dean'),
      doc('kw', 'Kiosk', { keywords: ['the corner', 'atmosphere'] }),
    ]);
    expect(ids(idx.search('the'))).toEqual(['theatre']);
    expect(ids(idx.search('at'))).toEqual(['atm', 'kw']);
    expect(idx.search('at')[1]?.matchKind).toBe('synonym');
    expect(ids(idx.search('of'))).toEqual(['office']);
    expect(ids(idx.search('of the'))).toEqual(['theatre']);
    expect(idx.search('the')[0]?.highlights).toEqual([[5, 8]]);
  });

  it('still allows an exact title that consists of stopwords', () => {
    const idx = createSearchIndex([doc('a', 'The')]);
    expect(ids(idx.search('the'))).toEqual(['a']);
  });
});

describe('synonyms and keywords', () => {
  it('surfaces docs through keywords below title matches', () => {
    const index = createSearchIndex([
      doc('kiosk', 'Print Kiosk', { keywords: ['xerox', 'photocopy'] }),
      doc('xerox', 'Xerox Corner'),
    ]);
    const hits = index.search('xerox');
    expect(ids(hits)).toEqual(['xerox', 'kiosk']);
    expect(hits[1]?.matchKind).toBe('synonym');
  });

  it('matches multiword keyword phrases by prefix', () => {
    const index = createSearchIndex([doc('w', 'Cooler Point', { keywords: ['drinking water'] })]);
    expect(index.search('drinking wat')[0]?.matchKind).toBe('synonym');
  });
});

describe('search options and robustness', () => {
  const many = Array.from({ length: 40 }, (_, i) => doc(`d${String(i).padStart(2, '0')}`, `Room ${i}`));
  const index = createSearchIndex([...many, doc('cat', 'Rooms', { kind: 'category' })]);

  it('returns [] for empty or whitespace queries', () => {
    expect(index.search('')).toEqual([]);
    expect(index.search('   \t\n')).toEqual([]);
    expect(index.search('---')).toEqual([]);
  });

  it('defaults the limit to APP_CONFIG.search.maxResults and honours explicit limits', () => {
    expect(index.search('room')).toHaveLength(APP_CONFIG.search.maxResults);
    expect(index.search('room', { limit: 3 })).toHaveLength(3);
    expect(index.search('room', { limit: 0 })).toEqual([]);
    expect(index.search('room', { limit: -2 })).toEqual([]);
  });

  it('filters by kind', () => {
    expect(ids(index.search('room', { kinds: ['category'] }))).toEqual(['cat']);
    expect(index.search('room', { kinds: ['command'] })).toEqual([]);
  });

  it('never throws on weird input', () => {
    const weird = ['🍕🍕🍕', '\u0000￿', 'a'.repeat(100_000), '\ud83d', '[(.*+?)]', '%s %d', 'é'.repeat(500)];
    for (const q of weird) expect(() => index.search(q)).not.toThrow();
    expect(() => index.search(undefined as unknown as string)).not.toThrow();
    expect(() => index.search(42 as unknown as string)).not.toThrow();
  });

  it('tolerates malformed options from untyped callers', () => {
    const bad = [null, 'x', { limit: 'many' }, { kinds: 'place' }] as unknown as Array<{ limit?: number }>;
    for (const opts of bad) {
      expect(() => index.search('room', opts)).not.toThrow();
      expect(index.search('room', opts)).toHaveLength(APP_CONFIG.search.maxResults);
    }
  });

  it('caps the query at 100 characters', () => {
    const idx = createSearchIndex([doc('a', 'x'.repeat(100))]);
    expect(ids(idx.search('x'.repeat(150)))).toEqual(['a']);
    expect(idx.search('x'.repeat(150))[0]?.matchKind).toBe('exact');
  });

  it('deduplicates docs by id (first occurrence wins)', () => {
    const idx = createSearchIndex([
      doc('dup', 'Library'),
      doc('dup', 'Library Annexe'),
      doc('x', 'Library Two'),
    ]);
    expect(idx.size).toBe(2);
    const hits = idx.search('library');
    expect(ids(hits)).toEqual(['dup', 'x']);
    expect(hits[0]?.doc.title).toBe('Library');
  });

  it('handles docs with missing optional fields', () => {
    const bare = {
      id: 'bare',
      kind: 'layer',
      title: 'Buildings layer',
      ref: 'buildings',
      hasLocation: false,
    };
    const idx = createSearchIndex([
      bare as unknown as SearchDoc,
      doc('cmd', 'Reset view', { kind: 'command' }),
    ]);
    expect(ids(idx.search('buildings'))).toEqual(['bare']);
    expect(ids(idx.search('reset'))).toEqual(['cmd']);
  });

  it('returns empty results when nothing matches', () => {
    expect(index.search('zzzz qqqq')).toEqual([]);
  });
});

describe('determinism', () => {
  const docs: SearchDoc[] = [
    doc('a', 'Hostel 1', { boost: 0 }),
    doc('b', 'Hostel 2'),
    doc('c', 'Hostel 10'),
    doc('d', 'Hostel Office'),
    doc('e', 'Mens Hostel'),
    doc('f', 'Boys Hostel', { boost: 2 }),
    doc('g', 'Hostel 1'),
  ];

  const shuffled = (seed: number): SearchDoc[] => {
    const out = [...docs];
    let s = seed;
    for (let i = out.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) % 2147483648;
      const j = s % (i + 1);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };

  it('gives identical results across runs and input orders', () => {
    const baseline = createSearchIndex(docs).search('hostel');
    for (let seed = 1; seed <= 10; seed++) {
      const result = createSearchIndex(shuffled(seed)).search('hostel');
      expect(result).toEqual(baseline);
    }
    expect(createSearchIndex(docs).search('hostel')).toEqual(baseline);
  });

  it('breaks ties by boost, then shorter title, then id', () => {
    const hits = createSearchIndex(docs).search('hostel');
    const order = ids(hits);
    // Identical titles 'Hostel 1' tie on everything but id.
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('g'));
    // Equal-score word matches: the boosted doc wins.
    expect(order.indexOf('f')).toBeLessThan(order.indexOf('e'));
  });
});

describe('short queries and subsequence matching', () => {
  const idx = createSearchIndex([
    doc('atm', 'ATM & bank', { kind: 'category' }),
    doc('apt', 'Apartment Block 3'),
    doc('pharm', 'Pharmacy'),
  ]);

  it("a 3-letter query does not fuzzy-highlight scattered letters ('atm' in 'Apartment')", () => {
    const hits = idx.search('atm');
    expect(ids(hits)).toEqual(['atm']);
    expect(hits.some((h) => h.matchKind === 'fuzzy')).toBe(false);
  });

  it('subsequence matching still applies from 4 characters', () => {
    const [hit] = idx.search('phrm');
    expect(hit?.doc.id).toBe('pharm');
    expect(hit?.matchKind).toBe('fuzzy');
  });
});
