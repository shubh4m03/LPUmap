import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';
import { createWorkspace, findPath } from '../../../src/routing/astar.ts';
import { buildGraph } from '../../../src/routing/graph.ts';
import { SearchHeap } from '../../../src/routing/priority-queue.ts';
import { buildProfileTables, costTable, heuristicScale, PROFILE_IDS } from '../../../src/routing/profiles.ts';
import { createRouter } from '../../../src/routing/index.ts';
import type { RoutePreference } from '../../../src/routing/index.ts';
import { gridGraph, makeGraph, mulberry32, type EdgeSpec, pt } from './helpers.ts';

describe('SearchHeap', () => {
  it('pops labels in (f, g, node) order', () => {
    const rand = mulberry32(7);
    const heap = new SearchHeap(2);
    const labels: Array<[number, number, number]> = [];
    for (let i = 0; i < 500; i++) {
      const label: [number, number, number] = [Math.floor(rand() * 20), Math.floor(rand() * 5), i % 37];
      labels.push(label);
      heap.push(label[2], label[0], label[1]);
    }
    labels.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const popped: number[] = [];
    while (heap.size > 0) popped.push(heap.pop());
    expect(popped).toEqual(labels.map((l) => l[2]));
    expect(heap.pop()).toBe(-1);
  });
});

function randomGraph(seed: number, nodeCount: number) {
  const rand = mulberry32(seed);
  const xy: Array<[number, number]> = [];
  for (let i = 0; i < nodeCount; i++) xy.push([rand() * 1200, rand() * 1200]);
  const specs: EdgeSpec[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const near = xy
      .map((p, j) => ({ j, d: Math.hypot(p[0] - xy[i]![0], p[1] - xy[i]![1]) }))
      .filter((c) => c.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    for (const { j } of near) {
      if (rand() < 0.15) continue; // leave some gaps so a few queries are disconnected
      specs.push([
        i,
        j,
        {
          steps: rand() < 0.1,
          onewayFoot: rand() < 0.1,
          onewayBicycle: rand() < 0.2,
          bicycle: rand() < 0.15 ? 'no' : rand() < 0.3 ? 'push' : 'ride',
          wheelchair: rand() < 0.1 ? 'no' : 'unknown',
          foot: rand() > 0.05,
        },
      ]);
    }
  }
  return makeGraph(xy, specs);
}

describe('A* matches Dijkstra (seeded property test)', () => {
  const preferences: RoutePreference[] = ['shortest', 'fastest'];
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`agrees on random graph seed ${seed}`, () => {
      const graph = buildGraph(randomGraph(seed, 80));
      const rand = mulberry32(seed * 101);
      const ws = createWorkspace(graph.nodeCount);
      let found = 0;
      let missing = 0;
      for (const profile of PROFILE_IDS) {
        const tables = buildProfileTables(graph, profile);
        for (const preference of preferences) {
          const cost = costTable(tables, preference);
          for (let q = 0; q < 25; q++) {
            const s = Math.floor(rand() * graph.nodeCount);
            const t = Math.floor(rand() * graph.nodeCount);
            const astar = findPath(graph, cost, s, t, heuristicScale(profile, preference), ws);
            const dijkstra = findPath(graph, cost, s, t, 0, ws);
            expect(astar === null).toBe(dijkstra === null);
            if (!astar || !dijkstra) {
              missing++;
              continue;
            }
            found++;
            expect(astar.cost).toBeCloseTo(dijkstra.cost, 6);
            expect(astar.arcs).toEqual(dijkstra.arcs);
            expect(astar.expanded).toBeLessThanOrEqual(dijkstra.expanded);
            // The path is contiguous from s to t.
            let at = s;
            for (const a of astar.arcs) {
              expect(graph.arcSource[a]).toBe(at);
              at = graph.arcTarget[a]!;
            }
            expect(at).toBe(t);
          }
        }
      }
      // Both outcomes must actually be exercised.
      expect(found).toBeGreaterThan(50);
      expect(missing).toBeGreaterThan(0);
    });
  }
});

describe('performance on a 120 × 120 grid', () => {
  const file = gridGraph(120, 120, 10);
  const graph = buildGraph(file);
  const tables = buildProfileTables(graph, 'walk');
  const cost = costTable(tables, 'shortest');
  const midLeft = 60 * 120;
  const midRight = 60 * 120 + 119;

  it('A* expands fewer nodes than Dijkstra on the same query and finds the same cost', () => {
    const astar = findPath(graph, cost, midLeft, midRight, heuristicScale('walk', 'shortest'));
    const dijkstra = findPath(graph, cost, midLeft, midRight, 0);
    expect(astar && dijkstra).toBeTruthy();
    expect(astar!.cost).toBeCloseTo(dijkstra!.cost, 6);
    expect(astar!.expanded).toBeLessThan(dijkstra!.expanded);
    expect(astar!.expanded).toBeLessThan(dijkstra!.expanded / 4);
  });

  it(`routes across the grid within ${APP_CONFIG.performance.routeBudgetMs} ms`, () => {
    const router = createRouter(file);
    expect(router.nodeCount).toBe(14_400);
    const queries = [
      { from: pt(0, 600), to: pt(1190, 600) },
      { from: pt(0, 0), to: pt(1190, 1190) },
    ];
    for (const profile of PROFILE_IDS) {
      for (const q of queries) {
        router.route({ ...q, profile }); // warm-up builds the lazy tables and snap index
        let best = Infinity;
        for (let i = 0; i < 5; i++) {
          const t0 = performance.now();
          const r = router.route({ ...q, profile, preference: 'fastest' });
          best = Math.min(best, performance.now() - t0);
          expect(r.ok).toBe(true);
        }
        expect(best).toBeLessThan(APP_CONFIG.performance.routeBudgetMs);
      }
    }
  });
});

describe('findPath edge cases', () => {
  const graph = buildGraph(
    makeGraph(
      [
        [0, 0],
        [10, 0],
      ],
      [[0, 1]],
    ),
  );
  const cost = costTable(buildProfileTables(graph, 'walk'), 'shortest');

  it('returns an empty path for source === target and null for invalid nodes', () => {
    expect(findPath(graph, cost, 0, 0, 1)).toEqual({ arcs: [], cost: 0, expanded: 0 });
    expect(findPath(graph, cost, 0, 5, 1)).toBeNull();
    expect(findPath(graph, cost, -1, 0, 1)).toBeNull();
  });
});
