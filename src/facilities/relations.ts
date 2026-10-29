/**
 * Structural checks on the place-relationship graph. Used by the data
 * pipeline's quality report and by tests; findings are data issues to fix at
 * the source, never something the UI papers over.
 */
import type { Place, Relation } from '../data/index.ts';

export type RelationIssueCode =
  | 'duplicate-relation-id'
  | 'missing-endpoint'
  | 'self-relation'
  | 'duplicate-relation'
  | 'located-in-target-not-building'
  | 'accessed-via-target-not-entrance'
  | 'nearby-without-distance'
  | 'entrance-without-access';

export interface RelationIssue {
  level: 'error' | 'warning';
  code: RelationIssueCode;
  message: string;
  ids: string[];
}

/** Place kinds that can be the target of `accessed_via` (a campus gate is an entrance too). */
const ENTRANCE_KINDS = new Set<Place['kind']>(['entrance', 'gate']);

export function validateRelations(places: Place[], relations: Relation[]): RelationIssue[] {
  const issues: RelationIssue[] = [];
  const byId = new Map(places.map((p) => [p.id, p]));
  const seenIds = new Set<string>();
  const seenEdges = new Map<string, string>();
  const accessedEntrances = new Set<string>();
  const error = (code: RelationIssueCode, message: string, ids: string[]) =>
    issues.push({ level: 'error', code, message, ids });

  for (const r of relations) {
    if (seenIds.has(r.id))
      error('duplicate-relation-id', `Relation id ${r.id} is used more than once`, [r.id]);
    seenIds.add(r.id);

    const to = byId.get(r.to);
    const missing = [r.from, r.to].filter((id) => !byId.has(id));
    if (missing.length > 0) {
      error('missing-endpoint', `Relation ${r.id} references unknown place(s): ${missing.join(', ')}`, [
        r.id,
        ...missing,
      ]);
      continue;
    }
    if (r.from === r.to) {
      error('self-relation', `Relation ${r.id} (${r.type}) links ${r.from} to itself`, [r.id, r.from]);
      continue;
    }
    const edgeKey = `${r.type}\u0000${r.from}\u0000${r.to}`;
    const firstId = seenEdges.get(edgeKey);
    if (firstId !== undefined) {
      error('duplicate-relation', `Relation ${r.id} duplicates ${firstId} (${r.type} ${r.from} → ${r.to})`, [
        firstId,
        r.id,
      ]);
    } else {
      seenEdges.set(edgeKey, r.id);
    }

    if (r.type === 'located_in' && to?.kind !== 'building') {
      error(
        'located-in-target-not-building',
        `Relation ${r.id}: located_in target ${r.to} is a ${to?.kind}`,
        [r.id, r.to],
      );
    }
    if (r.type === 'accessed_via') {
      if (to && ENTRANCE_KINDS.has(to.kind)) accessedEntrances.add(to.id);
      else {
        error(
          'accessed-via-target-not-entrance',
          `Relation ${r.id}: accessed_via target ${r.to} is a ${to?.kind}`,
          [r.id, r.to],
        );
      }
    }
    if (r.type === 'nearby' && r.distanceM === undefined) {
      error('nearby-without-distance', `Relation ${r.id}: nearby relation has no distanceM`, [r.id]);
    }
  }

  for (const p of places) {
    if (p.kind === 'entrance' && !accessedEntrances.has(p.id)) {
      issues.push({
        level: 'warning',
        code: 'entrance-without-access',
        message: `Entrance ${p.id} is not the target of any accessed_via relation`,
        ids: [p.id],
      });
    }
  }
  return issues;
}
