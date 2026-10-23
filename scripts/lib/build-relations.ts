/**
 * Place relations derived from geometry. Every relation states its method;
 * proximity ("nearby") never implies a physical connection or a path.
 */
import type { Place, Relation } from '../../src/data/schema.ts';
import { haversineM } from '../../src/distance/geodesic.ts';
import type { BuildingRecord } from './build-buildings.ts';
import type { PlaceRecord } from './build-places.ts';
import { inBBox, pointInMultiPolygon, round } from './geometry.ts';

/** Categories offered as "nearby essentials" for named facilities and buildings. */
export const ESSENTIAL_CATEGORIES = ['food', 'water', 'washroom', 'finance', 'health', 'printing'] as const;
export const NEARBY_RADIUS_M = 150;
export const NEARBY_LIMIT = 3;

export interface RelationsContext {
  campusPlaceId: string;
  buildings: readonly BuildingRecord[];
  retrievedAt: string;
}

export interface RelationsResult {
  relations: Relation[];
  attachedEntrances: string[];
  unattachedEntrances: string[];
}

export function relationId(type: Relation['type'], from: string, to: string): string {
  return `${type}:${from}->${to}`;
}

function osmRelation(
  type: Relation['type'],
  from: string,
  to: string,
  method: Relation['method'],
  retrievedAt: string,
  extra: Partial<Relation> = {},
): Relation {
  return {
    id: relationId(type, from, to),
    type,
    from,
    to,
    inferred: true,
    method,
    ...extra,
    provenance: {
      sourceId: 'osm',
      retrievedAt,
      verificationStatus: method === 'distance' ? 'estimated' : 'imported',
      notes:
        method === 'distance'
          ? 'Straight-line proximity only; does not imply a path or physical connection.'
          : 'Derived from OpenStreetMap geometry.',
    },
  };
}

/** Smallest building footprint containing the point, if any. */
export function containingBuilding(
  p: [number, number],
  buildings: readonly BuildingRecord[],
): BuildingRecord | null {
  let best: BuildingRecord | null = null;
  for (const b of buildings) {
    if (!inBBox(p, b.bbox) || !pointInMultiPolygon(p, b.multiPolygon)) continue;
    if (!best || (b.areaM2 ?? Infinity) < (best.areaM2 ?? Infinity)) best = b;
  }
  return best;
}

/** Builds relations and sets buildingId / entrance labels on places (mutates). */
export function buildRelations(records: PlaceRecord[], ctx: RelationsContext): RelationsResult {
  const relations: Relation[] = [];
  const attachedEntrances: string[] = [];
  const unattachedEntrances: string[] = [];

  for (const rec of records) {
    const { place } = rec;
    if (!place.location || place.kind === 'building' || place.kind === 'organization') continue;
    if (place.kind === 'entrance') {
      const host = ctx.buildings.find(
        (b) => rec.osmNodeId !== undefined && b.outlineNodeIds.has(rec.osmNodeId),
      );
      if (host) {
        place.buildingId = host.id;
        if (!place.name) place.displayName = `${place.displayName} · ${host.displayName}`;
        relations.push(
          osmRelation('accessed_via', host.id, place.id, 'osm-entrance-on-outline', ctx.retrievedAt),
        );
        attachedEntrances.push(place.id);
      } else {
        unattachedEntrances.push(place.id);
      }
      continue;
    }
    if (rec.geometry !== 'point') continue;
    const host = containingBuilding(place.location, ctx.buildings);
    if (host) {
      place.buildingId = host.id;
      relations.push(osmRelation('located_in', place.id, host.id, 'osm-containment', ctx.retrievedAt));
    }
  }

  for (const { place } of records) {
    if (place.id === ctx.campusPlaceId || place.kind === 'organization' || place.campusZone !== 'on-campus')
      continue;
    if (!place.location) continue;
    relations.push(osmRelation('part_of', place.id, ctx.campusPlaceId, 'osm-containment', ctx.retrievedAt));
  }

  const essentials = records
    .map((r) => r.place)
    .filter(
      (p): p is Place & { location: [number, number] } =>
        p.location !== null && (ESSENTIAL_CATEGORIES as readonly string[]).includes(p.categoryId),
    );
  for (const { place } of records) {
    if (!place.name || !place.location || (place.kind !== 'facility' && place.kind !== 'building')) continue;
    const origin = place.location;
    const near = essentials
      .filter((e) => e.id !== place.id && e.buildingId !== place.id && place.buildingId !== e.id)
      .map((e) => ({ e, d: haversineM(origin, e.location) }))
      .filter((x) => x.d <= NEARBY_RADIUS_M)
      .sort((a, b) => a.d - b.d || a.e.id.localeCompare(b.e.id))
      .slice(0, NEARBY_LIMIT);
    for (const { e, d } of near) {
      relations.push(
        osmRelation('nearby', place.id, e.id, 'distance', ctx.retrievedAt, { distanceM: round(d, 1) }),
      );
    }
  }
  return { relations, attachedEntrances, unattachedEntrances };
}

export function sortRelations(relations: Relation[]): Relation[] {
  return [...relations].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
