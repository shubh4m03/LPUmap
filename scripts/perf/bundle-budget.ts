/**
 * Bundle-size budgets of the production build (docs/PERFORMANCE.md §Bundle
 * budgets, enforced). Pure: the caller supplies the file contents; the CLI is
 * scripts/perf/bundle.ts (`npm run perf:bundle`), run by `npm run check` and CI
 * after `vite build`.
 *
 * Chunks are classified by their contents, never by Rollup's chunk names, which
 * name a shared chunk after one of its modules and change between builds. When
 * the build has source maps (`vite build --sourcemap`), their `sources` decide;
 * the published build has none (vite.config.ts `build.sourcemap: false`), so
 * stable markers in the code decide instead: MapLibre's own error text, and the
 * names of the overviews' read-only e2e hooks (`window.__ATLAS_ISO__` in
 * src/isometric/test-hooks.ts, `window.__ATLAS_ART__` in src/isometric-art).
 * tests/unit/ci/bundle-budget.test.ts checks that those markers still exist.
 */
import { gzipSync } from 'node:zlib';

/** The enforced budgets. Keep in step with the table in docs/PERFORMANCE.md (a unit test compares them). */
export const BUNDLE_BUDGETS = {
  /** Every JS chunk, raw bytes. Vite's `chunkSizeWarningLimit` (1,200 kB) only warns; this fails. */
  maxChunkRawBytes: 1_200_000,
  /** The public entry script referenced by index.html, gzip level 9. */
  entryGzipBytes: 100_000,
  /** JS fetched before first render: the entry plus its `modulepreload` links, gzip level 9. */
  startupJsGzipBytes: 160_000,
  /** Stylesheets linked from index.html, gzip level 9. */
  startupCssGzipBytes: 25_000,
  /** Each chunk holding the Canvas2D isometric overview (`src/isometric/`), gzip level 9 (ISOMETRIC_AND_3D_DESIGN §9.1). */
  isometricChunkGzipBytes: 25_000,
  /** Sum of every file in the service-worker precache (what a first visit stores). */
  precacheBytes: 6_500_000,
} as const;

export type BundleBudgets = { readonly [K in keyof typeof BUNDLE_BUDGETS]: number };

/** Admin-only strings that must never reach the public entry (IMPLEMENTATION_STATUS §1.5). */
export const ADMIN_ENTRY_STRINGS = [
  'X-CSRF-Token',
  '/api/admin',
  'Owner password',
  'Moderation queue',
  'Approve and publish',
  'cdn-cgi/access',
] as const;

/** A string only MapLibre GL's own code contains (its "style not loaded" error). */
export const MAPLIBRE_MARKER = 'Style is not done loading';
/** Hook names that only the Canvas2D overview (src/isometric) and the illustrated overview (src/isometric-art) contain. */
export const ISOMETRIC_MARKER = '__ATLAS_ISO__';
export const ARTWORK_MARKER = '__ATLAS_ART__';
const MARKERS = [MAPLIBRE_MARKER, ISOMETRIC_MARKER, ARTWORK_MARKER] as const;

/** The only admin modules the public entry may contain: the lazy boundary and the path test. */
export const ADMIN_ENTRY_ALLOWED = ['src/admin/AdminRoot.tsx', 'src/admin/is-admin-path.ts'] as const;

export interface ChunkInfo {
  /** Path inside dist/, e.g. `assets/index-abc.js`. */
  file: string;
  rawBytes: number;
  gzipBytes: number;
  /** Repository-relative sources from the chunk's source map (`src/…`, `node_modules/…`); [] without a map. */
  sources: string[];
  /** Which classification markers the chunk's code contains. */
  markers: string[];
}

export interface BundleReport {
  entry: string | null;
  preloads: string[];
  stylesheets: string[];
  chunks: ChunkInfo[];
  cssGzipBytes: number;
  startupJsGzipBytes: number;
  precacheBytes: number | null;
  precacheFiles: number;
}

export interface BundleInput {
  indexHtml: string;
  /** Every file under dist/assets as `assets/<name>`. */
  assetFiles: string[];
  read(file: string): Uint8Array | null;
  /** sw.js precache URLs (null when there is no service worker). */
  precacheUrls: string[] | null;
  size(file: string): number | null;
}

export const gzipSize = (bytes: Uint8Array): number => gzipSync(bytes, { level: 9 }).length;

/** `../../src/x.ts` or an absolute path → `src/x.ts`; `node_modules/maplibre-gl/…` kept from `node_modules/`. */
export function normalizeSource(source: string): string {
  const s = source.replace(/\\/g, '/');
  const nm = s.lastIndexOf('/node_modules/');
  if (nm >= 0) return s.slice(nm + 1);
  if (s.startsWith('node_modules/')) return s;
  const src = s.lastIndexOf('/src/');
  if (src >= 0) return s.slice(src + 1);
  if (s.startsWith('src/')) return s;
  return s.replace(/^(\.\.\/)+/, '');
}

const attr = (tag: string, name: string): string | null =>
  new RegExp(`\\s${name}="([^"]+)"`).exec(tag)?.[1] ?? null;
const local = (href: string): string => href.replace(/^\//, '');

export function analyzeBundle(input: BundleInput): BundleReport {
  const tags = input.indexHtml.match(/<(script|link)\b[^>]*>/g) ?? [];
  let entry: string | null = null;
  const preloads: string[] = [];
  const stylesheets: string[] = [];
  for (const tag of tags) {
    if (tag.startsWith('<script') && attr(tag, 'type') === 'module' && attr(tag, 'src')) {
      entry ??= local(attr(tag, 'src')!);
    } else if (tag.startsWith('<link')) {
      const rel = attr(tag, 'rel');
      const href = attr(tag, 'href');
      if (!href) continue;
      if (rel === 'modulepreload') preloads.push(local(href));
      else if (rel === 'stylesheet') stylesheets.push(local(href));
    }
  }
  const chunks: ChunkInfo[] = [];
  for (const file of input.assetFiles.filter((f) => /\.(m?js)$/.test(f)).sort()) {
    const bytes = input.read(file);
    if (!bytes) continue;
    const map = input.read(`${file}.map`);
    let sources: string[] = [];
    if (map) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(map)) as { sources?: unknown };
        if (Array.isArray(parsed.sources))
          sources = parsed.sources.filter((x): x is string => typeof x === 'string').map(normalizeSource);
      } catch {
        sources = [];
      }
    }
    const text = new TextDecoder().decode(bytes);
    const markers = MARKERS.filter((m) => text.includes(m));
    chunks.push({ file, rawBytes: bytes.length, gzipBytes: gzipSize(bytes), sources, markers });
  }
  const gz = (file: string): number => {
    const known = chunks.find((c) => c.file === file);
    if (known) return known.gzipBytes;
    const bytes = input.read(file);
    return bytes ? gzipSize(bytes) : 0;
  };
  const startupJsGzipBytes = [entry, ...preloads]
    .filter((f): f is string => f !== null)
    .reduce((s, f) => s + gz(f), 0);
  const cssGzipBytes = stylesheets.reduce((s, f) => s + gz(f), 0);
  let precacheBytes: number | null = null;
  let precacheFiles = 0;
  if (input.precacheUrls) {
    const unique = [...new Set(input.precacheUrls.map((u) => decodeURIComponent(local(u))))];
    precacheFiles = unique.length;
    precacheBytes = unique.reduce((s, f) => s + (input.size(f) ?? 0), 0);
  }
  return {
    entry,
    preloads,
    stylesheets,
    chunks,
    cssGzipBytes,
    startupJsGzipBytes,
    precacheBytes,
    precacheFiles,
  };
}

const kB = (b: number): string => `${(b / 1000).toFixed(2)} kB`;
const hasMapLibre = (c: ChunkInfo): boolean =>
  c.sources.some((s) => s.startsWith('node_modules/maplibre-gl/')) || c.markers.includes(MAPLIBRE_MARKER);
/** The Canvas2D overview: by source map when present, else by its hook name. */
export const isIsometricChunk = (c: ChunkInfo): boolean =>
  c.sources.length > 0
    ? c.sources.some((s) => s.startsWith('src/isometric/'))
    : c.markers.includes(ISOMETRIC_MARKER);
/** Either overview (Canvas2D or illustrated). */
export const isOverviewChunk = (c: ChunkInfo): boolean =>
  c.sources.length > 0
    ? c.sources.some((s) => s.startsWith('src/isometric/') || s.startsWith('src/isometric-art/'))
    : c.markers.includes(ISOMETRIC_MARKER) || c.markers.includes(ARTWORK_MARKER);

/** Every budget or rule the build breaks, as one readable line each ([] = within budget). */
export function checkBundle(
  report: BundleReport,
  read: (file: string) => Uint8Array | null,
  budgets: BundleBudgets = BUNDLE_BUDGETS,
): string[] {
  const problems: string[] = [];
  if (!report.entry) {
    problems.push('index.html has no <script type="module" src> entry.');
    return problems;
  }
  const entry = report.chunks.find((c) => c.file === report.entry);
  if (!entry) problems.push(`The entry ${report.entry} is not in dist/assets.`);
  for (const c of report.chunks)
    if (c.rawBytes > budgets.maxChunkRawBytes)
      problems.push(
        `${c.file} is ${kB(c.rawBytes)} raw, over the ${kB(budgets.maxChunkRawBytes)} chunk budget.`,
      );
  if (entry) {
    if (entry.gzipBytes > budgets.entryGzipBytes)
      problems.push(
        `Entry ${entry.file} is ${kB(entry.gzipBytes)} gzip, over ${kB(budgets.entryGzipBytes)}.`,
      );
    if (hasMapLibre(entry))
      problems.push(`Entry ${entry.file} contains maplibre-gl; MapLibre must stay a lazy chunk.`);
    const admin = entry.sources.filter(
      (s) => s.startsWith('src/admin/') && !(ADMIN_ENTRY_ALLOWED as readonly string[]).includes(s),
    );
    if (admin.length > 0) problems.push(`Entry ${entry.file} contains admin modules: ${admin.join(', ')}.`);
    const text = new TextDecoder().decode(read(entry.file) ?? new Uint8Array());
    for (const s of ADMIN_ENTRY_STRINGS)
      if (text.includes(s)) problems.push(`Entry ${entry.file} contains the admin string "${s}".`);
  }
  if (report.startupJsGzipBytes > budgets.startupJsGzipBytes)
    problems.push(
      `Start-up JS (entry + ${report.preloads.length} modulepreloads) is ${kB(report.startupJsGzipBytes)} gzip, over ${kB(budgets.startupJsGzipBytes)}.`,
    );
  if (report.cssGzipBytes > budgets.startupCssGzipBytes)
    problems.push(
      `Start-up CSS is ${kB(report.cssGzipBytes)} gzip, over ${kB(budgets.startupCssGzipBytes)}.`,
    );
  const iso = report.chunks.filter(isIsometricChunk);
  if (iso.length === 0)
    problems.push(
      `No chunk holds the isometric overview (src/isometric/ or "${ISOMETRIC_MARKER}"); it could not be measured.`,
    );
  if (!report.chunks.some(hasMapLibre))
    problems.push(`No chunk contains MapLibre ("${MAPLIBRE_MARKER}"); the isolation checks cannot see it.`);
  for (const c of iso)
    if (c.gzipBytes > budgets.isometricChunkGzipBytes)
      problems.push(
        `Isometric overview chunk ${c.file} is ${kB(c.gzipBytes)} gzip, over ${kB(budgets.isometricChunkGzipBytes)}.`,
      );
  for (const c of report.chunks.filter(isOverviewChunk))
    if (hasMapLibre(c))
      problems.push(`Overview chunk ${c.file} contains maplibre-gl; the overview must never load it.`);
  if (report.precacheBytes === null) problems.push('dist/sw.js has no precache manifest.');
  else if (report.precacheBytes > budgets.precacheBytes)
    problems.push(
      `Precache is ${kB(report.precacheBytes)} in ${report.precacheFiles} files, over ${kB(budgets.precacheBytes)}.`,
    );
  return problems;
}

/** A human-readable table of the measured values against the budgets. */
export function formatBundleReport(report: BundleReport, budgets: BundleBudgets = BUNDLE_BUDGETS): string[] {
  const entry = report.chunks.find((c) => c.file === report.entry);
  const largest = [...report.chunks].sort((a, b) => b.rawBytes - a.rawBytes)[0];
  const iso = report.chunks.filter(isIsometricChunk);
  const row = (name: string, value: string, budget: string, ok: boolean) =>
    `| ${name} | ${value} | ${budget} | ${ok ? 'within' : '**over**'} |`;
  return [
    '| Budget | Measured | Limit | Verdict |',
    '| --- | --- | --- | --- |',
    row(
      `Largest JS chunk, raw (${largest?.file ?? '—'})`,
      kB(largest?.rawBytes ?? 0),
      kB(budgets.maxChunkRawBytes),
      (largest?.rawBytes ?? 0) <= budgets.maxChunkRawBytes,
    ),
    row(
      `Public entry, gzip (${entry?.file ?? '—'})`,
      kB(entry?.gzipBytes ?? 0),
      kB(budgets.entryGzipBytes),
      (entry?.gzipBytes ?? 0) <= budgets.entryGzipBytes,
    ),
    row(
      `Start-up JS, gzip (entry + ${report.preloads.length} modulepreloads)`,
      kB(report.startupJsGzipBytes),
      kB(budgets.startupJsGzipBytes),
      report.startupJsGzipBytes <= budgets.startupJsGzipBytes,
    ),
    row(
      'Start-up CSS, gzip',
      kB(report.cssGzipBytes),
      kB(budgets.startupCssGzipBytes),
      report.cssGzipBytes <= budgets.startupCssGzipBytes,
    ),
    ...iso.map((c) =>
      row(
        `Isometric overview chunk, gzip (${c.file})`,
        kB(c.gzipBytes),
        kB(budgets.isometricChunkGzipBytes),
        c.gzipBytes <= budgets.isometricChunkGzipBytes,
      ),
    ),
    row(
      `Precache (${report.precacheFiles} files)`,
      kB(report.precacheBytes ?? 0),
      kB(budgets.precacheBytes),
      (report.precacheBytes ?? 0) <= budgets.precacheBytes,
    ),
  ];
}
