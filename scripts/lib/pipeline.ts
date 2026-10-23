/**
 * Orchestrates raw OSM snapshot + detection snapshots + curated records →
 * public/data/* (the v2 geographic contract, docs/MODULE_CONTRACTS.md).
 * Pure function of its inputs: no network, no wall-clock time, stable
 * ordering and fixed precision, so rebuilds are byte-identical.
 *
 * Campus membership comes from the shared boundary service
 * (src/geo/boundary.ts) through scripts/lib/membership.ts:
 *  - buildings.geojson / building places = campus inventory only (inside, or
 *    crossing by rule R6), after deterministic duplicate resolution;
 *  - 'uncertain' footprints are held out and listed in boundary-review.json;
 *  - 'outside' footprints are never shipped (named/use-tagged ones become
 *    point-only context places); all are listed in the coverage report;
 *  - places.json = campus places; context-places.json = off-campus POIs;
 *  - detections.geojson = unmatched machine detections (flat review layer).
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { CATEGORIES } from '../../src/config/categories.ts';
import { APP_CONFIG } from '../../src/config/index.ts';
import {
  DATA_FILES,
  DATA_SCHEMA_VERSION,
  placeKindSchema,
  relationTypeSchema,
} from '../../src/data/schema.ts';
import type {
  BoundaryReviewItem,
  BuildingsFile,
  DirectoryKeysLock,
  Manifest,
  Place,
  SourceRecord,
} from '../../src/data/schema.ts';
import { createBoundary, DEFAULT_MEMBERSHIP_THRESHOLDS } from '../../src/geo/boundary.ts';
import type { CampusBoundary as GeoBoundary } from '../../src/geo/boundary.ts';
import { buildBasemap } from './build-basemap.ts';
import {
  boundaryFeatureCollection,
  buildBoundary,
  BuildError,
  CAMPUS_RELATION_ID,
} from './build-boundary.ts';
import { buildingsFeatureCollection, collectBuildings, toGeometry } from './build-buildings.ts';
import type { BuildingFeatureInput, BuildingRecord } from './build-buildings.ts';
import { buildGraph } from './build-graph.ts';
import { collectPlaces } from './build-places.ts';
import type { PlaceRecord } from './build-places.ts';
import { buildRelations, sortRelations } from './build-relations.ts';
import { boundaryReviewFile, loadBoundaryReview, openSectionForPoint } from './boundary-review.ts';
import { attachConnectors } from './connectors.ts';
import { loadCurated, mergeCurated } from './curated.ts';
import { CURATED_SCHEMAS } from './curated-schema.ts';
import { readDetectionSnapshots } from './detection-sources.ts';
import { buildDetections } from './detections.ts';
import type { DetectionsResult } from './detections.ts';
import { gridCellOf, isKeyEligible, keyCell, LOCK_FILE, readLock } from './directory-keys.ts';
import type { KeyCandidate } from './directory-keys.ts';
import { round } from './geometry.ts';
import { boundaryCrossingEdges, edgesThroughBuildings, setEdgeCampusFlags } from './graph-checks.ts';
import { buildingFlags, classifyBuildings, footprintPairs, resolveDuplicates } from './membership.ts';
import type { ClassifiedBuilding } from './membership.ts';
import { mergeOsmData, parseOsm, sortedValues } from './osm-parse.ts';
import type { OsmData } from './osm-parse.ts';
import { buildQualityReport } from './quality.ts';
import type { CoverageCell, QualityReport } from './quality.ts';
import { coverageMarkdown } from './coverage-markdown.ts';
import { qualityMarkdown } from './quality-markdown.ts';
import { readSourceMeta } from './source-meta.ts';
import { isBuildingTagged } from './classify.ts';
import { wayPolygon } from './osm-geometry.ts';

export interface BuildOptions {
  inputDir: string;
  curatedDir: string;
  outDir: string;
  /** Committed detection snapshots; default: the `detections` folder next to inputDir (absent = none). */
  detectionsDir?: string | null;
  /** Map-key lock; default <curatedDir>/directory-keys.json (absent = no keys). */
  keysLockPath?: string | null;
  /** Where the previous manifest is preserved for change detection; null disables. */
  cacheDir?: string | null;
  /** Markdown quality report path; null disables. */
  reportPath?: string | null;
  /** Generated docs/CAMPUS_BUILDING_COVERAGE.md path; null disables. */
  coveragePath?: string | null;
  /** Directory for generated JSON Schemas of curated inputs; null disables. */
  schemasDir?: string | null;
  /** Baseline dataset for the before/after diff in the coverage report (scripts/lib/baseline.ts). */
  previousManifest?: {
    schemaVersion?: unknown;
    datasetVersion?: unknown;
    counts?: unknown;
    ref?: unknown;
  } | null;
  relationId?: number;
}

/** Everything a build produces, before anything is written. */
export interface ComputedBuild {
  manifest: Manifest;
  quality: QualityReport;
  /** File key → exact file content. */
  contents: Record<Exclude<keyof typeof DATA_FILES, 'manifest'>, string>;
  manifestText: string;
  /** Extra shipped files (licence texts): path relative to outDir → content. */
  extraFiles: Record<string, string>;
  qualityMarkdown: string;
  coverageMarkdown: string;
  /** Inputs for `npm run data:keys`. */
  keyCandidates: KeyCandidate[];
  /** Inventory footprints by id (key transfer IoU). */
  inventory: BuildingRecord[];
}

export interface BuildResult {
  manifest: Manifest;
  quality: QualityReport;
  outDir: string;
  /** Repository side outputs written (report, schemas) — candidates for formatting. */
  generatedFiles: string[];
}

const RAW_EXTENSIONS = /\.(osm|xml|json)$/i;

/** Raw snapshot files; boundary extracts first so complete relations win the merge. */
export function rawSnapshotFiles(inputDir: string): string[] {
  return readdirSync(inputDir)
    .filter((f) => RAW_EXTENSIONS.test(f) && f !== 'SOURCE.json')
    .sort(
      (a, b) => Number(!a.startsWith('boundary')) - Number(!b.startsWith('boundary')) || a.localeCompare(b),
    );
}

export const stableJson = (value: unknown, pretty = false) =>
  `${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`;
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Manifest counts. Every value is derived from the processed files (see docs/MODULE_CONTRACTS.md). */
function counts(input: {
  places: readonly Place[];
  contextPlaces: readonly Place[];
  buildings: BuildingsFile;
  relationTypes: string[];
  basemapFeatures: number;
  q: QualityReport;
  detections: DetectionsResult;
  reviewItems: number;
}) {
  const { places, buildings, q } = input;
  const inv = buildings.features.map((f) => f.properties).filter((p) => p.inCampusInventory);
  const count = (pred: (p: Place) => boolean) => places.filter(pred).length;
  const c: Record<string, number> = {
    places: places.length,
    buildings: inv.length,
    'buildings:unnamed': inv.filter((p) => p.name === null).length,
    'buildings:inside': inv.filter((p) => p.campusStatus === 'inside').length,
    'buildings:crossing': inv.filter((p) => p.campusStatus === 'crossing').length,
    'buildings:uncertain': q.membership.uncertain.length,
    'buildings:outsideExcluded': q.membership.outside.length,
    'buildings:duplicatesRemoved': q.duplicatesResolved.length,
    'buildings:inSnapshot': q.membership.footprintsInSnapshot,
    contextPlaces: input.contextPlaces.length,
    detections: input.detections.file.features.length,
    'boundaryReview:items': input.reviewItems,
    relations: input.relationTypes.length,
    basemapFeatures: input.basemapFeatures,
    'graph:nodes': q.graph.nodes,
    'graph:edges': q.graph.edges,
    'graph:campusEdges': q.graph.campusEdges,
    'graph:components': q.graph.components,
    'graph:largestComponentNodes': q.graph.componentSizes[0] ?? 0,
    'places:withoutLocation': count((p) => p.location === null),
    'places:notConnected': count((p) => p.location !== null && p.graphNodeId === undefined),
    'zone:on-campus': count((p) => p.campusZone === 'on-campus'),
    'zone:off-campus-nearby': count((p) => p.campusZone === 'off-campus-nearby'),
    'directory:eligible': q.directory.eligible,
    'directory:keyed': q.directory.keyed,
  };
  for (const src of ['microsoft-ml', 'google-open-buildings'])
    c[`detections:${src}`] = input.detections.file.features.filter((f) => f.properties.source === src).length;
  for (const cat of CATEGORIES) c[`category:${cat.id}`] = count((p) => p.categoryId === cat.id);
  for (const k of placeKindSchema.options) c[`kind:${k}`] = count((p) => p.kind === k);
  for (const h of ['osm-height', 'osm-levels-estimate', 'fallback'])
    c[`heightSource:${h}`] = inv.filter((p) => p.renderHeightSource === h).length;
  for (const t of relationTypeSchema.options)
    c[`relation:${t}`] = input.relationTypes.filter((x) => x === t).length;
  return Object.fromEntries(Object.entries(c).sort(([a], [b]) => a.localeCompare(b)));
}

/** Named/area ways that carry building:* tags but no building=* tag (e.g. the School of Design outline). */
function osmTaggingNeeded(
  osm: OsmData,
  inside: (p: [number, number]) => boolean,
  records: readonly PlaceRecord[],
) {
  const located = new Map(records.map((r) => [r.place.id, r.place.location]));
  const out: QualityReport['osmTaggingNeeded'] = [];
  for (const way of sortedValues(osm.ways)) {
    if (isBuildingTagged(way.tags) || way.tags['building:part']) continue;
    const keys = Object.keys(way.tags).filter((k) => k.startsWith('building:'));
    if (keys.length === 0 || !wayPolygon(osm, way)) continue;
    const id = `osm:way/${way.id}`;
    const loc = located.get(id);
    if (!loc || !inside(loc)) continue;
    out.push({
      id,
      name: way.tags.name?.trim() || null,
      reason:
        `OSM tagging needed: has ${keys.sort().join(', ')} but no building=* tag, so it is not a footprint and is not ` +
        'extruded. Add building=* in OSM after on-site confirmation; nothing is inferred here.',
    });
  }
  return out;
}

function coverageGrid(inventory: readonly BuildingRecord[], detections: DetectionsResult): CoverageCell[] {
  const cells = new Map<string, CoverageCell>();
  const cellFor = (name: string) => {
    let c = cells.get(name);
    if (!c) {
      c = { cell: name, inventoryBuildings: 0, inventoryAreaM2: 0, detections: 0, detectionAreaM2: 0 };
      cells.set(name, c);
    }
    return c;
  };
  for (const b of inventory) {
    const c = cellFor(gridCellOf(b.location).cell ?? 'outside grid');
    c.inventoryBuildings++;
    c.inventoryAreaM2 += b.areaM2 ?? 0;
  }
  for (const f of detections.file.features) {
    if (f.properties.source !== 'microsoft-ml') continue;
    const ring = (f.geometry.coordinates as number[][][])[0]!;
    // Detection anchor for the grid: mean of distinct vertices (the polygon is never moved).
    const pts = ring.slice(0, -1);
    const p: [number, number] = [
      pts.reduce((s, v) => s + v[0]!, 0) / pts.length,
      pts.reduce((s, v) => s + v[1]!, 0) / pts.length,
    ];
    const c = cellFor(gridCellOf(p).cell ?? 'outside grid');
    c.detections++;
    c.detectionAreaM2 += f.properties.areaM2;
  }
  return [...cells.values()]
    .map((c) => ({
      ...c,
      inventoryAreaM2: Math.round(c.inventoryAreaM2),
      detectionAreaM2: Math.round(c.detectionAreaM2),
    }))
    .sort((a, b) => a.cell.localeCompare(b.cell, 'en', { numeric: true }));
}

function defaultDetectionsDir(inputDir: string): string {
  return join(dirname(inputDir), 'detections');
}

export function computeBuild(opts: BuildOptions): ComputedBuild {
  const meta = readSourceMeta(opts.inputDir);
  const rawFiles = rawSnapshotFiles(opts.inputDir);
  if (rawFiles.length === 0)
    throw new BuildError(`No raw OSM snapshot in ${opts.inputDir}. Run "npm run data:fetch".`);
  const osm = mergeOsmData(...rawFiles.map((f) => parseOsm(readFileSync(join(opts.inputDir, f), 'utf8'))));
  const maxBounds = APP_CONFIG.map.maxBounds;
  const retrievedAt = meta.retrievedAt;
  const thresholds = DEFAULT_MEMBERSHIP_THRESHOLDS;

  // --- boundary (scripts view for point tests, shared service for areas)
  const boundary = buildBoundary(osm, opts.relationId ?? CAMPUS_RELATION_ID);
  const geo: GeoBoundary = createBoundary(toGeometry(boundary.multiPolygon));
  const boundarySourceRef = `relation/${boundary.relation.id}`;
  const review = loadBoundaryReview(opts.curatedDir);

  // --- buildings: classify every footprint of the snapshot
  const b = collectBuildings(osm);
  const knownIds = new Set(b.buildings.map((x) => x.id));
  for (const d of review.decisions)
    if (!knownIds.has(d.featureId))
      throw new BuildError(
        `boundary-review.json decision for ${d.featureId}: no such building in the raw snapshot (check the id).`,
      );
  const classified = classifyBuildings(b.buildings, geo, review.sections, review.decisions, thresholds);
  const statusOf = new Map(classified.map((c) => [c.record.id, c.membership]));
  const inventoryCandidates = classified.filter((c) => c.membership.inCampusInventory).map((c) => c.record);
  const pairs = footprintPairs(inventoryCandidates);
  const duplicatesResolved = resolveDuplicates(pairs);
  const droppedDuplicates = new Set(duplicatesResolved.map((d) => d.dropped));
  const inventory = inventoryCandidates.filter((r) => !droppedDuplicates.has(r.id));
  const inventoryIds = new Set(inventory.map((r) => r.id));
  const outsideRecords = classified.filter((c) => c.membership.status === 'outside').map((c) => c.record);

  // --- basemap and graph (context features kept; land use only when mostly on campus)
  const droppedAreas: string[] = [];
  const basemap = buildBasemap(osm, maxBounds, {
    campusShare: (mp) => {
      const g = toGeometry(mp);
      try {
        return geo.insideFraction(g);
      } catch {
        return 0;
      }
    },
    dropped: droppedAreas,
  });
  const graphResult = buildGraph(osm, maxBounds);
  setEdgeCampusFlags(graphResult.graph, boundary.contains);
  const crossingEdges = boundaryCrossingEdges(graphResult.graph, boundary.contains);
  const throughBuildings = edgesThroughBuildings(graphResult.graph, b.buildings, osm);

  // --- places (campus + context), connectors, curated merge
  const records = collectPlaces(osm, {
    boundary,
    buildings: inventory,
    outsideBuildings: outsideRecords,
    maxBounds,
    retrievedAt,
  });
  attachConnectors(records, graphResult.graph, APP_CONFIG.routing.maxPlaceConnectorM);
  const curated = loadCurated(opts.curatedDir);
  const merged = mergeCurated(records, curated);

  const campusRecords: PlaceRecord[] = [];
  const contextRecords: PlaceRecord[] = [];
  const placeReviewItems: BoundaryReviewItem[] = [];
  for (const rec of merged.records) {
    const p = rec.place;
    if (p.campusZone === 'on-campus') {
      campusRecords.push(rec);
      continue;
    }
    const near = p.location ? openSectionForPoint(p.location, review.sections) : null;
    if (near && p.location) {
      // Owner decision 3: an off-campus place in an open boundary-review section is neither campus nor
      // confirmed outside — it is listed for review only.
      placeReviewItems.push({
        id: p.id,
        kind: 'place',
        displayName: p.displayName,
        campusStatus: 'uncertain',
        insideFraction: null,
        distanceToBoundaryM: round(geo.distanceToBoundaryM(p.location), 2),
        membershipReasonCode: 'review-section',
        membershipReason:
          `Point ${round(near.distanceM, 2)} m from open boundary-review section '${near.section.id}' ` +
          `(buffer ${near.section.bufferM} m), outside the mapped boundary. Held for review; not shown as campus or as outside.`,
        reviewSectionId: near.section.id,
        pointAreaDisagreement: false,
        anchor: p.location,
        decision: 'auto',
        decisionSource: null,
      });
      continue;
    }
    contextRecords.push(rec);
  }
  const outsideAsContext = new Set(
    contextRecords.filter((r) => outsideRecords.some((o) => o.id === r.place.id)).map((r) => r.place.id),
  );
  const campusPlaceId = `osm:relation/${boundary.relation.id}`;
  const rel = buildRelations(campusRecords, { campusPlaceId, buildings: inventory, retrievedAt });
  const campusIds = new Set(campusRecords.map((r) => r.place.id));
  const relations = sortRelations([
    ...rel.relations,
    ...merged.relations.filter((r) => campusIds.has(r.from) && campusIds.has(r.to)),
  ]);
  const places = campusRecords.map((r) => r.place).sort((p, q) => byString(p.id, q.id));
  const contextPlaces = contextRecords
    .map((r) => {
      const { buildingId: _b, ...rest } = r.place;
      return rest;
    })
    .sort((p, q) => byString(p.id, q.id));
  const placeById = new Map(places.map((p) => [p.id, p]));

  // --- directory keys (lock is read, never written here)
  const lockPath = opts.keysLockPath === undefined ? join(opts.curatedDir, LOCK_FILE) : opts.keysLockPath;
  const lock: DirectoryKeysLock | null = lockPath ? readLock(lockPath) : null;
  const hosts = new Set(
    relations
      .filter((r) => (r.type === 'located_in' || r.type === 'part_of') && r.from !== r.to)
      .map((r) => r.to),
  );
  const keyCandidates: KeyCandidate[] = inventory.map((r) => ({
    id: r.id,
    anchor: r.location,
    areaM2: r.areaM2,
    named: (placeById.get(r.id)?.name ?? r.name) !== null,
    hasFacility: hosts.has(r.id),
  }));
  const eligible = keyCandidates.filter((c) => isKeyEligible(c));
  const keyOf = (id: string) => lock?.keys[id] ?? null;
  const featureInputs: BuildingFeatureInput[] = inventory.map((r) => {
    const key = keyOf(r.id);
    return {
      record: r,
      membership: statusOf.get(r.id)!,
      place: placeById.get(r.id),
      retrievedAt,
      directoryKey: key,
      directoryCell: key ? keyCell(key) : gridCellOf(r.location).cell,
    };
  });
  const buildingsFile = buildingsFeatureCollection(featureInputs);
  const directory: QualityReport['directory'] = {
    lockVersion: lock?.version ?? null,
    eligible: eligible.length,
    keyed: featureInputs.filter((f) => f.directoryKey !== null).length,
    unkeyed: eligible
      .filter((c) => keyOf(c.id) === null && gridCellOf(c.anchor).cell !== null)
      .map((c) => c.id)
      .sort(),
    unkeyable: eligible
      .filter((c) => keyOf(c.id) === null && gridCellOf(c.anchor).cell === null)
      .map((c) => c.id)
      .sort(),
    staleLockKeys: Object.keys(lock?.keys ?? {})
      .filter((id) => !inventoryIds.has(id))
      .sort(),
    cells: new Set(featureInputs.map((f) => f.directoryCell).filter((c) => c !== null)).size,
  };

  // --- detections (flat review layer)
  const detectionsDir =
    opts.detectionsDir === undefined ? defaultDetectionsDir(opts.inputDir) : opts.detectionsDir;
  const snapshots = detectionsDir ? readDetectionSnapshots(detectionsDir) : { ms: null, google: null };
  const detections = buildDetections({
    ms: snapshots.ms,
    google: snapshots.google,
    boundary: geo,
    sections: review.sections,
    osmFootprints: b.buildings,
  });

  // --- review file (every uncertain and crossing footprint, plus places held for review)
  const displayNames = new Map(
    inventory.map((r) => [r.id, placeById.get(r.id)?.displayName ?? r.displayName]),
  );
  const buildingItems: BoundaryReviewItem[] = classified
    .filter((c) => c.membership.status === 'uncertain' || c.membership.status === 'crossing')
    .map((c: ClassifiedBuilding) => ({
      id: c.record.id,
      kind: 'building',
      displayName: displayNames.get(c.record.id) ?? c.record.displayName,
      campusStatus: c.membership.status,
      insideFraction: c.membership.insideFraction,
      distanceToBoundaryM: c.membership.distanceToBoundaryM,
      membershipReasonCode: c.membership.reasonCode,
      membershipReason: c.membership.reason,
      reviewSectionId: c.membership.reviewSectionId,
      pointAreaDisagreement: c.membership.pointAreaDisagreement,
      anchor: c.record.location,
      decision: c.membership.decision,
      decisionSource: c.membership.decisionSource,
    }));
  const reviewFile = boundaryReviewFile({
    boundarySourceRef: `${boundarySourceRef}`,
    thresholds,
    sections: review.sections,
    decisions: review.decisions,
    items: [...buildingItems, ...placeReviewItems],
  });

  const fidelity = new Map(buildingsFile.features.map((f) => [f.properties.id, f.properties.fidelityLevel]));
  const quality = buildQualityReport({
    builtFrom: retrievedAt,
    boundarySourceRef,
    boundaryAreaM2: geo.areaM2,
    thresholds,
    places,
    contextPlaces,
    classified,
    inventory,
    outsideAsContext,
    relationCount: relations.length,
    graph: graphResult,
    boundaryCrossing: crossingEdges,
    edgesThroughBuildings: throughBuildings,
    attachedEntrances: rel.attachedEntrances,
    unattachedEntrances: rel.unattachedEntrances,
    skipped: b.skipped,
    minHeightIgnored: b.minHeightIgnored.filter((r) => inventoryIds.has(`osm:${r}`)),
    curated: {
      filesPresent: [...curated.present, ...(review.present ? ['boundary-review.json'] : [])],
      ...merged.applied,
    },
    sections: review.sections,
    decisions: review.decisions,
    decidedBy: review.decidedBy,
    placeReviewItems,
    duplicatesResolved,
    overlaps: pairs.filter((p) => p.kind !== 'duplicate' && inventoryIds.has(p.a) && inventoryIds.has(p.b)),
    buildingFlags: buildingFlags(inventory),
    osmTaggingNeeded: osmTaggingNeeded(osm, boundary.contains, campusRecords),
    directory,
    detections: { ...detections.summary, shippedAreaM2: detections.shippedAreaM2 },
    basemap: { features: basemap.features.length, droppedOffCampusAreas: droppedAreas.sort() },
    coverageGrid: coverageGrid(inventory, detections),
    displayNames,
    fidelity,
  });

  const contents: ComputedBuild['contents'] = {
    boundary: stableJson(boundaryFeatureCollection(boundary)),
    buildings: stableJson(buildingsFile),
    basemap: stableJson(basemap),
    places: stableJson({ schemaVersion: DATA_SCHEMA_VERSION, places }),
    relations: stableJson({ schemaVersion: DATA_SCHEMA_VERSION, relations }),
    graph: stableJson(graphResult.graph),
    quality: stableJson(quality, true),
    contextPlaces: stableJson({ schemaVersion: DATA_SCHEMA_VERSION, places: contextPlaces }),
    detections: stableJson(detections.file),
    boundaryReview: stableJson(reviewFile),
  };
  const keys = Object.keys(contents).sort() as Array<keyof typeof contents>;
  const files: Manifest['files'] = {};
  for (const k of keys) {
    files[k] = {
      path: DATA_FILES[k],
      bytes: Buffer.byteLength(contents[k], 'utf8'),
      sha256: sha256(contents[k]),
    };
  }
  const datasetVersion = sha256(keys.map((k) => contents[k]).join('')).slice(0, 12);
  const osmSource: SourceRecord = {
    id: 'osm',
    name: meta.name,
    url: meta.url,
    license: meta.license,
    attribution: meta.attribution,
    retrievedAt,
    notes: `Retrieved via ${meta.method}; bbox ${meta.bbox.join(', ')}. Derived database under ODbL 1.0.`,
  };
  const manifest: Manifest = {
    schemaVersion: DATA_SCHEMA_VERSION,
    datasetVersion,
    builtFrom: retrievedAt,
    sources: [osmSource, ...merged.sources, ...detections.sources],
    files,
    counts: counts({
      places,
      contextPlaces,
      buildings: buildingsFile,
      relationTypes: relations.map((r) => r.type),
      basemapFeatures: basemap.features.length,
      q: quality,
      detections,
      reviewItems: reviewFile.items.length,
    }),
    bbox: boundary.bbox.map((v) => round(v, 7)) as Manifest['bbox'],
  };
  const previous = opts.previousManifest ?? null;
  return {
    manifest,
    quality,
    contents,
    manifestText: stableJson(manifest, true),
    extraFiles: detections.licenseFiles,
    qualityMarkdown: qualityMarkdown(quality, datasetVersion),
    coverageMarkdown: coverageMarkdown({
      quality,
      manifest,
      previous,
      snapshots,
      places,
      contextPlaces,
      buildings: buildingsFile,
      detections: detections.file,
      osmSourceName: meta.name,
    }),
    keyCandidates,
    inventory,
  };
}

/** Writes the computed dataset files (data + licence texts) into `outDir`. */
export function writeDataset(build: ComputedBuild, outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  for (const k of Object.keys(build.contents) as Array<keyof ComputedBuild['contents']>)
    writeFileSync(join(outDir, DATA_FILES[k]), build.contents[k]);
  for (const [rel, text] of Object.entries(build.extraFiles)) {
    mkdirSync(dirname(join(outDir, rel)), { recursive: true });
    writeFileSync(join(outDir, rel), text);
  }
  writeFileSync(join(outDir, DATA_FILES.manifest), build.manifestText);
}

/** Every path (relative, '/'-separated) a dataset directory should contain. */
export function datasetPaths(build: ComputedBuild): string[] {
  return [...Object.values(DATA_FILES), ...Object.keys(build.extraFiles)].sort();
}

/** Writes the repository side outputs (reports, curated JSON Schemas); returns the files written. */
export function writeSideOutputs(
  build: ComputedBuild,
  opts: Pick<BuildOptions, 'reportPath' | 'coveragePath' | 'schemasDir'>,
): string[] {
  const generated: string[] = [];
  if (opts.reportPath) {
    mkdirSync(dirname(opts.reportPath), { recursive: true });
    writeFileSync(opts.reportPath, build.qualityMarkdown);
    generated.push(opts.reportPath);
  }
  if (opts.coveragePath) {
    mkdirSync(dirname(opts.coveragePath), { recursive: true });
    writeFileSync(opts.coveragePath, build.coverageMarkdown);
    generated.push(opts.coveragePath);
  }
  if (opts.schemasDir) {
    mkdirSync(opts.schemasDir, { recursive: true });
    for (const [file, schema] of Object.entries(CURATED_SCHEMAS)) {
      writeFileSync(join(opts.schemasDir, file), stableJson(z.toJSONSchema(schema, { io: 'input' }), true));
      generated.push(join(opts.schemasDir, file));
    }
  }
  return generated;
}

export function readTextOrNull(path: string | null | undefined): string | null {
  return path && existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** Reads a manifest-like JSON loosely (any schema version) for before/after diffs; null when absent/unreadable. */
export function readManifestLoose(path: string): BuildOptions['previousManifest'] {
  if (!existsSync(path)) return null;
  try {
    const v = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return v && typeof v === 'object' ? (v as BuildOptions['previousManifest']) : null;
  } catch {
    return null;
  }
}

/**
 * Computes and writes a dataset directly into `outDir` (no validation gate).
 * Used by tests and by `npm run data:keys`; the CLI (`npm run data:build`)
 * goes through scripts/lib/publish.ts, which validates in a staging directory
 * before swapping into public/data.
 */
export function runBuild(opts: BuildOptions): BuildResult {
  const previousPath = join(opts.outDir, DATA_FILES.manifest);
  const build = computeBuild({
    ...opts,
    previousManifest:
      opts.previousManifest !== undefined ? opts.previousManifest : readManifestLoose(previousPath),
  });
  if (opts.cacheDir && existsSync(previousPath)) {
    mkdirSync(opts.cacheDir, { recursive: true });
    copyFileSync(previousPath, join(opts.cacheDir, 'previous-manifest.json'));
  }
  const licenseDir = join(opts.outDir, 'licenses');
  if (existsSync(licenseDir) && Object.keys(build.extraFiles).length === 0)
    rmSync(licenseDir, { recursive: true });
  writeDataset(build, opts.outDir);
  const generatedFiles = writeSideOutputs(build, opts);
  return { manifest: build.manifest, quality: build.quality, outDir: opts.outDir, generatedFiles };
}
