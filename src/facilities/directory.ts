/**
 * In-memory facility directory built from the generated dataset. Every count
 * and relationship is derived from the records passed in — nothing is added.
 */
import type { Place, Relation, RelationType } from '../data/schema.ts';

/** UI wording per relation type. `nearby` is explicitly not a physical connection. */
export const RELATION_LABELS: Record<RelationType, string> = {
  located_in: 'Inside',
  part_of: 'Part of',
  accessed_via: 'Entrance',
  nearby: 'Nearby (not a physical connection)',
  connected_by_path: 'Connected by mapped path',
};

export interface RelatedPlace {
  relation: Relation;
  place: Place;
  /** Label from RELATION_LABELS for the relation type. */
  label: string;
  /** 'outgoing' when the queried place is `relation.from`, 'incoming' when it is `relation.to`. */
  direction: 'outgoing' | 'incoming';
}

export interface CountOptions {
  /** true = only places with a map position; false = only places without one; omitted = all. */
  located?: boolean;
}

export interface FacilityDirectory {
  all: Place[];
  get(id: string): Place | undefined;
  byCategory(categoryId: string): Place[];
  countsByCategory(opts?: CountOptions): Record<string, number>;
  related(id: string): RelatedPlace[];
  isRoutable(place: Place): boolean;
}

/**
 * A place is a route endpoint only when it is on the campus, has a map position
 * and a validated path node. Off-campus places (the opt-in "Nearby, outside
 * campus" layer and owner/community locations outside the boundary) are never
 * LPU facilities or routing destinations (owner rule, map spec Phase 6), even
 * when a path node is recorded for them.
 */
export function isRoutablePlace(place: Place): boolean {
  return place.campusZone === 'on-campus' && place.location !== null && place.graphNodeId !== undefined;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function createFacilityDirectory(places: Place[], relations: Relation[]): FacilityDirectory {
  const byId = new Map<string, Place>();
  for (const p of places) {
    // First record wins on duplicate ids; validateRelations/quality checks report data issues.
    if (!byId.has(p.id)) byId.set(p.id, p);
  }
  const all = [...byId.values()];
  const categoryIndex = new Map<string, Place[]>();
  for (const p of all) pushTo(categoryIndex, p.categoryId, p);

  const relationIndex = new Map<string, RelatedPlace[]>();
  for (const relation of relations) {
    const from = byId.get(relation.from);
    const to = byId.get(relation.to);
    // Relations with a missing endpoint are dropped rather than shown half-resolved.
    if (!from || !to || from.id === to.id) continue;
    const label = RELATION_LABELS[relation.type];
    pushTo(relationIndex, from.id, { relation, place: to, label, direction: 'outgoing' });
    pushTo(relationIndex, to.id, { relation, place: from, label, direction: 'incoming' });
  }

  return {
    all,
    get: (id) => byId.get(id),
    byCategory: (categoryId) => [...(categoryIndex.get(categoryId) ?? [])],
    countsByCategory(opts = {}) {
      const counts: Record<string, number> = {};
      for (const p of all) {
        if (opts.located !== undefined && (p.location !== null) !== opts.located) continue;
        counts[p.categoryId] = (counts[p.categoryId] ?? 0) + 1;
      }
      return counts;
    },
    related: (id) => [...(relationIndex.get(id) ?? [])],
    isRoutable: isRoutablePlace,
  };
}
