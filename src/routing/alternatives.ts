/**
 * Alternative routes by iterative edge penalties: after each search, every
 * edge of the path just found costs ALTERNATIVE_EDGE_PENALTY× more, and the
 * search is repeated. A candidate is accepted only if its length-weighted
 * edge overlap with every accepted route is below 1 − alternativeMinDifference.
 *
 * Overlap(a, b) = length shared by a and b ÷ the shorter network length of
 * the two, so a short detour cannot hide inside a long route. A path that
 * covers only part of an edge (a mid-edge endpoint) counts only that part; two
 * paths share min(their covered lengths) of an edge. Accepted paths are
 * reported with their true (unpenalised) cost.
 */
import { ALTERNATIVE_EDGE_PENALTY } from './constants.ts';
import {
  findRoute,
  pieceCost,
  type PathPiece,
  type RoutePath,
  type SearchEnd,
  type SearchWorkspace,
} from './astar.ts';
import type { RoutingGraph } from './graph.ts';

export interface AlternativeOptions {
  maxAlternatives: number;
  minDifference: number;
  hScale: number;
  workspace: SearchWorkspace;
}

type PathLike = readonly number[] | readonly PathPiece[];

const asPieces = (path: PathLike): readonly PathPiece[] =>
  path.map((p) => (typeof p === 'number' ? { arc: p, start: 0, end: 1 } : p));

/** Metres of each edge (by index) a path covers, at most the edge's length. */
function coverage(graph: RoutingGraph, path: PathLike): Map<number, number> {
  const covered = new Map<number, number>();
  for (const p of asPieces(path)) {
    const e = graph.arcEdge[p.arc]!;
    const length = graph.edgeLengthM[e]!;
    covered.set(e, Math.min(length, (covered.get(e) ?? 0) + length * (p.end - p.start)));
  }
  return covered;
}

function total(covered: Map<number, number>): number {
  let sum = 0;
  for (const m of covered.values()) sum += m;
  return sum;
}

/** Length-weighted overlap of two paths given as arcs or pieces (1 = identical). */
export function edgeOverlap(graph: RoutingGraph, a: PathLike, b: PathLike): number {
  const ca = coverage(graph, a);
  const cb = coverage(graph, b);
  const shorter = Math.min(total(ca), total(cb));
  if (!(shorter > 0)) return 1;
  let shared = 0;
  for (const [e, m] of ca) {
    const other = cb.get(e);
    if (other !== undefined) shared += Math.min(m, other);
  }
  return shared / shorter;
}

/** Returns the best path followed by accepted alternatives, sorted by true cost (best first). */
export function findAlternatives(
  graph: RoutingGraph,
  cost: Float64Array,
  from: SearchEnd,
  to: SearchEnd,
  opts: AlternativeOptions,
): RoutePath[] {
  const best = findRoute(graph, cost, from, to, opts.hScale, opts.workspace);
  if (!best) return [];
  const accepted: RoutePath[] = [best];
  if (best.pieces.length === 0 || opts.maxAlternatives <= 0) return accepted;

  const penalised = Float64Array.from(cost);
  const maxOverlap = 1 - opts.minDifference;
  const maxAttempts = opts.maxAlternatives * 3;
  let last = best.pieces;
  for (let attempt = 0; attempt < maxAttempts && accepted.length <= opts.maxAlternatives; attempt++) {
    for (const e of new Set(last.map((p) => graph.arcEdge[p.arc]!))) {
      penalised[graph.edgeArcs[2 * e]!]! *= ALTERNATIVE_EDGE_PENALTY;
      penalised[graph.edgeArcs[2 * e + 1]!]! *= ALTERNATIVE_EDGE_PENALTY;
    }
    const candidate = findRoute(graph, penalised, from, to, opts.hScale, opts.workspace);
    if (!candidate) break;
    last = candidate.pieces;
    if (accepted.every((r) => edgeOverlap(graph, r.pieces, candidate.pieces) < maxOverlap)) {
      let trueCost = 0;
      for (const p of candidate.pieces) trueCost += pieceCost(cost, p);
      accepted.push({ ...candidate, cost: trueCost });
    }
  }
  // Stable sort keeps the optimal route first on exact ties.
  return accepted.sort((x, y) => x.cost - y.cost);
}
