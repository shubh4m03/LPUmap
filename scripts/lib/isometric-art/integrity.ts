/**
 * Pure integrity checks of the isometric-art pipeline (no I/O, no Chromium):
 * render jobs for derived copies, the visual-equivalence report and its
 * thresholds, duplicate originals, association coverage, external-origin
 * references and the production build (dist/) contents.
 *
 * Used by scripts/build-isometric-art.ts (--derive, --verify, --check,
 * --check-dist) and by tests/unit/isometric-art/integrity*.test.ts and
 * tests/integration/isometric-art*.test.ts. Reuses expectedDerived /
 * publishedFiles (art-registry-check.ts) and sha256Hex
 * (art-inventory-check.ts); never re-implements them.
 */
import { z } from 'zod';
import { ARTWORK_UNAVAILABLE_REASON } from '../../../src/isometric-art/manifest-loader.ts';
import {
  ILLUSTRATION_DISCLAIMER,
  ISOMETRIC_ART_MANIFEST_VERSION,
  type DerivedSpec,
  type IsometricArtManifest,
  type IsometricArtRegistry,
  type ManifestDerived,
} from '../../../src/isometric-art/schema.ts';
import { ART_RUNTIME_CACHE_NAME } from '../../../src/offline/pwa-config.ts';
import { expectedDerived, publishedFiles } from '../art-registry-check.ts';
import type { EquivalenceGroup, PixelMetrics, RenderJob } from './chromium.ts';

export const EQUIVALENCE_REPORT_PATH = 'docs/isometric-art/derived-equivalence.json';
export const DERIVED_DIR = 'derived';

/**
 * Width both images are downscaled to before the "downscaled" comparison: below
 * every derived size, so no side is ever upsampled.
 */
export const COMPARE_WIDTH = 512;

// ---------------------------------------------------------------------------
// Render jobs (what --derive draws) — one per expectedDerived output
// ---------------------------------------------------------------------------

/** WebP at quality 1 is encoded lossless (VP8L) by Chromium; PNG is always lossless. */
export function isLosslessSpec(spec: Pick<DerivedSpec, 'format' | 'quality'>): boolean {
  return spec.format === 'image/png' || (spec.format === 'image/webp' && spec.quality === 1);
}

/**
 * The jobs that produce every output of `spec`. Level size and tile offsets
 * follow expectedDerived exactly (level L = ceil(W/2^L) × ceil(H/2^L); tiles
 * partition that level), so names, sizes and rectangles have ONE definition.
 */
export function renderJobs(assetId: string, spec: DerivedSpec, W: number, H: number): RenderJob[] {
  return expectedDerived(assetId, spec, W, H).map((e) => {
    const level = e.tile?.level ?? null;
    const levelWidth = level === null ? e.width : Math.ceil(W / 2 ** level);
    const levelHeight = level === null ? e.height : Math.ceil(H / 2 ** level);
    const tileSize = spec.purpose === 'tiles' ? spec.tileSize : 0;
    return {
      url: e.url,
      levelWidth,
      levelHeight,
      x: e.tile ? e.tile.col * tileSize : 0,
      y: e.tile ? e.tile.row * tileSize : 0,
      width: e.width,
      height: e.height,
      mime: e.mime,
      quality: spec.quality,
    };
  });
}

/** RIFF chunk ids of a WebP file ([] when it is not a WebP). */
export function webpChunks(bytes: Uint8Array): string[] {
  const ascii = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  if (bytes.length < 12 || ascii(0) !== 'RIFF' || ascii(8) !== 'WEBP') return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: string[] = [];
  for (let o = 12; o + 8 <= bytes.length;) {
    const size = view.getUint32(o + 4, true);
    out.push(ascii(o));
    o += 8 + size + (size & 1);
  }
  return out;
}

/** Pixel size of a lossless (VP8L) WebP, read from its bitstream header; null for anything else. */
export function webpLosslessSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (webpChunks(bytes).length === 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let o = 12; o + 8 <= bytes.length;) {
    const id = String.fromCharCode(...bytes.subarray(o, o + 4));
    const size = view.getUint32(o + 4, true);
    if (id === 'VP8L' && bytes[o + 8] === 0x2f) {
      const bits = view.getUint32(o + 9, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    o += 8 + size + (size & 1);
  }
  return null;
}

/** Problems with a derived file's encoding against its spec (lossless WebP must be VP8L only). */
export function encodingProblems(bytes: Uint8Array, spec: Pick<DerivedSpec, 'format' | 'quality'>): string[] {
  if (spec.format !== 'image/webp') return [];
  const chunks = webpChunks(bytes);
  if (chunks.length === 0) return ['not a WebP file'];
  if (isLosslessSpec(spec) && (!chunks.includes('VP8L') || chunks.includes('VP8 ')))
    return [`expected lossless VP8L, found chunks ${chunks.join(',')}`];
  return [];
}

/** The group label a derived output belongs to: 'web-full', 'preview' or 'tiles-<level>'. */
export const groupLabel = (d: Pick<ManifestDerived, 'purpose' | 'tile'>): string =>
  d.purpose === 'tile' ? `tiles-${d.tile?.level ?? 0}` : d.purpose;

/**
 * Groups rendered outputs into whole images for the equivalence check: a
 * single file, or every tile of one level placed at its offset.
 */
export function equivalenceGroups(
  jobs: readonly RenderJob[],
  outputs: readonly { url: string; bytes: Uint8Array }[],
  derived: readonly Pick<ManifestDerived, 'url' | 'purpose' | 'tile' | 'mime'>[],
): EquivalenceGroup[] {
  const byUrl = new Map(outputs.map((o) => [o.url, o.bytes]));
  const recordByUrl = new Map(derived.map((d) => [d.url, d]));
  const groups = new Map<string, EquivalenceGroup>();
  for (const j of jobs) {
    const rec = recordByUrl.get(j.url);
    const bytes = byUrl.get(j.url);
    if (!rec || !bytes) throw new Error(`no output for ${j.url}`);
    const label = groupLabel(rec);
    let g = groups.get(label);
    if (!g) {
      g = { label, width: j.levelWidth, height: j.levelHeight, parts: [] };
      groups.set(label, g);
    }
    g.parts.push({ bytes, mime: rec.mime, x: j.x, y: j.y });
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Visual-equivalence thresholds and report
// ---------------------------------------------------------------------------

/**
 * Fixed thresholds (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §2.1). `native`
 * compares a derived image with the original drawn at the same size (so it
 * measures encoding loss only): a lossless spec must be pixel-identical, a
 * lossy one within the lossy bound. `downscaled` compares the derived image
 * and the FULL original, both downscaled to COMPARE_WIDTH, so it catches any
 * crop, stretch, shift, misplaced tile or recolour. The negative controls (a
 * 2 px shift, an R/B channel swap, a 2 % crop stretched back) must fail.
 */
export const EQUIVALENCE_THRESHOLDS = {
  native: { losslessMaxAbs: 0, lossyMinPsnr: 32, lossyMaxFracOver16: 0.08 },
  downscaled: { minPsnr: 30, maxMeanAbs: 2.5, maxFracOver16: 0.06 },
} as const;

export function equivalenceFailures(
  r: { native: PixelMetrics; downscaled: PixelMetrics },
  lossless: boolean,
): string[] {
  const t = EQUIVALENCE_THRESHOLDS;
  const out: string[] = [];
  if (lossless) {
    if (r.native.maxAbs > t.native.losslessMaxAbs)
      out.push(`native maxAbs ${r.native.maxAbs} > ${t.native.losslessMaxAbs} for a lossless copy`);
  } else {
    if (r.native.psnr < t.native.lossyMinPsnr)
      out.push(`native psnr ${r.native.psnr} < ${t.native.lossyMinPsnr}`);
    if (r.native.fracOver16 > t.native.lossyMaxFracOver16)
      out.push(`native fracOver16 ${r.native.fracOver16} > ${t.native.lossyMaxFracOver16}`);
  }
  if (r.downscaled.psnr < t.downscaled.minPsnr)
    out.push(`downscaled psnr ${r.downscaled.psnr} < ${t.downscaled.minPsnr}`);
  if (r.downscaled.meanAbs > t.downscaled.maxMeanAbs)
    out.push(`downscaled meanAbs ${r.downscaled.meanAbs} > ${t.downscaled.maxMeanAbs}`);
  if (r.downscaled.fracOver16 > t.downscaled.maxFracOver16)
    out.push(`downscaled fracOver16 ${r.downscaled.fracOver16} > ${t.downscaled.maxFracOver16}`);
  return out;
}

const metricsSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    meanAbs: z.number().min(0),
    maxAbs: z.number().int().min(0).max(255),
    psnr: z.number(),
    fracOver16: z.number().min(0).max(1),
  })
  .strict();

const sha = z.string().regex(/^[0-9a-f]{64}$/);

export const equivalenceReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('lpu-isometric-art-derived-equivalence'),
    $comment: z.string(),
    renderer: z.object({ engine: z.literal('chromium'), version: z.string().min(1) }).strict(),
    compareWidth: z.number().int().positive(),
    thresholds: z.unknown(),
    assets: z.array(
      z
        .object({
          assetId: z.string(),
          sourceSha256: sha,
          groups: z.array(
            z
              .object({
                label: z.string(),
                lossless: z.boolean(),
                files: z.array(z.object({ url: z.string(), sha256: sha }).strict()).min(1),
                native: metricsSchema,
                downscaled: metricsSchema,
                pass: z.boolean(),
              })
              .strict(),
          ),
          controls: z.array(
            z
              .object({
                label: z.string(),
                native: metricsSchema,
                downscaled: metricsSchema,
                failsThresholds: z.boolean(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export type EquivalenceReport = z.infer<typeof equivalenceReportSchema>;
export type EquivalenceReportAsset = EquivalenceReport['assets'][number];

/**
 * The committed equivalence report must cover every derived file of the
 * manifest with its current sha256, be measured against the current source,
 * pass the CURRENT thresholds, and show every negative control failing them.
 */
export function validateEquivalenceReport(
  raw: unknown,
  manifest: IsometricArtManifest,
  registry: IsometricArtRegistry,
): string[] {
  const anyDerived = manifest.assets.some((a) => a.derived.length > 0);
  if (raw === null)
    return anyDerived ? [`${EQUIVALENCE_REPORT_PATH} is missing (run npm run art:derive)`] : [];
  const parsed = equivalenceReportSchema.safeParse(raw);
  if (!parsed.success)
    return parsed.error.issues.map((i) => `${EQUIVALENCE_REPORT_PATH} ${i.path.join('.')}: ${i.message}`);
  const rep = parsed.data;
  const problems: string[] = [];
  if (JSON.stringify(rep.thresholds) !== JSON.stringify(EQUIVALENCE_THRESHOLDS))
    problems.push(
      'equivalence report thresholds differ from EQUIVALENCE_THRESHOLDS (re-run npm run art:derive)',
    );
  if (rep.compareWidth !== COMPARE_WIDTH)
    problems.push(`equivalence report compareWidth != ${COMPARE_WIDTH}`);
  const repAssets = new Map(rep.assets.map((a) => [a.assetId, a]));
  for (const a of manifest.assets) {
    const r = repAssets.get(a.assetId);
    if (a.derived.length === 0) {
      if (r) problems.push(`equivalence report lists ${a.assetId}, which has no derived copies`);
      continue;
    }
    if (!r) {
      problems.push(`${a.assetId}: derived copies have no equivalence measurement (run npm run art:derive)`);
      continue;
    }
    if (r.sourceSha256 !== a.source.sha256)
      problems.push(`${a.assetId}: equivalence was measured against a different original`);
    const specs = registry.assets.find((x) => x.assetId === a.assetId)?.derive ?? [];
    const losslessOf = (label: string) => {
      const purpose = label.startsWith('tiles-') ? 'tiles' : label;
      const spec = specs.find((s) => s.purpose === purpose);
      return spec ? isLosslessSpec(spec) : null;
    };
    const covered = new Map<string, string>();
    for (const g of r.groups) {
      for (const f of g.files) covered.set(f.url, f.sha256);
      const lossless = losslessOf(g.label);
      if (lossless === null) problems.push(`${a.assetId}: equivalence group ${g.label} has no derive spec`);
      else if (lossless !== g.lossless)
        problems.push(`${a.assetId}: ${g.label} lossless flag differs from its spec`);
      const fails = equivalenceFailures(g, g.lossless);
      if (fails.length)
        problems.push(`${a.assetId}: ${g.label} is not visually equivalent: ${fails.join('; ')}`);
      if (g.pass !== (fails.length === 0))
        problems.push(`${a.assetId}: ${g.label} pass flag is inconsistent`);
    }
    for (const d of a.derived) {
      const got = covered.get(d.url);
      if (got === undefined) problems.push(`${a.assetId}: ${d.url} has no equivalence measurement`);
      else if (got !== d.sha256) problems.push(`${a.assetId}: ${d.url} changed after it was measured`);
    }
    for (const url of covered.keys())
      if (!a.derived.some((d) => d.url === url)) problems.push(`${a.assetId}: report lists unknown ${url}`);
    if (r.controls.length === 0) problems.push(`${a.assetId}: no negative controls were measured`);
    for (const c of r.controls) {
      const fails = equivalenceFailures(c, true).length > 0 && equivalenceFailures(c, false).length > 0;
      if (!fails) problems.push(`${a.assetId}: negative control ${c.label} passes the thresholds (too lax)`);
      if (c.failsThresholds !== fails)
        problems.push(`${a.assetId}: ${c.label} failsThresholds flag is inconsistent`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Duplicates, associations, origins
// ---------------------------------------------------------------------------

/** Groups of byte-identical files (by sha256), each sorted by name; only groups of 2+. */
export function findDuplicateOriginals(shaByFile: ReadonlyMap<string, string>): string[][] {
  const bySha = new Map<string, string[]>();
  for (const [file, s] of shaByFile) bySha.set(s, [...(bySha.get(s) ?? []), file]);
  return [...bySha.values()]
    .filter((g) => g.length > 1)
    .map((g) => g.sort())
    .sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''));
}

/**
 * Every byte-identical group must have exactly one published canonical asset;
 * every other member is unpublished, `duplicateOf` the canonical, and never derived.
 */
export function checkDuplicatesHandled(
  groups: readonly string[][],
  manifest: IsometricArtManifest,
  registry: IsometricArtRegistry,
): string[] {
  const problems: string[] = [];
  const byFile = new Map(manifest.assets.map((a) => [a.source.originalPath.split('/').pop() ?? '', a]));
  for (const g of groups) {
    const members = g.map((f) => byFile.get(f));
    if (members.some((m) => !m)) {
      problems.push(`duplicate originals ${g.join(', ')}: not all are registered assets`);
      continue;
    }
    const published = members.filter((m) => m?.original);
    if (published.length !== 1) {
      problems.push(
        `duplicate originals ${g.join(', ')}: ${published.length} published (expected exactly 1)`,
      );
      continue;
    }
    const canonical = published[0]!.assetId;
    for (const m of members) {
      if (!m || m.assetId === canonical) continue;
      if (m.duplicateOf !== canonical) problems.push(`${m.assetId}: duplicateOf must be ${canonical}`);
      if (m.derived.length || registry.assets.find((r) => r.assetId === m.assetId)?.derive.length)
        problems.push(`${m.assetId}: a duplicate is never derived`);
    }
  }
  for (const a of manifest.assets)
    if (a.duplicateOf && !groups.some((g) => g.includes(a.source.originalPath.split('/').pop() ?? '')))
      problems.push(
        `${a.assetId}: marked duplicateOf ${a.duplicateOf} but its bytes are not identical to it`,
      );
  return problems;
}

export interface AssociationCoverage {
  verified: string[];
  approximate: string[];
  unresolved: string[];
  /** Subjects with no association record at all (an error). */
  missing: string[];
  /** Association records for no known subject (an error). */
  orphan: string[];
}

/** Association status of every subject (curated baseline); `missing`/`orphan` are errors. */
export function associationCoverage(manifest: IsometricArtManifest): AssociationCoverage {
  const subjects = new Set(manifest.subjects.map((s) => s.subjectId));
  const assoc = new Map(manifest.associations.map((a) => [a.subjectId, a]));
  const out: AssociationCoverage = { verified: [], approximate: [], unresolved: [], missing: [], orphan: [] };
  for (const s of [...subjects].sort()) {
    const a = assoc.get(s);
    if (!a) out.missing.push(s);
    else out[a.status].push(s);
  }
  for (const id of [...assoc.keys()].sort()) if (!subjects.has(id)) out.orphan.push(id);
  return out;
}

/** Absolute or protocol-relative URLs anywhere in the manifest (every artwork URL must be same-origin and relative). */
export function externalUrlsInManifest(manifest: unknown): string[] {
  const out: string[] = [];
  const visit = (v: unknown, path: string) => {
    if (typeof v === 'string') {
      // Subject ids such as 'art:num-25' are not URLs; only real fetchable schemes count.
      if (/^(?:https?:|wss?:|ftp:|data:|blob:|\/\/)/i.test(v)) out.push(`${path}: ${v.slice(0, 80)}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visit(x, `${path}.${k}`);
  };
  visit(manifest, 'manifest');
  return out;
}

/** http(s) or protocol-relative URLs in code (line and block comments ignored). */
export function externalUrlsInSource(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  return [...code.matchAll(/(['"`])((?:https?:)?\/\/[^'"`\s]+)\1/g)].map((m) => m[2] ?? '');
}

/** The img-src sources of a CSP header line; artwork must only ever come from 'self'. */
export function cspImgSrc(headers: string): string[] | null {
  const m = /img-src ([^;]+)/.exec(headers);
  return m?.[1] ? m[1].trim().split(/\s+/) : null;
}

// ---------------------------------------------------------------------------
// Production build (dist/)
// ---------------------------------------------------------------------------

/** Files the service worker must precache (light) and must NOT precache (heavy, runtime-cached). */
export function precacheExpectations(manifest: IsometricArtManifest): { must: string[]; mustNot: string[] } {
  const must = ['isometric-art/manifest.json'];
  const mustNot: string[] = [];
  for (const a of manifest.assets) {
    if (a.original) mustNot.push(`isometric-art/${a.original.url}`);
    for (const d of a.derived) (d.purpose === 'preview' ? must : mustNot).push(`isometric-art/${d.url}`);
  }
  return { must, mustNot };
}

/** URLs listed in a generated Workbox service worker's precache manifest. */
export function precachedUrls(swSource: string): string[] {
  return [...swSource.matchAll(/\burl:\s*"([^"]+)"/g)].map((m) => m[1] ?? '');
}

export interface DistView {
  /** Bytes of dist/<rel>, or null when absent. */
  read(rel: string): Uint8Array | null;
  /** Every file under dist/, '/'-separated, relative to dist/. */
  list(): string[];
  sha256(bytes: Uint8Array): string;
}

/**
 * Production build check: the manifest and every file it publishes are in
 * dist/ byte-identical, nothing else is under dist/isometric-art, the
 * service worker precaches the light files only, the app bundle contains
 * the manifest loader, and nothing in the build points artwork at another origin.
 */
export function checkDist(
  manifest: IsometricArtManifest,
  manifestBytes: Uint8Array,
  dist: DistView,
): string[] {
  const problems: string[] = [];
  const builtManifest = dist.read('isometric-art/manifest.json');
  if (!builtManifest) problems.push('dist/isometric-art/manifest.json is missing');
  else if (dist.sha256(builtManifest) !== dist.sha256(manifestBytes))
    problems.push('dist/isometric-art/manifest.json differs from public/isometric-art/manifest.json');
  if (manifest.schemaVersion !== ISOMETRIC_ART_MANIFEST_VERSION)
    problems.push('manifest schema version mismatch');
  const shaOf = new Map<string, string>();
  for (const a of manifest.assets) {
    if (a.original) shaOf.set(a.original.url, a.original.sha256);
    for (const d of a.derived) shaOf.set(d.url, d.sha256);
  }
  for (const url of publishedFiles(manifest)) {
    const b = dist.read(`isometric-art/${url}`);
    if (!b) problems.push(`dist/isometric-art/${url} is missing from the production build`);
    else if (dist.sha256(b) !== shaOf.get(url))
      problems.push(`dist/isometric-art/${url} differs from the manifest sha256`);
  }
  const expected = new Set([
    ...publishedFiles(manifest).map((u) => `isometric-art/${u}`),
    'isometric-art/manifest.json',
  ]);
  const all = dist.list();
  for (const f of all)
    if (f.startsWith('isometric-art/') && !expected.has(f)) problems.push(`dist/${f} is not in the manifest`);

  const swBytes = dist.read('sw.js');
  if (!swBytes) problems.push('dist/sw.js is missing (the PWA precache cannot be checked)');
  else {
    const sw = new TextDecoder().decode(swBytes);
    const pre = new Set(precachedUrls(sw));
    const { must, mustNot } = precacheExpectations(manifest);
    for (const u of must) if (!pre.has(u)) problems.push(`service worker does not precache ${u}`);
    for (const u of mustNot) if (pre.has(u)) problems.push(`service worker precaches heavy artwork ${u}`);
    for (const u of pre)
      if (u.startsWith('isometric-art/') && !must.includes(u)) problems.push(`service worker precaches ${u}`);
    if (!sw.includes(`cacheName:"${ART_RUNTIME_CACHE_NAME}"`))
      problems.push(`service worker has no runtime route for the artwork (cache ${ART_RUNTIME_CACHE_NAME})`);
  }

  const bundles = all.filter((f) => /^assets\/.+\.m?js$/.test(f));
  // Strings that only the artwork modules contain (the manifest URL alone is not enough: the PWA
  // precache list in the app bundle also names it).
  const text = bundles.map((f) => new TextDecoder().decode(dist.read(f) ?? new Uint8Array())).join('\n');
  for (const [marker, what] of [
    [ARTWORK_UNAVAILABLE_REASON, 'the artwork manifest loader (src/isometric-art/manifest-loader.ts)'],
    [ILLUSTRATION_DISCLAIMER, 'the illustration disclaimer (src/isometric-art/schema.ts)'],
  ] as const)
    if (!text.includes(marker))
      problems.push(`no app bundle contains ${what}: the illustrated view is not bundled`);

  const headers = dist.read('_headers');
  const img = headers ? cspImgSrc(new TextDecoder().decode(headers)) : null;
  if (!img) problems.push('dist/_headers has no img-src');
  else
    for (const s of img) if (!["'self'", 'data:', 'blob:'].includes(s)) problems.push(`img-src allows ${s}`);
  return problems;
}
