/**
 * Orchestrates raw OSM snapshot + curated records → public/data/*.
 * Pure function of its inputs: no network, no wall-clock time, stable
 * ordering and fixed precision, so rebuilds are byte-identical.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import type { Manifest, Place, SourceRecord } from '../../src/data/schema.ts';
import { buildBasemap } from './build-basemap.ts';
import {
  boundaryFeatureCollection,
  buildBoundary,
  BuildError,
  CAMPUS_RELATION_ID,
} from './build-boundary.ts';
import { buildingsFeatureCollection, collectBuildings } from './build-buildings.ts';
import { buildGraph } from './build-graph.ts';
import { collectPlaces } from './build-places.ts';
import { buildRelations, sortRelations } from './build-relations.ts';
import { attachConnectors } from './connectors.ts';
import { loadCurated, mergeCurated } from './curated.ts';
import { CURATED_SCHEMAS } from './curated-schema.ts';
import { round } from './geometry.ts';
import { mergeOsmData, parseOsm } from './osm-parse.ts';
import { buildQualityReport } from './quality.ts';
import type { QualityReport } from './quality.ts';
import { qualityMarkdown } from './quality-markdown.ts';
import { readSourceMeta } from './source-meta.ts';

export interface BuildOptions {
  inputDir: string;
  curatedDir: string;
  outDir: string;
  /** Where the previous manifest is preserved for change detection; null disables. */
  cacheDir?: string | null;
  /** Markdown quality report path; null disables. */
  reportPath?: string | null;
  /** Directory for generated JSON Schemas of curated inputs; null disables. */
  schemasDir?: string | null;
  relationId?: number;
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

function counts(
  places: readonly Place[],
  q: QualityReport,
  relationTypes: string[],
  basemapFeatures: number,
) {
  const c: Record<string, number> = {
    places: places.length,
    buildings: q.totals.buildings,
    'buildings:unnamed': q.unnamedBuildings.total,
    relations: q.totals.relations,
    basemapFeatures,
    'graph:nodes': q.graph.nodes,
    'graph:edges': q.graph.edges,
    'graph:components': q.graph.components,
    'graph:largestComponentNodes': q.graph.componentSizes[0] ?? 0,
    'places:withoutLocation': q.placesWithoutLocation.length,
    'places:notConnected': q.placesNotConnectedToGraph.length,
    'zone:on-campus': q.totals.onCampusPlaces,
    'zone:off-campus-nearby': q.totals.offCampusPlaces,
  };
  for (const cat of CATEGORIES)
    c[`category:${cat.id}`] = places.filter((p) => p.categoryId === cat.id).length;
  for (const k of placeKindSchema.options) c[`kind:${k}`] = places.filter((p) => p.kind === k).length;
  for (const h of ['osm-height', 'osm-levels-estimate', 'fallback'])
    c[`heightSource:${h}`] = q.heightSources[h] ?? 0;
  for (const t of relationTypeSchema.options)
    c[`relation:${t}`] = relationTypes.filter((x) => x === t).length;
  return Object.fromEntries(Object.entries(c).sort(([a], [b]) => a.localeCompare(b)));
}

export function runBuild(opts: BuildOptions): BuildResult {
  const meta = readSourceMeta(opts.inputDir);
  const rawFiles = rawSnapshotFiles(opts.inputDir);
  if (rawFiles.length === 0)
    throw new BuildError(`No raw OSM snapshot in ${opts.inputDir}. Run "npm run data:fetch".`);
  const osm = mergeOsmData(...rawFiles.map((f) => parseOsm(readFileSync(join(opts.inputDir, f), 'utf8'))));
  const maxBounds = APP_CONFIG.map.maxBounds;
  const retrievedAt = meta.retrievedAt;

  const boundary = buildBoundary(osm, opts.relationId ?? CAMPUS_RELATION_ID);
  const b = collectBuildings(osm, { maxBounds, insideCampus: boundary.contains });
  const basemap = buildBasemap(osm, maxBounds);
  const graphResult = buildGraph(osm, maxBounds);
  const osmRecords = collectPlaces(osm, { boundary, buildings: b.buildings, maxBounds, retrievedAt });
  const unconnected = attachConnectors(osmRecords, graphResult.graph, APP_CONFIG.routing.maxPlaceConnectorM);

  const curated = loadCurated(opts.curatedDir);
  const merged = mergeCurated(osmRecords, curated);
  const campusPlaceId = `osm:relation/${boundary.relation.id}`;
  const rel = buildRelations(merged.records, { campusPlaceId, buildings: b.buildings, retrievedAt });
  const relations = sortRelations([...rel.relations, ...merged.relations]);
  const places = merged.records.map((r) => r.place).sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));

  const quality = buildQualityReport({
    builtFrom: retrievedAt,
    places,
    buildings: b.buildings,
    relationCount: relations.length,
    graph: graphResult,
    unconnected,
    attachedEntrances: rel.attachedEntrances,
    unattachedEntrances: rel.unattachedEntrances,
    skipped: b.skipped,
    minHeightIgnored: b.minHeightIgnored,
    curated: { filesPresent: curated.present, ...merged.applied },
  });

  const contents: Record<Exclude<keyof typeof DATA_FILES, 'manifest'>, string> = {
    boundary: stableJson(boundaryFeatureCollection(boundary)),
    buildings: stableJson(buildingsFeatureCollection(b.buildings, new Map(places.map((p) => [p.id, p])))),
    basemap: stableJson(basemap),
    places: stableJson({ schemaVersion: DATA_SCHEMA_VERSION, places }),
    relations: stableJson({ schemaVersion: DATA_SCHEMA_VERSION, relations }),
    graph: stableJson(graphResult.graph),
    quality: stableJson(quality, true),
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
    sources: [osmSource, ...merged.sources],
    files,
    counts: counts(
      places,
      quality,
      relations.map((r) => r.type),
      basemap.features.length,
    ),
    bbox: boundary.bbox.map((v) => round(v, 7)) as Manifest['bbox'],
  };

  mkdirSync(opts.outDir, { recursive: true });
  const manifestPath = join(opts.outDir, DATA_FILES.manifest);
  if (opts.cacheDir && existsSync(manifestPath)) {
    mkdirSync(opts.cacheDir, { recursive: true });
    copyFileSync(manifestPath, join(opts.cacheDir, 'previous-manifest.json'));
  }
  for (const k of keys) writeFileSync(join(opts.outDir, DATA_FILES[k]), contents[k]);
  writeFileSync(manifestPath, stableJson(manifest, true));
  const generatedFiles: string[] = [];
  if (opts.reportPath) {
    mkdirSync(dirname(opts.reportPath), { recursive: true });
    writeFileSync(opts.reportPath, qualityMarkdown(quality, datasetVersion));
    generatedFiles.push(opts.reportPath);
  }
  if (opts.schemasDir) {
    mkdirSync(opts.schemasDir, { recursive: true });
    for (const [file, schema] of Object.entries(CURATED_SCHEMAS)) {
      writeFileSync(join(opts.schemasDir, file), stableJson(z.toJSONSchema(schema, { io: 'input' }), true));
      generatedFiles.push(join(opts.schemasDir, file));
    }
  }
  return { manifest, quality, outDir: opts.outDir, generatedFiles };
}
