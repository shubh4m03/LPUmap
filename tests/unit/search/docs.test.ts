import { describe, expect, it } from 'vitest';
import { CATEGORIES, getCategory } from '../../../src/config/categories.ts';
import {
  createSearchIndex,
  docsFromCategories,
  docsFromPlaces,
  looksLikeCode,
} from '../../../src/search/index.ts';
import { place } from './helpers.ts';

describe('docsFromPlaces', () => {
  it('tells identical titles apart by kind and host in the subtitle', () => {
    const docs = docsFromPlaces(
      [
        place('osm:way/9', {
          name: 'School of Design',
          displayName: 'School of Design',
          kind: 'facility',
          categoryId: 'academic',
        }),
        place('cur:design', {
          name: 'School of Design',
          displayName: 'School of Design',
          kind: 'organization',
          categoryId: 'academic',
        }),
        place('osm:way/10', { name: 'Central Library', categoryId: 'library' }),
      ],
      { hostName: (id) => (id === 'cur:design' ? 'School of Design' : undefined) },
    );
    const academic = getCategory('academic').label;
    expect(docs.map((d) => d.subtitle)).toEqual([
      `${academic} · Facility`,
      `${academic} · Department or office · in School of Design`,
      getCategory('library').label,
    ]);
    expect(new Set(docs.map((d) => d.subtitle)).size).toBe(docs.length);
    expect(docs.map((d) => d.qualifier)).toEqual([
      'Facility',
      'Department or office · in School of Design',
      undefined,
    ]);
  });

  it('excludes unnamed places without aliases and keeps named or aliased ones', () => {
    const docs = docsFromPlaces([
      place('osm:way/1'),
      place('osm:way/2', { displayName: 'Unnamed building · 4 floors', levels: 4 }),
      place('osm:way/3', { name: 'Central Library', categoryId: 'library' }),
      place('osm:way/4', { aliases: ['Block 34', 'B34'], categoryId: 'academic' }),
      place('osm:way/5', { name: '   ' }),
    ]);
    expect(docs.map((d) => d.ref)).toEqual(['osm:way/3', 'osm:way/4']);
    expect(docs.some((d) => /unnamed/i.test(d.title))).toBe(false);
  });

  it('uses a sourced alias as the title of a nameless place, never the generated display label', () => {
    const [d] = docsFromPlaces([
      place('osm:way/4', { aliases: ['Block 34', 'B34'], categoryId: 'academic' }),
    ]);
    expect(d?.title).toBe('Block 34');
    expect(d?.aliases).toEqual(['B34']);
    expect(d?.codes).toEqual(['B34']);
  });

  it('builds subtitle, keywords, ids and location flags from the record only', () => {
    const [onCampus, offCampus, noLocation] = docsFromPlaces([
      place('osm:node/1', { name: 'Campus Pharmacy', categoryId: 'health', subcategory: 'pharmacy' }),
      place('osm:node/2', { name: 'Hotel X', categoryId: 'residential', campusZone: 'off-campus-nearby' }),
      place('cur:registrar', {
        name: 'Registrar Office',
        categoryId: 'other',
        kind: 'organization',
        location: null,
      }),
    ]);
    expect(onCampus).toMatchObject({
      id: 'place:osm:node/1',
      kind: 'place',
      ref: 'osm:node/1',
      categoryId: 'health',
      subtitle: 'Health & emergency',
      hasLocation: true,
    });
    expect(onCampus?.keywords).toEqual(expect.arrayContaining(getCategory('health').synonyms));
    expect(onCampus?.keywords.filter((k) => k === 'pharmacy')).toHaveLength(1);
    expect(offCampus?.subtitle).toBe('Residence / PG / apartment · Off campus (nearby)');
    expect(noLocation?.hasLocation).toBe(false);
  });

  it('falls back to the "other" category for unknown category ids', () => {
    const [d] = docsFromPlaces([place('x', { name: 'Thing', categoryId: 'does-not-exist' })]);
    expect(d?.subtitle).toBe('Other mapped place');
  });

  it('keeps unnamed places from flooding a generic query', () => {
    const places = [
      ...Array.from({ length: 300 }, (_, i) => place(`osm:way/${i}`)),
      place('osm:way/named', { name: 'Admin Building' }),
    ];
    const index = createSearchIndex(docsFromPlaces(places));
    expect(index.size).toBe(1);
    expect(index.search('building').map((h) => h.doc.ref)).toEqual(['osm:way/named']);
  });
});

describe('looksLikeCode', () => {
  it.each([
    ['B34', true],
    ['B-34', true],
    ['BH 4', true],
    ['LIM', true],
    ['UniMall', false],
    ['Block 34', false],
    ['Library', false],
    ['ABCDEF', false],
    ['A', false],
  ])('%s → %s', (alias, expected) => {
    expect(looksLikeCode(alias)).toBe(expected);
  });
});

describe('docsFromCategories', () => {
  const counts = { finance: 3, printing: 0, washroom: 12 };
  const docs = docsFromCategories(CATEGORIES, counts);

  it('creates one category doc per category with counts from the input only', () => {
    expect(docs).toHaveLength(CATEGORIES.length);
    const finance = docs.find((d) => d.ref === 'finance');
    expect(finance).toMatchObject({
      id: 'category:finance',
      kind: 'category',
      title: 'ATM & bank',
      subtitle: '3 mapped',
    });
    expect(docs.find((d) => d.ref === 'printing')?.subtitle).toBe('None mapped yet');
    expect(docs.find((d) => d.ref === 'library')?.subtitle).toBeUndefined();
    expect(docs.every((d) => d.hasLocation === false)).toBe(true);
  });

  it.each([
    ['atm', 'finance'],
    ['xerox', 'printing'],
    ['toilet', 'washroom'],
    ['water', 'water'],
    ['food', 'food'],
  ])("query '%s' surfaces the %s category", (q, categoryId) => {
    const index = createSearchIndex(docs);
    const hits = index.search(q);
    expect(hits[0]?.doc.ref).toBe(categoryId);
    expect(hits[0]?.doc.kind).toBe('category');
  });

  it('ranks category docs alongside place docs', () => {
    const places = docsFromPlaces([place('osm:node/9', { name: 'SBI ATM', categoryId: 'finance' })]);
    const hits = createSearchIndex([...places, ...docs]).search('atm');
    expect(hits.map((h) => h.doc.id).slice(0, 2)).toEqual(['category:finance', 'place:osm:node/9']);
  });
});
