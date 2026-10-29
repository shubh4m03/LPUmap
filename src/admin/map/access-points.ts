/**
 * Access-point candidates for a location (pure). A candidate is an EXISTING
 * routing-graph node that passes exactly the server's check
 * (src/community/geo.ts `checkAccessNode`: exists, touches a walkable edge,
 * within APP_CONFIG.routing.maxPlaceConnectorM). The owner picks one
 * explicitly; nothing here chooses for them, and the server re-validates.
 */
import { checkAccessNode, footNodeSet } from '../../community/index.ts';
import { APP_CONFIG } from '../../config/index.ts';
import type { GraphFile, LngLat } from '../../data/index.ts';
import { isValidLngLat } from '../../distance/index.ts';
import { createGridIndex, type GridIndex } from '../../distance/index.ts';

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

const indexCache = new WeakMap<object, GridIndex<number>>();

/** The shared grid index (src/distance) over the walkable nodes, built once per graph. */
function footIndex(graph: Pick<GraphFile, 'nodes' | 'edges'>): GridIndex<number> {
  let index = indexCache.get(graph);
  if (!index) {
    index = createGridIndex([...footNodes(graph)], (id) => graph.nodes[id] ?? null);
    indexCache.set(graph, index);
  }
  return index;
}

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
  const out: AccessCandidate[] = [];
  // The index narrows the search (with 1 m to spare); the server's exact check decides.
  for (const { item: nodeId } of footIndex(graph).within(location, maxM + 1)) {
    const p = graph.nodes[nodeId]!;
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
