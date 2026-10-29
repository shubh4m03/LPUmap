/**
 * Data-quality report: what is missing, sparse, unverified, unroutable, held
 * for review or excluded — every figure derived from the processed data.
 * Rendered as docs/DATA_QUALITY_REPORT.md and docs/CAMPUS_BUILDING_COVERAGE.md.
 */
import { getCategory } from '../../src/config/categories.ts';
import type {
  BoundaryReviewItem,
  BoundaryReviewSection,
  CampusStatus,
  CuratedMembershipDecision,
  Place,
} from '../../src/data/schema.ts';
import type { MembershipThresholds } from '../../src/geo/boundary.ts';
import type { BuildingRecord, SkippedFeature } from './build-buildings.ts';
import type { GraphBuildResult, GraphStats } from './build-graph.ts';
import type { DetectionsSummary } from './detections.ts';
import type { BoundaryCrossingEdge, EdgeThroughBuilding } from './graph-checks.ts';
import type { BuildingFlag, ClassifiedBuilding, DuplicateResolution, FootprintPair } from './membership.ts';

/** Categories whose absence matters to students; reported as empty/sparse. */
export const IMPORTANT_CATEGORIES = [
  'water',
  'washroom',
  'health',
  'finance',
  'printing',
  'library',
  'gate',
  'hostel',
];
export const SPARSE_THRESHOLD = 3;
/** Outside footprints closer than this to the boundary are listed as "near-boundary exclusions". */
export const NEAR_BOUNDARY_M = 10;
export const OUTSIDE_DISTANCE_BANDS = [10, 50, 150, 400] as const;

interface PlaceRef {
  id: string;
  displayName: string;
}

export interface MembershipRow {
  id: string;
  displayName: string;
  categoryId: string;
  status: CampusStatus;
  insideFraction: number | null;
  areaM2: number | null;
  insideAreaM2: number | null;
  distanceToBoundaryM: number | null;
  reasonCode: string;
  reason: string;
  reviewSectionId: string | null;
  pointAreaDisagreement: boolean;
}

export interface OutsideRow extends MembershipRow {
  /** true when the footprint became a point-only context place (named or use-tagged). */
  contextPlace: boolean;
}

export interface CoverageCell {
  cell: string;
  inventoryBuildings: number;
  inventoryAreaM2: number;
  detections: number;
  detectionAreaM2: number;
}

export interface QualityReport {
  builtFrom: string;
  totals: {
    places: number;
    contextPlaces: number;
    buildings: number;
    relations: number;
    onCampusPlaces: number;
    offCampusPlaces: number;
    detections: number;
    boundaryReviewItems: number;
  };
  membership: {
    boundarySourceRef: string;
    boundaryAreaM2: number;
    thresholds: MembershipThresholds;
    footprintsInSnapshot: number;
    byStatus: Record<string, number>;
    byReason: Record<string, number>;
    inventory: { inside: number; crossing: number; duplicatesRemoved: number; total: number };
    insideAreaM2: number;
    crossing: MembershipRow[];
    uncertain: MembershipRow[];
    outside: OutsideRow[];
    outsideByDistance: Record<string, number>;
    nearBoundaryExclusions: string[];
    pointAreaDisagreements: string[];
    sections: Array<{ id: string; title: string; status: string; bufferM: number; affected: string[] }>;
    decisions: Array<CuratedMembershipDecision & { decidedBy: string | null; applied: boolean }>;
    placeReviewItems: BoundaryReviewItem[];
  };
  duplicatesResolved: DuplicateResolution[];
  overlaps: FootprintPair[];
  buildingFlags: BuildingFlag[];
  osmTaggingNeeded: Array<{ id: string; name: string | null; reason: string }>;
  unnamedBuildings: {
    total: number;
    onCampus: number;
    largestOnCampus: Array<PlaceRef & { areaM2: number }>;
  };
  placesWithoutLocation: PlaceRef[];
  placesNotConnectedToGraph: Array<PlaceRef & { campusZone: string }>;
  entrances: { total: number; attached: number; unattached: string[] };
  duplicates: { ids: string[]; locations: Array<{ location: [number, number]; ids: string[] }> };
  importantCategories: Array<{
    id: string;
    label: string;
    total: number;
    onCampus: number;
    /** Off-campus places of this category in the opt-in context layer (never counted as campus). */
    nearbyOutside: number;
    status: 'empty' | 'sparse' | 'ok';
  }>;
  verification: { byStatus: Record<string, number>; withoutLastVerifiedAt: number };
  graph: {
    nodes: number;
    edges: number;
    components: number;
    componentSizes: number[];
    largestComponentShare: number;
    footEdges: number;
    campusEdges: number;
    offCampusEdges: number;
    boundaryCrossingEdges: BoundaryCrossingEdge[];
    edgesThroughBuildings: EdgeThroughBuilding[];
    stats: GraphStats;
  };
  heightSources: Record<string, number>;
  fidelityLevels: Record<string, number>;
  skippedFeatures: SkippedFeature[];
  minHeightIgnored: string[];
  curated: {
    filesPresent: string[];
    aliases: number;
    overrides: number;
    organizations: number;
    anchoredOrganizations: number;
    /** Evidence-backed connected_by_path records (data/curated/path-connections.json). */
    pathConnections: number;
  };
  directory: {
    lockVersion: number | null;
    eligible: number;
    keyed: number;
    unkeyed: string[];
    unkeyable: string[];
    staleLockKeys: string[];
    cells: number;
  };
  detections: DetectionsSummary & { shippedAreaM2: number };
  basemap: { features: number; droppedOffCampusAreas: string[] };
  coverageGrid: CoverageCell[];
  notes: string[];
}

export interface QualityInputs {
  builtFrom: string;
  boundarySourceRef: string;
  boundaryAreaM2: number;
  thresholds: MembershipThresholds;
  places: readonly Place[];
  contextPlaces: readonly Place[];
  classified: readonly ClassifiedBuilding[];
  /** Inventory footprints actually shipped (after duplicate resolution). */
  inventory: readonly BuildingRecord[];
  /** Ids of outside footprints that became context places. */
  outsideAsContext: ReadonlySet<string>;
  relationCount: number;
  graph: GraphBuildResult;
  boundaryCrossing: BoundaryCrossingEdge[];
  edgesThroughBuildings: EdgeThroughBuilding[];
  attachedEntrances: readonly string[];
  unattachedEntrances: readonly string[];
  skipped: readonly SkippedFeature[];
  minHeightIgnored: readonly string[];
  curated: QualityReport['curated'];
  sections: readonly BoundaryReviewSection[];
  decisions: readonly CuratedMembershipDecision[];
  decidedBy: ReadonlyMap<string, string>;
  placeReviewItems: readonly BoundaryReviewItem[];
  duplicatesResolved: DuplicateResolution[];
  overlaps: FootprintPair[];
  buildingFlags: BuildingFlag[];
  osmTaggingNeeded: QualityReport['osmTaggingNeeded'];
  directory: QualityReport['directory'];
  detections: QualityReport['detections'];
  basemap: QualityReport['basemap'];
  coverageGrid: CoverageCell[];
  /** Final displayName per building id (curated overrides applied). */
  displayNames: ReadonlyMap<string, string>;
  fidelity: ReadonlyMap<string, number>;
}

const ref = (p: Place): PlaceRef => ({ id: p.id, displayName: p.displayName });
const count = <T>(items: readonly T[], key: (t: T) => string) =>
  items.reduce<Record<string, number>>((acc, t) => ((acc[key(t)] = (acc[key(t)] ?? 0) + 1), acc), {});
const sortedRecord = (r: Record<string, number>) =>
  Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)));
const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function membershipRow(c: ClassifiedBuilding, displayName: string): MembershipRow {
  const m = c.membership;
  return {
    id: c.record.id,
    displayName,
    categoryId: c.record.categoryId,
    status: m.status,
    insideFraction: m.insideFraction,
    areaM2: m.areaM2,
    insideAreaM2: m.insideAreaM2,
    distanceToBoundaryM: m.distanceToBoundaryM,
    reasonCode: m.reasonCode,
    reason: m.reason,
    reviewSectionId: m.reviewSectionId,
    pointAreaDisagreement: m.pointAreaDisagreement,
  };
}

function distanceBand(d: number | null): string {
  if (d === null) return 'unknown';
  let lo = 0;
  for (const hi of OUTSIDE_DISTANCE_BANDS) {
    if (d < hi) return `${lo}–${hi} m`;
    lo = hi;
  }
  return `≥ ${lo} m`;
}

export function buildQualityReport(q: QualityInputs): QualityReport {
  const { places } = q;
  const placesById = new Map(places.map((p) => [p.id, p]));
  const inventoryIds = new Set(q.inventory.map((b) => b.id));
  const nameOf = (c: ClassifiedBuilding) => q.displayNames.get(c.record.id) ?? c.record.displayName;
  const unnamed = q.inventory.filter((b) => (placesById.get(b.id)?.name ?? b.name) === null);

  const idCounts = count(places, (p) => p.id);
  const dupIds = Object.keys(idCounts)
    .filter((id) => idCounts[id]! > 1)
    .sort();
  const atLocation = new Map<string, string[]>();
  for (const p of places) {
    if (!p.location || p.kind === 'building' || p.kind === 'organization' || p.kind === 'area') continue;
    const key = `${p.location[0]},${p.location[1]}`;
    atLocation.set(key, [...(atLocation.get(key) ?? []), p.id]);
  }
  const dupLocations = [...atLocation.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([k, ids]) => ({ location: k.split(',').map(Number) as [number, number], ids: ids.sort() }))
    .sort((a, b) => a.ids[0]!.localeCompare(b.ids[0]!));

  const important = IMPORTANT_CATEGORIES.map((id) => {
    const inCat = places.filter((p) => p.categoryId === id);
    const nearbyOutside = q.contextPlaces.filter((p) => p.categoryId === id).length;
    const status: 'empty' | 'sparse' | 'ok' =
      inCat.length === 0 ? 'empty' : inCat.length < SPARSE_THRESHOLD ? 'sparse' : 'ok';
    return {
      id,
      label: getCategory(id).label,
      total: inCat.length,
      onCampus: inCat.length,
      nearbyOutside,
      status,
    };
  });

  const { graph, componentSizes } = q.graph;
  const notes: string[] = [];
  for (const p of [...places, ...q.contextPlaces]) {
    if (p.kind !== 'gate' && /\bgate\b/i.test(p.name ?? '') && p.description)
      notes.push(`${p.id} (${p.displayName}): ${p.description}`);
  }
  if (componentSizes.length > 1) {
    notes.push(
      `The walking graph has ${componentSizes.length} disconnected components; no synthetic links were added. ` +
        'Routes between components are reported as "no path" until the missing OSM connections are mapped.',
    );
  }
  const reviewEdges = q.edgesThroughBuildings.filter((e) => e.needsOsmReview);
  if (reviewEdges.length > 0)
    notes.push(
      `${reviewEdges.length} routing edge(s) run through a building with no grade-separation tag on the way or the building ` +
        `(${reviewEdges.map((e) => `way/${e.osmWayId} through ${e.buildingId}`).join('; ')}). Kept as mapped; flagged for OSM review.`,
    );

  const crossing = q.classified
    .filter((c) => c.membership.status === 'crossing')
    .map((c) => membershipRow(c, nameOf(c)))
    .sort(byId);
  const uncertain = q.classified
    .filter((c) => c.membership.status === 'uncertain')
    .map((c) => membershipRow(c, nameOf(c)))
    .sort(byId);
  const outside: OutsideRow[] = q.classified
    .filter((c) => c.membership.status === 'outside')
    .map((c) => ({ ...membershipRow(c, nameOf(c)), contextPlace: q.outsideAsContext.has(c.record.id) }))
    .sort(
      (a, b) =>
        (a.distanceToBoundaryM ?? Infinity) - (b.distanceToBoundaryM ?? Infinity) || a.id.localeCompare(b.id),
    );
  const outsideByDistance: Record<string, number> = {};
  for (const d of [0, ...OUTSIDE_DISTANCE_BANDS]) outsideByDistance[distanceBand(d)] = 0;
  for (const o of outside) {
    const b = distanceBand(o.distanceToBoundaryM);
    outsideByDistance[b] = (outsideByDistance[b] ?? 0) + 1;
  }
  const insideAreaM2 = q.classified
    .filter((c) => inventoryIds.has(c.record.id))
    .reduce((s, c) => s + (c.membership.insideAreaM2 ?? 0), 0);
  const applied = new Set(
    q.classified.filter((c) => c.membership.decision === 'curated').map((c) => c.record.id),
  );

  return {
    builtFrom: q.builtFrom,
    totals: {
      places: places.length,
      contextPlaces: q.contextPlaces.length,
      buildings: q.inventory.length,
      relations: q.relationCount,
      onCampusPlaces: places.filter((p) => p.campusZone === 'on-campus').length,
      offCampusPlaces: q.contextPlaces.length,
      detections: q.detections.microsoft.shipped + q.detections.google.shipped,
      boundaryReviewItems: crossing.length + uncertain.length + q.placeReviewItems.length,
    },
    membership: {
      boundarySourceRef: q.boundarySourceRef,
      boundaryAreaM2: Math.round(q.boundaryAreaM2),
      thresholds: q.thresholds,
      footprintsInSnapshot: q.classified.length,
      byStatus: sortedRecord(count(q.classified, (c) => c.membership.status)),
      byReason: sortedRecord(count(q.classified, (c) => c.membership.reasonCode)),
      inventory: {
        inside: q.inventory.filter(
          (b) => q.classified.find((c) => c.record.id === b.id)?.membership.status === 'inside',
        ).length,
        crossing: q.inventory.filter(
          (b) => q.classified.find((c) => c.record.id === b.id)?.membership.status === 'crossing',
        ).length,
        duplicatesRemoved: q.duplicatesResolved.length,
        total: q.inventory.length,
      },
      insideAreaM2: Math.round(insideAreaM2),
      crossing,
      uncertain,
      outside,
      outsideByDistance,
      nearBoundaryExclusions: outside
        .filter((o) => (o.distanceToBoundaryM ?? Infinity) < NEAR_BOUNDARY_M)
        .map((o) => o.id),
      pointAreaDisagreements: q.classified
        .filter((c) => c.membership.pointAreaDisagreement)
        .map((c) => c.record.id)
        .sort(),
      sections: q.sections.map((s) => ({
        id: s.id,
        title: s.title,
        status: s.status,
        bufferM: s.bufferM,
        affected: [
          ...q.classified.filter((c) => c.membership.reviewSectionId === s.id).map((c) => c.record.id),
          ...q.placeReviewItems.filter((i) => i.reviewSectionId === s.id).map((i) => i.id),
        ].sort(),
      })),
      decisions: q.decisions
        .map((d) => ({
          ...d,
          decidedBy: q.decidedBy.get(d.featureId) ?? null,
          applied: applied.has(d.featureId),
        }))
        .sort((a, b) => a.featureId.localeCompare(b.featureId)),
      placeReviewItems: [...q.placeReviewItems].sort(byId),
    },
    duplicatesResolved: q.duplicatesResolved,
    overlaps: q.overlaps,
    buildingFlags: q.buildingFlags,
    osmTaggingNeeded: q.osmTaggingNeeded,
    unnamedBuildings: {
      total: unnamed.length,
      onCampus: unnamed.length,
      largestOnCampus: [...unnamed]
        .sort((a, b) => (b.areaM2 ?? 0) - (a.areaM2 ?? 0) || a.id.localeCompare(b.id))
        .slice(0, 25)
        .map((b) => ({
          id: b.id,
          displayName: placesById.get(b.id)?.displayName ?? b.displayName,
          areaM2: Math.round(b.areaM2 ?? 0),
        })),
    },
    placesWithoutLocation: places.filter((p) => !p.location).map(ref),
    placesNotConnectedToGraph: places
      .filter((p) => p.location !== null && p.graphNodeId === undefined)
      .map((p) => ({ ...ref(p), campusZone: p.campusZone }))
      .sort(byId),
    entrances: {
      total: q.attachedEntrances.length + q.unattachedEntrances.length,
      attached: q.attachedEntrances.length,
      unattached: [...q.unattachedEntrances].sort(),
    },
    duplicates: { ids: dupIds, locations: dupLocations },
    importantCategories: important,
    verification: {
      byStatus: sortedRecord(count(places, (p) => p.provenance.verificationStatus)),
      withoutLastVerifiedAt: places.filter((p) => !p.provenance.lastVerifiedAt).length,
    },
    graph: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      components: componentSizes.length,
      componentSizes: componentSizes.slice(0, 30),
      largestComponentShare: graph.nodes.length
        ? Math.round(((componentSizes[0] ?? 0) / graph.nodes.length) * 1000) / 1000
        : 0,
      footEdges: graph.edges.filter((e) => e.foot).length,
      campusEdges: graph.edges.filter((e) => e.campus === true).length,
      offCampusEdges: graph.edges.filter((e) => e.campus === false).length,
      boundaryCrossingEdges: q.boundaryCrossing,
      edgesThroughBuildings: q.edgesThroughBuildings,
      stats: q.graph.stats,
    },
    heightSources: sortedRecord(count(q.inventory, (b) => b.height.heightSource)),
    fidelityLevels: sortedRecord(count(q.inventory, (b) => String(q.fidelity.get(b.id) ?? 0))),
    skippedFeatures: [...q.skipped].sort((a, b) => a.ref.localeCompare(b.ref)),
    minHeightIgnored: [...q.minHeightIgnored].sort(),
    curated: q.curated,
    directory: q.directory,
    detections: q.detections,
    basemap: q.basemap,
    coverageGrid: q.coverageGrid,
    notes,
  };
}
