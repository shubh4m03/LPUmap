import { describe, expect, it } from 'vitest';
import { RELATION_LABELS, createFacilityDirectory } from '../../../src/facilities/index.ts';
import { place, relation } from './synthetic-places.ts';

const places = [
  place({ id: 'b1', kind: 'building', categoryId: 'academic', graphNodeId: 3 }),
  place({ id: 'b2', kind: 'building', categoryId: 'building' }),
  place({ id: 'f1', categoryId: 'food', buildingId: 'b1', graphNodeId: 4 }),
  place({ id: 'f2', categoryId: 'food' }),
  place({ id: 'e1', kind: 'entrance', categoryId: 'gate', graphNodeId: 5 }),
  place({ id: 'org1', kind: 'organization', categoryId: 'academic', location: null }),
  place({ id: 'org2', kind: 'organization', categoryId: 'library', location: null, graphNodeId: 9 }),
];

const relations = [
  relation('r1', 'located_in', 'f1', 'b1'),
  relation('r2', 'accessed_via', 'b1', 'e1'),
  relation('r3', 'nearby', 'f2', 'b2', { distanceM: 40 }),
  relation('r4', 'part_of', 'org1', 'b1'),
  relation('r5', 'connected_by_path', 'b1', 'b2'),
  relation('r-missing', 'nearby', 'f1', 'ghost', { distanceM: 10 }),
];

const dir = createFacilityDirectory(places, relations);

describe('createFacilityDirectory', () => {
  it('looks places up by id', () => {
    expect(dir.get('f1')?.categoryId).toBe('food');
    expect(dir.get('nope')).toBeUndefined();
    expect(dir.all).toHaveLength(places.length);
  });

  it('keeps the first record when ids are duplicated', () => {
    const d = createFacilityDirectory(
      [place({ id: 'x', displayName: 'first' }), place({ id: 'x', displayName: 'second' })],
      [],
    );
    expect(d.all).toHaveLength(1);
    expect(d.get('x')?.displayName).toBe('first');
  });

  it('lists a category and returns a copy callers cannot corrupt', () => {
    expect(dir.byCategory('food').map((p) => p.id)).toEqual(['f1', 'f2']);
    dir.byCategory('food').pop();
    expect(dir.byCategory('food')).toHaveLength(2);
    expect(dir.byCategory('water')).toEqual([]);
  });

  it('derives counts from the data only', () => {
    expect(dir.countsByCategory()).toEqual({ academic: 2, building: 1, food: 2, gate: 1, library: 1 });
  });

  it('separates located (map) counts from organisations without a position', () => {
    expect(dir.countsByCategory({ located: true })).toEqual({ academic: 1, building: 1, food: 2, gate: 1 });
    expect(dir.countsByCategory({ located: false })).toEqual({ academic: 1, library: 1 });
  });

  it('returns relations in both directions with labels', () => {
    const b1 = dir.related('b1');
    expect(b1.map((r) => [r.relation.id, r.place.id, r.direction, r.label])).toEqual([
      ['r1', 'f1', 'incoming', 'Inside'],
      ['r2', 'e1', 'outgoing', 'Entrance'],
      ['r4', 'org1', 'incoming', 'Part of'],
      ['r5', 'b2', 'outgoing', 'Connected by mapped path'],
    ]);
    const f1 = dir.related('f1');
    expect(f1.map((r) => [r.place.id, r.direction])).toEqual([['b1', 'outgoing']]);
  });

  it('labels nearby relations as not a physical connection', () => {
    expect(dir.related('b2').find((r) => r.relation.type === 'nearby')?.label).toBe(
      'Nearby (not a physical connection)',
    );
    expect(RELATION_LABELS.nearby).toContain('not a physical connection');
  });

  it('drops relations whose endpoint is missing', () => {
    expect(dir.related('ghost')).toEqual([]);
    expect(dir.related('f1').some((r) => r.relation.id === 'r-missing')).toBe(false);
  });

  it('routable requires both a location and a graph node', () => {
    expect(dir.isRoutable(places[0]!)).toBe(true);
    expect(dir.isRoutable(places[1]!)).toBe(false); // no graph node
    expect(dir.isRoutable(places[6]!)).toBe(false); // graph node but no location
  });

  it('an off-campus place is never routable, even with a location and a graph node', () => {
    // Owner rule (map spec Phase 6): off-campus places are never LPU facilities or routing destinations.
    expect(dir.isRoutable({ ...places[0]!, campusZone: 'off-campus-nearby' })).toBe(false);
  });
});
