import { describe, expect, it } from 'vitest';
import {
  findPossibleDuplicates,
  keySimilarity,
  nameKey,
  nameSimilarity,
  type DuplicateSource,
} from '../../../src/community/duplicates.ts';

const src = (
  id: string,
  name: string | null,
  categoryId: string,
  location: [number, number] | null,
): DuplicateSource => ({
  id,
  kind: 'place',
  name,
  categoryId,
  location,
});

const HERE: [number, number] = [75.7005, 31.25];
/** ~`m` metres east of HERE (1e-5° lon ≈ 0.95 m at this latitude). */
const east = (m: number): [number, number] => [HERE[0] + m / 95_100, HERE[1]];

describe('name similarity (Sørensen–Dice over bigrams of normalised names)', () => {
  it('normalises case, diacritics, punctuation, spacing and &', () => {
    expect(nameKey('  Café & Bakery! ')).toBe(nameKey('cafe and bakery'));
    expect(nameSimilarity('Block-34', 'block 34')).toBe(1);
  });

  it('scores identical 1, unrelated low, near-misses high', () => {
    expect(keySimilarity('library', 'library')).toBe(1);
    expect(nameSimilarity('Main Library', 'Main Libary')).toBeGreaterThanOrEqual(0.8);
    expect(nameSimilarity('Main Library', 'Food Court')).toBeLessThan(0.3);
    expect(keySimilarity('a', 'b')).toBe(0);
    expect(keySimilarity('', '')).toBe(0);
    // Multiset intersection: repeated bigrams are not over-counted.
    expect(keySimilarity('aaaa', 'aa')).toBeCloseTo((2 * 1) / (3 + 1));
  });
});

describe('findPossibleDuplicates', () => {
  const subject = { name: 'Main Library', categoryId: 'library', location: HERE };

  it('rule 1: similar name within duplicateRadiusM (60 m)', () => {
    const r = findPossibleDuplicates(subject, [
      src('near', 'Main Libary', 'study', east(40)),
      src('far', 'Main Libary', 'study', east(80)),
      src('different', 'Sports Complex', 'study', east(10)),
    ]);
    expect(r.map((d) => d.id)).toEqual(['near']);
    expect(r[0]?.reason).toMatch(/Similar name/);
    expect(r[0]?.distanceM).toBeCloseTo(40, 0);
  });

  it('rule 2: same category within 15 m regardless of name', () => {
    const r = findPossibleDuplicates(subject, [
      src('samecat', 'Reading Room', 'library', east(10)),
      src('samecat-far', 'Reading Room', 'library', east(20)),
      src('othercat', 'Reading Room', 'food', east(5)),
    ]);
    expect(r.map((d) => [d.id, d.reason.startsWith('Same category')])).toEqual([['samecat', true]]);
  });

  it('rule 3: identical normalised name anywhere inside the map bounds (not outside)', () => {
    const r = findPossibleDuplicates(subject, [
      src('same-name-far', 'MAIN  library', 'food', [75.72, 31.268]),
      src('outside-bounds', 'Main Library', 'food', [77.2, 28.6]),
    ]);
    expect(r.map((d) => d.id)).toEqual(['same-name-far']);
    expect(r[0]?.reason).toMatch(/Same name/);
  });

  it('skips sources without location, excluded ids and repeats; sorts by distance then id; caps the list', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      src(`p${String(i).padStart(2, '0')}`, 'Main Library', 'x', east(i)),
    );
    const r = findPossibleDuplicates(
      subject,
      [
        src('noloc', 'Main Library', 'library', null),
        src('self', 'Main Library', 'library', HERE),
        ...many,
        many[3]!,
      ],
      { excludeIds: new Set(['self']) },
    );
    expect(r).toHaveLength(10);
    expect(r.map((d) => d.id)).toEqual([
      'p00',
      'p01',
      'p02',
      'p03',
      'p04',
      'p05',
      'p06',
      'p07',
      'p08',
      'p09',
    ]);
  });

  it('unnamed base places can only match by category proximity', () => {
    const r = findPossibleDuplicates({ name: 'Block 9', categoryId: 'academic', location: HERE }, [
      src('unnamed-near', null, 'academic', east(5)),
      src('unnamed-other', null, 'food', east(5)),
    ]);
    expect(r.map((d) => [d.id, d.name])).toEqual([['unnamed-near', 'unnamed-near']]);
  });
});
