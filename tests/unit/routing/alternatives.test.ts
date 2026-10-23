import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';
import { haversineM } from '../../../src/distance/geodesic.ts';
import { edgeOverlap } from '../../../src/routing/alternatives.ts';
import { buildGraph } from '../../../src/routing/graph.ts';
import { createRouter, type RouteOk } from '../../../src/routing/index.ts';
import { expectFailure, expectOk, loadFixture, makeGraph, polylineLength, pt } from './helpers.ts';

const R = APP_CONFIG.routing;

/** Three disjoint corridors from (0,0) to (300,0): direct, north (+100) and south (−150). */
const ladder = makeGraph(
  [
    [0, 0], // 0
    [100, 0], // 1
    [200, 0], // 2
    [300, 0], // 3
    [0, 100], // 4
    [300, 100], // 5
    [0, -150], // 6
    [300, -150], // 7
  ],
  [
    [0, 1],
    [1, 2],
    [2, 3],
    [0, 4],
    [4, 5],
    [5, 3],
    [0, 6],
    [6, 7],
    [7, 3],
  ],
);

function lengthOf(edgeIds: number[]): number {
  return edgeIds.reduce((s, id) => {
    const e = ladder.edges[id]!;
    return s + haversineM(ladder.nodes[e.from]!, ladder.nodes[e.to]!);
  }, 0);
}

function overlapShare(a: RouteOk, b: RouteOk): number {
  const shared = a.edgeIds.filter((id) => b.edgeIds.includes(id));
  return lengthOf(shared) / Math.min(lengthOf(a.edgeIds), lengthOf(b.edgeIds));
}

describe('alternatives', () => {
  const router = createRouter(ladder);

  it('returns the best route first and distinct, sorted alternatives', () => {
    const results = router
      .alternatives({ from: pt(0, 0), to: pt(300, 0), profile: 'walk' })
      .map((r) => expectOk(r));
    expect(results.length).toBe(1 + R.maxAlternatives);
    expect(results[0]!.edgeIds).toEqual(
      expectOk(router.route({ from: pt(0, 0), to: pt(300, 0), profile: 'walk' })).edgeIds,
    );
    expect(results.map((r) => r.edgeIds)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
    ]);
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.distanceM).toBeGreaterThanOrEqual(results[i - 1]!.distanceM);
      for (let j = 0; j < i; j++) {
        expect(overlapShare(results[i]!, results[j]!)).toBeLessThan(1 - R.alternativeMinDifference);
      }
    }
  });

  it('reports true (unpenalised) distance and duration for every alternative', () => {
    const results = router
      .alternatives({ from: pt(0, 0), to: pt(300, 0), profile: 'walk' })
      .map((r) => expectOk(r));
    expect(results[1]!.distanceM).toBeCloseTo(500, 0);
    expect(results[2]!.distanceM).toBeCloseTo(600, 0);
    for (const r of results) {
      expect(r.distanceM).toBeCloseTo(polylineLength(r.coordinates), 9);
      expect(r.durationS).toBeCloseTo(r.distanceM / R.walkSpeedMps, 6);
    }
  });

  it('sorts by the requested preference cost', () => {
    const results = router
      .alternatives({ from: pt(0, 0), to: pt(300, 0), profile: 'walk', preference: 'fastest' })
      .map((r) => expectOk(r));
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.durationS).toBeGreaterThanOrEqual(results[i - 1]!.durationS);
    }
  });

  it('offers no alternative that mostly overlaps the best route', () => {
    // A long shared trunk with a tiny parallel bypass: the bypass differs by < 30 %.
    const g = makeGraph(
      [
        [0, 0],
        [400, 0],
        [420, 0],
        [410, 8],
      ],
      [
        [0, 1],
        [1, 2],
        [1, 3],
        [3, 2],
      ],
    );
    const results = createRouter(g).alternatives({ from: pt(0, 0), to: pt(420, 0), profile: 'walk' });
    expect(results).toHaveLength(1);
    expect(expectOk(results[0]).edgeIds).toEqual([0, 1]);
  });

  it('returns the failure as a single entry when routing fails', () => {
    const r = createRouter(loadFixture('synthetic-disconnected.json')).alternatives({
      from: pt(0, 0),
      to: pt(0, 300),
      profile: 'walk',
    });
    expect(r).toHaveLength(1);
    expectFailure(r[0], 'no-path');
    expectFailure(router.alternatives({ from: pt(0, 0), to: pt(0, 1), profile: 'walk' })[0], 'same-point');
  });

  it('returns a single connector-only route when both ends snap to one node', () => {
    const r = router.alternatives({ from: pt(3, 3), to: pt(-3, -3), profile: 'walk' });
    expect(r).toHaveLength(1);
    expect(expectOk(r[0]).edgeIds).toEqual([]);
  });
});

describe('edgeOverlap', () => {
  it('is 1 for identical paths, 0 for disjoint ones', () => {
    const graph = buildGraph(ladder);
    const direct = [graph.edgeArcs[0]!, graph.edgeArcs[2]!, graph.edgeArcs[4]!];
    const north = [graph.edgeArcs[6]!, graph.edgeArcs[8]!, graph.edgeArcs[10]!];
    expect(edgeOverlap(graph, direct, direct)).toBeCloseTo(1, 12);
    expect(edgeOverlap(graph, direct, north)).toBe(0);
    expect(edgeOverlap(graph, direct, [graph.edgeArcs[1]!])).toBeCloseTo(1, 12);
  });
});
