import { describe, expect, it } from 'vitest';
import { accessCandidates } from '../../../src/admin/map/access-points.ts';
import { checkAccessNode, footNodeSet } from '../../../src/community/geo.ts';
import type { GraphFile, LngLat } from '../../../src/data/schema.ts';

/** Deterministic pseudo-random numbers (LCG), so the graph is the same on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

function graph(): Pick<GraphFile, 'nodes' | 'edges'> {
  const r = rng(7);
  const nodes: LngLat[] = Array.from({ length: 600 }, () => [75.695 + r() * 0.02, 31.245 + r() * 0.016]);
  const edges = [];
  for (let i = 0; i + 1 < nodes.length; i += 2)
    edges.push({ id: i, from: i, to: i + 1, lengthM: 1, foot: r() > 0.3 } as GraphFile['edges'][number]);
  return { nodes, edges };
}

// G-21: candidates now come from the shared grid index (src/distance); they must equal a brute-force scan.
describe('access candidates via the shared spatial index', () => {
  it('match a brute-force scan with the server check, in the same order', () => {
    const g = graph();
    const foot = footNodeSet(g);
    const r = rng(11);
    for (let t = 0; t < 40; t++) {
      const at: LngLat = [75.695 + r() * 0.02, 31.245 + r() * 0.016];
      const maxM = 40 + r() * 120;
      const brute = [...foot]
        .map((nodeId) => ({ nodeId, check: checkAccessNode(g.nodes, foot, nodeId, at, maxM) }))
        .flatMap(({ nodeId, check }) => (check.ok ? [{ nodeId, distanceM: check.distanceM }] : []))
        .sort((a, b) => a.distanceM - b.distanceM || a.nodeId - b.nodeId);
      const got = accessCandidates(g, at, { maxM, limit: 1000 });
      expect(got.map((c) => [c.nodeId, c.distanceM])).toEqual(brute.map((c) => [c.nodeId, c.distanceM]));
    }
  });
});
