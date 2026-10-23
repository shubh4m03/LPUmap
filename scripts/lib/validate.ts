/**
 * Validates a generated dataset directory: Zod schemas, manifest integrity,
 * referential integrity, geometry and graph invariants, plus warnings for
 * suspicious changes against a previous manifest.
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
  buildingsFileSchema,
  DATA_FILES,
  graphFileSchema,
  manifestSchema,
  placesFileSchema,
  relationsFileSchema,
} from '../../src/data/schema.ts';
import type { BuildingsFile, GraphFile, Manifest, Place, Relation } from '../../src/data/schema.ts';
import { inBBox, pointInMultiPolygon } from './geometry.ts';
import type { MultiPolygon } from './geometry.ts';
import { checkCounts, checkLinks } from './validate-changes.ts';
import { checkGraph, checkMultiPolygon, toMultiPolygon } from './validate-geometry.ts';

export interface Issue {
  level: 'error' | 'warning';
  code: string;
  message: string;
}

export interface ValidateOptions {
  dir: string;
  previousManifest?: Manifest | null;
  /** Returns null for unparseable opening_hours; omit to skip that check. */
  parseHours?: ((raw: string) => unknown) | null;
  /** When set, HEAD-requests every website (opt-in, network). */
  checkLinks?: { fetchImpl: typeof fetch; timeoutMs?: number } | null;
  changeThreshold?: number;
}

export interface ValidateResult {
  errors: Issue[];
  warnings: Issue[];
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

function checkManifest(m: Manifest, raws: Record<string, string>, c: Collector) {
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
}

function checkPlaces(
  places: Place[],
  ctx: { boundary: MultiPolygon | null; buildings: Map<string, MultiPolygon>; graph: GraphFile | null },
  opts: ValidateOptions,
  c: Collector,
) {
  const maxBounds = APP_CONFIG.map.maxBounds;
  const categories = new Set(CATEGORIES.map((x) => x.id));
  const ids = new Set<string>();
  for (const p of places) {
    if (ids.has(p.id)) c.error('duplicate-id', `duplicate place id ${p.id}`);
    ids.add(p.id);
    if (!p.displayName.trim()) c.error('display-name', `${p.id} has an empty displayName`);
    if (!categories.has(p.categoryId)) c.error('category', `${p.id} has unknown categoryId ${p.categoryId}`);
    if (p.contact?.website && !isHttpUrl(p.contact.website))
      c.error('website', `${p.id} website is not http(s): ${p.contact.website}`);
    if (p.location) {
      if (!inBBox(p.location, maxBounds))
        c.error('out-of-bounds', `${p.id} location ${p.location.join(',')} is outside maxBounds`);
      if (p.campusZone === 'on-campus' && ctx.boundary && !pointInMultiPolygon(p.location, ctx.boundary)) {
        c.error('campus-zone', `${p.id} is marked on-campus but lies outside the boundary`);
      }
      if (
        p.campusZone === 'off-campus-nearby' &&
        ctx.boundary &&
        pointInMultiPolygon(p.location, ctx.boundary)
      ) {
        c.warn('campus-zone', `${p.id} is marked off-campus but lies inside the boundary`);
      }
    } else if (p.graphNodeId !== undefined && p.kind !== 'organization') {
      c.error('graph-node', `${p.id} has a graphNodeId but no location`);
    }
    if (p.graphNodeId !== undefined) {
      if (!ctx.graph || p.graphNodeId >= ctx.graph.nodes.length)
        c.error('graph-node', `${p.id} graphNodeId ${p.graphNodeId} does not exist`);
      if ((p.connectorLengthM ?? 0) > APP_CONFIG.routing.maxPlaceConnectorM) {
        c.error('connector', `${p.id} connector ${p.connectorLengthM} m exceeds maxPlaceConnectorM`);
      }
    }
    if (p.kind === 'building' && !ctx.buildings.has(p.id))
      c.error('building-footprint', `${p.id} has no footprint in buildings.geojson`);
    if (p.buildingId && !ctx.buildings.has(p.buildingId))
      c.error('building-ref', `${p.id} buildingId ${p.buildingId} does not exist`);
    if (p.kind === 'entrance') checkEntrance(p, ctx.buildings, c);
    if (p.openingHours && opts.parseHours && opts.parseHours(p.openingHours) === null) {
      c.warn(
        'opening-hours',
        `${p.id} opening_hours "${p.openingHours}" is not in the supported subset (shown as unknown)`,
      );
    }
  }
  return ids;
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
  const qualityPath = join(dir, DATA_FILES.quality);
  const qualityRaw = existsSync(qualityPath) ? readFileSync(qualityPath, 'utf8') : undefined;
  if (qualityRaw === undefined) c.error('missing-file', `${DATA_FILES.quality} does not exist`);

  if (manifest) {
    const raws: Record<string, string | undefined> = {
      boundary: boundary?.raw,
      buildings: buildings?.raw,
      basemap: basemap?.raw,
      places: places?.raw,
      relations: relations?.raw,
      graph: graph?.raw,
      quality: qualityRaw,
    };
    checkManifest(manifest.data, raws as Record<string, string>, c);
  }

  let boundaryMp: MultiPolygon | null = null;
  if (boundary) {
    const f = boundary.data.features[0];
    boundaryMp = f ? toMultiPolygon(f.geometry) : null;
    if (!boundaryMp) c.error('boundary', 'boundary.geojson has no Polygon/MultiPolygon feature');
    else checkMultiPolygon('boundary', boundaryMp, c);
  }
  const footprints = new Map<string, MultiPolygon>();
  if (buildings) collectFootprints(buildings.data, footprints, c);
  if (basemap) {
    for (const f of basemap.data.features) {
      const coords = f.geometry.coordinates as unknown;
      if (!Array.isArray(coords) || coords.length === 0)
        c.error('basemap-geometry', `${f.properties.id} has empty geometry`);
    }
  }
  if (graph) checkGraph(graph.data, c);
  let placeIds = new Set<string>();
  if (places)
    placeIds = checkPlaces(
      places.data.places,
      { boundary: boundaryMp, buildings: footprints, graph: graph?.data ?? null },
      opts,
      c,
    );
  if (relations && places) checkRelations(relations.data.relations, placeIds, c);
  if (manifest && opts.previousManifest)
    checkCounts(manifest.data, opts.previousManifest, opts.changeThreshold ?? 0.25, c);
  if (places && opts.checkLinks) await checkLinks(places.data.places, opts.checkLinks, c);
  return { errors: c.errors, warnings: c.warnings };
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
    if (f.properties.minHeightM >= f.properties.heightM)
      c.error('building-height', `${id} minHeightM ≥ heightM`);
    out.set(id, mp);
  }
}
