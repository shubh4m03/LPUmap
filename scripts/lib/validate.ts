/**
 * Validates a generated dataset directory: Zod schemas, manifest integrity,
 * referential integrity, geometry and graph invariants, and the v2 regression
 * guards (owner decisions 1–3):
 *  - buildings.geojson holds the campus inventory only: no 'outside' or
 *    'uncertain' footprint, membership re-checked with the boundary service;
 *  - places.json holds campus places only, synchronised with the footprints;
 *  - context-places.json holds off-campus points only, never a building;
 *  - detections never duplicate an inventory footprint;
 *  - required landmarks are present; map keys are unique;
 *  - count changes against the previous manifest: warn > 15 %, error > 40 %
 *    (only when the absolute change is also material), any landmark removal is an error.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { z } from 'zod';
import { CATEGORIES } from '../../src/config/categories.ts';
import { APP_CONFIG } from '../../src/config/index.ts';
import {
  basemapFileSchema,
  boundaryFileSchema,
  boundaryReviewFileSchema,
  buildingsFileSchema,
  contextPlacesFileSchema,
  DATA_FILES,
  DETECTION_MANIFEST_SOURCE_IDS,
  detectionsFileSchema,
  graphFileSchema,
  manifestSchema,
  placesFileSchema,
  relationsFileSchema,
} from '../../src/data/schema.ts';
import type {
  BoundaryReviewFile,
  BuildingsFile,
  DetectionsFile,
  GraphFile,
  Manifest,
  Place,
  Relation,
} from '../../src/data/schema.ts';
import { boundaryFromFeatureCollection, createBoundary } from '../../src/geo/boundary.ts';
import type { CampusBoundary, PolygonalGeometry } from '../../src/geo/boundary.ts';
import { inBBox, pointInMultiPolygon } from './geometry.ts';
import type { MultiPolygon } from './geometry.ts';
import { missingLandmarks } from './landmarks.ts';
import type { LandmarksFile } from './landmarks.ts';
import { checkLinks, evaluateCountGuard, reportCountGuard } from './validate-changes.ts';
import type { CountAcceptance, CountBaseline, CountGuardResult } from './validate-changes.ts';
import type { CountThresholds } from './validate-changes.ts';
import { checkGraph, checkMultiPolygon, toMultiPolygon } from './validate-geometry.ts';

export interface Issue {
  level: 'error' | 'warning';
  code: string;
  message: string;
}

export interface ValidateOptions {
  dir: string;
  /** Legacy form of `baseline`: a current-schema manifest to compare counts with. */
  previousManifest?: Manifest | null;
  /** Dataset the count-change guard compares with (scripts/lib/baseline.ts); wins over previousManifest. */
  baseline?: CountBaseline | null;
  /** Explicit acknowledgement of an intentional large change (see scripts/lib/validate-changes.ts). */
  acceptance?: CountAcceptance | null;
  /** Curated acceptances pinned to another baseline (reported as warnings). */
  staleAcceptances?: string[];
  /** Returns null for unparseable opening_hours; omit to skip that check. */
  parseHours?: ((raw: string) => unknown) | null;
  /** When set, HEAD-requests every website (opt-in, network). */
  checkLinks?: { fetchImpl: typeof fetch; timeoutMs?: number } | null;
  /** Count-change thresholds (defaults: warn 15 %, error 40 %, min absolute change 5). */
  countThresholds?: Partial<CountThresholds>;
  /** Legacy form of `acceptance`: downgrades count-change errors to warnings. */
  acceptCountChanges?: boolean;
  /** data/curated/landmarks.json contents; null/undefined skips the landmark check. */
  landmarks?: LandmarksFile | null;
}

export interface ValidateResult {
  errors: Issue[];
  warnings: Issue[];
  /** Outcome of the count-change guard (null when there was nothing to compare with). */
  countGuard?: CountGuardResult | null;
}

class Collector {
  errors: Issue[] = [];
  warnings: Issue[] = [];
  error(code: string, message: string) {
    this.errors.push({ level: 'error', code, message });
  }
  warn(code: string, message: string) {
    this.warnings.push({ level: 'warning', code, message });
  }
}

function load<S extends z.ZodType>(
  dir: string,
  file: string,
  schema: S,
  c: Collector,
): { data: z.infer<S>; raw: string } | null {
  const path = join(dir, file);
  if (!existsSync(path)) {
    c.error('missing-file', `${file} does not exist`);
    return null;
  }
  const raw = readFileSync(path, 'utf8');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    c.error('invalid-json', `${file}: ${(e as Error).message}`);
    return null;
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 20)) {
      c.error('schema', `${file}: ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    return null;
  }
  return { data: parsed.data, raw };
}

export function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.');
  } catch {
    return false;
  }
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

function checkManifest(m: Manifest, raws: Record<string, string | undefined>, dir: string, c: Collector) {
  const keys = Object.keys(m.files).sort();
  for (const key of Object.keys(DATA_FILES)) {
    if (key !== 'manifest' && !(key in m.files))
      c.error('manifest-files', `manifest.files lacks an entry for ${key}`);
  }
  for (const [key, f] of Object.entries(m.files)) {
    if (!(key in DATA_FILES) || key === 'manifest' || f.path !== DATA_FILES[key as keyof typeof DATA_FILES]) {
      c.error('manifest-files', `manifest.files.${key} (${f.path}) is not a known dataset file`);
      continue;
    }
    const raw = raws[key];
    if (raw === undefined) continue;
    if (sha256(raw) !== f.sha256 || Buffer.byteLength(raw, 'utf8') !== f.bytes) {
      c.error(
        'manifest-hash',
        `${f.path} does not match its manifest sha256/bytes (stale or edited by hand)`,
      );
    }
  }
  if (keys.every((k) => raws[k] !== undefined)) {
    const version = sha256(keys.map((k) => raws[k]).join('')).slice(0, 12);
    if (version !== m.datasetVersion)
      c.error('manifest-version', `datasetVersion ${m.datasetVersion} ≠ content hash ${version}`);
  }
  if (!m.sources.some((s) => s.id === 'osm'))
    c.error('manifest-sources', 'manifest lacks the OpenStreetMap source');
  for (const s of m.sources) {
    if (!s.licenseTextPath) continue;
    const local = join(dir, s.licenseTextPath.replace(/^data\//, ''));
    if (!existsSync(local))
      c.error('license-text', `${s.id}: licence text ${s.licenseTextPath} is not shipped`);
  }
}

interface PlaceCtx {
  boundary: MultiPolygon | null;
  buildings: Map<string, MultiPolygon>;
  graph: GraphFile | null;
}

function checkPlaceCommon(
  p: Place,
  ctx: PlaceCtx,
  opts: ValidateOptions,
  c: Collector,
  categories: Set<string>,
) {
  if (!p.displayName.trim()) c.error('display-name', `${p.id} has an empty displayName`);
  if (!categories.has(p.categoryId)) c.error('category', `${p.id} has unknown categoryId ${p.categoryId}`);
  if (p.contact?.website && !isHttpUrl(p.contact.website))
    c.error('website', `${p.id} website is not http(s): ${p.contact.website}`);
  if (p.location && !inBBox(p.location, APP_CONFIG.map.maxBounds))
    c.error('out-of-bounds', `${p.id} location ${p.location.join(',')} is outside maxBounds`);
  if (!p.location && p.graphNodeId !== undefined && p.kind !== 'organization')
    c.error('graph-node', `${p.id} has a graphNodeId but no location`);
  if (p.graphNodeId !== undefined) {
    if (!ctx.graph || p.graphNodeId >= ctx.graph.nodes.length)
      c.error('graph-node', `${p.id} graphNodeId ${p.graphNodeId} does not exist`);
    if ((p.connectorLengthM ?? 0) > APP_CONFIG.routing.maxPlaceConnectorM)
      c.error('connector', `${p.id} connector ${p.connectorLengthM} m exceeds maxPlaceConnectorM`);
  }
  if (p.openingHours && opts.parseHours && opts.parseHours(p.openingHours) === null) {
    c.warn(
      'opening-hours',
      `${p.id} opening_hours "${p.openingHours}" is not in the supported subset (shown as unknown)`,
    );
  }
}

function checkPlaces(places: Place[], ctx: PlaceCtx, opts: ValidateOptions, c: Collector) {
  const categories = new Set(CATEGORIES.map((x) => x.id));
  const ids = new Set<string>();
  for (const p of places) {
    if (ids.has(p.id)) c.error('duplicate-id', `duplicate place id ${p.id}`);
    ids.add(p.id);
    checkPlaceCommon(p, ctx, opts, c, categories);
    if (p.location && ctx.boundary && !pointInMultiPolygon(p.location, ctx.boundary)) {
      // A campus building place may sit on a crossing footprint's anchor outside the line only if the
      // footprint is in the inventory; any other campus place must be inside the boundary.
      if (!(p.kind === 'building' && ctx.buildings.has(p.id)))
        c.error('campus-zone', `${p.id} is in places.json (campus) but lies outside the boundary`);
    }
    if (p.kind === 'building' && !ctx.buildings.has(p.id))
      c.error('building-footprint', `${p.id} has no footprint in buildings.geojson`);
    if (p.buildingId && !ctx.buildings.has(p.buildingId))
      c.error('building-ref', `${p.id} buildingId ${p.buildingId} does not exist`);
    if (p.kind === 'entrance') checkEntrance(p, ctx.buildings, c);
  }
  return ids;
}

function checkContextPlaces(
  context: Place[],
  campusIds: Set<string>,
  ctx: PlaceCtx,
  opts: ValidateOptions,
  c: Collector,
) {
  const categories = new Set(CATEGORIES.map((x) => x.id));
  const ids = new Set<string>();
  for (const p of context) {
    if (ids.has(p.id) || campusIds.has(p.id)) c.error('duplicate-id', `duplicate place id ${p.id} (context)`);
    ids.add(p.id);
    checkPlaceCommon(p, ctx, opts, c, categories);
    if (p.location && ctx.boundary && pointInMultiPolygon(p.location, ctx.boundary))
      c.error('context-inside', `${p.id} is a context (off-campus) place inside the campus boundary`);
    if (ctx.buildings.has(p.id))
      c.error('context-building', `${p.id} is a context place with a campus footprint`);
  }
}

function checkEntrance(p: Place, buildings: Map<string, MultiPolygon>, c: Collector) {
  if (!p.buildingId) {
    c.warn('entrance-unattached', `${p.id} is an entrance not attached to any building outline`);
    return;
  }
  const mp = buildings.get(p.buildingId);
  if (!mp || !p.location) return;
  const onOutline = mp.some((poly) =>
    poly.some((ring) => ring.some((v) => v[0] === p.location![0] && v[1] === p.location![1])),
  );
  if (!onOutline) c.error('entrance-outline', `${p.id} is not a vertex of its building ${p.buildingId}`);
}

function checkRelations(relations: Relation[], placeIds: Set<string>, c: Collector) {
  const ids = new Set<string>();
  const triples = new Set<string>();
  for (const r of relations) {
    if (ids.has(r.id)) c.error('relation-id', `duplicate relation id ${r.id}`);
    ids.add(r.id);
    const t = `${r.type}|${r.from}|${r.to}`;
    if (triples.has(t)) c.error('relation-duplicate', `duplicate relation ${t}`);
    triples.add(t);
    if (!placeIds.has(r.from)) c.error('relation-ref', `${r.id}: from ${r.from} does not exist`);
    if (!placeIds.has(r.to)) c.error('relation-ref', `${r.id}: to ${r.to} does not exist`);
    if (r.from === r.to) c.error('relation-self', `${r.id} relates a place to itself`);
    if (r.type === 'nearby' && r.distanceM === undefined)
      c.error('relation-distance', `${r.id} lacks distanceM`);
  }
}

/** Membership re-checked with the shared boundary service (owner decisions 2 and 3). */
function checkBuildingMembership(file: BuildingsFile, boundary: CampusBoundary | null, c: Collector) {
  const t = APP_CONFIG.geo.membership;
  const keys = new Map<string, string>();
  for (const f of file.features) {
    const p = f.properties;
    if (p.campusStatus === 'outside' || p.campusStatus === 'uncertain' || !p.inCampusInventory)
      c.error(
        'campus-status',
        `${p.id} is '${p.campusStatus}' but buildings.geojson holds the campus inventory only`,
      );
    if (p.directoryKey) {
      const prev = keys.get(p.directoryKey);
      if (prev) c.error('directory-key', `map key ${p.directoryKey} is used by ${prev} and ${p.id}`);
      keys.set(p.directoryKey, p.id);
    }
    if (!boundary || p.membershipDecision === 'curated') continue;
    let f2: number;
    try {
      f2 = boundary.insideFraction(f.geometry as unknown as PolygonalGeometry);
    } catch {
      c.error('membership', `${p.id}: footprint geometry is invalid for the boundary service`);
      continue;
    }
    if (p.insideFraction === null || Math.abs(f2 - p.insideFraction) > 1e-3)
      c.error(
        'membership',
        `${p.id}: stored insideFraction ${p.insideFraction} ≠ recomputed ${f2.toFixed(4)}`,
      );
    const min = p.campusStatus === 'inside' ? t.insideMinFraction : t.crossingInventoryMinFraction;
    if (f2 < min - 1e-4)
      c.error('membership', `${p.id} is '${p.campusStatus}' but only ${(f2 * 100).toFixed(2)} % is inside`);
  }
}

/** Pairwise IoU ≥ 0.95 between shipped footprints = an unresolved duplicate. */
function checkDuplicateFootprints(file: BuildingsFile, c: Collector) {
  const feats = file.features.map((f) => ({
    id: f.properties.id,
    g: f.geometry as unknown as PolygonalGeometry,
    bbox: bboxOf(f.geometry as unknown as PolygonalGeometry),
    area: f.properties.areaM2 ?? 0,
  }));
  for (let i = 0; i < feats.length; i++) {
    const a = feats[i]!;
    let region: CampusBoundary | null = null;
    for (let j = i + 1; j < feats.length; j++) {
      const b = feats[j]!;
      if (a.bbox[0] > b.bbox[2] || b.bbox[0] > a.bbox[2] || a.bbox[1] > b.bbox[3] || b.bbox[1] > a.bbox[3])
        continue;
      try {
        region ??= createBoundary(a.g);
        const inter = region.intersectionAreaM2(b.g);
        const iou = inter / (a.area + b.area - inter);
        if (iou >= 0.95)
          c.error(
            'duplicate-footprint',
            `${a.id} and ${b.id} are the same footprint (IoU ${iou.toFixed(3)})`,
          );
      } catch {
        // invalid geometry is reported by the ring check
      }
    }
  }
}

function bboxOf(g: PolygonalGeometry): [number, number, number, number] {
  const pts = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).flat(2);
  return [
    Math.min(...pts.map((p) => p[0])),
    Math.min(...pts.map((p) => p[1])),
    Math.max(...pts.map((p) => p[0])),
    Math.max(...pts.map((p) => p[1])),
  ];
}

/** Detections never duplicate the campus inventory (owner decision 1) and their sources are licensed. */
function checkDetections(
  det: DetectionsFile,
  buildings: BuildingsFile,
  manifest: Manifest | null,
  c: Collector,
) {
  const ids = new Set<string>();
  const inv = buildings.features.map((f) => ({
    id: f.properties.id,
    g: f.geometry as unknown as PolygonalGeometry,
    bbox: bboxOf(f.geometry as unknown as PolygonalGeometry),
    area: f.properties.areaM2 ?? 0,
  }));
  for (const f of det.features) {
    const p = f.properties;
    if (ids.has(p.id)) c.error('detection-id', `duplicate detection id ${p.id}`);
    ids.add(p.id);
    if (p.matchedOsmId !== null)
      c.error('detection-matched', `${p.id} is matched to ${p.matchedOsmId} and must not ship`);
    if (manifest) {
      const src = manifest.sources.find((s) => s.id === DETECTION_MANIFEST_SOURCE_IDS[p.source]);
      if (!src?.license)
        c.error('detection-source', `${p.id}: source ${p.source} has no licensed manifest record`);
    }
    if (f.geometry.type === 'Point') {
      const pt = f.geometry.coordinates as unknown as [number, number];
      for (const b of inv)
        if (
          inBBox(pt, b.bbox) &&
          pointInMultiPolygon(
            pt,
            (b.g.type === 'Polygon' ? [b.g.coordinates] : b.g.coordinates) as MultiPolygon,
          )
        )
          c.error('detection-matched', `${p.id} lies inside campus building ${b.id}`);
      continue;
    }
    const g = f.geometry as unknown as PolygonalGeometry;
    const bb = bboxOf(g);
    let region: CampusBoundary;
    try {
      region = createBoundary(g);
    } catch {
      c.error('detection-geometry', `${p.id} has invalid geometry`);
      continue;
    }
    let covered = 0;
    for (const b of inv) {
      if (bb[0] > b.bbox[2] || b.bbox[0] > bb[2] || bb[1] > b.bbox[3] || b.bbox[1] > bb[3]) continue;
      const inter = region.intersectionAreaM2(b.g);
      covered += inter;
      const iou = inter / (region.areaM2 + b.area - inter);
      if (iou >= 0.3)
        c.error('detection-matched', `${p.id} matches campus building ${b.id} (IoU ${iou.toFixed(2)})`);
    }
    if (covered / region.areaM2 >= 0.5)
      c.error('detection-matched', `${p.id} is ≥ 50 % covered by campus buildings and must not ship`);
  }
}

function checkReview(review: BoundaryReviewFile, buildings: Set<string>, places: Set<string>, c: Collector) {
  for (const it of review.items) {
    if (it.campusStatus === 'uncertain' && (buildings.has(it.id) || places.has(it.id)))
      c.error('review-item', `${it.id} is held for review but appears in the campus inventory`);
    if (it.campusStatus === 'crossing' && !buildings.has(it.id))
      c.warn(
        'review-item',
        `${it.id} is a crossing review item not in buildings.geojson (duplicate removed?)`,
      );
  }
}

/** Counts that must equal what the processed files contain. */
function checkDerivedCounts(
  m: Manifest,
  files: {
    places?: Place[];
    context?: Place[];
    buildings?: BuildingsFile;
    detections?: DetectionsFile;
    review?: BoundaryReviewFile;
  },
  c: Collector,
) {
  const expect: Array<[string, number | undefined]> = [
    ['places', files.places?.length],
    ['contextPlaces', files.context?.length],
    ['buildings', files.buildings?.features.filter((f) => f.properties.inCampusInventory).length],
    ['detections', files.detections?.features.length],
    ['boundaryReview:items', files.review?.items.length],
  ];
  for (const [k, v] of expect) {
    if (v === undefined) continue;
    if (m.counts[k] !== v)
      c.error('count-derived', `manifest count "${k}" is ${m.counts[k]} but the files hold ${v}`);
  }
}

export async function validateDataset(opts: ValidateOptions): Promise<ValidateResult> {
  const c = new Collector();
  const { dir } = opts;
  const manifest = load(dir, DATA_FILES.manifest, manifestSchema, c);
  const boundary = load(dir, DATA_FILES.boundary, boundaryFileSchema, c);
  const buildings = load(dir, DATA_FILES.buildings, buildingsFileSchema, c);
  const basemap = load(dir, DATA_FILES.basemap, basemapFileSchema, c);
  const places = load(dir, DATA_FILES.places, placesFileSchema, c);
  const relations = load(dir, DATA_FILES.relations, relationsFileSchema, c);
  const graph = load(dir, DATA_FILES.graph, graphFileSchema, c);
  const context = load(dir, DATA_FILES.contextPlaces, contextPlacesFileSchema, c);
  const detections = load(dir, DATA_FILES.detections, detectionsFileSchema, c);
  const review = load(dir, DATA_FILES.boundaryReview, boundaryReviewFileSchema, c);
  const qualityPath = join(dir, DATA_FILES.quality);
  const qualityRaw = existsSync(qualityPath) ? readFileSync(qualityPath, 'utf8') : undefined;
  if (qualityRaw === undefined) c.error('missing-file', `${DATA_FILES.quality} does not exist`);

  if (manifest) {
    checkManifest(
      manifest.data,
      {
        boundary: boundary?.raw,
        buildings: buildings?.raw,
        basemap: basemap?.raw,
        places: places?.raw,
        relations: relations?.raw,
        graph: graph?.raw,
        quality: qualityRaw,
        contextPlaces: context?.raw,
        detections: detections?.raw,
        boundaryReview: review?.raw,
      },
      dir,
      c,
    );
  }

  let boundaryMp: MultiPolygon | null = null;
  let geo: CampusBoundary | null = null;
  if (boundary) {
    const f = boundary.data.features[0];
    boundaryMp = f ? toMultiPolygon(f.geometry) : null;
    if (!boundaryMp) c.error('boundary', 'boundary.geojson has no Polygon/MultiPolygon feature');
    else {
      checkMultiPolygon('boundary', boundaryMp, c);
      try {
        geo = boundaryFromFeatureCollection(boundary.data);
      } catch (e) {
        c.error('boundary', `boundary is not valid for the boundary service: ${(e as Error).message}`);
      }
    }
  }
  const footprints = new Map<string, MultiPolygon>();
  if (buildings) {
    collectFootprints(buildings.data, footprints, c);
    checkBuildingMembership(buildings.data, geo, c);
    checkDuplicateFootprints(buildings.data, c);
  }
  if (basemap) {
    for (const f of basemap.data.features) {
      const coords = f.geometry.coordinates as unknown;
      if (!Array.isArray(coords) || coords.length === 0)
        c.error('basemap-geometry', `${f.properties.id} has empty geometry`);
    }
  }
  if (graph) {
    checkGraph(graph.data, c);
    const missing = graph.data.edges.filter((e) => e.campus === undefined).length;
    if (missing > 0) c.error('graph-campus-flag', `${missing} graph edges lack the v2 'campus' flag`);
  }
  const ctx: PlaceCtx = { boundary: boundaryMp, buildings: footprints, graph: graph?.data ?? null };
  let placeIds = new Set<string>();
  if (places) {
    placeIds = checkPlaces(places.data.places, ctx, opts, c);
    if (buildings) checkBuildingPlaceSync(buildings.data, places.data.places, c);
  }
  if (context) checkContextPlaces(context.data.places, placeIds, ctx, opts, c);
  if (relations && places) checkRelations(relations.data.relations, placeIds, c);
  if (detections && buildings) checkDetections(detections.data, buildings.data, manifest?.data ?? null, c);
  if (review) checkReview(review.data, new Set(footprints.keys()), placeIds, c);
  if (manifest)
    checkDerivedCounts(
      manifest.data,
      {
        places: places?.data.places,
        context: context?.data.places,
        buildings: buildings?.data,
        detections: detections?.data,
        review: review?.data,
      },
      c,
    );
  if (opts.landmarks) {
    const present = {
      buildings: new Set(footprints.keys()),
      places: placeIds,
      boundary: new Set(boundary?.data.features.map((f) => f.properties.id) ?? []),
    };
    for (const m of missingLandmarks(opts.landmarks, present)) c.error('landmark-missing', m);
  }
  let countGuard: CountGuardResult | null = null;
  const baseline: CountBaseline | null =
    opts.baseline ??
    (opts.previousManifest
      ? {
          origin: 'explicit',
          ref: 'previous manifest',
          schemaVersion: opts.previousManifest.schemaVersion,
          datasetVersion: opts.previousManifest.datasetVersion,
          counts: opts.previousManifest.counts,
        }
      : null);
  const acceptance: CountAcceptance | null =
    opts.acceptance ??
    (opts.acceptCountChanges
      ? {
          origin: 'cli',
          reason: 'accepted by the caller',
          acceptedBy: null,
          acceptedAt: null,
          baselineDatasetVersion: null,
        }
      : null);
  if (manifest && (baseline || (opts.staleAcceptances?.length ?? 0) > 0)) {
    countGuard = evaluateCountGuard(
      manifest.data,
      baseline,
      acceptance,
      opts.countThresholds ?? {},
      opts.staleAcceptances ?? [],
    );
    reportCountGuard(countGuard, opts.countThresholds ?? {}, c);
  }
  if (places && opts.checkLinks)
    await checkLinks([...places.data.places, ...(context?.data.places ?? [])], opts.checkLinks, c);
  return { errors: c.errors, warnings: c.warnings, countGuard };
}

/** Every footprint has exactly one building place with the same identity and label, and vice versa. */
function checkBuildingPlaceSync(file: BuildingsFile, places: Place[], c: Collector) {
  const byId = new Map(places.map((p) => [p.id, p]));
  for (const f of file.features) {
    const p = byId.get(f.properties.id);
    if (!p) {
      c.error('building-place', `${f.properties.id} has no place in places.json`);
      continue;
    }
    if (p.kind !== 'building') c.error('building-place', `${p.id} footprint's place has kind ${p.kind}`);
    if (
      p.name !== f.properties.name ||
      p.displayName !== f.properties.displayName ||
      p.categoryId !== f.properties.categoryId
    )
      c.error(
        'building-place',
        `${p.id}: name/displayName/categoryId differ between the footprint and its place`,
      );
  }
}

function collectFootprints(file: BuildingsFile, out: Map<string, MultiPolygon>, c: Collector) {
  for (const f of file.features) {
    const id = f.properties.id;
    if (out.has(id)) c.error('duplicate-id', `duplicate building feature ${id}`);
    const mp = toMultiPolygon(f.geometry);
    if (!mp) {
      c.error('building-geometry', `${id} is not a Polygon/MultiPolygon`);
      continue;
    }
    checkMultiPolygon(id, mp, c);
    if (f.properties.renderMinHeightM >= f.properties.renderHeightM)
      c.error('building-height', `${id} renderMinHeightM ≥ renderHeightM`);
    out.set(id, mp);
  }
}
