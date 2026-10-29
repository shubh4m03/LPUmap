/**
 * `connected_by_path` relations (G-29), produced ONLY from explicit evidence:
 * curated records in data/curated/path-connections.json that cite the OSM way
 * joining two places (for example a covered walkway). Nothing here looks at
 * graph connectivity or distance to *find* connections; the graph is used only
 * to check that a cited way is real, walkable, on campus and reaches both
 * places. Today the file holds no records, so the dataset has none.
 */
import type { GraphFile, LngLat, Relation } from '../../src/data/schema.ts';
import type { PlaceRecord } from './build-places.ts';
import { relationId } from './build-relations.ts';
import type { PathConnectionsFile } from './curated-schema.ts';
import {
  distanceToMultiPolygonM,
  pointInMultiPolygon,
  pointToSegmentM,
  segmentsIntersect,
} from './geometry.ts';
import type { MultiPolygon } from './geometry.ts';

export const PATH_CONNECTIONS_FILE = 'path-connections.json';

export interface PathConnectionContext {
  graph: GraphFile;
  /** A cited way must come this close to each place (APP_CONFIG.routing.maxPlaceConnectorM). */
  maxDistanceM: number;
}

type Segment = [LngLat, LngLat];

/** Shortest distance (m) between a place (footprint or point) and a path's segments. */
export function placeToPathM(rec: PlaceRecord, segments: readonly Segment[]): number {
  const { place } = rec;
  const outline: MultiPolygon | undefined =
    place.kind === 'building' || rec.geometry === 'area' ? rec.multiPolygon : undefined;
  let best = Infinity;
  if (!outline) {
    for (const [a, b] of segments) best = Math.min(best, pointToSegmentM(place.location!, a, b));
    return best;
  }
  for (const [a, b] of segments) {
    if (pointInMultiPolygon(a, outline) || pointInMultiPolygon(b, outline)) return 0;
    best = Math.min(best, distanceToMultiPolygonM(a, outline), distanceToMultiPolygonM(b, outline));
    for (const poly of outline)
      for (const ring of poly)
        for (let i = 0; i + 1 < ring.length; i++) {
          if (segmentsIntersect(a, b, ring[i]!, ring[i + 1]!)) return 0;
          best = Math.min(best, pointToSegmentM(ring[i]!, a, b));
        }
  }
  return best;
}

/**
 * Turns curated path connections into relations, or reports why an entry is
 * unusable. `registerSource` returns the manifest source id for the citation
 * (and records a problem itself when its licence terms are unknown).
 */
export function buildPathConnections(
  file: PathConnectionsFile,
  byId: ReadonlyMap<string, PlaceRecord>,
  ctx: PathConnectionContext,
  registerSource: (src: PathConnectionsFile['connections'][number]['source'], where: string) => string,
  problems: string[],
): Relation[] {
  const relations: Relation[] = [];
  const pairs = new Set<string>();
  const waySegments = new Map<number, { segments: Segment[]; foot: boolean; offCampus: boolean }>();
  for (const e of ctx.graph.edges) {
    if (e.source !== 'osm' || e.osmWayId === null) continue;
    const w = waySegments.get(e.osmWayId) ?? { segments: [], foot: false, offCampus: false };
    w.segments.push([ctx.graph.nodes[e.from]!, ctx.graph.nodes[e.to]!]);
    w.foot ||= e.foot;
    w.offCampus ||= e.campus === false;
    waySegments.set(e.osmWayId, w);
  }

  for (const [i, c] of file.connections.entries()) {
    const where = `path-connections.json connections[${i}] (${c.from} ↔ ${c.to})`;
    const before = problems.length;
    if (c.from === c.to) problems.push(`${where}: connects a place to itself`);
    const pair = [c.from, c.to].sort().join('|');
    if (pairs.has(pair)) problems.push(`${where}: duplicate connection between the same two places`);
    pairs.add(pair);
    const ends: PlaceRecord[] = [];
    for (const id of [c.from, c.to]) {
      const rec = byId.get(id);
      if (!rec) problems.push(`${where}: place ${id} does not exist`);
      else if (!rec.place.location || rec.place.kind === 'organization')
        problems.push(`${where}: place ${id} has no mapped position of its own`);
      else if (rec.place.campusZone !== 'on-campus')
        problems.push(`${where}: place ${id} is off campus (off-campus places are never connected)`);
      else ends.push(rec);
    }
    const way = waySegments.get(c.pathOsmWayId);
    if (!way) problems.push(`${where}: way ${c.pathOsmWayId} is not a path in the routing graph`);
    else if (!way.foot) problems.push(`${where}: way ${c.pathOsmWayId} is not walkable in the routing graph`);
    else if (way.offCampus) problems.push(`${where}: way ${c.pathOsmWayId} leaves the campus boundary`);
    else
      for (const rec of ends) {
        const d = placeToPathM(rec, way.segments);
        if (d > ctx.maxDistanceM)
          problems.push(
            `${where}: way ${c.pathOsmWayId} passes ${Math.round(d)} m from ${rec.place.id} ` +
              `(more than ${ctx.maxDistanceM} m), so it does not join it`,
          );
      }
    const sourceId = registerSource(c.source, where);
    if (problems.length > before) continue;
    relations.push({
      id: relationId('connected_by_path', c.from, c.to),
      type: 'connected_by_path',
      from: c.from,
      to: c.to,
      inferred: false,
      method: 'curated',
      pathOsmWayId: c.pathOsmWayId,
      provenance: {
        sourceId,
        sourceRef: c.source.url,
        retrievedAt: c.source.retrievedAt,
        verificationStatus: c.evidence === 'osm-tagging' ? 'imported' : 'verified',
        notes: `Joined by OSM way ${c.pathOsmWayId} (${c.evidence}): ${c.note}`,
      },
    });
  }
  return relations;
}
