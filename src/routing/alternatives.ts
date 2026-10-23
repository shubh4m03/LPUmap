/**
 * Alternative routes by iterative edge penalties: after each search, every
 * edge of the path just found costs ALTERNATIVE_EDGE_PENALTY× more, and the
 * search is repeated. A candidate is accepted only if its length-weighted
 * edge overlap with every accepted route is below 1 − alternativeMinDifference.
 *
 * Overlap(a, b) = length of edges shared by a and b ÷ the shorter network
 * length of the two, so a short detour cannot hide inside a long route.
 * Accepted paths are reported with their true (unpenalised) cost.
 */
import { ALTERNATIVE_EDGE_PENALTY } from './constants.ts';
import { findPath, type PathResult, type SearchWorkspace } from './astar.ts';
import type { RoutingGraph } from './graph.ts';

export interface AlternativeOptions {
  maxAlternatives: number;
  minDifference: number;
  hScale: number;
  workspace: SearchWorkspace;
}

function edgeSet(graph: RoutingGraph, arcs: readonly number[]): Set<number> {
  const set = new Set<number>();
  for (const a of arcs) set.add(graph.arcEdge[a]!);
  return set;
}

function networkLength(graph: RoutingGraph, edges: Set<number>): number {
  let total = 0;
  for (const e of edges) total += graph.edgeLengthM[e]!;
  return total;
}

export function edgeOverlap(graph: RoutingGraph, a: readonly number[], b: readonly number[]): number {
  const ea = edgeSet(graph, a);
  const eb = edgeSet(graph, b);
  const shorter = Math.min(networkLength(graph, ea), networkLength(graph, eb));
  if (!(shorter > 0)) return 1;
  let shared = 0;
  for (const e of ea) if (eb.has(e)) shared += graph.edgeLengthM[e]!;
  return shared / shorter;
}

/** Returns the best path followed by accepted alternatives, sorted by true cost (best first). */
export function findAlternatives(
  graph: RoutingGraph,
  cost: Float64Array,
  source: number,
  target: number,
  opts: AlternativeOptions,
): PathResult[] {
  const best = findPath(graph, cost, source, target, opts.hScale, opts.workspace);
  if (!best) return [];
  const accepted: PathResult[] = [best];
  if (best.arcs.length === 0 || opts.maxAlternatives <= 0) return accepted;

  const penalised = Float64Array.from(cost);
  const maxOverlap = 1 - opts.minDifference;
  const maxAttempts = opts.maxAlternatives * 3;
  let last = best.arcs;
  for (let attempt = 0; attempt < maxAttempts && accepted.length <= opts.maxAlternatives; attempt++) {
    for (const e of edgeSet(graph, last)) {
      penalised[graph.edgeArcs[2 * e]!]! *= ALTERNATIVE_EDGE_PENALTY;
      penalised[graph.edgeArcs[2 * e + 1]!]! *= ALTERNATIVE_EDGE_PENALTY;
    }
    const candidate = findPath(graph, penalised, source, target, opts.hScale, opts.workspace);
    if (!candidate) break;
    last = candidate.arcs;
    if (accepted.every((r) => edgeOverlap(graph, r.arcs, candidate.arcs) < maxOverlap)) {
      let trueCost = 0;
      for (const a of candidate.arcs) trueCost += cost[a]!;
      accepted.push({ ...candidate, cost: trueCost });
    }
  }
  // Stable sort keeps the optimal route first on exact ties.
  return accepted.sort((x, y) => x.cost - y.cost);
}
