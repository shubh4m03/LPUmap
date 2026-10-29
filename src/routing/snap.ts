/**
 * Nearest point on the usable path network (G-28).
 *
 * Every edge the profile may travel in at least one direction is indexed as a
 * straight segment over a uniform grid in a local metric projection. A query
 * projects the point onto each candidate segment and keeps the closest
 * projection, so a point beside the middle of a long edge snaps to the middle
 * of that edge, not to whichever end node happens to be nearer.
 *
 * - A projection within SNAP_NODE_MERGE_M of an edge end is reported as that
 *   node, so the router never creates a sliver of edge.
 * - Ties are deterministic and independent of input order: the shorter
 *   distance wins, then a node over an edge interior, then the smaller node id
 *   or edge id.
 * - Cells are slightly larger than the snap radius and each segment is filed
 *   in every cell its bounding box touches, so the query cell's neighbours
 *   hold every segment point within reach. The equirectangular x scale is true only
 *   at the origin latitude, so the east–west span widens when the query sits
 *   where projected metres understate real ones. The final distance test uses
 *   haversine, the app's single distance definition.
 */
import type { LngLat } from '../data/index.ts';
import { createLocalProjection, haversineM, isValidLngLat } from '../distance/index.ts';
import { SNAP_NODE_MERGE_M } from './constants.ts';
import type { RoutingGraph } from './graph.ts';

/** Where an endpoint joins the network. */
export type SnapHit =
  | {
      kind: 'node';
      nodeId: number;
      /** The node's coordinate. */
      point: LngLat;
      /** Straight-line distance from the query point, metres. */
      distanceM: number;
    }
  | {
      kind: 'edge';
      /** Index into graph.edges (not the edge id). */
      edge: number;
      /** Point on the edge's straight segment. */
      point: LngLat;
      distanceM: number;
      /** Metres along the edge from its `from` node to `point`. */
      fromM: number;
      /** Metres along the edge from `point` to its `to` node. */
      toM: number;
    };

export type NodeHit = Extract<SnapHit, { kind: 'node' }>;

export interface SnapIndex {
  /** Nearest point on a usable edge (possibly an edge end node). */
  nearest(p: LngLat): SnapHit | null;
  /** Nearest end node of a usable edge: the node-only rule used before G-28, kept as a fallback. */
  nearestNode(p: LngLat): NodeHit | null;
}

/** Offsets keep cell coordinates positive inside a safe-integer key. */
const KEY_OFFSET = 2 ** 24;
const KEY_SPAN = 2 ** 25;
const cellKey = (cx: number, cy: number) => (cx + KEY_OFFSET) * KEY_SPAN + (cy + KEY_OFFSET);
/** Beyond this many cells either side a query is not near the indexed network at all. */
const MAX_CELL_SPAN = 64;
/** A segment spanning more cells than this per axis is filed in a fallback list instead. */
const MAX_SEGMENT_CELLS = 64;
const DEG = Math.PI / 180;

/** Strict total order over snap candidates (see the module comment). */
function better(a: SnapHit, b: SnapHit, graph: RoutingGraph): boolean {
  if (a.distanceM !== b.distanceM) return a.distanceM < b.distanceM;
  if (a.kind !== b.kind) return a.kind === 'node';
  if (a.kind === 'node' && b.kind === 'node') return a.nodeId < b.nodeId;
  if (a.kind === 'edge' && b.kind === 'edge') {
    const ia = graph.edges[a.edge]!.id;
    const ib = graph.edges[b.edge]!.id;
    return ia !== ib ? ia < ib : a.edge < b.edge;
  }
  return false;
}

/**
 * @param edgeUsable 1 for each edge (index into graph.edges) the profile may
 *   travel in at least one direction.
 */
export function buildSnapIndex(graph: RoutingGraph, edgeUsable: Uint8Array, maxDistanceM: number): SnapIndex {
  let origin: LngLat | null = null;
  for (let i = 0; i < graph.edgeCount && !origin; i++) {
    if (edgeUsable[i]) {
      const from = graph.edges[i]!.from;
      origin = [graph.lon[from]!, graph.lat[from]!];
    }
  }
  if (!origin || !(maxDistanceM > 0)) return { nearest: () => null, nearestNode: () => null };

  const projection = createLocalProjection(origin);
  const cosOriginLat = Math.cos(origin[1] * DEG);
  // 10 % margin absorbs the tiny disagreement between projected and haversine distance.
  const cell = maxDistanceM * 1.1;
  const xy = new Float64Array(graph.nodeCount * 2);
  for (let i = 0; i < graph.nodeCount; i++) {
    if (!graph.nodeValid[i]) continue;
    const [x, y] = projection.toXY([graph.lon[i]!, graph.lat[i]!]);
    xy[2 * i] = x;
    xy[2 * i + 1] = y;
  }
  const buckets = new Map<number, number[]>();
  const oversized: number[] = [];
  for (let e = 0; e < graph.edgeCount; e++) {
    if (!edgeUsable[e]) continue;
    const { from, to } = graph.edges[e]!;
    const x0 = Math.min(xy[2 * from]!, xy[2 * to]!);
    const x1 = Math.max(xy[2 * from]!, xy[2 * to]!);
    const y0 = Math.min(xy[2 * from + 1]!, xy[2 * to + 1]!);
    const y1 = Math.max(xy[2 * from + 1]!, xy[2 * to + 1]!);
    const cx0 = Math.floor(x0 / cell);
    const cx1 = Math.floor(x1 / cell);
    const cy0 = Math.floor(y0 / cell);
    const cy1 = Math.floor(y1 / cell);
    if (cx1 - cx0 > MAX_SEGMENT_CELLS || cy1 - cy0 > MAX_SEGMENT_CELLS) {
      oversized.push(e);
      continue;
    }
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const key = cellKey(cx, cy);
        const bucket = buckets.get(key);
        if (bucket) bucket.push(e);
        else buckets.set(key, [e]);
      }
    }
  }
  // Per-query stamps dedupe segments filed in several cells.
  const seen = new Uint32Array(graph.edgeCount);
  let stamp = 0;

  const nodeHit = (node: number, p: LngLat): NodeHit => {
    const point: LngLat = [graph.lon[node]!, graph.lat[node]!];
    return { kind: 'node', nodeId: node, point, distanceM: haversineM(p, point) };
  };

  const candidate = (e: number, p: LngLat, px: number, py: number): SnapHit => {
    const { from, to } = graph.edges[e]!;
    const ax = xy[2 * from]!;
    const ay = xy[2 * from + 1]!;
    const dx = xy[2 * to]! - ax;
    const dy = xy[2 * to + 1]! - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const a: LngLat = [graph.lon[from]!, graph.lat[from]!];
    const b: LngLat = [graph.lon[to]!, graph.lat[to]!];
    const point: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const fromM = haversineM(a, point);
    const toM = haversineM(point, b);
    if (fromM <= SNAP_NODE_MERGE_M || toM <= SNAP_NODE_MERGE_M) {
      // Ends closer than the merge distance to each other: the nearer end wins (from on a tie).
      return nodeHit(fromM <= toM ? from : to, p);
    }
    return { kind: 'edge', edge: e, point, distanceM: haversineM(p, point), fromM, toM };
  };

  /** Calls `visit` once per usable edge filed near `p`, or returns false when `p` is out of reach. */
  const scan = (p: LngLat, visit: (e: number, x: number, y: number) => void): boolean => {
    if (!isValidLngLat(p)) return false;
    const [x, y] = projection.toXY(p);
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    // Projected x = true east–west metres × cos(originLat) / cos(lat); bound it at the
    // most poleward latitude a candidate within maxDistanceM can have.
    const reachLat = Math.min(89.9, Math.abs(p[1]) + maxDistanceM / 111_000);
    const xStretch = Math.max(1, cosOriginLat / Math.cos(reachLat * DEG));
    const span = Math.ceil((maxDistanceM * xStretch) / cell);
    if (span > MAX_CELL_SPAN) return false;
    if (Math.abs(cx) >= KEY_OFFSET - span - 1 || Math.abs(cy) >= KEY_OFFSET - 2) return false;
    if (++stamp >= 0xffffffff) {
      seen.fill(0);
      stamp = 1;
    }
    const consider = (e: number) => {
      if (seen[e] === stamp) return;
      seen[e] = stamp;
      visit(e, x, y);
    };
    for (let dx = -span; dx <= span; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = buckets.get(cellKey(cx + dx, cy + dy));
        if (bucket) for (const e of bucket) consider(e);
      }
    }
    for (const e of oversized) consider(e);
    return true;
  };

  return {
    nearest(p) {
      let best: SnapHit | null = null;
      scan(p, (e, x, y) => {
        const hit = candidate(e, p, x, y);
        if (hit.distanceM <= maxDistanceM && (!best || better(hit, best, graph))) best = hit;
      });
      return best;
    },
    nearestNode(p) {
      // A node within reach lies in a neighbouring cell, and so does every usable edge touching it.
      let best: NodeHit | null = null;
      scan(p, (e) => {
        for (const node of [graph.edges[e]!.from, graph.edges[e]!.to]) {
          const hit = nodeHit(node, p);
          if (hit.distanceM <= maxDistanceM && (!best || better(hit, best, graph))) best = hit;
        }
      });
      return best;
    },
  };
}
