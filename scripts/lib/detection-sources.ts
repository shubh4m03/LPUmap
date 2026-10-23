/**
 * Committed snapshots of machine-detected building footprints
 * (data/raw/detections/), written by scripts/fetch-footprints.ts and read by
 * the offline build. Owner decision 1: these are review leads only — a flat,
 * dashed "Unverified detected footprints" layer, never buildings.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const DETECTIONS_RAW_DIR = 'detections';
export const MS_DIR = 'microsoft-ml';
export const MS_FOOTPRINTS_FILE = 'footprints.geojsonl';
export const MS_LICENSE_FILE = 'LICENSE-CDLA-Permissive-2.0.txt';
export const GOOGLE_DIR = 'google-open-buildings';
export const GOOGLE_POINTS_FILE = 'points.csv';
export const GOOGLE_LICENSE_FILE = 'LICENSE-NOTICE.md';
/** Where the CDLA text is shipped next to the data (manifest source `licenseTextPath`). */
export const SHIPPED_LICENSE_DIR = 'licenses';
export const SHIPPED_MS_LICENSE = 'CDLA-Permissive-2.0.txt';

const isoDateTime = z.iso.datetime();
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
const bboxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export const msSourceSchema = z.strictObject({
  sourceId: z.literal('microsoft-ml-buildings'),
  name: z.string().min(1),
  url: z.url(),
  license: z.literal('CDLA-Permissive-2.0'),
  licenseUrl: z.url(),
  attribution: z.string().min(1),
  datasetLinksUrl: z.url(),
  tileUrl: z.url(),
  quadkey: z.string().regex(/^[0-3]+$/),
  release: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  retrievedAt: isoDateTime,
  tileSha256: sha256Hex,
  tileBytes: z.number().int().positive(),
  featuresInTile: z.number().int().nonnegative(),
  featuresInSnapshot: z.number().int().nonnegative(),
  /** [w, s, e, n]: a footprint is kept when any vertex lies inside (APP_CONFIG.map.maxBounds). */
  filterBBox: bboxSchema,
  licenseTextUrl: z.url(),
  licenseTextRetrievedAt: isoDateTime,
  notes: z.string().optional(),
});
export type MsSource = z.infer<typeof msSourceSchema>;

export const googleSourceSchema = z.strictObject({
  sourceId: z.literal('google-open-buildings'),
  name: z.string().min(1),
  url: z.url(),
  /** Dual-licensed CC BY 4.0 or ODbL 1.0; the owner chose ODbL for this ODbL derived database. */
  license: z.literal('ODbL 1.0'),
  licenseUrl: z.url(),
  attribution: z.string().min(1),
  version: z.literal('v3'),
  tileUrl: z.url(),
  s2Token: z.string().min(1),
  retrievedAt: isoDateTime,
  tileSha256: sha256Hex,
  tileBytes: z.number().int().positive(),
  rowsInTile: z.number().int().nonnegative(),
  rowsInSnapshot: z.number().int().nonnegative(),
  filterBBox: bboxSchema,
  /** Confidence at or above which a point confirms or stands as a detection, and where the value comes from. */
  confidenceThreshold: z.number().min(0).max(1),
  confidenceThresholdSource: z.string().min(1),
  /** Minimum source-reported area (m²) for a Google-only point detection. */
  minAreaM2: z.number().nonnegative(),
  notes: z.string().optional(),
});
export type GoogleSource = z.infer<typeof googleSourceSchema>;

export interface MsSnapshot {
  source: MsSource;
  /** Source lines exactly as published (GeoJSON features, one per line). */
  lines: string[];
  licenseText: string;
}

export interface GoogleSnapshot {
  source: GoogleSource;
  /** Source rows exactly as published: latitude,longitude,area_in_meters,confidence,full_plus_code. */
  rows: string[];
  licenseNotice: string;
}

function readSource<S extends z.ZodType>(dir: string, schema: S): z.infer<S> {
  const path = join(dir, 'SOURCE.json');
  const parsed = schema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) throw new Error(`${path} is invalid:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

const nonEmptyLines = (text: string) => text.split(/\r?\n/).filter((l) => l.trim() !== '');

/** Reads the committed snapshots under <rawRoot>/detections; a missing source directory = not used. */
export function readDetectionSnapshots(detectionsDir: string): {
  ms: MsSnapshot | null;
  google: GoogleSnapshot | null;
} {
  const msDir = join(detectionsDir, MS_DIR);
  const gDir = join(detectionsDir, GOOGLE_DIR);
  let ms: MsSnapshot | null = null;
  let google: GoogleSnapshot | null = null;
  if (existsSync(join(msDir, 'SOURCE.json'))) {
    const source = readSource(msDir, msSourceSchema);
    const lines = nonEmptyLines(readFileSync(join(msDir, MS_FOOTPRINTS_FILE), 'utf8'));
    if (lines.length !== source.featuresInSnapshot)
      throw new Error(
        `${MS_DIR}/${MS_FOOTPRINTS_FILE} has ${lines.length} features, SOURCE.json says ${source.featuresInSnapshot}`,
      );
    const licensePath = join(msDir, MS_LICENSE_FILE);
    if (!existsSync(licensePath))
      throw new Error(
        `${licensePath} is missing: CDLA-Permissive-2.0 §2.1 requires shipping the licence text`,
      );
    ms = { source, lines, licenseText: readFileSync(licensePath, 'utf8') };
  }
  if (existsSync(join(gDir, 'SOURCE.json'))) {
    const source = readSource(gDir, googleSourceSchema);
    const rows = nonEmptyLines(readFileSync(join(gDir, GOOGLE_POINTS_FILE), 'utf8'));
    if (rows.length !== source.rowsInSnapshot)
      throw new Error(
        `${GOOGLE_DIR}/${GOOGLE_POINTS_FILE} has ${rows.length} rows, SOURCE.json says ${source.rowsInSnapshot}`,
      );
    const noticePath = join(gDir, GOOGLE_LICENSE_FILE);
    if (!existsSync(noticePath)) throw new Error(`${noticePath} is missing (ODbL notice)`);
    google = { source, rows, licenseNotice: readFileSync(noticePath, 'utf8') };
  }
  return { ms, google };
}
