/** Resolves OSM ways and multipolygon relations into coordinates. */
import type { LngLat } from '../../src/data/schema.ts';
import { assembleRings, dedupeConsecutive, pointInRing, roundCoord, withWinding } from './geometry.ts';
import type { MultiPolygon, Polygon, Ring } from './geometry.ts';
import type { OsmData, OsmRelation, OsmWay } from './osm-parse.ts';

export function nodeCoord(osm: OsmData, id: number): LngLat | null {
  const n = osm.nodes.get(id);
  return n ? roundCoord([n.lon, n.lat]) : null;
}

/** Rounded coordinates of a way, or null if any referenced node is missing. */
export function wayCoords(osm: OsmData, way: OsmWay): LngLat[] | null {
  const out: LngLat[] = [];
  for (const id of way.nodes) {
    const c = nodeCoord(osm, id);
    if (!c) return null;
    out.push(c);
  }
  return out;
}

export function isClosedWay(way: OsmWay): boolean {
  return way.nodes.length >= 4 && way.nodes[0] === way.nodes[way.nodes.length - 1];
}

function idsToRing(osm: OsmData, ids: readonly number[]): Ring | null {
  const coords: LngLat[] = [];
  for (const id of ids) {
    const c = nodeCoord(osm, id);
    if (!c) return null;
    coords.push(c);
  }
  const ring = dedupeConsecutive(coords);
  return ring.length >= 4 ? ring : null;
}

/** Closed way → single-ring polygon (outer CCW), or null. */
export function wayPolygon(osm: OsmData, way: OsmWay): Polygon | null {
  if (!isClosedWay(way)) return null;
  const ring = idsToRing(osm, way.nodes);
  return ring ? [withWinding(ring, true)] : null;
}

export interface RelationGeometry {
  multiPolygon: MultiPolygon;
  /** Outer node-id rings, used to test whether a node lies on the outline. */
  outlineNodeIds: Set<number>;
  missingWays: number;
  unclosedRings: number;
}

/** Assembles a multipolygon relation. Rings that cannot be closed are dropped and counted. */
export function relationGeometry(osm: OsmData, rel: OsmRelation): RelationGeometry {
  const outerSeqs: number[][] = [];
  const innerSeqs: number[][] = [];
  let missingWays = 0;
  for (const m of rel.members) {
    if (m.type !== 'way') continue;
    const way = osm.ways.get(m.ref);
    if (!way) {
      missingWays++;
      continue;
    }
    (m.role === 'inner' ? innerSeqs : outerSeqs).push(way.nodes);
  }
  const outer = assembleRings(outerSeqs);
  const inner = assembleRings(innerSeqs);
  const outlineNodeIds = new Set<number>();
  const polygons: Polygon[] = [];
  let unclosedRings = outer.unclosed.length + inner.unclosed.length;
  for (const ids of outer.rings) {
    const ring = idsToRing(osm, ids);
    if (!ring) {
      unclosedRings++;
      continue;
    }
    ids.forEach((id) => outlineNodeIds.add(id));
    polygons.push([withWinding(ring, true)]);
  }
  for (const ids of inner.rings) {
    const ring = idsToRing(osm, ids);
    if (!ring) {
      unclosedRings++;
      continue;
    }
    ids.forEach((id) => outlineNodeIds.add(id));
    const host = polygons.find((p) => p[0] && pointInRing(ring[0]!, p[0]));
    if (host) host.push(withWinding(ring, false));
  }
  return { multiPolygon: polygons, outlineNodeIds, missingWays, unclosedRings };
}

export function osmRef(type: 'node' | 'way' | 'relation', id: number): string {
  return `${type}/${id}`;
}

export function placeIdFor(type: 'node' | 'way' | 'relation', id: number): string {
  return `osm:${type}/${id}`;
}
