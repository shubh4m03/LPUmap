/**
 * Access-point candidates for a location (pure). A candidate is an EXISTING
 * routing-graph node that passes exactly the server's check
 * (src/community/geo.ts `checkAccessNode`: exists, touches a walkable edge,
 * within APP_CONFIG.routing.maxPlaceConnectorM). The owner picks one
 * explicitly; nothing here chooses for them, and the server re-validates.
 */
import { checkAccessNode, footNodeSet } from '../../community/geo.ts';
import { APP_CONFIG } from '../../config/index.ts';
import type { GraphFile, LngLat } from '../../data/schema.ts';
import { isValidLngLat } from '../../distance/geodesic.ts';

export interface AccessCandidate {
  nodeId: number;
  position: LngLat;
  /** Metres from the location (rounded to cm, as the server reports). */
  distanceM: number;
}

const footCache = new WeakMap<object, Set<number>>();

function footNodes(graph: Pick<GraphFile, 'edges'>): Set<number> {
  let s = footCache.get(graph);
  if (!s) {
    s = footNodeSet(graph);
    footCache.set(graph, s);
  }
  return s;
}

/** Degrees of latitude per metre (a generous box before the exact distance check). */
const DEG_PER_M = 1 / 111_000;

/** Valid candidates for `location`, nearest first (at most `limit`). */
export function accessCandidates(
  graph: Pick<GraphFile, 'nodes' | 'edges'>,
  location: LngLat,
  opts: { maxM?: number; limit?: number } = {},
): AccessCandidate[] {
  if (!isValidLngLat(location)) return [];
  const maxM = opts.maxM ?? APP_CONFIG.routing.maxPlaceConnectorM;
  const limit = opts.limit ?? 8;
  const foot = footNodes(graph);
  const dLat = maxM * DEG_PER_M * 1.2;
  const dLon = dLat / Math.max(0.2, Math.cos((location[1] * Math.PI) / 180));
  const out: AccessCandidate[] = [];
  for (const nodeId of foot) {
    const p = graph.nodes[nodeId];
    if (!p || Math.abs(p[1] - location[1]) > dLat || Math.abs(p[0] - location[0]) > dLon) continue;
    const check = checkAccessNode(graph.nodes, foot, nodeId, location, maxM);
    if (check.ok) out.push({ nodeId, position: [p[0], p[1]], distanceM: check.distanceM });
  }
  out.sort((a, b) => a.distanceM - b.distanceM || a.nodeId - b.nodeId);
  return out.slice(0, limit);
}

/** The server's verdict on a stored node for `location`: null when valid, else the reason text. */
export function accessProblem(
  graph: Pick<GraphFile, 'nodes' | 'edges'>,
  nodeId: number,
  location: LngLat,
): string | null {
  const check = checkAccessNode(graph.nodes, footNodes(graph), nodeId, location);
  return check.ok ? null : check.message;
}
