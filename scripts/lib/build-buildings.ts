/** Building footprints (closed ways + building multipolygons) with heights. */
import type { BuildingsFile, CampusZone, LngLat, Place } from '../../src/data/schema.ts';
import { classifyTags, isBuildingTagged } from './classify.ts';
import {
  bboxOfCoords,
  inBBox,
  multiPolygonCoords,
  multiPolygonPointOnSurface,
  polygonAreaM2,
  ringProblems,
  roundCoord,
} from './geometry.ts';
import type { BBox, MultiPolygon } from './geometry.ts';
import { computeHeight, unnamedBuildingLabel } from './height.ts';
import type { HeightInfo } from './height.ts';
import { isClosedWay, relationGeometry, wayPolygon } from './osm-geometry.ts';
import { sortedValues } from './osm-parse.ts';
import type { OsmData, Tags } from './osm-parse.ts';
import { nameFromTags } from './place-fields.ts';

export interface BuildingRecord {
  id: string;
  ref: string;
  tags: Tags;
  multiPolygon: MultiPolygon;
  bbox: BBox;
  /** OSM node ids on the outline (entrance attachment). */
  outlineNodeIds: Set<number>;
  location: LngLat;
  height: HeightInfo;
  name: string | null;
  displayName: string;
  categoryId: string;
  campusZone: CampusZone;
  areaM2: number;
}

export interface SkippedFeature {
  ref: string;
  reason: string;
}

export interface BuildingsResult {
  buildings: BuildingRecord[];
  skipped: SkippedFeature[];
  minHeightIgnored: string[];
}

export function collectBuildings(
  osm: OsmData,
  ctx: { maxBounds: readonly [number, number, number, number]; insideCampus: (p: LngLat) => boolean },
): BuildingsResult {
  const buildings: BuildingRecord[] = [];
  const skipped: SkippedFeature[] = [];
  const minHeightIgnored: string[] = [];

  const add = (ref: string, tags: Tags, mp: MultiPolygon, outline: Set<number>) => {
    for (const poly of mp) {
      for (const ring of poly) {
        const problems = ringProblems(ring);
        if (problems.length > 0) {
          skipped.push({ ref, reason: `invalid geometry: ${problems.join(', ')}` });
          return;
        }
      }
    }
    const surface = multiPolygonPointOnSurface(mp);
    if (!surface) {
      skipped.push({ ref, reason: 'no representative point' });
      return;
    }
    const location = roundCoord(surface);
    if (!inBBox(location, ctx.maxBounds)) return; // outside the app's map extent: silently out of scope
    const height = computeHeight(tags);
    if (height.minHeightIgnored) minHeightIgnored.push(ref);
    const name = nameFromTags(tags);
    buildings.push({
      id: `osm:${ref}`,
      ref,
      tags,
      multiPolygon: mp,
      bbox: bboxOfCoords(multiPolygonCoords(mp))!,
      outlineNodeIds: outline,
      location,
      height,
      name,
      displayName: name ?? unnamedBuildingLabel(height.levels),
      categoryId: classifyTags(tags) ?? 'building',
      campusZone: ctx.insideCampus(location) ? 'on-campus' : 'off-campus-nearby',
      areaM2: mp.reduce((s, p) => s + polygonAreaM2(p), 0),
    });
  };

  for (const way of sortedValues(osm.ways)) {
    if (!isBuildingTagged(way.tags)) continue;
    const ref = `way/${way.id}`;
    if (!isClosedWay(way)) {
      skipped.push({ ref, reason: 'building way is not closed' });
      continue;
    }
    const poly = wayPolygon(osm, way);
    if (!poly) {
      skipped.push({ ref, reason: 'building way references nodes missing from the snapshot' });
      continue;
    }
    add(ref, way.tags, [poly], new Set(way.nodes));
  }
  for (const rel of sortedValues(osm.relations)) {
    if (rel.tags.type !== 'multipolygon' || !isBuildingTagged(rel.tags)) continue;
    const ref = `relation/${rel.id}`;
    const geom = relationGeometry(osm, rel);
    if (geom.multiPolygon.length === 0 || geom.missingWays > 0 || geom.unclosedRings > 0) {
      skipped.push({
        ref,
        reason: `multipolygon not assembled (${geom.missingWays} missing ways, ${geom.unclosedRings} unclosed rings)`,
      });
      continue;
    }
    add(ref, rel.tags, geom.multiPolygon, geom.outlineNodeIds);
  }
  return { buildings, skipped, minHeightIgnored };
}

/**
 * Footprint features. `places` (the final, curated places) supplies name, displayName and
 * categoryId so a curated override shows the same label on the map as in search.
 */
export function buildingsFeatureCollection(
  buildings: readonly BuildingRecord[],
  places: ReadonlyMap<string, Pick<Place, 'name' | 'displayName' | 'categoryId'>> = new Map(),
): BuildingsFile {
  return {
    type: 'FeatureCollection',
    features: buildings.map((b) => {
      const p = places.get(b.id);
      return {
        type: 'Feature',
        geometry:
          b.multiPolygon.length === 1
            ? { type: 'Polygon', coordinates: b.multiPolygon[0] }
            : { type: 'MultiPolygon', coordinates: b.multiPolygon },
        properties: {
          id: b.id,
          name: p ? p.name : b.name,
          displayName: p ? p.displayName : b.displayName,
          levels: b.height.levels,
          heightM: b.height.heightM,
          minHeightM: b.height.minHeightM,
          heightSource: b.height.heightSource,
          categoryId: p ? p.categoryId : b.categoryId,
          campusZone: b.campusZone,
        },
      };
    }),
  };
}
