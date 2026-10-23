import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';
import type { GraphFile, LngLat } from '../../../src/data/schema.ts';
import { haversineM } from '../../../src/distance/geodesic.ts';
import { createRouter, ROUTE_PROFILES, type RouteRequest } from '../../../src/routing/index.ts';
import {
  at,
  caveatCodes,
  expectFailure,
  expectOk,
  loadFixture,
  makeGraph,
  polylineLength,
  pt,
} from './helpers.ts';

const R = APP_CONFIG.routing;

describe('createRouter basics', () => {
  it('exposes node and edge counts and the three profiles', () => {
    const router = createRouter(loadFixture('synthetic-campus.json'));
    expect(router.nodeCount).toBe(10);
    expect(router.edgeCount).toBe(12);
    expect(Object.keys(ROUTE_PROFILES).sort()).toEqual(['cycle', 'step-free', 'walk']);
    expect(ROUTE_PROFILES.walk.speedMps).toBe(R.walkSpeedMps);
    expect(ROUTE_PROFILES.cycle.speedMps).toBe(R.cycleSpeedMps);
    expect(ROUTE_PROFILES['step-free'].speedMps).toBe(R.walkSpeedMps);
  });

  it('ignores edges with out-of-range, non-integer or self-loop nodes instead of crashing', () => {
    const base = makeGraph(
      [
        [0, 0],
        [100, 0],
      ],
      [[0, 1]],
    );
    const bad = { ...base.edges[0]! };
    const graph: GraphFile = {
      ...base,
      edges: [
        ...base.edges,
        { ...bad, id: 10, to: 7 },
        { ...bad, id: 11, from: -1 },
        { ...bad, id: 12, to: 0.5 },
        { ...bad, id: 13, from: 1, to: 1 },
      ],
    };
    const router = createRouter(graph);
    expect(router.edgeCount).toBe(1);
    const r = expectOk(router.route({ from: pt(0, 0), to: pt(100, 0), profile: 'walk' }));
    expect(r.edgeIds).toEqual([0]);
  });

  it('ignores edges touching nodes with invalid coordinates', () => {
    const base = makeGraph(
      [
        [0, 0],
        [100, 0],
        [200, 0],
      ],
      [
        [0, 1],
        [1, 2],
      ],
    );
    const graph = { ...base, nodes: [base.nodes[0]!, base.nodes[1]!, [Number.NaN, 91] as LngLat] };
    const router = createRouter(graph);
    expect(router.edgeCount).toBe(1);
  });

  it('handles an empty graph with truthful unsnappable failures', () => {
    const router = createRouter({ schemaVersion: 1, nodes: [], edges: [] });
    expect(router.snap(at(0, 0), 'walk')).toBeNull();
    expectFailure(router.route({ from: pt(0, 0), to: pt(100, 0), profile: 'walk' }), 'origin-unsnappable');
  });
});

describe('known shortest paths', () => {
  const router = createRouter(loadFixture('synthetic-campus.json'));

  it('walks along the avenue between its ends', () => {
    const r = expectOk(router.route({ from: pt(0, 0), to: pt(300, 0), profile: 'walk' }));
    expect(r.edgeIds).toEqual([0, 1, 2]);
    expect(r.distanceM).toBeCloseTo(300, 0);
    expect(r.profile).toBe('walk');
    expect(r.preference).toBe('shortest');
  });

  it('takes the steps shortcut when walking the shortest way', () => {
    const r = expectOk(router.route({ from: pt(0, 0), to: pt(150, -120), profile: 'walk' }));
    expect(r.edgeIds).toEqual([0, 6, 7]);
    expect(caveatCodes(r)).toContain('contains-steps');
  });

  it('excludes foot=false edges for walking (the cycleway is shorter but not walkable)', () => {
    const walk = expectOk(router.route({ from: pt(0, 0), to: pt(150, -120), profile: 'walk' }));
    expect(walk.edgeIds).not.toContain(11);
    const cycle = expectOk(router.route({ from: pt(0, 0), to: pt(150, -120), profile: 'cycle' }));
    expect(cycle.edgeIds).toEqual([11]);
  });

  it('returns no-path on disconnected components and does not keep stale state', () => {
    const r2 = createRouter(loadFixture('synthetic-disconnected.json'));
    expectFailure(r2.route({ from: pt(0, 0), to: pt(0, 300), profile: 'walk' }), 'no-path');
    const ok = expectOk(r2.route({ from: pt(0, 300), to: pt(100, 300), profile: 'walk' }));
    expect(ok.edgeIds).toEqual([1]);
    expectFailure(r2.route({ from: pt(0, 0), to: pt(0, 300), profile: 'walk' }), 'no-path');
    expect(expectOk(r2.route({ from: pt(0, 0), to: pt(100, 0), profile: 'walk' })).edgeIds).toEqual([0]);
  });

  it('does not merge distinct nodes that share a coordinate', () => {
    const r2 = createRouter(loadFixture('synthetic-disconnected.json'));
    expectFailure(r2.route({ from: pt(0, 0), to: pt(200, 0), profile: 'walk' }), 'no-path');
    // The tie between nodes 1 and 4 (same coordinate) resolves to the lower id.
    expect(r2.snap(at(100, 0), 'walk')?.nodeId).toBe(1);
  });
});

describe('deterministic equal-cost choice', () => {
  const diamond = loadFixture('synthetic-diamond.json');

  it('prefers the predecessor with the smaller node id', () => {
    const router = createRouter(diamond);
    expect(expectOk(router.route({ from: pt(0, 0), to: pt(0, 100), profile: 'walk' })).edgeIds).toEqual([
      0, 2,
    ]);
    expect(expectOk(router.route({ from: pt(0, 100), to: pt(0, 0), profile: 'walk' })).edgeIds).toEqual([
      2, 0,
    ]);
  });

  it('is independent of input edge order and repeatable', () => {
    const reversed = createRouter({ ...diamond, edges: [...diamond.edges].reverse() });
    for (let i = 0; i < 3; i++) {
      const r = expectOk(reversed.route({ from: pt(0, 0), to: pt(0, 100), profile: 'walk' }));
      expect(r.edgeIds).toEqual([0, 2]);
    }
  });
});

describe('input validation and endpoint edge cases', () => {
  const router = createRouter(loadFixture('synthetic-campus.json'));
  const valid: RouteRequest = { from: pt(0, 0), to: pt(300, 0), profile: 'walk' };

  it.each([
    ['NaN longitude', { ...valid, from: { kind: 'point', label: 'x', location: [Number.NaN, 31] } }],
    ['latitude out of range', { ...valid, to: { kind: 'point', label: 'x', location: [75.7, 95] } }],
    ['missing endpoint', { ...valid, from: undefined }],
    ['unknown endpoint kind', { ...valid, from: { kind: 'gps', label: 'x', location: at(0, 0) } }],
    ['unknown profile', { ...valid, profile: 'car' }],
    ['unknown preference', { ...valid, preference: 'scenic' }],
  ])('rejects %s as invalid-input', (_label, req) => {
    expectFailure(router.route(req as unknown as RouteRequest), 'invalid-input');
  });

  it('rejects a null request', () => {
    expectFailure(router.route(null as unknown as RouteRequest), 'invalid-input');
  });

  it('treats identical and near-identical endpoints as the same point', () => {
    expectFailure(router.route({ ...valid, to: pt(0, 0) }), 'same-point');
    expectFailure(router.route({ ...valid, from: pt(10, 10), to: pt(11.5, 11.5) }), 'same-point');
  });

  it('routes very close points that snap to the same node as two connector legs', () => {
    const r = expectOk(router.route({ from: pt(2, 3), to: pt(-3, -2), profile: 'walk' }));
    expect(r.edgeIds).toEqual([]);
    expect(r.coordinates).toHaveLength(3);
    expect(r.coordinates[1]).toEqual(at(0, 0));
    expect(r.distanceM).toBeCloseTo(polylineLength(r.coordinates), 9);
    expect(r.steps.map((s) => s.kind)).toEqual(['connector', 'connector']);
  });

  it('reports points far outside the network as unsnappable', () => {
    const far = R.maxSnapDistanceM + 20;
    expectFailure(router.route({ ...valid, from: pt(-far, 0) }), 'origin-unsnappable');
    expectFailure(router.route({ ...valid, to: pt(300 + far, 0) }), 'destination-unsnappable');
    const delhi: LngLat = [77.209, 28.6139];
    expectFailure(
      router.route({ ...valid, to: { kind: 'point', label: 'Delhi', location: delhi } }),
      'destination-unsnappable',
    );
  });

  it('uses a place endpoint node when the profile can use it', () => {
    // Node 2 is farther from the location than node 1, but the place says node 2.
    const r = expectOk(
      router.route({
        from: pt(0, 0),
        to: { kind: 'place', placeId: 'cur:test', label: 'Test place', location: at(130, 10), nodeId: 2 },
        profile: 'walk',
      }),
    );
    expect(r.edgeIds).toEqual([0, 1]);
    expect(r.snap.toM).toBeCloseTo(haversineM(at(200, 0), at(130, 10)), 6);
  });

  it('falls back to snapping when the place node id is out of range', () => {
    const r = expectOk(
      router.route({
        from: pt(0, 0),
        to: { kind: 'place', placeId: 'cur:test', label: 'Test place', location: at(110, 5), nodeId: 999 },
        profile: 'walk',
      }),
    );
    expect(r.edgeIds).toEqual([0]);
  });
});

describe('snap', () => {
  const graph = makeGraph(
    [
      [0, 0],
      [100, 0],
      [100, 40],
      [140, 40],
    ],
    [
      [0, 1],
      [2, 3, { foot: false, bicycle: 'ride' }],
    ],
  );
  const router = createRouter(graph);

  it('finds the nearest node within the snap radius', () => {
    const hit = router.snap(at(40, 30), 'walk');
    expect(hit?.nodeId).toBe(0);
    expect(hit?.distanceM).toBeCloseTo(50, 1);
  });

  it('only snaps to nodes usable by the profile', () => {
    expect(router.snap(at(100, 38), 'walk')?.nodeId).toBe(1);
    expect(router.snap(at(100, 38), 'cycle')?.nodeId).toBe(2);
  });

  it('ignores a place node the profile cannot use and snaps from the location instead', () => {
    // Node 2 only touches a foot=false edge, so walking must snap elsewhere (node 1).
    const r = expectOk(
      router.route({
        from: pt(0, 0),
        to: { kind: 'place', placeId: 'cur:test', label: 'Test place', location: at(100, 35), nodeId: 2 },
        profile: 'walk',
      }),
    );
    expect(r.edgeIds).toEqual([0]);
    expect(r.snap.toM).toBeCloseTo(35, 1);
  });

  it('returns null beyond maxSnapDistanceM and for invalid input', () => {
    expect(router.snap(at(-(R.maxSnapDistanceM + 1), 0), 'walk')).toBeNull();
    expect(router.snap(at(-(R.maxSnapDistanceM - 1), 0), 'walk')?.nodeId).toBe(0);
    expect(router.snap([Number.NaN, 0], 'walk')).toBeNull();
    expect(router.snap(at(0, 0), 'car' as never)).toBeNull();
  });
});

describe('geometry, distance and duration', () => {
  const router = createRouter(loadFixture('synthetic-campus.json'));

  it('includes connector legs and reports distance equal to the polyline length', () => {
    const r = expectOk(router.route({ from: pt(-30, 5), to: pt(300, -40), profile: 'walk' }));
    expect(r.coordinates[0]).toEqual(at(-30, 5));
    expect(r.coordinates[r.coordinates.length - 1]).toEqual(at(300, -40));
    expect(r.snap.fromM).toBeCloseTo(haversineM(at(-30, 5), at(0, 0)), 6);
    expect(r.snap.toM).toBeCloseTo(40, 1);
    expect(r.distanceM).toBeCloseTo(polylineLength(r.coordinates), 9);
    expect(caveatCodes(r)).toEqual(expect.arrayContaining(['start-connector', 'end-connector']));
    const end = r.caveats.find((c) => c.code === 'end-connector');
    expect(end?.message).toBe('Last 40 m is a straight-line estimate off the mapped paths.');
  });

  it('drops connector legs shorter than 0.5 m', () => {
    const r = expectOk(router.route({ from: pt(0, 0.2), to: pt(300, 0), profile: 'walk' }));
    expect(r.coordinates[0]).toEqual(at(0, 0));
    expect(r.coordinates).toHaveLength(4);
    expect(r.snap).toEqual({ fromM: 0, toM: 0 });
    expect(caveatCodes(r)).not.toContain('start-connector');
  });

  it('does not flag short connectors (≤ 15 m) as estimates', () => {
    const r = expectOk(router.route({ from: pt(0, 10), to: pt(300, 0), profile: 'walk' }));
    expect(r.snap.fromM).toBeCloseTo(10, 1);
    expect(caveatCodes(r)).not.toContain('start-connector');
  });

  it('derives walking duration from walkSpeedMps (connectors included)', () => {
    const r = expectOk(router.route({ from: pt(-30, 0), to: pt(300, 0), profile: 'walk' }));
    expect(r.durationS).toBeCloseTo(r.distanceM / R.walkSpeedMps, 6);
  });

  it('charges the steps penalty when walking', () => {
    const r = expectOk(router.route({ from: pt(0, 0), to: pt(150, -120), profile: 'walk' }));
    const stepsM = haversineM(at(100, 0), at(150, -60));
    const expected = r.distanceM / R.walkSpeedMps + stepsM * R.stepsPenaltySecPerM;
    expect(r.durationS).toBeCloseTo(expected, 6);
  });

  it('derives cycling duration from ride speed and connectors at pushing speed', () => {
    const r = expectOk(router.route({ from: pt(-20, 0), to: pt(300, 0), profile: 'cycle' }));
    expect(r.edgeIds).toEqual([0, 1, 2]);
    const expected = 20 / R.pushBikeSpeedMps + 300 / R.cycleSpeedMps;
    expect(r.durationS).toBeCloseTo(expected, 1);
    expect(r.distanceM).toBeCloseTo(polylineLength(r.coordinates), 9);
  });

  it('step durations and distances add up to the route totals', () => {
    const r = expectOk(
      router.route({ from: pt(-20, 5), to: pt(250, -250), profile: 'walk', preference: 'fastest' }),
    );
    const sumD = r.steps.reduce((s, x) => s + x.distanceM, 0);
    const sumT = r.steps.reduce((s, x) => s + x.durationS, 0);
    expect(sumD).toBeCloseTo(r.distanceM, 6);
    expect(sumT).toBeCloseTo(r.durationS, 6);
  });

  it('flags unnamed paths', () => {
    const r = expectOk(router.route({ from: pt(0, 0), to: pt(0, 80), profile: 'walk' }));
    expect(caveatCodes(r)).toContain('unnamed-paths');
    const named = expectOk(router.route({ from: pt(0, 0), to: pt(300, 0), profile: 'walk' }));
    expect(caveatCodes(named)).not.toContain('unnamed-paths');
  });
});
