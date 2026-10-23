/**
 * Small geometry helpers shared by the merge service (browser) and the
 * server: campus-boundary containment and access-node validation. Pure; no
 * DOM/Node APIs. Distances come only from src/distance.
 */
import { APP_CONFIG } from '../config/index.ts';
import type { BoundaryFile, CampusZone, GraphFile, LngLat } from '../data/schema.ts';
import { haversineM, isValidLngLat } from '../distance/geodesic.ts';

/** A polygon as rings (first = outer, rest = holes). */
export type PolygonRings = LngLat[][];

/** Even–odd ray casting. Points exactly on an edge may fall either way. */
export function pointInRing(p: LngLat, ring: readonly LngLat[]): boolean {
  let inside = false;
  const [x, y] = p;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function pointInPolygons(p: LngLat, polygons: readonly PolygonRings[]): boolean {
  return polygons.some(([outer, ...holes]) => !!outer && pointInRing(p, outer) && !holes.some((h) => pointInRing(p, h)));
}

const isRing = (r: unknown): r is LngLat[] => Array.isArray(r) && r.length >= 4 && r.every(isValidLngLat);
const isPolygon = (p: unknown): p is PolygonRings => Array.isArray(p) && p.length > 0 && p.every(isRing);

/** Polygons of every Polygon/MultiPolygon feature in the boundary file; other geometry is ignored. */
export function boundaryPolygons(boundary: BoundaryFile): PolygonRings[] {
  const out: PolygonRings[] = [];
  for (const f of boundary.features) {
    const c = f.geometry.coordinates;
    if (f.geometry.type === 'Polygon' && isPolygon(c)) out.push(c);
    else if (f.geometry.type === 'MultiPolygon' && Array.isArray(c)) {
      for (const poly of c) if (isPolygon(poly)) out.push(poly);
    }
  }
  return out;
}

export function campusZoneFor(p: LngLat, polygons: readonly PolygonRings[]): CampusZone {
  return pointInPolygons(p, polygons) ? 'on-campus' : 'off-campus-nearby';
}

/** Inside APP_CONFIG.map.maxBounds — the area where suggestions/locations may be placed. */
export function insideContributionArea(p: LngLat): boolean {
  const [w, s, e, n] = APP_CONFIG.map.maxBounds;
  return isValidLngLat(p) && p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n;
}

/** Nodes incident to at least one walkable (`foot: true`) edge. */
export function footNodeSet(graph: Pick<GraphFile, 'edges'>): Set<number> {
  const s = new Set<number>();
  for (const e of graph.edges) {
    if (!e.foot) continue;
    s.add(e.from);
    s.add(e.to);
  }
  return s;
}

export type AccessNodeCheck =
  | { ok: true; nodeId: number; distanceM: number }
  | { ok: false; reason: 'missing-node' | 'not-walkable' | 'too-far'; message: string };

/**
 * An access node is accepted only when it exists, touches a walkable edge and
 * lies within APP_CONFIG.routing.maxPlaceConnectorM of the location. Nothing
 * is ever snapped: a failing node is reported, never replaced.
 */
export function checkAccessNode(
  nodes: readonly LngLat[],
  footNodes: ReadonlySet<number>,
  nodeId: number,
  location: LngLat,
  maxM: number = APP_CONFIG.routing.maxPlaceConnectorM,
): AccessNodeCheck {
  const node = Number.isInteger(nodeId) && nodeId >= 0 ? nodes[nodeId] : undefined;
  if (!node || !isValidLngLat(node)) {
    return { ok: false, reason: 'missing-node', message: `Path node ${nodeId} does not exist in the routing graph.` };
  }
  if (!footNodes.has(nodeId)) {
    return {
      ok: false,
      reason: 'not-walkable',
      message: `Path node ${nodeId} is not on any walkable path, so it cannot be an access point.`,
    };
  }
  const distanceM = haversineM(location, node);
  if (!(distanceM <= maxM)) {
    return {
      ok: false,
      reason: 'too-far',
      message: `Path node ${nodeId} is ${Math.round(distanceM)} m from the location; an access point must be within ${maxM} m.`,
    };
  }
  return { ok: true, nodeId, distanceM: Math.round(distanceM * 100) / 100 };
}
