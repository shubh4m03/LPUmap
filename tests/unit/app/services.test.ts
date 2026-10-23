import { describe, expect, it } from 'vitest';
import { buildServices, categorySubtitle, hostNames } from '../../../src/app/data/services.ts';
import { syntheticCampus } from './synthetic-campus.ts';

describe('buildServices', () => {
  const s = buildServices(syntheticCampus());

  it('derives counts from the data (all vs located)', () => {
    expect(s.categoryCounts['food']).toBe(2);
    expect(s.categoryCounts['library']).toBe(1);
    expect(s.locatedCounts['library']).toBeUndefined();
    expect(s.locatedCounts['finance']).toBe(1);
  });

  it('ranks the category doc first for category words', () => {
    for (const q of ['food', 'atm', 'water', 'xerox']) {
      const [top] = s.searchIndex.search(q);
      expect(top?.doc.kind, q).toBe('category');
    }
    expect(s.searchIndex.search('water')[0]?.doc.subtitle).toBe('None mapped yet');
  });

  it('never calls an unlocated place "mapped" in a category subtitle', () => {
    // The synthetic library is listed but has no map position.
    const lib = s.searchIndex.search('library').find((h) => h.doc.kind === 'category');
    expect(lib?.doc.subtitle).toBe('1 listed · no verified map position yet');
    expect(categorySubtitle(0, 0)).toBeUndefined();
    expect(categorySubtitle(3, 3)).toBeUndefined();
    expect(categorySubtitle(3, 1)).toBe('1 mapped · 2 without a verified map position');
  });

  it('indexes commands and layers, and never indexes the generated unnamed label', () => {
    expect(s.searchIndex.search('dark')[0]?.doc).toMatchObject({ kind: 'command', ref: 'toggle-theme' });
    expect(s.searchIndex.search('layers').some((h) => h.doc.kind === 'command')).toBe(true);
    expect(s.searchIndex.search('unnamed building').some((h) => h.doc.ref === 'osm:way/2')).toBe(false);
  });

  it('resolves source names and places', () => {
    expect(s.sourceName('curated:lib')).toBe('Synthetic library page');
    expect(s.sourceName('missing')).toBe('missing');
    expect(s.getPlace('osm:node/1')?.name).toBe('Synthetic Food Point');
    expect(s.router.nodeCount).toBe(3);
  });
});

describe('hostNames', () => {
  it('names the place a place is located_in, from located_in relations only', () => {
    const data = syntheticCampus();
    const [a, b] = data.places;
    const rel = (type: 'located_in' | 'nearby', from: string, to: string) => ({
      id: `${type}:${from}->${to}`,
      type,
      from,
      to,
      inferred: false,
      method: 'curated' as const,
      provenance: a!.provenance,
    });
    const host = hostNames(data.places, [rel('located_in', a!.id, b!.id), rel('nearby', b!.id, a!.id)]);
    expect(host(a!.id)).toBe(b!.displayName);
    expect(host(b!.id)).toBeUndefined();
  });
});
