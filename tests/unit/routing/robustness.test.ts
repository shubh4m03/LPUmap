import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';
import type { GraphFile, LngLat } from '../../../src/data/schema.ts';
import { haversineM } from '../../../src/distance/geodesic.ts';
import { createRouter } from '../../../src/routing/index.ts';
import { at, caveatCodes, expectOk, gridGraph, makeGraph, polylineLength, pt } from './helpers.ts';

const R = APP_CONFIG.routing;

describe('snap robustness', () => {
  it('finds every node within maxSnapDistanceM even when an outlier node anchors the grid', () => {
    // Node 0 is a bogus far-away coordinate that is still usable; it becomes the grid's
    // projection origin, so east–west projected metres no longer match real ones at campus.
    const misses: number[] = [];
    for (let k = 0; k < 40; k++) {
      const x0 = k * 7;
      const base = makeGraph(
        [
          [0, 0],
          [0, 0],
          [x0, 0],
          [x0, 200],
        ],
        [
          [0, 1],
          [2, 3],
        ],
      );
      const nodes: LngLat[] = [[0, 0], [0.001, 0], base.nodes[2]!, base.nodes[3]!];
      const router = createRouter({ ...base, nodes });
      const q = at(x0 + R.maxSnapDistanceM - 1, 0);
      const hit = router.snap(q, 'walk');
      if (hit?.nodeId !== 2) misses.push(x0);
      else expect(hit.distanceM).toBeCloseTo(haversineM(q, base.nodes[2]!), 9);
    }
    expect(misses).toEqual([]);
  });
});

describe('deterministic choice between parallel edges', () => {
  const base = makeGraph(
    [
      [0, 0],
      [100, 0],
    ],
    [
      [0, 1],
      [0, 1],
    ],
  );
  const graph: GraphFile = {
    ...base,
    edges: [
      { ...base.edges[0]!, id: 7 },
      { ...base.edges[1]!, id: 3 },
    ],
  };

  it('picks the lower edge id regardless of input order', () => {
    const forward = createRouter(graph).route({ from: pt(0, 0), to: pt(100, 0), profile: 'walk' });
    const reversed = createRouter({ ...graph, edges: [...graph.edges].reverse() }).route({
      from: pt(0, 0),
      to: pt(100, 0),
      profile: 'walk',
    });
    expect(expectOk(forward).edgeIds).toEqual([3]);
    expect(expectOk(reversed).edgeIds).toEqual([3]);
  });
});

describe('duplicate nodes joined explicitly by the data', () => {
  // Nodes 1 and 2 share a coordinate; a zero-length edge says they connect.
  const graph = makeGraph(
    [
      [0, 0],
      [100, 0],
      [100, 0],
      [100, 100],
    ],
    [
      [0, 1, { name: 'West Test Path' }],
      [1, 2],
      [2, 3, { name: 'North Test Path' }],
    ],
  );

  it('routes through the joining edge with finite, consistent numbers', () => {
    const r = expectOk(createRouter(graph).route({ from: pt(0, 0), to: pt(100, 100), profile: 'walk' }));
    expect(r.edgeIds).toEqual([0, 1, 2]);
    expect(r.distanceM).toBeCloseTo(200, 0);
    expect(r.distanceM).toBeCloseTo(polylineLength(r.coordinates), 9);
    expect(r.durationS).toBeCloseTo(r.distanceM / R.walkSpeedMps, 6);
    for (const s of r.steps) {
      expect(Number.isFinite(s.distanceM) && Number.isFinite(s.durationS)).toBe(true);
      expect(s.instruction).not.toMatch(/NaN|undefined/);
    }
    // The turn is measured across the zero-length edge, not from it.
    expect(r.steps.map((s) => s.instruction)).toEqual([
      'Head along West Test Path for 100 m',
      'Turn left onto North Test Path (100 m)',
    ]);
    expect(r.steps.reduce((sum, s) => sum + s.durationS, 0)).toBeCloseTo(r.durationS, 9);
  });

  it('keeps them apart when no edge joins them', () => {
    const split = { ...graph, edges: graph.edges.filter((e) => e.id !== 1) };
    const r = createRouter(split).route({ from: pt(0, 0), to: pt(100, 100), profile: 'walk' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no-path');
  });
});

describe('cycle preferences', () => {
  // Pushing 100 m straight vs riding a 2 × ~112 m detour.
  const graph = makeGraph(
    [
      [0, 0],
      [100, 0],
      [50, 100],
    ],
    [
      [0, 1, { bicycle: 'push' }],
      [0, 2, { bicycle: 'ride' }],
      [2, 1, { bicycle: 'ride' }],
    ],
  );
  const router = createRouter(graph);

  it('shortest pushes the short way; fastest rides the longer detour', () => {
    const shortest = expectOk(router.route({ from: pt(0, 0), to: pt(100, 0), profile: 'cycle' }));
    expect(shortest.edgeIds).toEqual([0]);
    expect(caveatCodes(shortest)).toContain('push-bike');
    expect(shortest.durationS).toBeCloseTo(100 / R.pushBikeSpeedMps, 1);
    const fastest = expectOk(
      router.route({ from: pt(0, 0), to: pt(100, 0), profile: 'cycle', preference: 'fastest' }),
    );
    expect(fastest.edgeIds).toEqual([1, 2]);
    expect(caveatCodes(fastest)).not.toContain('push-bike');
    expect(fastest.durationS).toBeLessThan(shortest.durationS);
  });

  it('alternatives with only one corridor return just the best route', () => {
    const line = makeGraph(
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
    const results = createRouter(line).alternatives({ from: pt(0, 0), to: pt(200, 0), profile: 'walk' });
    expect(results).toHaveLength(1);
    expect(expectOk(results[0]).edgeIds).toEqual([0, 1]);
  });
});

describe('step-free caveat wording', () => {
  it('does not claim to avoid anything the data does not contain', () => {
    const r = expectOk(
      createRouter(
        makeGraph(
          [
            [0, 0],
            [100, 0],
          ],
          [[0, 1]],
        ),
      ).route({ from: pt(0, 0), to: pt(100, 0), profile: 'step-free' }),
    );
    const msg = r.caveats.find((c) => c.code === 'accessibility-unverified')?.message ?? '';
    expect(msg).toMatch(/not verified/);
    expect(msg).not.toMatch(/barrier/i);
  });
});

describe('cold routing budget', () => {
  it(`first cross-grid route on a fresh 120 × 120 router (lazy setup included) is under ${APP_CONFIG.performance.routeBudgetMs} ms`, () => {
    const router = createRouter(gridGraph(120, 120, 10));
    const t0 = performance.now();
    const r = router.route({ from: pt(0, 0), to: pt(1190, 1190), profile: 'walk', preference: 'fastest' });
    const elapsed = performance.now() - t0;
    expect(r.ok).toBe(true);
    expect(elapsed).toBeLessThan(APP_CONFIG.performance.routeBudgetMs);
  });
});
