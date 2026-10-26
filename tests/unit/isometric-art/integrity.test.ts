// @vitest-environment node
/**
 * Artwork pipeline integrity (Gate 1) on the REAL committed files, no
 * Chromium: originals unchanged, every registered path resolves, published
 * copies byte-identical, derived copies trace to their original and are
 * lossless at the recorded size, labels equal the inventory transcription,
 * duplicates handled, associations reported, nothing from another origin,
 * the visual-equivalence record covers every derived file — each with
 * deliberate breakages that must be caught.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ART_HOTSPOTS_PATH, type ArtHotspots } from '../../../scripts/lib/art-hotspots-check.ts';
import {
  ART_INVENTORY_PATH,
  ART_SOURCE_DIR,
  imageSize,
  sha256Hex,
  type ArtInventory,
} from '../../../scripts/lib/art-inventory-check.ts';
import {
  ART_MANIFEST_PATH,
  ART_MAPPING_DOC_PATH,
  ART_PUBLIC_DIR,
  ART_REGISTRY_PATH,
  buildArtManifest,
  publishedFiles,
  validateArtRegistry,
  type BlockCandidateLead,
} from '../../../scripts/lib/art-registry-check.ts';
import {
  COMPARE_WIDTH,
  EQUIVALENCE_REPORT_PATH,
  EQUIVALENCE_THRESHOLDS,
  associationCoverage,
  checkDist,
  checkDuplicatesHandled,
  cspImgSrc,
  encodingProblems,
  equivalenceFailures,
  externalUrlsInManifest,
  externalUrlsInSource,
  findDuplicateOriginals,
  isLosslessSpec,
  precachedUrls,
  renderJobs,
  validateEquivalenceReport,
  webpChunks,
  webpLosslessSize,
  type DistView,
  type EquivalenceReport,
} from '../../../scripts/lib/isometric-art/integrity.ts';
import { ARTWORK_UNAVAILABLE_REASON, artworkUrl } from '../../../src/isometric-art/manifest-loader.ts';
import {
  ILLUSTRATION_DISCLAIMER,
  isometricArtManifestSchema,
  type IsometricArtManifest,
  type IsometricArtRegistry,
} from '../../../src/isometric-art/schema.ts';
import { ART_RUNTIME_CACHE_NAME } from '../../../src/offline/pwa-config.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const bytesOf = (p: string) => new Uint8Array(readFileSync(join(root, p)));
const json = (p: string): unknown => JSON.parse(readFileSync(join(root, p), 'utf8'));
const inventory = json(ART_INVENTORY_PATH) as ArtInventory;
const hotspots = json(ART_HOTSPOTS_PATH) as ArtHotspots;
const candidates = json('docs/research/block-leads/block-candidates.json') as BlockCandidateLead[];
const registryRaw = json(ART_REGISTRY_PATH) as IsometricArtRegistry;
const manifestBytes = bytesOf(ART_MANIFEST_PATH);
const manifest = isometricArtManifestSchema.parse(JSON.parse(new TextDecoder().decode(manifestBytes)));
const report = json(EQUIVALENCE_REPORT_PATH) as EquivalenceReport;
const master = manifest.assets.find((a) => a.assetId === 'iso-art-001')!;

const registryOk = validateArtRegistry(registryRaw, inventory, hotspots, candidates, null);
const registry = registryOk.registry!;

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}
const rel = (base: string, f: string) => relative(base, f).split('\\').join('/');

describe('originals (Gate 1: unchanged, present)', () => {
  it('the source folder holds exactly the inventory files, each with its recorded sha256 and size', () => {
    const files = readdirSync(join(root, ART_SOURCE_DIR)).sort();
    expect(files).toEqual(inventory.assets.map((a) => a.file).sort());
    expect(files).toHaveLength(29);
    for (const a of inventory.assets) {
      const b = bytesOf(a.path);
      expect(sha256Hex(b), a.path).toBe(a.sha256);
      expect(b.length, a.path).toBe(a.bytes);
      expect(imageSize(b), a.path).toEqual({ width: a.width, height: a.height });
    }
  });

  it('every published original is a byte-identical copy under its unchanged file name', () => {
    const originals = manifest.assets.filter((a) => a.original);
    expect(originals).toHaveLength(28);
    for (const a of originals) {
      expect(a.original!.url).toBe(`original/${a.source.originalPath.split('/').pop()}`);
      expect(sha256Hex(bytesOf(`${ART_PUBLIC_DIR}/${a.original!.url}`))).toBe(a.source.sha256);
      expect(a.original!.sha256).toBe(a.source.sha256);
    }
  });
});

describe('every registered path resolves', () => {
  it('inventory, registry sources, manifest files, docs and the equivalence record exist', () => {
    for (const a of inventory.assets) expect(existsSync(join(root, a.path)), a.path).toBe(true);
    for (const p of Object.values((registryRaw as unknown as { sources: Record<string, string> }).sources))
      expect(existsSync(join(root, p)), p).toBe(true);
    for (const url of publishedFiles(manifest))
      expect(existsSync(join(root, ART_PUBLIC_DIR, url)), url).toBe(true);
    for (const p of [ART_MAPPING_DOC_PATH, EQUIVALENCE_REPORT_PATH, ART_MANIFEST_PATH])
      expect(existsSync(join(root, p)), p).toBe(true);
  });

  it('public/isometric-art holds exactly the manifest and the files it publishes', () => {
    const onDisk = listFiles(join(root, ART_PUBLIC_DIR))
      .map((f) => rel(join(root, ART_PUBLIC_DIR), f))
      .sort();
    expect(onDisk).toEqual([...publishedFiles(manifest), 'manifest.json'].sort());
  });

  it('ids cross-reference: hotspots → subjects, subjects → hotspots/assets, assets → inventory', () => {
    const subjects = new Set(manifest.subjects.map((s) => s.subjectId));
    const hs = new Set(manifest.hotspots.map((h) => h.hotspotId));
    const assets = new Set(manifest.assets.map((a) => a.assetId));
    for (const h of manifest.hotspots) expect(subjects.has(h.subjectId), h.hotspotId).toBe(true);
    for (const s of manifest.subjects) {
      for (const h of s.hotspotIds) expect(hs.has(h), `${s.subjectId} → ${h}`).toBe(true);
      for (const v of s.vignetteAssetIds) expect(assets.has(v), `${s.subjectId} → ${v}`).toBe(true);
    }
    for (const a of manifest.assets)
      expect(inventory.assets.some((i) => i.id === a.assetId && i.path === a.source.originalPath)).toBe(true);
    expect(manifest.coordinateSpace).toEqual({ assetId: 'iso-art-001', width: 3371, height: 2384 });
  });

  it('the committed manifest is exactly what the pipeline builds from the committed inputs (deterministic)', () => {
    const input = {
      registry,
      inventory,
      hotspots,
      sha256: {
        registry: sha256Hex(bytesOf(ART_REGISTRY_PATH)),
        inventory: sha256Hex(bytesOf(ART_INVENTORY_PATH)),
        hotspots: sha256Hex(bytesOf(ART_HOTSPOTS_PATH)),
      },
      derived: new Map(manifest.assets.map((a) => [a.assetId, a.derived])),
    };
    const a = buildArtManifest(input);
    const b = buildArtManifest(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).toBe(JSON.stringify(manifest));
  });
});

describe('derived copies trace to an original', () => {
  it('the master has web-full, a 1600 px preview and a 3-level 512 px tile pyramid, all lossless WebP', () => {
    const specs = registry.assets.find((a) => a.assetId === 'iso-art-001')!.derive;
    expect(specs.map((s) => s.purpose)).toEqual(['web-full', 'preview', 'tiles']);
    for (const s of specs) expect(isLosslessSpec(s), s.purpose).toBe(true);
    expect(master.derived.filter((d) => d.purpose === 'tile')).toHaveLength(35 + 12 + 4);
    // Only the master is derived; vignettes are published as unchanged originals only.
    for (const a of manifest.assets) if (a.assetId !== 'iso-art-001') expect(a.derived).toEqual([]);
  });

  it('each derived file records the current original sha256, its own sha256/size, and is VP8L at the recorded size', () => {
    const originalSha = sha256Hex(bytesOf(master.source.originalPath));
    for (const d of master.derived) {
      const b = bytesOf(`${ART_PUBLIC_DIR}/${d.url}`);
      expect(d.sourceSha256, d.url).toBe(originalSha);
      expect(sha256Hex(b), d.url).toBe(d.sha256);
      expect(b.length, d.url).toBe(d.bytes);
      expect(webpChunks(b), d.url).toContain('VP8L');
      expect(encodingProblems(b, { format: 'image/webp', quality: 1 }), d.url).toEqual([]);
      expect(webpLosslessSize(b), d.url).toEqual({ width: d.width, height: d.height });
    }
  });

  it('every copy is a UNIFORM scale of the whole original (aspect error below one derived pixel)', () => {
    const { width: W, height: H } = master.source;
    for (const d of master.derived) {
      const lw = d.tile ? Math.ceil(W / 2 ** d.tile.level) : d.width;
      const lh = d.tile ? Math.ceil(H / 2 ** d.tile.level) : d.height;
      // Scaling x by lw/W and y by lh/H differ by less than one pixel across the image.
      expect(Math.abs((lw / W) * H - lh), d.url).toBeLessThan(1);
    }
  });

  it('tiles partition each level exactly (no gap, no overlap) at offsets col/row × tileSize', () => {
    const spec = registry.assets
      .find((a) => a.assetId === 'iso-art-001')!
      .derive.find((s) => s.purpose === 'tiles')!;
    const jobs = renderJobs('iso-art-001', spec, 3371, 2384);
    for (const level of [0, 1, 2]) {
      const lw = Math.ceil(3371 / 2 ** level);
      const lh = Math.ceil(2384 / 2 ** level);
      const ts = jobs.filter((j) => j.levelWidth === lw && j.levelHeight === lh);
      expect(ts.reduce((n, j) => n + j.width * j.height, 0)).toBe(lw * lh);
      for (const j of ts) {
        expect(j.x % 512).toBe(0);
        expect(j.y % 512).toBe(0);
        expect(j.x + j.width).toBeLessThanOrEqual(lw);
        expect(j.y + j.height).toBeLessThanOrEqual(lh);
      }
      expect(new Set(ts.map((j) => `${j.x},${j.y}`)).size).toBe(ts.length);
    }
  });

  it('a lossy or foreign file is caught by the encoding check', () => {
    const b = bytesOf(`${ART_PUBLIC_DIR}/${master.derived[0]!.url}`);
    const lossy = b.slice();
    const at = webpChunks(b).indexOf('VP8L');
    expect(at).toBeGreaterThan(-1);
    // Rename the VP8L chunk id to the lossy 'VP8 ' id.
    const offset = new TextDecoder('latin1').decode(lossy).indexOf('VP8L');
    lossy.set([0x56, 0x50, 0x38, 0x20], offset);
    expect(encodingProblems(lossy, { format: 'image/webp', quality: 1 }).join()).toMatch(/lossless/);
    expect(
      encodingProblems(bytesOf(master.source.originalPath), { format: 'image/webp', quality: 1 }),
    ).toEqual(['not a WebP file']);
  });
});

describe('visual-equivalence record (measured in Chromium by art:derive / art:verify)', () => {
  it('covers every derived file with its current sha256 and passes the fixed thresholds', () => {
    expect(validateEquivalenceReport(report, manifest, registry)).toEqual([]);
    expect(report.compareWidth).toBe(COMPARE_WIDTH);
    expect(report.thresholds).toEqual(EQUIVALENCE_THRESHOLDS);
    const groups = report.assets[0]!.groups;
    expect(groups.map((g) => g.label)).toEqual(['web-full', 'preview', 'tiles-0', 'tiles-1', 'tiles-2']);
    // Lossless: pixel-identical to the colour-managed original at every level's own size.
    for (const g of groups) expect(g.native.maxAbs, g.label).toBe(0);
    for (const c of report.assets[0]!.controls) expect(c.failsThresholds, c.label).toBe(true);
    expect(report.assets[0]!.controls.map((c) => c.label)).toEqual([
      'control:shift-2px',
      'control:recolour-swap-rb',
      'control:crop-2pct-stretched',
    ]);
  });

  it('catches a file changed after measurement, a failing metric, a lax threshold and a missing record', () => {
    const tampered = structuredClone(report);
    tampered.assets[0]!.groups[2]!.files[0]!.sha256 = 'f'.repeat(64);
    expect(validateEquivalenceReport(tampered, manifest, registry).join()).toMatch(
      /changed after it was measured/,
    );

    const worse = structuredClone(report);
    worse.assets[0]!.groups[1]!.downscaled.psnr = 25;
    expect(validateEquivalenceReport(worse, manifest, registry).join()).toMatch(/not visually equivalent/);

    const lax = structuredClone(report);
    const ctl = lax.assets[0]!.controls[0]!;
    ctl.native = { ...ctl.native, maxAbs: 0, psnr: 99, fracOver16: 0 };
    ctl.downscaled = { ...ctl.downscaled, psnr: 99, meanAbs: 0, fracOver16: 0 };
    expect(validateEquivalenceReport(lax, manifest, registry).join()).toMatch(/too lax/);

    const loosened = structuredClone(report) as EquivalenceReport & { thresholds: unknown };
    loosened.thresholds = {
      ...EQUIVALENCE_THRESHOLDS,
      downscaled: { minPsnr: 10, maxMeanAbs: 50, maxFracOver16: 1 },
    };
    expect(validateEquivalenceReport(loosened, manifest, registry).join()).toMatch(/thresholds differ/);

    expect(validateEquivalenceReport(null, manifest, registry).join()).toMatch(/missing/);
    const other = structuredClone(report);
    other.assets[0]!.sourceSha256 = '0'.repeat(64);
    expect(validateEquivalenceReport(other, manifest, registry).join()).toMatch(/different original/);
  });

  it('thresholds: lossless must be exact; the downscaled bound rejects a 2 px shift', () => {
    const perfect = { width: 1, height: 1, meanAbs: 0, maxAbs: 0, psnr: 99, fracOver16: 0 };
    expect(equivalenceFailures({ native: perfect, downscaled: perfect }, true)).toEqual([]);
    expect(
      equivalenceFailures({ native: { ...perfect, maxAbs: 1 }, downscaled: perfect }, true),
    ).toHaveLength(1);
    expect(
      equivalenceFailures({ native: { ...perfect, maxAbs: 9, psnr: 40 }, downscaled: perfect }, false),
    ).toEqual([]);
    const shift = report.assets[0]!.controls.find((c) => c.label === 'control:shift-2px')!;
    expect(equivalenceFailures(shift, false).length).toBeGreaterThan(0);
  });
});

describe('labels equal the inventory transcription exactly', () => {
  it('the registry quotes are valid and every published label is the inventory text, unchanged', () => {
    expect(registryOk.problems).toEqual([]);
    for (const a of manifest.assets) {
      const inv = inventory.assets.find((i) => i.id === a.assetId)!;
      const printed = inv.labels.filter((l) => l.text !== '(blank)' && l.text !== '(illegible)');
      expect(
        a.labels.map((l) => [l.labelId, l.text, l.lines]),
        a.assetId,
      ).toEqual(printed.map((l) => [l.id, l.text, l.lines]));
    }
    // Typos are kept exactly as printed (never silently corrected).
    const all = manifest.assets.flatMap((a) => a.labels.map((l) => l.text)).join('\n');
    expect(all).toContain('INGNEERING');
    expect(all).toContain('HOSTAL');
    expect(all).toContain('PEDISTRIAN');
  });

  it('a "corrected" label in the registry is rejected', () => {
    const r = structuredClone(registryRaw);
    const s = r.subjects.find((x) => x.displayLabel?.text.includes('INGNEERING'));
    expect(s).toBeDefined();
    s!.displayLabel = {
      ...s!.displayLabel!,
      text: s!.displayLabel!.text.replace('INGNEERING', 'ENGINEERING'),
    };
    expect(validateArtRegistry(r, inventory, hotspots, candidates, null).problems.join()).toMatch(
      /is not exactly/,
    );
  });
});

describe('duplicate originals', () => {
  const shaByFile = new Map(inventory.assets.map((a) => [a.file, sha256Hex(bytesOf(a.path))]));

  it('detects exactly 111/115 and publishes only the canonical copy', () => {
    const groups = findDuplicateOriginals(shaByFile);
    expect(groups).toEqual([
      ['111-lpu-isometric-map-design-963.png', '115-lpu-isometric-map-design-963.png'],
    ]);
    expect(checkDuplicatesHandled(groups, manifest, registry)).toEqual([]);
    const dup = manifest.assets.find((a) => a.assetId === 'iso-art-115')!;
    expect(dup.original).toBeNull();
    expect(dup.duplicateOf).toBe('iso-art-111');
    expect(existsSync(join(root, ART_PUBLIC_DIR, 'original', '115-lpu-isometric-map-design-963.png'))).toBe(
      false,
    );
  });

  it('flags a duplicate published twice, an unregistered duplicate and a false duplicateOf', () => {
    const groups = findDuplicateOriginals(shaByFile);
    const twice = structuredClone(manifest) as IsometricArtManifest;
    const d = twice.assets.find((a) => a.assetId === 'iso-art-115')!;
    d.original = {
      url: 'original/115-lpu-isometric-map-design-963.png',
      sha256: d.source.sha256,
      bytes: d.source.bytes,
    };
    expect(checkDuplicatesHandled(groups, twice, registry).join()).toMatch(/2 published/);

    const extra = new Map(shaByFile).set(
      '999-new-upload.png',
      shaByFile.get('11-lpu-isometric-map-design-961.png')!,
    );
    expect(checkDuplicatesHandled(findDuplicateOriginals(extra), manifest, registry).join()).toMatch(
      /not all are registered/,
    );

    const falseDup = structuredClone(manifest) as IsometricArtManifest;
    falseDup.assets.find((a) => a.assetId === 'iso-art-119')!.duplicateOf = 'iso-art-111';
    expect(checkDuplicatesHandled(groups, falseDup, registry).join()).toMatch(/not identical/);
  });
});

describe('associations are reported', () => {
  it('every subject has a record; statuses are counted (nothing verified without evidence)', () => {
    const c = associationCoverage(manifest);
    expect(c.missing).toEqual([]);
    expect(c.orphan).toEqual([]);
    expect(c.verified.length + c.approximate.length + c.unresolved.length).toBe(manifest.subjects.length);
    expect(c.verified).toEqual([]);
    expect(c.approximate.length).toBeGreaterThan(0);
  });

  it('a subject without a record and a record without a subject are reported', () => {
    const m = structuredClone(manifest) as IsometricArtManifest;
    const dropped = m.associations.shift()!;
    m.associations.push({ ...dropped, subjectId: 'art:num-999' });
    const c = associationCoverage(m);
    expect(c.missing).toEqual([dropped.subjectId]);
    expect(c.orphan).toEqual(['art:num-999']);
  });
});

describe('no artwork is fetched from another origin', () => {
  it('the manifest has relative URLs only, resolved under the app base', () => {
    expect(externalUrlsInManifest(manifest)).toEqual([]);
    for (const url of publishedFiles(manifest)) {
      expect(url).toMatch(/^(?:original|derived)\//);
      expect(artworkUrl(url, '/')).toBe(`/isometric-art/${url}`);
    }
    const evil = structuredClone(manifest) as unknown as { assets: { derived: { url: string }[] }[] };
    evil.assets[0]!.derived[0]!.url = 'https://cdn.example/x.webp';
    expect(externalUrlsInManifest(evil)).toHaveLength(1);
    expect(
      externalUrlsInManifest({ a: '//cdn.example/x.png', b: 'art:num-25', c: 'BLOCK-25,26:' }),
    ).toHaveLength(1);
  });

  it('no artwork module embeds an absolute URL in code, and the CSP allows images from self only', () => {
    const dir = join(root, 'src', 'isometric-art');
    const sources = listFiles(dir).filter((f) => /\.(?:ts|tsx)$/.test(f));
    expect(sources.length).toBeGreaterThan(0);
    for (const f of sources) expect(externalUrlsInSource(readFileSync(f, 'utf8')), rel(root, f)).toEqual([]);
    expect(externalUrlsInSource("const u = 'https://cdn.example/a.png'; // https://ok.example")).toEqual([
      'https://cdn.example/a.png',
    ]);
    expect(cspImgSrc(readFileSync(join(root, 'public', '_headers'), 'utf8'))).toEqual([
      "'self'",
      'data:',
      'blob:',
    ]);
  });
});

describe('production build check (pure, synthetic dist)', () => {
  const files = new Map<string, Uint8Array>();
  for (const url of publishedFiles(manifest))
    files.set(`isometric-art/${url}`, bytesOf(`${ART_PUBLIC_DIR}/${url}`));
  files.set('isometric-art/manifest.json', manifestBytes);
  const pre = [
    'index.html',
    'isometric-art/manifest.json',
    'isometric-art/derived/iso-art-001/preview-1600.webp',
  ];
  const sw = `precacheAndRoute([${pre.map((u) => `{url:"${u}",revision:"1"}`).join(',')}]);registerRoute(({url:s,sameOrigin:e})=>e&&/\\/isometric-art\\//.test(s.pathname),new StaleWhileRevalidate({cacheName:"${ART_RUNTIME_CACHE_NAME}"}),"GET");`;
  files.set('sw.js', new TextEncoder().encode(sw));
  files.set(
    'assets/index-abc.js',
    new TextEncoder().encode(`x="${ARTWORK_UNAVAILABLE_REASON}";y="${ILLUSTRATION_DISCLAIMER}"`),
  );
  files.set(
    '_headers',
    new TextEncoder().encode("Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:"),
  );
  const view = (m: Map<string, Uint8Array>): DistView => ({
    read: (p) => m.get(p) ?? null,
    list: () => [...m.keys()],
    sha256: sha256Hex,
  });

  it('accepts a complete build', () => {
    expect(checkDist(manifest, manifestBytes, view(files))).toEqual([]);
    expect(precachedUrls(sw)).toEqual(pre);
  });

  it('rejects a missing or altered file, a stray file, heavy precache, an unbundled view and a remote img-src', () => {
    const missing = new Map(files);
    missing.delete('isometric-art/derived/iso-art-001/tiles/0/0-0.webp');
    expect(checkDist(manifest, manifestBytes, view(missing)).join()).toMatch(
      /tiles\/0\/0-0\.webp is missing/,
    );

    const altered = new Map(files).set(
      'isometric-art/original/11-lpu-isometric-map-design-961.png',
      new Uint8Array([1]),
    );
    expect(checkDist(manifest, manifestBytes, view(altered)).join()).toMatch(
      /differs from the manifest sha256/,
    );

    const stray = new Map(files).set(
      'isometric-art/original/115-lpu-isometric-map-design-963.png',
      new Uint8Array([1]),
    );
    expect(checkDist(manifest, manifestBytes, view(stray)).join()).toMatch(/is not in the manifest/);

    const heavy = new Map(files).set(
      'sw.js',
      new TextEncoder().encode(
        sw.replace('[', '[{url:"isometric-art/original/1-lpu-isometric-map-design-3371.jpg",revision:"1"},'),
      ),
    );
    expect(checkDist(manifest, manifestBytes, view(heavy)).join()).toMatch(/precaches heavy artwork/);

    const noView = new Map(files).set(
      'assets/index-abc.js',
      new TextEncoder().encode('isometric-art/manifest.json'),
    );
    expect(checkDist(manifest, manifestBytes, view(noView)).join()).toMatch(/not bundled/);

    const remote = new Map(files).set('_headers', new TextEncoder().encode('img-src https://cdn.example'));
    expect(checkDist(manifest, manifestBytes, view(remote)).join()).toMatch(
      /img-src allows https:\/\/cdn.example/,
    );

    const staleManifest = new Map(files).set('isometric-art/manifest.json', new TextEncoder().encode('{}'));
    expect(checkDist(manifest, manifestBytes, view(staleManifest)).join()).toMatch(/manifest.json differs/);
  });
});
