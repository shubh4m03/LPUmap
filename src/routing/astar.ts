/**
 * A* point-to-point search over the CSR graph.
 *
 * h(n) = haversine(n, target) × hScale × HEURISTIC_SAFETY. Callers pass
 * hScale = 1 for distance costs and 1 / (profile's fastest speed) for time
 * costs; every arc costs at least its straight length × that scale, so the
 * heuristic is admissible and consistent and closed nodes are final.
 * hScale = 0 turns the search into Dijkstra (used by tests as a reference).
 *
 * Determinism: the heap orders by (f, g, node id). When two paths reach a
 * node with equal cost (within COST_TIE_TOLERANCE), the one whose predecessor
 * has the smaller node id wins (then the smaller edge id for parallel edges),
 * independent of input edge order.
 */
import { haversineM } from '../distance/geodesic.ts';
import { COST_TIE_TOLERANCE, HEURISTIC_SAFETY } from './constants.ts';
import type { RoutingGraph } from './graph.ts';
import { SearchHeap } from './priority-queue.ts';

export interface PathResult {
  /** Arc indices from source to target (empty when source === target). */
  arcs: number[];
  cost: number;
  /** Nodes settled during the search (for diagnostics and benchmarks). */
  expanded: number;
}

/** Reusable per-graph scratch memory; stamps avoid clearing arrays between searches. */
export interface SearchWorkspace {
  g: Float64Array;
  h: Float64Array;
  predArc: Int32Array;
  seen: Uint32Array;
  closed: Uint32Array;
  heap: SearchHeap;
  stamp: number;
}

export function createWorkspace(nodeCount: number): SearchWorkspace {
  return {
    g: new Float64Array(nodeCount),
    h: new Float64Array(nodeCount),
    predArc: new Int32Array(nodeCount),
    seen: new Uint32Array(nodeCount),
    closed: new Uint32Array(nodeCount),
    heap: new SearchHeap(256),
    stamp: 0,
  };
}

export function findPath(
  graph: RoutingGraph,
  cost: Float64Array,
  source: number,
  target: number,
  hScale: number,
  workspace: SearchWorkspace = createWorkspace(graph.nodeCount),
): PathResult | null {
  const n = graph.nodeCount;
  if (source < 0 || source >= n || target < 0 || target >= n) return null;
  if (source === target) return { arcs: [], cost: 0, expanded: 0 };

  const ws = workspace;
  if (ws.stamp >= 0xfffffffe) {
    ws.seen.fill(0);
    ws.closed.fill(0);
    ws.stamp = 0;
  }
  const sid = ++ws.stamp;
  const { g, h, predArc, seen, closed, heap } = ws;
  const { offsets, arcTarget, arcSource, arcEdge, lon, lat } = graph;
  const targetCoord: [number, number] = [lon[target]!, lat[target]!];
  const scale = hScale * HEURISTIC_SAFETY;
  const heuristic = (v: number) => (scale === 0 ? 0 : scale * haversineM([lon[v]!, lat[v]!], targetCoord));

  heap.clear();
  seen[source] = sid;
  g[source] = 0;
  h[source] = heuristic(source);
  predArc[source] = -1;
  heap.push(source, h[source]!, 0);

  let expanded = 0;
  let found = false;
  while (heap.size > 0) {
    const u = heap.pop();
    if (closed[u] === sid) continue;
    closed[u] = sid;
    expanded++;
    if (u === target) {
      found = true;
      break;
    }
    const gu = g[u]!;
    for (let a = offsets[u]!, end = offsets[u + 1]!; a < end; a++) {
      const w = cost[a]!;
      if (!(w < Infinity)) continue;
      const v = arcTarget[a]!;
      if (closed[v] === sid) continue;
      const ng = gu + w;
      if (seen[v] !== sid) {
        seen[v] = sid;
        g[v] = ng;
        h[v] = heuristic(v);
        predArc[v] = a;
        heap.push(v, ng + h[v]!, ng);
        continue;
      }
      const gv = g[v]!;
      const tol = COST_TIE_TOLERANCE * Math.max(1, gv);
      if (ng < gv - tol) {
        g[v] = ng;
        predArc[v] = a;
        heap.push(v, ng + h[v]!, ng);
      } else if (ng <= gv + tol) {
        const pa = predArc[v]!;
        const pu = arcSource[pa]!;
        // Parallel edges between the same nodes tie-break on edge id, not input order.
        if (u < pu || (u === pu && graph.edges[arcEdge[a]!]!.id < graph.edges[arcEdge[pa]!]!.id)) {
          predArc[v] = a;
        }
      }
    }
  }
  if (!found) return null;

  const arcs: number[] = [];
  for (let v = target; v !== source;) {
    const a = predArc[v]!;
    arcs.push(a);
    v = arcSource[a]!;
  }
  arcs.reverse();
  let total = 0;
  for (const a of arcs) total += cost[a]!;
  return { arcs, cost: total, expanded };
}
