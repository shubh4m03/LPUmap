import type { Place } from '../../../src/data/schema.ts';
import type { SearchDoc } from '../../../src/search/index.ts';

/** Synthetic doc builder — names here are test fixtures, not campus data. */
export function doc(id: string, title: string, extra: Partial<SearchDoc> = {}): SearchDoc {
  return {
    id,
    kind: 'place',
    title,
    aliases: [],
    codes: [],
    keywords: [],
    ref: id,
    hasLocation: true,
    ...extra,
  };
}

export function place(id: string, overrides: Partial<Place> = {}): Place {
  return {
    id,
    name: null,
    displayName: 'Unnamed building',
    aliases: [],
    categoryId: 'building',
    kind: 'building',
    location: [75.7, 31.25],
    campusZone: 'on-campus',
    wheelchair: 'unknown',
    provenance: { sourceId: 'synthetic', verificationStatus: 'unverified' },
    ...overrides,
  };
}

export function ids(hits: Array<{ doc: SearchDoc }>): string[] {
  return hits.map((h) => h.doc.id);
}
