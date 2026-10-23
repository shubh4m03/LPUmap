/**
 * Building footprints (closed ways + building multipolygons) with heights,
 * and the v2 buildings.geojson features.
 *
 * Every building-tagged element of the raw snapshot becomes a record, wherever
 * it lies and whatever its geometry: campus membership is decided later by
 * src/geo/boundary.ts (scripts/lib/membership.ts). An invalid polygon is kept
 * with its problems (rule R1 makes it 'uncertain'), never silently dropped.
 * Only elements with no usable geometry at all (open ways, missing nodes,
 * unassembled relations) are "skipped", and each is listed in the report.
 */
import type { BuildingProps, BuildingsFile, LngLat, Place } from '../../src/data/schema.ts';
import { geometryProblems, pointOnSurface, polygonAreaM2, vertexMeanAnchor } from '../../src/geo/boundary.ts';
import type { MembershipResult, PolygonalGeometry } from '../../src/geo/boundary.ts';
import { classifyTags, isBuildingTagged } from './classify.ts';
import { bboxOfCoords, multiPolygonCoords, round, roundCoord } from './geometry.ts';
import type { BBox, MultiPolygon } from './geometry.ts';
import { computeHeight, fidelityOf, unnamedBuildingLabel } from './height.ts';
import type { HeightInfo } from './height.ts';
import { isClosedWay, relationGeometry, wayPolygon } from './osm-geometry.ts';
import { sortedValues } from './osm-parse.ts';
import type { OsmData, Tags } from './osm-parse.ts';
import { nameFromTags } from './place-fields.ts';

export interface BuildingRecord {
  id: string;
  /** 'way/123' or 'relation/123'. */
  ref: string;
  osmType: 'way' | 'relation';
  osmId: number;
  tags: Tags;
  multiPolygon: MultiPolygon;
  /** The same footprint as a GeoJSON geometry (for src/geo). */
  geometry: PolygonalGeometry;
  bbox: BBox;
  /** OSM node ids on the outline (entrance attachment). */
  outlineNodeIds: Set<number>;
  /** Anchor: point-on-surface (valid geometry) or mean of distinct vertices (invalid), 7 dp. */
  location: LngLat;
  height: HeightInfo;
  name: string | null;
  displayName: string;
  categoryId: string;
  /** Footprint area in m²; null when the geometry is invalid. */
  areaM2: number | null;
  /** src/geo geometryProblems (empty = valid). */
  problems: string[];
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

export function toGeometry(mp: MultiPolygon): PolygonalGeometry {
  return mp.length === 1
    ? { type: 'Polygon', coordinates: mp[0]! }
    : { type: 'MultiPolygon', coordinates: mp };
}

export function collectBuildings(osm: OsmData): BuildingsResult {
  const buildings: BuildingRecord[] = [];
  const skipped: SkippedFeature[] = [];
  const minHeightIgnored: string[] = [];

  const add = (
    osmType: 'way' | 'relation',
    osmId: number,
    tags: Tags,
    mp: MultiPolygon,
    outline: Set<number>,
  ) => {
    const ref = `${osmType}/${osmId}`;
    const geometry = toGeometry(mp);
    const problems = geometryProblems(geometry);
    const anchor = problems.length === 0 ? pointOnSurface(geometry) : vertexMeanAnchor(geometry);
    if (!anchor) {
      skipped.push({ ref, reason: 'no valid coordinate to anchor the footprint' });
      return;
    }
    const height = computeHeight(tags);
    if (height.minHeightIgnored) minHeightIgnored.push(ref);
    const name = nameFromTags(tags);
    buildings.push({
      id: `osm:${ref}`,
      ref,
      osmType,
      osmId,
      tags,
      multiPolygon: mp,
      geometry,
      bbox: bboxOfCoords(multiPolygonCoords(mp))!,
      outlineNodeIds: outline,
      location: roundCoord(anchor),
      height,
      name,
      displayName: name ?? unnamedBuildingLabel(height.levels),
      categoryId: classifyTags(tags) ?? 'building',
      areaM2: problems.length === 0 ? polygonAreaM2(geometry) : null,
      problems,
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
    add('way', way.id, way.tags, [poly], new Set(way.nodes));
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
    add('relation', rel.id, rel.tags, geom.multiPolygon, geom.outlineNodeIds);
  }
  return { buildings, skipped, minHeightIgnored };
}

const tagText = (tags: Tags, key: string): string | null => {
  const v = tags[key]?.trim();
  return v ? v : null;
};
const tagNumber = (tags: Tags, key: string): number | null => {
  const raw = tags[key]?.trim();
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
};

export interface BuildingFeatureInput {
  record: BuildingRecord;
  membership: MembershipResult;
  /** The final (curated) place, which supplies name, displayName, categoryId and provenance. */
  place: Pick<Place, 'name' | 'displayName' | 'categoryId' | 'provenance'> | undefined;
  retrievedAt: string;
  directoryKey: string | null;
  directoryCell: string | null;
}

/** BuildingPropsV2 for one footprint (docs/MODULE_CONTRACTS.md "v2 geographic contract"). */
export function buildingProps(i: BuildingFeatureInput): BuildingProps {
  const { record: b, membership: m, place: p } = i;
  const t = b.tags;
  const fidelity = fidelityOf(b.height);
  const part = t['building:part'];
  return {
    id: b.id,
    name: p ? p.name : b.name,
    displayName: p ? p.displayName : b.displayName,
    categoryId: p ? p.categoryId : b.categoryId,
    geometrySource: 'osm',
    sourceId: 'osm',
    sourceRef: b.ref,
    retrievedAt: i.retrievedAt,
    verificationStatus: p?.provenance.verificationStatus ?? 'imported',
    lastVerifiedAt: p?.provenance.lastVerifiedAt ?? null,
    campusStatus: m.status,
    inCampusInventory: m.inCampusInventory,
    insideFraction: m.insideFraction,
    distanceToBoundaryM: m.distanceToBoundaryM,
    membershipMethod: m.method,
    membershipReasonCode: m.reasonCode,
    membershipReason: m.reason,
    membershipDecision: m.decision,
    membershipDecisionSource: m.decisionSource,
    reviewSectionId: m.reviewSectionId,
    pointAreaDisagreement: m.pointAreaDisagreement,
    areaM2: b.areaM2 === null ? null : round(b.areaM2, 2),
    anchorLon: b.location[0],
    anchorLat: b.location[1],
    isBuildingPart: part !== undefined && part !== '' && part !== 'no',
    levels: b.height.levels,
    levelsSource: b.height.levels === null ? null : 'osm-building-levels',
    minLevel: b.height.minLevel,
    osmHeightM: b.height.osmHeightM,
    osmMinHeightM: b.height.osmMinHeightM,
    roofShape: tagText(t, 'roof:shape'),
    roofMaterial: tagText(t, 'roof:material'),
    roofColour: tagText(t, 'roof:colour'),
    roofLevels: tagNumber(t, 'roof:levels'),
    buildingMaterial: tagText(t, 'building:material'),
    buildingColour: tagText(t, 'building:colour'),
    fidelityLevel: fidelity.level,
    fidelityReason: fidelity.reason,
    directoryKey: i.directoryKey,
    directoryCell: i.directoryCell,
    officialBlockLabel: null,
    officialBlockSourceId: null,
    renderHeightM: b.height.heightM,
    renderMinHeightM: b.height.minHeightM,
    renderHeightSource: b.height.heightSource,
  };
}

/** buildings.geojson: the campus inventory only (owner decisions 2 and 3), sorted by id. */
export function buildingsFeatureCollection(inputs: readonly BuildingFeatureInput[]): BuildingsFile {
  return {
    type: 'FeatureCollection',
    features: [...inputs]
      .sort((a, b) => (a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0))
      .map((i) => ({
        type: 'Feature',
        geometry: i.record.geometry as BuildingsFile['features'][number]['geometry'],
        properties: buildingProps(i),
      })),
  };
}
