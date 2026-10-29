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
 *
 * Endpoints inside an edge (G-28). `findRoute` also accepts endpoints part way
 * along an edge and splits that edge virtually, without changing the graph:
 * the search starts from the edge's end nodes, each seeded with the cost of
 * the partial edge to it (only in directions the profile may travel), and
 * ends at one virtual target slot reached from the target edge's end nodes
 * the same way. Endpoints on the same edge also get the direct piece between
 * them. A partial cost is the arc's cost times the share of the edge covered,
 * so every piece still costs at least its straight length × hScale and the
 * heuristic (measured to the snapped target point) stays admissible and
 * consistent. Ties at the virtual target prefer the direct piece, then the
 * end node with the smaller id; a node seeded from the source keeps that seed
 * on a tie.
 */
import type { LngLat } from '../data/index.ts';
import { haversineM } from '../distance/index.ts';
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

/** Where a search starts or ends: a graph node, or a point part way along an edge. */
export type SearchEnd =
  | { kind: 'node'; node: number }
  | {
      kind: 'edge';
      /** Index into graph.edges. */
      edge: number;
      /** The point on the edge; the heuristic aims at it. */
      point: LngLat;
      /** Metres from the edge's `from` node to the point, and from the point to its `to` node. */
      fromM: number;
      toM: number;
    };

/** Part of one arc, as fractions of its edge in the arc's direction (0 = arc source, 1 = arc target). */
export interface PathPiece {
  arc: number;
  start: number;
  end: number;
}

export interface RoutePath {
  /** Pieces in travel order; a full arc has start 0 and end 1. */
  pieces: PathPiece[];
  cost: number;
  /** Nodes settled during the search. */
  expanded: number;
}

/** Scratch memory for one graph, with one extra slot for the virtual target of a mid-edge endpoint. */
export function createWorkspace(nodeCount: number): SearchWorkspace {
  const slots = nodeCount + 1;
  return {
    g: new Float64Array(slots),
    h: new Float64Array(slots),
    predArc: new Int32Array(slots),
    seen: new Uint32Array(slots),
    closed: new Uint32Array(slots),
    heap: new SearchHeap(256),
    stamp: 0,
  };
}

/** Node-to-node search (the original API): the arcs of the best path, or null. */
export function findPath(
  graph: RoutingGraph,
  cost: Float64Array,
  source: number,
  target: number,
  hScale: number,
  workspace?: SearchWorkspace,
): PathResult | null {
  const n = graph.nodeCount;
  if (!isIndex(source, n) || !isIndex(target, n)) return null;
  const found = findRoute(
    graph,
    cost,
    { kind: 'node', node: source },
    { kind: 'node', node: target },
    hScale,
    workspace,
  );
  return found ? { arcs: found.pieces.map((p) => p.arc), cost: found.cost, expanded: found.expanded } : null;
}

const isIndex = (v: number, n: number) => Number.isInteger(v) && v >= 0 && v < n;

/** Share of the edge's length between its `from` node and the endpoint. */
function edgeShare(end: Extract<SearchEnd, { kind: 'edge' }>): number {
  const total = end.fromM + end.toM;
  return total > 0 ? end.fromM / total : 0;
}

function validEnd(graph: RoutingGraph, end: SearchEnd): boolean {
  if (end.kind === 'node') return isIndex(end.node, graph.nodeCount);
  return (
    isIndex(end.edge, graph.edgeCount) &&
    Number.isFinite(end.fromM) &&
    Number.isFinite(end.toM) &&
    end.fromM >= 0 &&
    end.toM >= 0
  );
}

/** predArc of a node source; a node seeded from a mid-edge source stores -2 - (its start piece index). */
const ROOT = -1;
/** targetVia when the target was reached by the direct piece on a shared edge. */
const DIRECT = -1;

/** Cost of a piece: the arc's cost scaled by the share of the edge it covers. */
export function pieceCost(cost: Float64Array, p: PathPiece): number {
  return p.start === 0 && p.end === 1 ? cost[p.arc]! : cost[p.arc]! * (p.end - p.start);
}

/** Best path between two endpoints that may lie inside edges, or null when none exists. */
export function findRoute(
  graph: RoutingGraph,
  cost: Float64Array,
  from: SearchEnd,
  to: SearchEnd,
  hScale: number,
  workspace: SearchWorkspace = createWorkspace(graph.nodeCount),
): RoutePath | null {
  const n = graph.nodeCount;
  if (!validEnd(graph, from) || !validEnd(graph, to)) return null;
  if (from.kind === 'node' && to.kind === 'node' && from.node === to.node) {
    return { pieces: [], cost: 0, expanded: 0 };
  }

  const ws = workspace;
  if (ws.stamp >= 0xfffffffe) {
    ws.seen.fill(0);
    ws.closed.fill(0);
    ws.stamp = 0;
  }
  const sid = ++ws.stamp;
  const { g, h, predArc, seen, closed, heap } = ws;
  const { offsets, arcTarget, arcSource, arcEdge, edgeArcs, lon, lat } = graph;
  const virtual = n;
  const targetNode = to.kind === 'node' ? to.node : virtual;
  const targetCoord: LngLat = to.kind === 'node' ? [lon[to.node]!, lat[to.node]!] : to.point;
  const scale = hScale * HEURISTIC_SAFETY;
  const heuristic = (v: number) => (scale === 0 ? 0 : scale * haversineM([lon[v]!, lat[v]!], targetCoord));

  // Pieces leaving a mid-edge source towards each end node it may travel to.
  const startPieces: PathPiece[] = [];
  // Links from the target edge's end nodes to the virtual target.
  const links: Array<{ node: number; piece: PathPiece }> = [];
  let direct: PathPiece | null = null;
  if (to.kind === 'edge') {
    const t = edgeShare(to);
    const { from: x, to: y } = graph.edges[to.edge]!;
    const fwd = edgeArcs[2 * to.edge]!;
    const back = edgeArcs[2 * to.edge + 1]!;
    if (cost[fwd]! < Infinity) links.push({ node: x, piece: { arc: fwd, start: 0, end: t } });
    if (cost[back]! < Infinity) links.push({ node: y, piece: { arc: back, start: 0, end: 1 - t } });
    if (from.kind === 'edge' && from.edge === to.edge) {
      const s = edgeShare(from);
      if (t >= s && cost[fwd]! < Infinity) direct = { arc: fwd, start: s, end: t };
      else if (t < s && cost[back]! < Infinity) direct = { arc: back, start: 1 - s, end: 1 - t };
    }
  }

  heap.clear();
  const reach = (v: number, ng: number, pred: number) => {
    seen[v] = sid;
    g[v] = ng;
    h[v] = heuristic(v);
    predArc[v] = pred;
    heap.push(v, ng + h[v]!, ng);
  };
  if (from.kind === 'node') {
    reach(from.node, 0, ROOT);
  } else {
    const s = edgeShare(from);
    const fwd = edgeArcs[2 * from.edge]!;
    const back = edgeArcs[2 * from.edge + 1]!;
    if (cost[back]! < Infinity) startPieces.push({ arc: back, start: 1 - s, end: 1 });
    if (cost[fwd]! < Infinity) startPieces.push({ arc: fwd, start: s, end: 1 });
    // The two seeds reach different nodes (no self-loops), so their order does not matter.
    startPieces.forEach((piece, k) => reach(arcTarget[piece.arc]!, pieceCost(cost, piece), -2 - k));
  }
  // The virtual target remembers the end node it was reached from (DIRECT for the direct piece).
  let targetVia = -2;
  let targetPiece: PathPiece | null = null;
  const reachTarget = (via: number, piece: PathPiece, ng: number) => {
    if (seen[virtual] === sid) {
      const gv = g[virtual]!;
      const tol = COST_TIE_TOLERANCE * Math.max(1, gv);
      if (ng > gv + tol || (ng >= gv - tol && via >= targetVia)) return;
    }
    seen[virtual] = sid;
    g[virtual] = ng;
    h[virtual] = 0;
    targetVia = via;
    targetPiece = piece;
    heap.push(virtual, ng, ng);
  };
  if (direct) reachTarget(DIRECT, direct, pieceCost(cost, direct));

  let expanded = 0;
  let found = false;
  while (heap.size > 0) {
    const u = heap.pop();
    if (closed[u] === sid) continue;
    closed[u] = sid;
    if (u === virtual) {
      found = true;
      break;
    }
    expanded++;
    if (u === targetNode) {
      found = true;
      break;
    }
    const gu = g[u]!;
    for (const link of links)
      if (link.node === u) reachTarget(u, link.piece, gu + pieceCost(cost, link.piece));
    for (let a = offsets[u]!, end = offsets[u + 1]!; a < end; a++) {
      const w = cost[a]!;
      if (!(w < Infinity)) continue;
      const v = arcTarget[a]!;
      if (closed[v] === sid) continue;
      const ng = gu + w;
      if (seen[v] !== sid) {
        reach(v, ng, a);
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
        // A node reached straight from the source keeps that start on a tie.
        if (pa < 0) continue;
        const pu = arcSource[pa]!;
        // Parallel edges between the same nodes tie-break on edge id, not input order.
        if (u < pu || (u === pu && graph.edges[arcEdge[a]!]!.id < graph.edges[arcEdge[pa]!]!.id)) {
          predArc[v] = a;
        }
      }
    }
  }
  if (!found) return null;

  const pieces: PathPiece[] = [];
  let v = targetNode;
  if (targetNode === virtual) {
    pieces.push(targetPiece!);
    v = targetVia;
  }
  while (v !== DIRECT) {
    const a = predArc[v]!;
    if (a === ROOT) break;
    if (a <= -2) {
      pieces.push(startPieces[-2 - a]!);
      break;
    }
    pieces.push({ arc: a, start: 0, end: 1 });
    v = arcSource[a]!;
  }
  pieces.reverse();
  let total = 0;
  for (const p of pieces) total += pieceCost(cost, p);
  return { pieces, cost: total, expanded };
}
