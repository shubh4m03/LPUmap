/**
 * Pure helpers for scripts/fetch-footprints.ts: locate the Microsoft tile in
 * dataset-links.csv, filter source records to the map extent, extract the
 * CDLA-Permissive-2.0 text from its official page, and stream a gzip download
 * while hashing it (timeouts and bounded retries: scripts/lib/http.ts).
 * Records are kept byte-for-byte as published (never re-projected, rounded or
 * shifted).
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { openStream, withRetry } from './http.ts';
import type { RetryOptions } from './http.ts';

export type BBox4 = readonly [number, number, number, number];

/** The `Url` of the dataset-links.csv row for (location, quadkey); throws when absent or ambiguous. */
export function findTileUrl(csv: string, location: string, quadkey: string): string {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = lines[0]?.split(',').map((h) => h.trim()) ?? [];
  const iLoc = header.indexOf('Location');
  const iKey = header.indexOf('QuadKey');
  const iUrl = header.indexOf('Url');
  if (iLoc < 0 || iKey < 0 || iUrl < 0)
    throw new Error('dataset-links.csv lacks Location/QuadKey/Url columns');
  const hits = lines
    .slice(1)
    .map((l) => l.split(','))
    .filter((cols) => cols[iLoc] === location && cols[iKey] === quadkey);
  if (hits.length !== 1)
    throw new Error(`dataset-links.csv has ${hits.length} rows for ${location} ${quadkey}`);
  return hits[0]![iUrl]!;
}

/** Release date (YYYY-MM-DD) embedded in a Microsoft tile URL. */
export function releaseOf(url: string): string {
  const m = /\/(\d{4}-\d{2}-\d{2})\//.exec(url);
  if (!m?.[1]) throw new Error(`cannot find a release date in ${url}`);
  return m[1];
}

const inBox = (x: number, y: number, b: BBox4) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

/** Keeps a Microsoft GeoJSON line when any vertex lies inside the box (the line is never altered). */
export function keepMsLine(line: string, box: BBox4): boolean {
  if (!line.includes('"coordinates"')) return false;
  const nums = /"coordinates"\s*:\s*(\[[\s\S]*\])\s*\}\s*\}?\s*$/.exec(line);
  const coords = (nums?.[1] ?? '').match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi);
  if (!coords) return false;
  for (let i = 0; i + 1 < coords.length; i += 2)
    if (inBox(Number(coords[i]), Number(coords[i + 1]), box)) return true;
  return false;
}

/** Keeps a Google points row (latitude,longitude,area,confidence,plus_code) inside the box. */
export function keepGoogleRow(row: string, box: BBox4): boolean {
  const [lat, lon] = row.split(',', 2).map(Number);
  return (
    lat !== undefined &&
    lon !== undefined &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    inBox(lon, lat, box)
  );
}

const ENTITIES: Record<string, string> = {
  '&#8211;': '–',
  '&#8212;': '—',
  '&#8216;': '‘',
  '&#8217;': '’',
  '&#8220;': '“',
  '&#8221;': '”',
  '&amp;': '&',
  '&nbsp;': ' ',
  '&quot;': '"',
  '&#039;': "'",
};

/**
 * Plain text of the agreement from https://cdla.dev/permissive-2-0/: the
 * paragraphs from the centred title to the last definition. Throws when the
 * page no longer has the expected structure (so a changed page is noticed).
 */
export function extractCdlaText(html: string): string {
  const start = html.indexOf(
    'Community Data License Agreement &#8211; Permissive &#8211; Version 2.0</strong>',
  );
  if (start < 0) throw new Error('CDLA page: licence title not found');
  const blockStart = html.lastIndexOf('<p', start);
  const blockEnd = html.indexOf('</div>', start);
  const block = html.slice(blockStart, blockEnd);
  const paras = [...block.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) =>
    m[1]!
      .replace(/<[^>]+>/g, '')
      .replace(/&#?\w+;/g, (e) => ENTITIES[e] ?? e)
      .replace(/\s+/g, ' ')
      .trim(),
  );
  const text = paras.filter((p) => p !== '').join('\n\n');
  for (const must of ['2.1. A Data Recipient may share Data', '5.4. “Results” means'])
    if (!text.includes(must)) throw new Error(`CDLA page: expected clause not found (${must})`);
  return `${text}\n`;
}

export interface StreamStats {
  sha256: string;
  bytes: number;
  lines: number;
}

/**
 * Streams gzip bytes, hashing the compressed input and yielding decompressed
 * lines to `onLine`. An error on the input (a dropped or stalled download)
 * rejects instead of leaving the line reader waiting forever.
 */
export async function scanGzipLines(input: Readable, onLine: (line: string) => void): Promise<StreamStats> {
  const hash = createHash('sha256');
  let bytes = 0;
  input.on('data', (chunk: Buffer) => {
    hash.update(chunk);
    bytes += chunk.length;
  });
  const gunzip = createGunzip();
  input.on('error', (e) => gunzip.destroy(e));
  const rl = createInterface({ input: input.pipe(gunzip), crlfDelay: Infinity });
  let lines = 0;
  for await (const line of rl) {
    lines++;
    onLine(line);
  }
  return { sha256: hash.digest('hex'), bytes, lines };
}

export interface ScanResult {
  stats: StreamStats;
  kept: string[];
}

/**
 * Reads a gzip line file from `localFile` when given, else downloads `url`
 * (research User-Agent, header timeout, stall timeout). A failed or stalled
 * download is restarted from scratch, at most `retry.retries` times with
 * exponential backoff, so a partial read never leaks into the result.
 */
export async function scanSource(
  url: string,
  localFile: string | undefined,
  fetchImpl: typeof fetch,
  keep: (line: string) => boolean,
  retry: RetryOptions = {},
): Promise<ScanResult> {
  const run = async (input: Readable): Promise<ScanResult> => {
    const kept: string[] = [];
    const stats = await scanGzipLines(input, (line) => {
      if (keep(line)) kept.push(line);
    });
    return { stats, kept };
  };
  if (localFile) return run(createReadStream(localFile));
  return withRetry(url, async () => run(await openStream(fetchImpl, url, retry)), retry);
}
