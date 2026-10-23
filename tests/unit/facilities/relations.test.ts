import { describe, expect, it } from 'vitest';
import { validateRelations } from '../../../src/facilities/index.ts';
import { place, relation } from './synthetic-places.ts';

const places = [
  place({ id: 'b1', kind: 'building' }),
  place({ id: 'b2', kind: 'building' }),
  place({ id: 'f1' }),
  place({ id: 'e1', kind: 'entrance' }),
  place({ id: 'g1', kind: 'gate' }),
  place({ id: 'area', kind: 'area' }),
];
const base = [relation('ok-1', 'located_in', 'f1', 'b1'), relation('ok-2', 'accessed_via', 'b1', 'e1')];

const codes = (rels = base, ps = places) => validateRelations(ps, rels).map((i) => [i.level, i.code, i.ids]);

describe('validateRelations', () => {
  it('accepts a consistent graph', () => {
    expect(validateRelations(places, base)).toEqual([]);
  });

  it('reports missing endpoints and skips further checks for them', () => {
    expect(codes([...base, relation('r', 'located_in', 'f1', 'ghost')])).toEqual([
      ['error', 'missing-endpoint', ['r', 'ghost']],
    ]);
    expect(codes([...base, relation('r', 'nearby', 'x', 'y')])).toEqual([
      ['error', 'missing-endpoint', ['r', 'x', 'y']],
    ]);
  });

  it('reports self-relations', () => {
    expect(codes([...base, relation('r', 'connected_by_path', 'b1', 'b1')])).toEqual([
      ['error', 'self-relation', ['r', 'b1']],
    ]);
  });

  it('reports duplicate edges with the same type, from and to', () => {
    expect(codes([...base, relation('dup', 'located_in', 'f1', 'b1')])).toEqual([
      ['error', 'duplicate-relation', ['ok-1', 'dup']],
    ]);
  });

  it('does not treat a reversed or differently typed edge as a duplicate', () => {
    expect(
      codes([
        ...base,
        relation('p1', 'connected_by_path', 'b1', 'b2'),
        relation('p2', 'connected_by_path', 'b2', 'b1'),
        relation('n1', 'nearby', 'b1', 'b2', { distanceM: 30 }),
      ]),
    ).toEqual([]);
  });

  it('reports duplicate relation ids', () => {
    expect(codes([...base, relation('ok-1', 'connected_by_path', 'b1', 'b2')])).toEqual([
      ['error', 'duplicate-relation-id', ['ok-1']],
    ]);
  });

  it('requires located_in targets to be buildings', () => {
    expect(codes([...base, relation('r', 'located_in', 'b1', 'area')])).toEqual([
      ['error', 'located-in-target-not-building', ['r', 'area']],
    ]);
  });

  it('requires accessed_via targets to be entrances (gates count)', () => {
    expect(codes([...base, relation('r', 'accessed_via', 'b1', 'f1')])).toEqual([
      ['error', 'accessed-via-target-not-entrance', ['r', 'f1']],
    ]);
    expect(codes([...base, relation('g', 'accessed_via', 'area', 'g1')])).toEqual([]);
  });

  it('requires nearby relations to carry a distance', () => {
    expect(codes([...base, relation('r', 'nearby', 'f1', 'b2')])).toEqual([
      ['error', 'nearby-without-distance', ['r']],
    ]);
    expect(codes([...base, relation('r', 'nearby', 'f1', 'b2', { distanceM: 0 })])).toEqual([]);
  });

  it('warns about entrances no relation gives access to', () => {
    const issues = validateRelations(places, [relation('ok-1', 'located_in', 'f1', 'b1')]);
    expect(issues).toEqual([
      expect.objectContaining({ level: 'warning', code: 'entrance-without-access', ids: ['e1'] }),
    ]);
    expect(issues[0]?.message).toContain('e1');
  });

  it('reports every problem in a mixed set', () => {
    const issues = validateRelations(places, [
      ...base,
      relation('s', 'part_of', 'f1', 'f1'),
      relation('n', 'nearby', 'f1', 'b2'),
      relation('l', 'located_in', 'f1', 'e1'),
    ]);
    expect(issues.map((i) => i.code).sort()).toEqual([
      'located-in-target-not-building',
      'nearby-without-distance',
      'self-relation',
    ]);
  });
});
