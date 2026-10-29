/** Adapters from base places / DB records to duplicate-detection sources. */
import type { DuplicateSource } from '../../src/community/index.ts';
import type { BaseData } from '../base-data.ts';
import type { LocationRecord, SuggestionRecord } from '../db/records.ts';

/**
 * Campus places plus (v2) the off-campus context places: a suggestion near Law
 * Gate must still be flagged as a possible duplicate of a mapped shop, even
 * though v2 moved those shops out of places.json.
 */
export function baseSources(base: BaseData): DuplicateSource[] {
  const out: DuplicateSource[] = [];
  for (const p of [...base.places.values(), ...base.contextPlaces.values()]) {
    out.push({ id: p.id, kind: 'place', name: p.name, categoryId: p.categoryId, location: p.location });
  }
  return out;
}

export const locationSources = (locations: readonly LocationRecord[]): DuplicateSource[] =>
  locations.map((l) => ({
    id: l.id,
    kind: 'location',
    name: l.name,
    categoryId: l.categoryId,
    location: l.location,
  }));

export const suggestionSources = (suggestions: readonly SuggestionRecord[]): DuplicateSource[] =>
  suggestions.map((s) => ({
    id: s.id,
    kind: 'suggestion',
    name: s.name,
    categoryId: s.categoryId,
    location: s.location,
  }));
