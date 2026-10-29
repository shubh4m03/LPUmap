/**
 * Raw OSM snapshot refresh. Tries Overpass first, falls back to the OSM API
 * 0.6 (/relation/<id>/full and /map?bbox). Polite: the neutral research
 * User-Agent, sequential requests, timeouts and bounded retries with
 * exponential backoff (scripts/lib/http.ts).
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bboxOfCoords } from './geometry.ts';
import { FetchFailedError, fetchTextWithRetry } from './http.ts';
import type { RetryOptions } from './http.ts';
import { relationGeometry } from './osm-geometry.ts';
import { parseOsm } from './osm-parse.ts';
import type { SourceMeta } from './source-meta.ts';

export { FetchFailedError, fetchTextWithRetry } from './http.ts';
export type { RetryOptions } from './http.ts';

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
export const OSM_API = 'https://api.openstreetmap.org/api/0.6';
/** ≈ 500 m around the boundary extent, so nearby off-campus streets (Law Gate) are included. */
export const FETCH_MARGIN_DEG = 0.005;
export const BBOX_FILE = 'campus-bbox.osm';
export const boundaryFile = (relationId: number) => `boundary-relation-${relationId}.osm`;

export function withMargin(
  b: [number, number, number, number],
  margin: number,
): [number, number, number, number] {
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return [r(b[0] - margin), r(b[1] - margin), r(b[2] + margin), r(b[3] + margin)];
}

export function overpassRelationQuery(relationId: number): string {
  return `[out:xml][timeout:90];rel(${relationId});(._;>;);out meta;`;
}

/** bbox is [w, s, e, n]; Overpass wants (s, w, n, e). */
export function overpassBboxQuery(b: readonly [number, number, number, number]): string {
  return `[out:xml][timeout:180];(nwr(${b[1]},${b[0]},${b[3]},${b[2]}););(._;>;);out meta;`;
}

export interface FetchSnapshotOptions {
  rawDir: string;
  relationId: number;
  force: boolean;
  fetchImpl: typeof fetch;
  now: () => Date;
  retry?: RetryOptions;
  log?: (msg: string) => void;
}

export type FetchSnapshotResult = { status: 'cached' } | { status: 'fetched'; meta: SourceMeta };

function assertHasRelation(text: string, relationId: number): ReturnType<typeof parseOsm> {
  const data = parseOsm(text);
  if (!data.relations.has(relationId)) throw new FetchFailedError(`response lacks relation ${relationId}`);
  return data;
}

async function viaOverpass<T>(
  o: FetchSnapshotOptions,
  query: string,
  check: (text: string) => T,
): Promise<{ text: string; endpoint: string } | null> {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const text = await fetchTextWithRetry(
        o.fetchImpl,
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
        },
        o.retry,
      );
      check(text);
      return { text, endpoint };
    } catch (e) {
      o.log?.(`Overpass ${endpoint} failed: ${(e as Error).message}`);
    }
  }
  return null;
}

export async function fetchSnapshot(o: FetchSnapshotOptions): Promise<FetchSnapshotResult> {
  const files = [boundaryFile(o.relationId), BBOX_FILE];
  const exists = [...files, 'SOURCE.json'].every((f) => existsSync(join(o.rawDir, f)));
  if (exists && !o.force) return { status: 'cached' };
  const get = { method: 'GET' };

  let boundaryText = (
    await viaOverpass(o, overpassRelationQuery(o.relationId), (t) => assertHasRelation(t, o.relationId))
  )?.text;
  if (!boundaryText) {
    o.log?.('Falling back to the OSM API for the boundary relation.');
    boundaryText = await fetchTextWithRetry(
      o.fetchImpl,
      `${OSM_API}/relation/${o.relationId}/full`,
      get,
      o.retry,
    );
  }
  const boundaryData = assertHasRelation(boundaryText, o.relationId);
  const geom = relationGeometry(boundaryData, boundaryData.relations.get(o.relationId)!);
  const extent = bboxOfCoords(geom.multiPolygon.flat(2));
  if (!extent || geom.unclosedRings > 0 || geom.missingWays > 0) {
    throw new FetchFailedError(`relation ${o.relationId} did not assemble into a closed boundary`);
  }
  const bbox = withMargin(extent, FETCH_MARGIN_DEG);

  let method: SourceMeta['method'] = 'overpass';
  let url: string;
  const over = await viaOverpass(o, overpassBboxQuery(bbox), parseOsm);
  let bboxText: string;
  if (over) {
    bboxText = over.text;
    url = over.endpoint;
  } else {
    o.log?.('Falling back to the OSM API /map for the campus bbox.');
    method = 'osm-api-map';
    url = `${OSM_API}/map?bbox=${bbox.join(',')}`;
    bboxText = await fetchTextWithRetry(o.fetchImpl, url, get, o.retry);
    parseOsm(bboxText);
  }

  const meta: SourceMeta = {
    sourceId: 'osm',
    name: 'OpenStreetMap',
    url,
    license: 'ODbL 1.0',
    attribution: '© OpenStreetMap contributors',
    retrievedAt: o
      .now()
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z'),
    method,
    bbox,
    files,
  };
  mkdirSync(o.rawDir, { recursive: true });
  // Write to temporary names first so a failure never leaves a half-updated snapshot.
  const writes: Array<[string, string]> = [
    [files[0]!, boundaryText],
    [files[1]!, bboxText],
    ['SOURCE.json', `${JSON.stringify(meta, null, 2)}\n`],
  ];
  for (const [name, text] of writes) writeFileSync(join(o.rawDir, `${name}.tmp`), text);
  for (const [name] of writes) renameSync(join(o.rawDir, `${name}.tmp`), join(o.rawDir, name));
  return { status: 'fetched', meta };
}
