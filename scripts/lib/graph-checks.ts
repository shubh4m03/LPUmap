/**
 * Routing-graph checks against the campus boundary and building footprints.
 * Nothing here edits the graph: real, legal public OSM edges are kept and only
 * tagged (`campus`) or reported.
 *
 *  - campus flag: the edge midpoint lies inside the boundary.
 *  - boundary-crossing edges: one end inside, one outside (the only graph links
 *    between campus and town; whether they are open gates is unverified).
 *  - edges through building interiors: more than 0.5 m of the edge inside a
 *    footprint polygon (the segment is split at every crossing with the
 *    outline and each piece's midpoint is tested). Each is classified by the
 *    grade-separation evidence in OSM tags; edges with no such tag on either
 *    the way or the building are flagged for OSM review.
 */
import type { GraphFile, LngLat } from '../../src/data/schema.ts';
import { createLocalProjection, haversineM } from '../../src/distance/geodesic.ts';
import type { BuildingRecord } from './build-buildings.ts';
import { pointInMultiPolygon, round } from './geometry.ts';
import type { OsmData, Tags } from './osm-parse.ts';

/** Inside length above which an edge "runs through" a building (audit method). */
export const THROUGH_BUILDING_MIN_M = 0.5;

const WAY_GRADE_KEYS = ['layer', 'tunnel', 'bridge', 'covered', 'level', 'indoor', 'location'];
const BUILDING_GRADE_KEYS = ['layer', 'building:min_level', 'min_height', 'location', 'covered'];

export function setEdgeCampusFlags(graph: GraphFile, inside: (p: LngLat) => boolean): void {
  for (const e of graph.edges) {
    const a = graph.nodes[e.from]!;
    const b = graph.nodes[e.to]!;
    e.campus = inside([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
}

export interface BoundaryCrossingEdge {
  edgeId: number;
  osmWayId: number | null;
  highway: string;
  insideNode: LngLat;
  outsideNode: LngLat;
}

export function boundaryCrossingEdges(
  graph: GraphFile,
  inside: (p: LngLat) => boolean,
): BoundaryCrossingEdge[] {
  const nodeIn = graph.nodes.map((n) => inside(n));
  const out: BoundaryCrossingEdge[] = [];
  for (const e of graph.edges) {
    if (nodeIn[e.from] === nodeIn[e.to]) continue;
    const [i, o] = nodeIn[e.from] ? [e.from, e.to] : [e.to, e.from];
    out.push({
      edgeId: e.id,
      osmWayId: e.osmWayId,
      highway: e.highway,
      insideNode: graph.nodes[i]!,
      outsideNode: graph.nodes[o]!,
    });
  }
  return out;
}

/** Length (m) of segment ab inside the (multi)polygon. */
export function lengthInsideM(a: LngLat, b: LngLat, mp: BuildingRecord['multiPolygon']): number {
  const proj = createLocalProjection(a);
  const A = proj.toXY(a);
  const B = proj.toXY(b);
  const ts = [0, 1];
  for (const poly of mp)
    for (const ring of poly)
      for (let i = 0; i + 1 < ring.length; i++) {
        const C = proj.toXY(ring[i]!);
        const D = proj.toXY(ring[i + 1]!);
        const rx = B[0] - A[0];
        const ry = B[1] - A[1];
        const sx = D[0] - C[0];
        const sy = D[1] - C[1];
        const den = rx * sy - ry * sx;
        if (Math.abs(den) < 1e-12) continue;
        const qx = C[0] - A[0];
        const qy = C[1] - A[1];
        const t = (qx * sy - qy * sx) / den;
        const u = (qx * ry - qy * rx) / den;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
      }
  ts.sort((x, y) => x - y);
  let inside = 0;
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i]!;
    const t1 = ts[i + 1]!;
    if (t1 - t0 < 1e-12) continue;
    const at = (t: number): LngLat => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    if (pointInMultiPolygon(at((t0 + t1) / 2), mp)) inside += haversineM(at(t0), at(t1));
  }
  return inside;
}

export type GradeEvidence = 'way-tagged' | 'building-tagged' | 'none';

export interface EdgeThroughBuilding {
  edgeId: number;
  osmWayId: number | null;
  highway: string;
  buildingId: string;
  insideM: number;
  edgeLengthM: number;
  gradeEvidence: GradeEvidence;
  /** The tags that provide grade-separation evidence ('layer=-1', 'covered=yes', …). */
  evidenceTags: string[];
  /** true when neither the way nor the building carries a grade-separation tag. */
  needsOsmReview: boolean;
}

const pick = (tags: Tags | undefined, keys: readonly string[]) =>
  keys
    .filter((k) => tags?.[k] !== undefined && tags[k] !== '' && tags[k] !== 'no')
    .map((k) => `${k}=${tags![k]}`);

export function edgesThroughBuildings(
  graph: GraphFile,
  buildings: readonly BuildingRecord[],
  osm: OsmData,
): EdgeThroughBuilding[] {
  const valid = buildings.filter((b) => b.problems.length === 0);
  const out: EdgeThroughBuilding[] = [];
  for (const e of graph.edges) {
    const a = graph.nodes[e.from]!;
    const b = graph.nodes[e.to]!;
    const w = Math.min(a[0], b[0]);
    const s = Math.min(a[1], b[1]);
    const east = Math.max(a[0], b[0]);
    const n = Math.max(a[1], b[1]);
    for (const bl of valid) {
      if (bl.bbox[0] > east || bl.bbox[2] < w || bl.bbox[1] > n || bl.bbox[3] < s) continue;
      const insideM = lengthInsideM(a, b, bl.multiPolygon);
      if (insideM <= THROUGH_BUILDING_MIN_M) continue;
      const wayTags = e.osmWayId !== null ? osm.ways.get(e.osmWayId)?.tags : undefined;
      const wayEv = pick(wayTags, WAY_GRADE_KEYS);
      const bEv = pick(bl.tags, BUILDING_GRADE_KEYS);
      const gradeEvidence: GradeEvidence =
        wayEv.length > 0 ? 'way-tagged' : bEv.length > 0 ? 'building-tagged' : 'none';
      out.push({
        edgeId: e.id,
        osmWayId: e.osmWayId,
        highway: e.highway,
        buildingId: bl.id,
        insideM: round(insideM, 1),
        edgeLengthM: e.lengthM,
        gradeEvidence,
        evidenceTags: [...wayEv.map((t) => `way ${t}`), ...bEv.map((t) => `building ${t}`)],
        needsOsmReview: gradeEvidence === 'none',
      });
    }
  }
  return out.sort((x, y) => x.edgeId - y.edgeId || x.buildingId.localeCompare(y.buildingId));
}
