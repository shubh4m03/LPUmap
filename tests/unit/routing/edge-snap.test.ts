/**
 * G-28: endpoints snap to the nearest point ON a usable edge, which is split
 * virtually for the search. Synthetic graphs only (metre offsets around the
 * map centre; see helpers.ts).
 */
import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';
import type { GraphEdge, GraphFile, LngLat } from '../../../src/data/schema.ts';
import { haversineM } from '../../../src/distance/geodesic.ts';
import { createWorkspace, findRoute, type SearchEnd } from '../../../src/routing/astar.ts';
import { buildGraph } from '../../../src/routing/graph.ts';
import { buildProfileTables, costTable, heuristicScale, PROFILE_IDS } from '../../../src/routing/profiles.ts';
import { buildSnapIndex } from '../../../src/routing/snap.ts';
import {
  createRouter,
  type RoutePreference,
  type RouteProfileId,
  type RouteRequest,
} from '../../../src/routing/index.ts';
import {
  at,
  caveatCodes,
  expectFailure,
  expectOk,
  makeGraph,
  mulberry32,
  polylineLength,
  projection,
  pt,
  type EdgeSpec,
} from './helpers.ts';

const R = APP_CONFIG.routing;
const near = (a: LngLat, b: LngLat, m = 0.01) => haversineM(a, b) < m;

/** One 400 m footway east from the origin, plus a short spur north from its far end. */
const longEdge = makeGraph(
  [
    [0, 0], // 0
    [400, 0], // 1
    [400, 60], // 2
  ],
  [
    [0, 1, { name: 'Long Test Walk' }],
    [1, 2],
  ],
);

describe('snapping onto the middle of an edge', () => {
  const router = createRouter(longEdge);

  it('routes from a point beside the middle of a long edge (both end nodes are out of snap range)', () => {
    // The nearest node is 200 m away; node-only snapping called this unsnappable.
    const r = expectOk(router.route({ from: pt(200, 30), to: pt(400, 60), profile: 'walk' }));
    expect(r.edgeIds).toEqual([0, 1]);
    expect(near(r.coordinates[1]!, at(200, 0))).toBe(true);
    expect(r.snap.fromM).toBeCloseTo(30, 1);
    expect(r.distanceM).toBeCloseTo(30 + 200 + 60, 0);
    expect(r.distanceM).toBeCloseTo(polylineLength(r.coordinates), 9);
    expect(r.durationS).toBeCloseTo(r.distanceM / R.walkSpeedMps, 6);
  });

  it('prefers the nearer edge point to a reachable end node, so the route does not overshoot', () => {
    const r = expectOk(router.route({ from: pt(0, 0), to: pt(350, 20), profile: 'walk' }));
    expect(r.edgeIds).toEqual([0]);
    expect(near(r.coordinates[r.coordinates.length - 2]!, at(350, 0))).toBe(true);
    expect(r.snap.toM).toBeCloseTo(20, 1);
    expect(r.distanceM).toBeCloseTo(350 + 20, 0);
    expect(caveatCodes(r)).toContain('end-connector');
  });

  it('travels directly between two points on the same edge, in either direction', () => {
    const east = expectOk(router.route({ from: pt(100, 10), to: pt(300, -10), profile: 'walk' }));
    expect(east.edgeIds).toEqual([0]);
    expect(east.coordinates).toHaveLength(4);
    expect(east.distanceM).toBeCloseTo(220, 0);
    const west = expectOk(router.route({ from: pt(300, -10), to: pt(100, 10), profile: 'walk' }));
    expect(west.edgeIds).toEqual([0]);
    expect(west.distanceM).toBeCloseTo(220, 0);
    // Steps and durations still add up to the totals with partial edges.
    const sumD = east.steps.reduce((s, x) => s + x.distanceM, 0);
    const sumT = east.steps.reduce((s, x) => s + x.durationS, 0);
    expect(sumD).toBeCloseTo(east.distanceM, 6);
    expect(sumT).toBeCloseTo(east.durationS, 6);
    expect(east.steps.some((s) => s.name === 'Long Test Walk')).toBe(true);
  });

  it('exposes the snapped edge point through router.snap', () => {
    const hit = router.snap(at(120, -25), 'walk');
    expect(hit).not.toBeNull();
    expect(hit!.edgeId).toBe(0);
    expect(hit!.nodeId).toBeNull();
    expect(near(hit!.location, at(120, 0))).toBe(true);
    expect(hit!.distanceM).toBeCloseTo(25, 1);
    expect(router.snap(at(200, R.maxSnapDistanceM + 1), 'walk')).toBeNull();
  });

  it('treats a projection within 0.5 m of an edge end as that node', () => {
    const hit = router.snap(at(399.7, -10), 'walk');
    expect(hit?.nodeId).toBe(1);
    expect(hit?.edgeId).toBeNull();
  });
});

describe('profile permissions on a split edge', () => {
  // A square: 0 (0,0) → 1 (400,0) one-way for walkers, then 1–2–3–0 two-way.
  const square = makeGraph(
    [
      [0, 0],
      [400, 0],
      [400, 100],
      [0, 100],
    ],
    [
      [0, 1, { onewayFoot: true, onewayBicycle: true }],
      [1, 2],
      [2, 3],
      [3, 0],
    ],
  );
  const router = createRouter(square);

  it('leaves a one-way edge only forwards: going back to its start means the long way round', () => {
    const r = expectOk(router.route({ from: pt(100, -5), to: pt(0, -5), profile: 'walk' }));
    expect(r.edgeIds).toEqual([0, 1, 2, 3]);
    expect(r.distanceM).toBeCloseTo(5 + 300 + 100 + 400 + 100 + 5, 0);
  });

  it('reaches a point on a one-way edge only from its start side', () => {
    const r = expectOk(router.route({ from: pt(400, 50), to: pt(300, -5), profile: 'walk' }));
    // Not straight back along the one-way edge (100 m): round via 2, 3 and 0.
    expect(r.edgeIds).toEqual([1, 2, 3, 0]);
    expect(r.distanceM).toBeCloseTo(50 + 400 + 100 + 300 + 5, 0);
  });

  it('allows the direct piece forwards but not backwards on the same one-way edge', () => {
    const fwd = expectOk(router.route({ from: pt(100, 5), to: pt(300, 5), profile: 'walk' }));
    expect(fwd.edgeIds).toEqual([0]);
    const back = expectOk(router.route({ from: pt(300, 5), to: pt(100, 5), profile: 'walk' }));
    expect(back.edgeIds).toEqual([0, 1, 2, 3, 0]);
  });

  it('never snaps onto an edge the profile cannot use', () => {
    const graph = makeGraph(
      [
        [0, 0],
        [400, 0],
        [0, 50],
        [400, 50],
      ],
      [
        [0, 1, { foot: false, bicycle: 'ride', highway: 'cycleway' }],
        [2, 3],
      ],
    );
    const r = createRouter(graph);
    // 10 m from the cycleway but 40 m from the footway.
    expect(r.snap(at(200, 10), 'walk')?.edgeId).toBe(1);
    expect(r.snap(at(200, 10), 'cycle')?.edgeId).toBe(0);
    const steps = makeGraph(
      [
        [0, 0],
        [400, 0],
      ],
      [[0, 1, { steps: true, highway: 'steps', wheelchair: 'no' }]],
    );
    expect(createRouter(steps).snap(at(200, 10), 'step-free')).toBeNull();
    expect(createRouter(steps).snap(at(200, 10), 'walk')?.edgeId).toBe(0);
  });

  it('charges partial steps edges their penalty share only', () => {
    const steps = makeGraph(
      [
        [0, 0],
        [200, 0],
      ],
      [[0, 1, { steps: true, highway: 'steps', wheelchair: 'no' }]],
    );
    const r = expectOk(createRouter(steps).route({ from: pt(50, 0), to: pt(150, 0), profile: 'walk' }));
    expect(r.distanceM).toBeCloseTo(100, 1);
    expect(r.durationS).toBeCloseTo(100 / R.walkSpeedMps + 100 * R.stepsPenaltySecPerM, 3);
    expect(caveatCodes(r)).toContain('contains-steps');
  });
});

describe('place endpoints and their access node', () => {
  const router = createRouter(longEdge);
  const place = (x: number, y: number, nodeId?: number): RouteRequest['to'] => ({
    kind: 'place',
    placeId: 'cur:test',
    label: 'Test place',
    location: at(x, y),
    ...(nodeId === undefined ? {} : { nodeId }),
  });

  it('honours an access node within range even when it lies far along the edge from the place', () => {
    // The place sits beside the edge at x = 340, but its recorded access node is node 1 (x = 400).
    const r = expectOk(router.route({ from: pt(0, 0), to: place(340, 20, 1), profile: 'walk' }));
    expect(r.edgeIds).toEqual([0]);
    expect(near(r.coordinates[r.coordinates.length - 2]!, at(400, 0))).toBe(true);
    expect(r.snap.toM).toBeCloseTo(haversineM(at(400, 0), at(340, 20)), 6);
    // The same location as a plain point snaps beside it instead.
    const point = expectOk(router.route({ from: pt(0, 0), to: pt(340, 20), profile: 'walk' }));
    expect(point.distanceM).toBeLessThan(r.distanceM);
    expect(point.snap.toM).toBeCloseTo(20, 1);
  });

  it('snaps onto the edge when the access node is beyond the snap radius', () => {
    // Node 1 is 200 m away: node-only snapping failed this request as destination-unsnappable.
    const r = expectOk(router.route({ from: pt(0, 0), to: place(200, 20, 1), profile: 'walk' }));
    expect(r.edgeIds).toEqual([0]);
    expect(r.snap.toM).toBeCloseTo(20, 1);
    expect(r.distanceM).toBeCloseTo(220, 0);
  });

  it('snaps onto the edge when the place has no access node', () => {
    const r = expectOk(router.route({ from: place(200, -20), to: pt(400, 60), profile: 'walk' }));
    expect(r.snap.fromM).toBeCloseTo(20, 1);
    expect(r.edgeIds).toEqual([0, 1]);
  });
});

describe('determinism', () => {
  it('breaks an exact distance tie between two edges by the smaller edge id, whatever the input order', () => {
    // Two parallel edges with identical geometry (ids 0 and 1): every query is an exact tie.
    const graph = makeGraph(
      [
        [0, 0],
        [400, 0],
      ],
      [
        [0, 1, { name: 'First' }],
        [0, 1, { name: 'Second' }],
      ],
    );
    const forward = createRouter(graph);
    const reversed = createRouter({ ...graph, edges: [...graph.edges].reverse() });
    for (const x of [50, 200, 350]) {
      expect(forward.snap(at(x, 15), 'walk')?.edgeId).toBe(0);
      expect(reversed.snap(at(x, 15), 'walk')?.edgeId).toBe(0);
    }
    const graphObj = buildGraph(graph);
    const index = buildSnapIndex(
      graphObj,
      buildProfileTables(graphObj, 'walk').edgeUsable,
      R.maxSnapDistanceM,
    );
    const hit = index.nearest(projection.toLngLat([200, -15]));
    expect(hit?.kind === 'edge' ? graphObj.edges[hit.edge]!.id : null).toBe(0);
  });

  it('returns identical routes on repeated and reordered calls', () => {
    const reordered = createRouter({ ...longEdge, edges: [...longEdge.edges].reverse() });
    const base = createRouter(longEdge);
    for (let i = 0; i < 3; i++) {
      const a = expectOk(base.route({ from: pt(150, 15), to: pt(380, 40), profile: 'walk' }));
      const b = expectOk(reordered.route({ from: pt(150, 15), to: pt(380, 40), profile: 'walk' }));
      expect(b.coordinates).toEqual(a.coordinates);
      expect(b.edgeIds).toEqual(a.edgeIds);
    }
  });

  it('keeps alternatives truthful with mid-edge endpoints', () => {
    const ladder = makeGraph(
      [
        [0, 0],
        [300, 0],
        [0, 100],
        [300, 100],
        [0, -150],
        [300, -150],
      ],
      [
        [0, 1],
        [0, 2],
        [2, 3],
        [3, 1],
        [0, 4],
        [4, 5],
        [5, 1],
      ],
    );
    const router = createRouter(ladder);
    const req: RouteRequest = { from: pt(-10, 50), to: pt(310, 40), profile: 'walk' };
    const all = router.alternatives(req).map(expectOk);
    expect(all.length).toBeGreaterThan(1);
    expect(all[0]!.coordinates).toEqual(expectOk(router.route(req)).coordinates);
    for (const r of all) expect(r.distanceM).toBeCloseTo(polylineLength(r.coordinates), 9);
    for (let i = 1; i < all.length; i++)
      expect(all[i]!.durationS).toBeGreaterThanOrEqual(all[i - 1]!.durationS);
  });
});

/**
 * Brute-force reference: insert real nodes at the snapped points and split
 * their edges, then route node to node. The virtual split must give the same
 * distance and duration.
 */
function splitAt(file: GraphFile, cuts: Array<{ edgeId: number; point: LngLat }>): GraphFile {
  const nodes = [...file.nodes];
  let nextId = Math.max(...file.edges.map((e) => e.id)) + 1;
  const edges: GraphEdge[] = [];
  for (const e of file.edges) {
    const here = cuts
      .filter((c) => c.edgeId === e.id)
      .map((c) => ({ ...c, d: haversineM(file.nodes[e.from]!, c.point) }))
      .sort((a, b) => a.d - b.d);
    if (here.length === 0) {
      edges.push(e);
      continue;
    }
    let prev = e.from;
    for (const c of here) {
      nodes.push(c.point);
      const id = nodes.length - 1;
      edges.push({ ...e, id: nextId++, from: prev, to: id });
      prev = id;
    }
    edges.push({ ...e, id: nextId++, from: prev, to: e.to });
  }
  return { ...file, nodes, edges };
}

function randomNetwork(seed: number): GraphFile {
  const rand = mulberry32(seed);
  const xy: Array<[number, number]> = [];
  for (let i = 0; i < 40; i++) xy.push([rand() * 800, rand() * 800]);
  const specs: EdgeSpec[] = [];
  for (let i = 0; i < xy.length; i++) {
    const nearest = xy
      .map((p, j) => ({ j, d: Math.hypot(p[0] - xy[i]![0], p[1] - xy[i]![1]) }))
      .filter((c) => c.j > i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const { j } of nearest) {
      const r = rand();
      specs.push([
        i,
        j,
        {
          onewayFoot: r < 0.1,
          onewayBicycle: r < 0.2,
          steps: r > 0.9,
          highway: r > 0.9 ? 'steps' : 'footway',
          bicycle: r < 0.5 ? 'ride' : r < 0.8 ? 'push' : 'no',
          foot: r > 0.05,
          wheelchair: r > 0.9 ? 'no' : 'unknown',
        },
      ]);
    }
  }
  return makeGraph(xy, specs);
}

describe('virtual split matches an explicitly split graph', () => {
  it('gives the same distance, duration and outcome on random networks, profiles and preferences', () => {
    let compared = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const file = randomNetwork(seed);
      const router = createRouter(file);
      const rand = mulberry32(1000 + seed);
      for (let q = 0; q < 12; q++) {
        const profile = PROFILE_IDS[Math.floor(rand() * PROFILE_IDS.length)] as RouteProfileId;
        const preference: RoutePreference = rand() < 0.5 ? 'shortest' : 'fastest';
        const from = pt(rand() * 800, rand() * 800);
        const to = pt(rand() * 800, rand() * 800);
        const a = router.route({ from, to, profile, preference });
        const sf = router.snap(from.location, profile);
        const st = router.snap(to.location, profile);
        if (!sf || !st) {
          expect(a.ok).toBe(false);
          continue;
        }
        const cuts = [sf, st]
          .filter((s) => s.edgeId !== null)
          .map((s) => ({ edgeId: s.edgeId!, point: s.location }));
        const b = createRouter(splitAt(file, cuts)).route({ from, to, profile, preference });
        expect(a.ok).toBe(b.ok);
        if (a.ok && b.ok) {
          expect(a.distanceM).toBeCloseTo(b.distanceM, 6);
          expect(a.durationS).toBeCloseTo(b.durationS, 6);
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(40);
  });

  it('A* with mid-edge endpoints finds the Dijkstra optimum (the heuristic stays admissible)', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const file = randomNetwork(seed);
      const graph = buildGraph(file);
      const rand = mulberry32(5000 + seed);
      for (const profile of PROFILE_IDS) {
        const tables = buildProfileTables(graph, profile);
        const index = buildSnapIndex(graph, tables.edgeUsable, R.maxSnapDistanceM);
        const ws = createWorkspace(graph.nodeCount);
        for (const preference of ['shortest', 'fastest'] as const) {
          const cost = costTable(tables, preference);
          for (let q = 0; q < 6; q++) {
            const hf = index.nearest(at(rand() * 800, rand() * 800));
            const ht = index.nearest(at(rand() * 800, rand() * 800));
            if (!hf || !ht) continue;
            const end = (h: NonNullable<typeof hf>): SearchEnd =>
              h.kind === 'node'
                ? { kind: 'node', node: h.nodeId }
                : { kind: 'edge', edge: h.edge, point: h.point, fromM: h.fromM, toM: h.toM };
            const astar = findRoute(graph, cost, end(hf), end(ht), heuristicScale(profile, preference), ws);
            const dijkstra = findRoute(graph, cost, end(hf), end(ht), 0, ws);
            expect(astar === null).toBe(dijkstra === null);
            if (astar && dijkstra) expect(astar.cost).toBeCloseTo(dijkstra.cost, 9);
          }
        }
      }
    }
  });

  describe('node-only fallback when the nearest edge is cut off', () => {
    // An isolated 400 m footway along y = 60, and a separate connected spur
    // (190,0)–(190,-300)–(400,-300). From (200, 40) the nearest edge point is on
    // the isolated footway (20 m); the nearest usable node is the spur's end
    // (190, 0), about 41 m away.
    const graph = makeGraph(
      [
        [0, 60], // 0
        [400, 60], // 1
        [190, 0], // 2
        [190, -300], // 3
        [400, -300], // 4
      ],
      [
        [0, 1, { name: 'Isolated Walk' }],
        [2, 3],
        [3, 4],
      ],
    );
    const router = createRouter(graph);

    it('snaps to the isolated edge, which on its own has no path', () => {
      expect(router.snap(at(200, 40), 'walk')?.edgeId).toBe(0);
    });

    it('routes from the nearest usable node when the snapped origin edge is disconnected', () => {
      const r = expectOk(router.route({ from: pt(200, 40), to: pt(400, -300), profile: 'walk' }));
      expect(r.edgeIds).toEqual([1, 2]);
      expect(near(r.coordinates[1]!, at(190, 0))).toBe(true);
      expect(r.snap.fromM).toBeCloseTo(haversineM(at(200, 40), at(190, 0)), 6);
    });

    it('routes to the nearest usable node when the snapped destination edge is disconnected', () => {
      const r = expectOk(router.route({ from: pt(400, -300), to: pt(200, 40), profile: 'walk' }));
      expect(r.edgeIds).toEqual([2, 1]);
      expect(near(r.coordinates[r.coordinates.length - 2]!, at(190, 0))).toBe(true);
    });

    it('applies the same fallback to alternatives', () => {
      const all = router.alternatives({ from: pt(200, 40), to: pt(400, -300), profile: 'walk' });
      expect(all).toHaveLength(1);
      expect(expectOk(all[0]).edgeIds).toEqual([1, 2]);
    });
  });

  it('fails truthfully when the snapped edges lie on separate components', () => {
    const graph = makeGraph(
      [
        [0, 0],
        [400, 0],
        [0, 300],
        [400, 300],
      ],
      [
        [0, 1],
        [2, 3],
      ],
    );
    expectFailure(
      createRouter(graph).route({ from: pt(200, 10), to: pt(200, 290), profile: 'walk' }),
      'no-path',
    );
  });
});
