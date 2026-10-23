/** Campus boundary from the OSM multipolygon relation. Never guessed. */
import type { BoundaryFile } from '../../src/data/schema.ts';
import { bboxOfCoords, multiPolygonCoords, pointInMultiPolygon, ringProblems } from './geometry.ts';
import type { BBox, MultiPolygon } from './geometry.ts';
import { relationGeometry } from './osm-geometry.ts';
import type { OsmData, OsmRelation } from './osm-parse.ts';
import type { LngLat } from '../../src/data/schema.ts';

export const CAMPUS_RELATION_ID = 21599790;

export class BuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildError';
  }
}

export interface CampusBoundary {
  relation: OsmRelation;
  name: string;
  multiPolygon: MultiPolygon;
  bbox: BBox;
  contains(p: LngLat): boolean;
}

export function buildBoundary(osm: OsmData, relationId: number = CAMPUS_RELATION_ID): CampusBoundary {
  const relation = osm.relations.get(relationId);
  if (!relation) {
    throw new BuildError(
      `Campus boundary relation ${relationId} is missing from the raw snapshot. Run "npm run data:fetch -- --force" ` +
        'to download it; the pipeline never substitutes a guessed rectangle.',
    );
  }
  const geom = relationGeometry(osm, relation);
  if (geom.multiPolygon.length === 0 || geom.missingWays > 0 || geom.unclosedRings > 0) {
    throw new BuildError(
      `Campus boundary relation ${relationId} could not be assembled ` +
        `(${geom.multiPolygon.length} closed outer rings, ${geom.missingWays} missing member ways, ` +
        `${geom.unclosedRings} unclosed rings). Refresh the raw snapshot.`,
    );
  }
  for (const poly of geom.multiPolygon) {
    for (const ring of poly) {
      const problems = ringProblems(ring);
      if (problems.length > 0) {
        throw new BuildError(
          `Campus boundary relation ${relationId} has an invalid ring: ${problems.join(', ')}`,
        );
      }
    }
  }
  const bbox = bboxOfCoords(multiPolygonCoords(geom.multiPolygon))!;
  const mp = geom.multiPolygon;
  return {
    relation,
    name: relation.tags.name?.trim() || `OSM relation ${relationId}`,
    multiPolygon: mp,
    bbox,
    contains: (p) => pointInMultiPolygon(p, mp),
  };
}

export function boundaryFeatureCollection(b: CampusBoundary): BoundaryFile {
  const geometry =
    b.multiPolygon.length === 1
      ? { type: 'Polygon', coordinates: b.multiPolygon[0] }
      : { type: 'MultiPolygon', coordinates: b.multiPolygon };
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry,
        properties: {
          id: `osm:relation/${b.relation.id}`,
          name: b.name,
          sourceRef: `relation/${b.relation.id}`,
        },
      },
    ],
  };
}
