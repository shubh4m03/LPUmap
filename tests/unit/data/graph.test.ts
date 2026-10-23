// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { haversineM } from '../../../src/distance/geodesic.ts';
import { wayAccess, wayDirection } from '../../../scripts/lib/access.ts';
import { buildGraph } from '../../../scripts/lib/build-graph.ts';
import { syntheticOsm } from './osm-builder.ts';

const BOUNDS = [75.685, 31.236, 75.722, 31.27] as const;

describe('wayAccess', () => {
  it.each([
    [{ highway: 'footway' }, { foot: true, bicycle: 'push' }],
    [{ highway: 'pedestrian' }, { foot: true, bicycle: 'push' }],
    [{ highway: 'steps' }, { foot: true, bicycle: 'push' }],
    [
      { highway: 'footway', bicycle: 'designated' },
      { foot: true, bicycle: 'ride' },
    ],
    [{ highway: 'residential' }, { foot: true, bicycle: 'ride' }],
    [{ highway: 'track' }, { foot: true, bicycle: 'ride' }],
    [{ highway: 'cycleway' }, { foot: true, bicycle: 'ride' }],
    [
      { highway: 'cycleway', foot: 'no' },
      { foot: false, bicycle: 'ride' },
    ],
    [
      { highway: 'residential', bicycle: 'no' },
      { foot: true, bicycle: 'no' },
    ],
    [
      { highway: 'service', bicycle: 'dismount' },
      { foot: true, bicycle: 'push' },
    ],
    [
      { highway: 'primary', foot: 'yes' },
      { foot: true, bicycle: 'no' },
    ],
    [
      { highway: 'trunk', foot: 'designated', bicycle: 'yes' },
      { foot: true, bicycle: 'ride' },
    ],
    [
      { highway: 'service', access: 'private', foot: 'yes' },
      { foot: true, bicycle: 'no' },
    ],
    [
      { highway: 'service', access: 'permissive' },
      { foot: true, bicycle: 'ride' },
    ],
  ])('%o → %o', (tags, expected) => {
    expect(wayAccess(tags)).toEqual(expected);
  });

  it.each([
    [{ highway: 'trunk' }],
    [{ highway: 'primary' }],
    [{ highway: 'motorway', bicycle: 'permissive' }],
    [{ highway: 'service', access: 'private' }],
    [{ highway: 'footway', foot: 'no' }], // dismounting impossible where walking is banned
    [{ highway: 'construction' }],
    [{ highway: 'footway', area: 'yes' }],
    [{ railway: 'rail' }],
  ])('%o is not routable', (tags) => {
    expect(wayAccess(tags)).toBeNull();
  });
});

describe('wayDirection', () => {
  it('applies vehicle oneway to bicycles unless oneway:bicycle=no', () => {
    expect(wayDirection({ oneway: 'yes' })).toMatchObject({
      reverse: false,
      onewayBicycle: true,
      onewayFoot: false,
    });
    expect(wayDirection({ oneway: 'yes', 'oneway:bicycle': 'no' }).onewayBicycle).toBe(false);
    expect(wayDirection({ oneway: '-1' })).toMatchObject({ reverse: true, onewayBicycle: true });
    expect(wayDirection({ junction: 'roundabout' }).onewayBicycle).toBe(true);
  });

  it('sets onewayFoot only from oneway:foot', () => {
    expect(wayDirection({ oneway: 'yes' }).onewayFoot).toBe(false);
    expect(wayDirection({ 'oneway:foot': 'yes' }).onewayFoot).toBe(true);
    expect(wayDirection({ oneway: '-1', 'oneway:foot': 'yes' }).conflict).toBe(true);
  });
});

// Two crossing roads sharing node 3, plus an isolated footway 20-21.
const base = {
  nodes: {
    1: [75.7, 31.25],
    2: [75.701, 31.25],
    3: [75.702, 31.25],
    4: [75.702, 31.251],
    5: [75.702, 31.249],
    20: [75.71, 31.26],
    21: [75.711, 31.26],
    99: [75.705, 31.255],
  } as Record<number, [number, number]>,
};

describe('buildGraph', () => {
  it('creates one edge per consecutive node pair with haversine lengths', () => {
    const g = buildGraph(
      syntheticOsm({
        ...base,
        ways: [[10, [1, 2, 3], { highway: 'residential', name: 'Main Rd', surface: 'asphalt' }]],
      }),
      BOUNDS,
    );
    expect(g.graph.nodes).toEqual([
      [75.7, 31.25],
      [75.701, 31.25],
      [75.702, 31.25],
    ]);
    expect(g.graph.edges).toHaveLength(2);
    const e = g.graph.edges[0]!;
    expect(e).toMatchObject({
      id: 0,
      from: 0,
      to: 1,
      highway: 'residential',
      name: 'Main Rd',
      surface: 'asphalt',
      osmWayId: 10,
      source: 'osm',
    });
    expect(e.lengthM).toBeCloseTo(haversineM([75.7, 31.25], [75.701, 31.25]), 2);
  });

  it('connects ways only through shared OSM nodes and never bridges components', () => {
    const g = buildGraph(
      syntheticOsm({
        ...base,
        ways: [
          [10, [1, 2, 3], { highway: 'residential' }],
          [11, [4, 3, 5], { highway: 'footway' }],
          [12, [20, 21], { highway: 'footway' }],
        ],
      }),
      BOUNDS,
    );
    expect(g.componentSizes).toEqual([5, 2]);
    expect(g.graph.edges).toHaveLength(5);
    // Unused node 99 is dropped; ids are dense and ordered by OSM id.
    expect(g.osmNodeIds).toEqual([1, 2, 3, 4, 5, 20, 21]);
    const isolated = g.osmNodeIds.indexOf(20);
    expect(g.componentOf[isolated]).toBe(1);
    expect(g.graph.edges.every((e) => e.source === 'osm')).toBe(true);
  });

  it('sets steps, wheelchair, push/ride and indoor flags', () => {
    const g = buildGraph(
      syntheticOsm({
        ...base,
        ways: [
          [10, [1, 2], { highway: 'steps' }],
          [11, [2, 3], { highway: 'footway', wheelchair: 'yes' }],
          [12, [3, 4], { highway: 'corridor' }],
          [13, [4, 5], { highway: 'steps', wheelchair: 'limited' }],
        ],
      }),
      BOUNDS,
    );
    const [steps, footway, corridor, ramp] = g.graph.edges;
    expect(steps).toMatchObject({ steps: true, wheelchair: 'no', bicycle: 'push', foot: true });
    expect(footway).toMatchObject({ steps: false, wheelchair: 'yes', bicycle: 'push' });
    expect(corridor).toMatchObject({ indoor: true, wheelchair: 'unknown' });
    expect(ramp).toMatchObject({ steps: true, wheelchair: 'limited' });
  });

  it('orients oneway=-1 edges against the way and keeps onewayFoot separate', () => {
    const g = buildGraph(
      syntheticOsm({
        ...base,
        ways: [
          [10, [1, 2], { highway: 'residential', oneway: '-1' }],
          [11, [2, 3], { highway: 'footway', 'oneway:foot': 'yes' }],
        ],
      }),
      BOUNDS,
    );
    const ids = g.osmNodeIds;
    const [rev, foot] = g.graph.edges;
    expect([ids[rev!.from], ids[rev!.to]]).toEqual([2, 1]);
    expect(rev).toMatchObject({ onewayBicycle: true, onewayFoot: false });
    expect([ids[foot!.from], ids[foot!.to]]).toEqual([2, 3]);
    expect(foot).toMatchObject({ onewayBicycle: false, onewayFoot: true });
  });

  it('excludes trunk roads and private ways, drops duplicate overlapping segments', () => {
    const g = buildGraph(
      syntheticOsm({
        ...base,
        ways: [
          [10, [1, 2], { highway: 'trunk' }],
          [11, [2, 3], { highway: 'service', access: 'private' }],
          [12, [3, 4], { highway: 'footway' }],
          [13, [4, 3], { highway: 'path' }],
        ],
      }),
      BOUNDS,
    );
    expect(g.graph.edges).toHaveLength(1);
    expect(g.graph.edges[0]!.osmWayId).toBe(12);
    expect(g.stats.duplicateEdgesDropped).toBe(1);
  });

  it('merges distinct nodes at the same position instead of emitting zero-length edges', () => {
    const g = buildGraph(
      syntheticOsm({
        nodes: { 1: [75.7, 31.25], 2: [75.7, 31.25], 3: [75.701, 31.25] },
        ways: [[10, [1, 2, 3], { highway: 'footway' }]],
      }),
      BOUNDS,
    );
    expect(g.stats.zeroLengthSegmentsMerged).toBe(1);
    expect(g.graph.nodes).toHaveLength(2);
    expect(g.graph.edges).toEqual([expect.objectContaining({ from: 0, to: 1 })]);
    expect(g.graph.edges[0]!.lengthM).toBeGreaterThan(0);
  });

  it('drops segments outside the map bounds and with missing nodes', () => {
    const g = buildGraph(
      syntheticOsm({
        nodes: { 1: [75.7, 31.25], 2: [75.701, 31.25], 3: [76.5, 31.25] },
        ways: [[10, [1, 2, 3, 404], { highway: 'footway' }]],
      }),
      BOUNDS,
    );
    expect(g.graph.edges).toHaveLength(1);
    expect(g.stats.segmentsOutsideBounds).toBe(1);
    expect(g.stats.segmentsWithMissingNodes).toBe(1);
  });

  it('is deterministic regardless of input insertion order', () => {
    const ways: Array<[number, number[], Record<string, string>]> = [
      [11, [4, 3, 5], { highway: 'footway' }],
      [10, [1, 2, 3], { highway: 'residential' }],
      [12, [20, 21], { highway: 'footway' }],
    ];
    const a = buildGraph(syntheticOsm({ ...base, ways }), BOUNDS);
    const reversedNodes = Object.fromEntries(Object.entries(base.nodes).reverse());
    const b = buildGraph(syntheticOsm({ nodes: reversedNodes, ways: [...ways].reverse() }), BOUNDS);
    expect(JSON.stringify(b.graph)).toBe(JSON.stringify(a.graph));
  });
});
