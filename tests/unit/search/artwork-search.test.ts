/**
 * Global search over the campus illustration (src/search/artwork-docs.ts) on
 * the committed dataset and manifest: exact labels, artwork numbers
 * ("25", "Block 25", "BLOCK-25") and aliases; one result per building for a
 * verified item; held labels and unlabelled areas never indexed.
 */
import { describe, expect, it } from 'vitest';
import { ARTWORK_DOC_PREFIX, artworkNumberCodes, docsFromArtwork } from '../../../src/search/index.ts';
import { artServices, CANDIDATE_25, VERIFIED_25 } from '../directory/artwork-fixtures.ts';

describe('artwork search docs', () => {
  const s = artServices();
  const art = s.buildingDirectory.artwork!;
  const docs = docsFromArtwork(art.entries);

  it('indexes artwork-only items with exact titles, no location and the artwork wording', () => {
    const d25 = docs.find((d) => d.ref === 'art:num-25')!;
    expect(d25).toMatchObject({
      id: `${ARTWORK_DOC_PREFIX}art:num-25`,
      kind: 'artwork',
      title: 'SCHOOL OF AGRICULTURE',
      hasLocation: false,
    });
    expect(d25.subtitle).toBe('Campus illustration · No. 25 on the illustration · Unconfirmed match');
    expect(d25.aliases).toContain('BLOCK-25,26:');
    expect(d25.categoryId).toBeUndefined();
    expect(docs.find((d) => d.ref === 'art:num-56')!.title).toBe('SCHOOL OF CIVIL INGNEERING');
    expect(docs.find((d) => d.ref === 'art:scene-091')!.subtitle).toBe(
      'Campus illustration · Not linked to a map building',
    );
  });

  it('never indexes a held label or an area with nothing printed on it', () => {
    expect(docs.some((d) => d.ref === 'art:scene-103')).toBe(false);
    expect(docs.some((d) => d.ref === 'art:area-scene-pavilion')).toBe(false);
    // Printed letters are text: the "LPU" letters area is searchable by them.
    expect(docs.some((d) => d.ref === 'art:area-text-lpu-letters')).toBe(true);
    expect(s.searchIndex.search('DILDO').some((h) => h.doc.kind === 'artwork')).toBe(false);
  });

  it('finds an item by its artwork number in every printed form', () => {
    expect(artworkNumberCodes('9')).toEqual(['9', 'Block 9', '09', 'Block 09']);
    for (const q of ['Block 25', 'BLOCK-25', 'block25', '25']) {
      const top = s.searchIndex.search(q, { kinds: ['artwork'] })[0]!;
      expect(top.doc.ref, q).toBe('art:num-25');
      expect(top.matchKind, q).toBe('code');
    }
    expect(s.searchIndex.search('Block 25')[0]!.doc.ref).toBe('art:num-25');
    expect(s.searchIndex.search('BLOCK- 09')[0]!.doc.ref).toBe('art:num-9');
  });

  it('finds an item by its exact label and by a corrected-spelling alias, keeping the printed title', () => {
    const exact = s.searchIndex.search('SCHOOL OF CIVIL INGNEERING')[0]!;
    expect(exact.doc).toMatchObject({ ref: 'art:num-56', title: 'SCHOOL OF CIVIL INGNEERING' });
    const alias = s.searchIndex.search('school of civil engineering', { kinds: ['artwork'] })[0]!;
    expect(alias.doc).toMatchObject({ ref: 'art:num-56', title: 'SCHOOL OF CIVIL INGNEERING' });
    expect(s.searchIndex.search('girls hostel 5')[0]!.doc.ref).toBe('art:num-22');
  });

  it('a verified item is one result: its building, findable by the printed label and number', () => {
    const v = artServices([VERIFIED_25]);
    const hits = v.searchIndex.search('SCHOOL OF AGRICULTURE');
    expect(hits.some((h) => h.doc.ref === 'art:num-25')).toBe(false);
    // The caption also labels 26 (still artwork-only), and a curated organisation shares the name:
    // all three are top results, 25 as its building.
    expect(hits.slice(0, 3).map((h) => [h.doc.kind, h.doc.ref])).toEqual(
      expect.arrayContaining([
        ['place', CANDIDATE_25],
        ['artwork', 'art:num-26'],
      ]),
    );
    expect(v.searchIndex.search('Block 25')[0]!.doc.ref).toBe(CANDIDATE_25);
    // The building's own title is unchanged (map key, never replaced by the artwork label).
    const building = hits.find((h) => h.doc.ref === CANDIDATE_25)!;
    expect(building.doc.title).toMatch(/^Map key [A-Z]\d+-\d{2}$/);
    expect(building.doc.aliases).toContain('SCHOOL OF AGRICULTURE');
    // The other subjects of the same caption are still separate artwork items.
    expect(v.searchIndex.search('Block 26')[0]!.doc.ref).toBe('art:num-26');
  });
});
