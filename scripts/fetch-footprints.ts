/**
 * Refreshes the committed machine-detection snapshots in data/raw/detections/
 * (network). A normal build never needs this: the snapshots are committed and
 * `npm run data:build` reads them offline.
 *
 *   node scripts/fetch-footprints.ts [--out data/raw/detections] [--force]
 *        [--ms-links <dataset-links.csv URL>] [--ms-file <local tile .csv.gz>]
 *        [--google-url <points .csv.gz URL>] [--google-file <local .csv.gz>]
 *        [--retrieved-at <ISO time, required with a local file>]
 *
 * Microsoft Global ML Building Footprints (CDLA Permissive 2.0): the tile URL
 * is looked up in dataset-links.csv (row India / quadkey 123121013); the full
 * licence text is fetched from https://cdla.dev/permissive-2-0/ and committed
 * next to the snapshot (CDLA-P 2.0 §2.1). Google Open Buildings v3 points
 * (CC BY 4.0 or ODbL 1.0; used under ODbL 1.0): S2 cell 391b, URL from
 * docs/GEODATA_SOURCES_AND_LICENSES.md §3. Both are filtered to
 * APP_CONFIG.map.maxBounds and kept byte-for-byte as published — never
 * re-projected, rounded or shifted (the ~5.6 m MS–OSM offset is documented,
 * not corrected).
 *
 * A local file (--ms-file / --google-file) replaces the download of that file
 * only; the published URL is still recorded and --retrieved-at must say when
 * that copy was downloaded. Set DATA_FETCH_CONTACT for the User-Agent.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_CONFIG } from '../src/config/index.ts';
import { parseArgs } from './lib/args.ts';
import {
  GOOGLE_DIR,
  GOOGLE_LICENSE_FILE,
  GOOGLE_POINTS_FILE,
  googleSourceSchema,
  MS_DIR,
  MS_FOOTPRINTS_FILE,
  MS_LICENSE_FILE,
  msSourceSchema,
} from './lib/detection-sources.ts';
import type { GoogleSource, MsSource } from './lib/detection-sources.ts';
import { userAgent as osmUserAgent } from './lib/fetch-osm-lib.ts';
import {
  extractCdlaText,
  findTileUrl,
  keepGoogleRow,
  keepMsLine,
  openSource,
  releaseOf,
  scanGzipLines,
} from './lib/fetch-footprints-lib.ts';

const root = resolve(fileURLToPath(import.meta.url), '../..');

const DEFAULTS = {
  msRepo: 'https://github.com/microsoft/GlobalMLBuildingFootprints',
  msLinks: 'https://bfppub.blob.core.windows.net/%24web/2026-08-13/dataset-links.csv',
  msLocation: 'India',
  msQuadkey: '123121013',
  cdlaUrl: 'https://cdla.dev/permissive-2-0/',
  googleSite: 'https://sites.research.google/gr/open-buildings/',
  googleUrl:
    'https://storage.googleapis.com/open-buildings-data/v3/points_s2_level_6_gzip_no_header/391b_buildings.csv.gz',
  googleS2: '391b',
  /** 90 %-precision threshold for S2 level-4 cell 391 (Google's score_thresholds_s2_level_4.csv). */
  googleThreshold: 0.875,
  googleMinAreaM2: 50,
  odblUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
} as const;

function writeAtomic(path: string, text: string): void {
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
}

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

async function main(): Promise<void> {
  const { values, flags } = parseArgs(
    process.argv.slice(2),
    ['out', 'ms-links', 'ms-file', 'google-url', 'google-file', 'retrieved-at'],
    ['force', 'skip-ms', 'skip-google'],
  );
  const out = resolve(values.out ?? resolve(root, 'data/raw/detections'));
  const version = (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string })
    .version;
  const ua = osmUserAgent(version, process.env.DATA_FETCH_CONTACT);
  const box = APP_CONFIG.map.maxBounds;
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  if ((values['ms-file'] || values['google-file']) && !values['retrieved-at'])
    throw new Error('--retrieved-at is required with a local file: record when that copy was downloaded');
  const retrievedAt = values['retrieved-at'] ?? now;

  if (!flags.has('skip-ms')) {
    const dir = join(out, MS_DIR);
    if (existsSync(join(dir, 'SOURCE.json')) && !flags.has('force')) {
      console.log(`${dir} exists; nothing fetched (use --force to refresh).`);
    } else {
      mkdirSync(dir, { recursive: true });
      const linksUrl = values['ms-links'] ?? DEFAULTS.msLinks;
      console.log(`Reading ${linksUrl} …`);
      const linksRes = await fetch(linksUrl, { headers: { 'User-Agent': ua } });
      if (!linksRes.ok) throw new Error(`${linksUrl} answered HTTP ${linksRes.status}`);
      const tileUrl = findTileUrl(await linksRes.text(), DEFAULTS.msLocation, DEFAULTS.msQuadkey);
      console.log(
        `Tile ${DEFAULTS.msQuadkey}: ${tileUrl}${values['ms-file'] ? ` (local copy ${values['ms-file']})` : ''}`,
      );
      const kept: string[] = [];
      const stats = await scanGzipLines(await openSource(tileUrl, values['ms-file'], fetch, ua), (line) => {
        if (keepMsLine(line, box)) kept.push(line);
      });
      console.log(`Reading ${DEFAULTS.cdlaUrl} …`);
      const cdlaRes = await fetch(DEFAULTS.cdlaUrl, { headers: { 'User-Agent': ua } });
      if (!cdlaRes.ok) throw new Error(`${DEFAULTS.cdlaUrl} answered HTTP ${cdlaRes.status}`);
      const licenseText = extractCdlaText(await cdlaRes.text());
      const source: MsSource = msSourceSchema.parse({
        sourceId: 'microsoft-ml-buildings',
        name: 'Microsoft Global ML Building Footprints',
        url: DEFAULTS.msRepo,
        license: 'CDLA-Permissive-2.0',
        licenseUrl: DEFAULTS.cdlaUrl,
        attribution: 'Building footprints © Microsoft (Global ML Building Footprints), CDLA Permissive 2.0',
        datasetLinksUrl: linksUrl,
        tileUrl,
        quadkey: DEFAULTS.msQuadkey,
        release: releaseOf(tileUrl),
        retrievedAt,
        tileSha256: stats.sha256,
        tileBytes: stats.bytes,
        featuresInTile: stats.lines,
        featuresInSnapshot: kept.length,
        filterBBox: [...box],
        licenseTextUrl: DEFAULTS.cdlaUrl,
        licenseTextRetrievedAt: now,
        notes:
          'Each line is a source feature exactly as published (GeoJSON, height and confidence -1 = not provided), kept when any ' +
          'vertex lies in the map extent. Machine-detected, unverified; never shifted (the ~5.6 m offset to OSM is documented in ' +
          'docs/CAMPUS_GEOGRAPHY_AUDIT.md section 5.1, not corrected).',
      });
      writeAtomic(join(dir, MS_FOOTPRINTS_FILE), kept.length ? `${kept.join('\n')}\n` : '');
      writeAtomic(join(dir, MS_LICENSE_FILE), licenseText);
      writeAtomic(join(dir, 'SOURCE.json'), json(source));
      console.log(`Microsoft: kept ${kept.length} of ${stats.lines} features (tile sha256 ${stats.sha256}).`);
    }
  }

  if (!flags.has('skip-google')) {
    const dir = join(out, GOOGLE_DIR);
    if (existsSync(join(dir, 'SOURCE.json')) && !flags.has('force')) {
      console.log(`${dir} exists; nothing fetched (use --force to refresh).`);
    } else {
      mkdirSync(dir, { recursive: true });
      const url = values['google-url'] ?? DEFAULTS.googleUrl;
      console.log(`Reading ${url}${values['google-file'] ? ` (local copy ${values['google-file']})` : ''} …`);
      const kept: string[] = [];
      const stats = await scanGzipLines(await openSource(url, values['google-file'], fetch, ua), (row) => {
        if (keepGoogleRow(row, box)) kept.push(row);
      });
      const source: GoogleSource = googleSourceSchema.parse({
        sourceId: 'google-open-buildings',
        name: 'Google Open Buildings',
        url: DEFAULTS.googleSite,
        license: 'ODbL 1.0',
        licenseUrl: DEFAULTS.odblUrl,
        attribution: 'Google Open Buildings (v3), used under the Open Database License 1.0',
        version: 'v3',
        tileUrl: url,
        s2Token: DEFAULTS.googleS2,
        retrievedAt,
        tileSha256: stats.sha256,
        tileBytes: stats.bytes,
        rowsInTile: stats.lines,
        rowsInSnapshot: kept.length,
        filterBBox: [...box],
        confidenceThreshold: DEFAULTS.googleThreshold,
        confidenceThresholdSource:
          '90 % precision threshold for S2 level-4 cell 391 in Google score_thresholds_s2_level_4.csv ' +
          '(0.801 / 0.839 / 0.875 for 80 / 85 / 90 %), recorded in docs/GEODATA_SOURCES_AND_LICENSES.md section 3',
        minAreaM2: DEFAULTS.googleMinAreaM2,
        notes:
          'Rows exactly as published: latitude,longitude,area_in_meters,confidence,full_plus_code. Points only (the polygon file ' +
          'was not downloaded), so Google-only detections are point features. Machine-detected, unverified.',
      });
      writeAtomic(join(dir, GOOGLE_POINTS_FILE), kept.length ? `${kept.join('\n')}\n` : '');
      writeAtomic(
        join(dir, GOOGLE_LICENSE_FILE),
        [
          '# Google Open Buildings — licence notice',
          '',
          `Data: Google Open Buildings ${source.version}, ${DEFAULTS.googleSite}`,
          '',
          'Google publishes Open Buildings under two licences and lets the user choose: Creative Commons Attribution 4.0',
          '(CC BY 4.0) or the Open Data Commons Open Database License 1.0 (ODbL 1.0). This project uses it under',
          `**ODbL 1.0** (${DEFAULTS.odblUrl}), the licence of the OpenStreetMap-derived database it is combined with.`,
          '',
          'Attribution: "Google Open Buildings". The extract in points.csv and anything derived from it in',
          'public/data are offered under ODbL 1.0. Machine-detected and unverified: not building records.',
          '',
        ].join('\n'),
      );
      writeAtomic(join(dir, 'SOURCE.json'), json(source));
      console.log(`Google: kept ${kept.length} of ${stats.lines} rows (file sha256 ${stats.sha256}).`);
    }
  }
  console.log('Next: npm run data:check, then review docs/CAMPUS_BUILDING_COVERAGE.md before committing.');
}

main().catch((e: unknown) => {
  console.error(`fetch-footprints failed: ${(e as Error).message}`);
  process.exit(1);
});
