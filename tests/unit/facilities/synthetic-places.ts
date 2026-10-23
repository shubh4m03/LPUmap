/** Synthetic (invented) places and relations for facilities tests — not LPU data. */
import type { LngLat, Place, Relation } from '../../../src/data/schema.ts';

export const ORIGIN: LngLat = [75.7, 31.25];

/** A point `metresEast` east of ORIGIN (≈ 0.0000105° longitude per metre at this latitude). */
export function east(metresEast: number): LngLat {
  return [ORIGIN[0] + metresEast / (111_320 * Math.cos((ORIGIN[1] * Math.PI) / 180)), ORIGIN[1]];
}

export function place(overrides: Partial<Place> & Pick<Place, 'id'>): Place {
  return {
    name: null,
    displayName: overrides.id,
    aliases: [],
    categoryId: 'other',
    kind: 'facility',
    location: ORIGIN,
    campusZone: 'on-campus',
    wheelchair: 'unknown',
    provenance: { sourceId: 'synthetic', verificationStatus: 'unverified' },
    ...overrides,
  };
}

export function relation(
  id: string,
  type: Relation['type'],
  from: string,
  to: string,
  extra: Partial<Relation> = {},
): Relation {
  return {
    id,
    type,
    from,
    to,
    inferred: true,
    method: 'curated',
    provenance: { sourceId: 'synthetic', verificationStatus: 'unverified' },
    ...extra,
  };
}
