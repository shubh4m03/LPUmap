/**
 * Immutable routing graph in compressed sparse row (CSR) form.
 *
 * Every accepted input edge yields two directed arcs (forward from→to and
 * backward to→from). Whether an arc may be used, and at what cost, is decided
 * per profile in profiles.ts, so one graph serves all profiles.
 *
 * Input is treated defensively: edges referencing missing nodes, nodes with
 * invalid coordinates, self-loops or non-integer ids are skipped (and
 * counted), never "repaired". Nodes sharing a coordinate stay separate unless
 * an edge connects them.
 */
import type { GraphEdge, GraphFile, LngLat } from '../data/schema.ts';
import { haversineM, isValidLngLat } from '../distance/geodesic.ts';

export interface RoutingGraph {
  readonly nodeCount: number;
  /** Number of accepted edges (input edges minus rejected ones). */
  readonly edgeCount: number;
  readonly rejectedEdgeCount: number;
  readonly lon: Float64Array;
  readonly lat: Float64Array;
  /** 1 when the node has a valid coordinate. */
  readonly nodeValid: Uint8Array;
  /** Arcs leaving node u are offsets[u] .. offsets[u + 1] - 1. */
  readonly offsets: Int32Array;
  readonly arcSource: Int32Array;
  readonly arcTarget: Int32Array;
  /** Index into `edges` of the edge this arc traverses. */
  readonly arcEdge: Int32Array;
  /** 1 when the arc follows its edge from→to. */
  readonly arcForward: Uint8Array;
  /** Accepted edges, in input order. */
  readonly edges: readonly GraphEdge[];
  /** Straight-line length of each accepted edge between its node coordinates. */
  readonly edgeLengthM: Float64Array;
  /** Arc indices of edge i are edgeArcs[2i] (forward) and edgeArcs[2i + 1] (backward). */
  readonly edgeArcs: Int32Array;
}

function isNodeIndex(v: unknown, n: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < n;
}

export function buildGraph(file: GraphFile): RoutingGraph {
  const rawNodes: unknown[] = Array.isArray(file?.nodes) ? file.nodes : [];
  const rawEdges: unknown[] = Array.isArray(file?.edges) ? file.edges : [];
  const n = rawNodes.length;
  const lon = new Float64Array(n);
  const lat = new Float64Array(n);
  const nodeValid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = rawNodes[i];
    if (isValidLngLat(p)) {
      lon[i] = p[0];
      lat[i] = p[1];
      nodeValid[i] = 1;
    }
  }

  const edges: GraphEdge[] = [];
  for (const raw of rawEdges) {
    if (typeof raw !== 'object' || raw === null) continue;
    const e = raw as GraphEdge;
    if (!isNodeIndex(e.from, n) || !isNodeIndex(e.to, n) || e.from === e.to) continue;
    if (!nodeValid[e.from] || !nodeValid[e.to]) continue;
    if (typeof e.id !== 'number' || !Number.isFinite(e.id)) continue;
    edges.push(e);
  }

  const m = edges.length;
  const edgeLengthM = new Float64Array(m);
  const degree = new Int32Array(n + 1);
  for (let i = 0; i < m; i++) {
    const e = edges[i]!;
    edgeLengthM[i] = haversineM([lon[e.from]!, lat[e.from]!], [lon[e.to]!, lat[e.to]!]);
    degree[e.from]!++;
    degree[e.to]!++;
  }

  const offsets = new Int32Array(n + 1);
  for (let u = 0; u < n; u++) offsets[u + 1] = offsets[u]! + degree[u]!;
  const cursor = offsets.slice(0, n);
  const arcCount = 2 * m;
  const arcSource = new Int32Array(arcCount);
  const arcTarget = new Int32Array(arcCount);
  const arcEdge = new Int32Array(arcCount);
  const arcForward = new Uint8Array(arcCount);
  const edgeArcs = new Int32Array(arcCount);
  const place = (edgeIndex: number, from: number, to: number, forward: boolean) => {
    const a = cursor[from]!++;
    arcSource[a] = from;
    arcTarget[a] = to;
    arcEdge[a] = edgeIndex;
    arcForward[a] = forward ? 1 : 0;
    edgeArcs[2 * edgeIndex + (forward ? 0 : 1)] = a;
  };
  for (let i = 0; i < m; i++) {
    const e = edges[i]!;
    place(i, e.from, e.to, true);
    place(i, e.to, e.from, false);
  }

  return {
    nodeCount: n,
    edgeCount: m,
    rejectedEdgeCount: rawEdges.length - m,
    lon,
    lat,
    nodeValid,
    offsets,
    arcSource,
    arcTarget,
    arcEdge,
    arcForward,
    edges,
    edgeLengthM,
    edgeArcs,
  };
}

export function nodeCoord(graph: RoutingGraph, node: number): LngLat {
  return [graph.lon[node]!, graph.lat[node]!];
}
