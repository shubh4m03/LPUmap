/**
 * Publishes the owner-supplied isometric artwork
 * (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §2):
 *
 *   npm run art:build        validate, copy originals, write manifest + mapping doc
 *   npm run art:check        verify the committed outputs are complete and current (CI; no Chromium)
 *   npm run art:derive       (re)make derived copies with the Playwright Chromium canvas, measure their
 *                            visual equivalence with the original, then build as above
 *   npm run art:verify       Chromium: re-derive twice (must be byte-identical), compare with the committed
 *                            copies and re-measure their visual equivalence; writes nothing
 *   npm run art:check-dist   after `vite build`: the production build holds every published file
 *                            byte-identical, precaches only the light files, bundles the loader
 *
 * Inputs (curated, committed): lpu-isometric-map-design/* (originals, read
 * only), data/curated/isometric-art/{inventory,hotspots,registry}.json and
 * docs/research/block-leads/block-candidates.json. Outputs (committed, so a
 * production build never needs Chromium): public/isometric-art/manifest.json,
 * public/isometric-art/original/<unchanged original file names>,
 * public/isometric-art/derived/**, docs/isometric-art/derived-equivalence.json
 * and docs/LPU_ISOMETRIC_ASSET_MAPPING.md.
 *
 * Originals are never written: every original's sha256 is checked against
 * the inventory before anything is published, and published copies are
 * byte-identical (checked again in --check and --check-dist).
 */
import {
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isometricArtManifestSchema,
  type IsometricArtManifest,
  type IsometricArtRegistry,
  type ManifestDerived,
} from '../src/isometric-art/schema.ts';
import { ART_HOTSPOTS_PATH, validateArtHotspots, type ArtHotspots } from './lib/art-hotspots-check.ts';
import {
  ART_INVENTORY_PATH,
  ART_SOURCE_DIR,
  sha256Hex,
  validateArtInventory,
  type ArtInventory,
} from './lib/art-inventory-check.ts';
import {
  ART_MANIFEST_PATH,
  ART_MAPPING_DOC_PATH,
  ART_PUBLIC_DIR,
  ART_REGISTRY_PATH,
  buildArtManifest,
  expectedDerived,
  publishedFiles,
  renderMappingMarkdown,
  validateArtRegistry,
  validateDerived,
  type BlockCandidateLead,
} from './lib/art-registry-check.ts';
import type { ImageSource, RenderedFile } from './lib/isometric-art/chromium.ts';
import {
  COMPARE_WIDTH,
  EQUIVALENCE_REPORT_PATH,
  EQUIVALENCE_THRESHOLDS,
  associationCoverage,
  checkDist,
  checkDuplicatesHandled,
  encodingProblems,
  equivalenceFailures,
  equivalenceGroups,
  externalUrlsInManifest,
  findDuplicateOriginals,
  isLosslessSpec,
  renderJobs,
  type EquivalenceReport,
  type EquivalenceReportAsset,
  validateEquivalenceReport,
} from './lib/isometric-art/integrity.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CANDIDATES_PATH = 'docs/research/block-leads/block-candidates.json';
const BUILDINGS_PATH = 'public/data/buildings.geojson';

const argv = process.argv.slice(2);
const check = argv.includes('--check');
const derive = argv.includes('--derive');
const verify = argv.includes('--verify');
const distAt = argv.indexOf('--check-dist');
const distDir =
  distAt < 0 ? null : argv[distAt + 1] && !argv[distAt + 1]!.startsWith('--') ? argv[distAt + 1]! : 'dist';

const abs = (p: string) => join(root, p);
const readJson = (p: string): unknown => JSON.parse(readFileSync(abs(p), 'utf8'));
const fail = (problems: readonly string[], what: string): never => {
  console.error(`art: ${what} failed (${problems.length} problem${problems.length === 1 ? '' : 's'}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
};

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

async function formatWithPrettier(text: string, filepath: string): Promise<string> {
  const prettier = await import('prettier');
  const options = (await prettier.resolveConfig(filepath)) ?? {};
  return prettier.format(text, { ...options, filepath });
}

const sourceOf = (m: IsometricArtManifest['assets'][number]): ImageSource => ({
  bytes: readFileSync(abs(m.source.originalPath)),
  mime: m.source.mime,
  width: m.source.width,
  height: m.source.height,
});

/** Renders every derive spec of every registry asset (one browser per call). */
async function renderAll(
  registry: IsometricArtRegistry,
  assets: IsometricArtManifest['assets'],
): Promise<{
  version: string;
  byAsset: Map<string, { jobs: ReturnType<typeof renderJobs>; files: RenderedFile[] }>;
}> {
  const { launchArtChromium, renderDerived } = await import('./lib/isometric-art/chromium.ts');
  const { browser, page, version } = await launchArtChromium();
  const byAsset = new Map<string, { jobs: ReturnType<typeof renderJobs>; files: RenderedFile[] }>();
  try {
    for (const r of registry.assets) {
      if (r.derive.length === 0) continue;
      const m = assets.find((a) => a.assetId === r.assetId);
      if (!m) throw new Error(`no manifest asset ${r.assetId}`);
      const jobs = r.derive.flatMap((s) => renderJobs(r.assetId, s, m.source.width, m.source.height));
      byAsset.set(r.assetId, { jobs, files: await renderDerived(page, sourceOf(m), jobs) });
    }
  } finally {
    await browser.close();
  }
  return { version, byAsset };
}

/** Measures every derived group of every asset (+ negative controls) in Chromium. */
async function measureAll(
  registry: IsometricArtRegistry,
  assets: IsometricArtManifest['assets'],
  filesOf: (assetId: string, url: string) => Uint8Array,
): Promise<{ version: string; compareWidth: number; assets: EquivalenceReportAsset[] }> {
  const { launchArtChromium, measureEquivalence, NEGATIVE_CONTROLS } =
    await import('./lib/isometric-art/chromium.ts');
  const { browser, page, version } = await launchArtChromium();
  const out: EquivalenceReportAsset[] = [];
  try {
    for (const r of registry.assets) {
      if (r.derive.length === 0) continue;
      const m = assets.find((a) => a.assetId === r.assetId);
      if (!m) throw new Error(`no manifest asset ${r.assetId}`);
      const jobs = r.derive.flatMap((s) => renderJobs(r.assetId, s, m.source.width, m.source.height));
      const outputs = jobs.map((j) => ({ url: j.url, bytes: filesOf(r.assetId, j.url) }));
      const groups = equivalenceGroups(jobs, outputs, m.derived);
      // Controls are encoded like the first spec, so they carry the same encoding loss as a real copy.
      const first = r.derive[0]!;
      const { results, controls } = await measureEquivalence(page, sourceOf(m), groups, {
        kinds: NEGATIVE_CONTROLS,
        mime: first.format,
        quality: first.quality,
      });
      const specOf = (label: string) =>
        r.derive.find((s) => s.purpose === (label.startsWith('tiles-') ? 'tiles' : label));
      out.push({
        assetId: r.assetId,
        sourceSha256: m.source.sha256,
        groups: results.map((g) => {
          const spec = specOf(g.label);
          const lossless = spec ? isLosslessSpec(spec) : false;
          const files = m.derived
            .filter((d) => (d.purpose === 'tile' ? `tiles-${d.tile?.level ?? 0}` : d.purpose) === g.label)
            .map((d) => ({ url: d.url, sha256: d.sha256 }));
          return { ...g, lossless, files, pass: equivalenceFailures(g, lossless).length === 0 };
        }),
        controls: controls.map((c) => ({
          ...c,
          failsThresholds:
            equivalenceFailures(c, true).length > 0 && equivalenceFailures(c, false).length > 0,
        })),
      });
    }
  } finally {
    await browser.close();
  }
  return { version, compareWidth: COMPARE_WIDTH, assets: out };
}

function equivalenceReport(measured: Awaited<ReturnType<typeof measureAll>>): EquivalenceReport {
  return {
    schemaVersion: 1,
    kind: 'lpu-isometric-art-derived-equivalence',
    $comment:
      'Generated by npm run art:derive (scripts/build-isometric-art.ts). native: each derived image vs the original drawn at the same size in Chromium (encoding loss only; lossless must be identical). downscaled: the derived image and the FULL original, both downscaled to compareWidth in Chromium (catches crop, stretch, shift, misplaced tiles, recolour). controls: deliberate perturbations that must fail the thresholds. Metrics: meanAbs/maxAbs in 0-255 per channel, psnr in dB over RGB, fracOver16 = share of pixels with a channel off by more than 16.',
    renderer: { engine: 'chromium', version: measured.version },
    compareWidth: measured.compareWidth,
    thresholds: EQUIVALENCE_THRESHOLDS,
    assets: measured.assets,
  };
}

async function main(): Promise<void> {
  // ---- 1. inputs and their own validators (reused, never re-implemented)
  const inventory = readJson(ART_INVENTORY_PATH) as ArtInventory;
  const originals = new Map<string, Uint8Array>();
  for (const f of readdirSync(abs(ART_SOURCE_DIR)))
    originals.set(f, readFileSync(join(abs(ART_SOURCE_DIR), f)));
  const invProblems = validateArtInventory(inventory, originals);
  if (invProblems.length) fail(invProblems, 'inventory validation');
  const hotspots = readJson(ART_HOTSPOTS_PATH) as ArtHotspots;
  const masterFile = inventory.assets.find((a) => a.id === hotspots.source.assetId)?.file ?? '';
  const hsProblems = validateArtHotspots(hotspots, inventory, originals.get(masterFile) ?? new Uint8Array());
  if (hsProblems.length) fail(hsProblems, 'hotspot validation');

  const candidates = readJson(CANDIDATES_PATH) as BlockCandidateLead[];
  let buildingIds: Set<string> | null = null;
  if (existsSync(abs(BUILDINGS_PATH))) {
    const fc = readJson(BUILDINGS_PATH) as {
      features: { properties: { id: string; inCampusInventory?: boolean } }[];
    };
    buildingIds = new Set(
      fc.features.filter((f) => f.properties.inCampusInventory).map((f) => f.properties.id),
    );
  }
  const registryRaw = readJson(ART_REGISTRY_PATH);
  const { registry, problems: regProblems } = validateArtRegistry(
    registryRaw,
    inventory,
    hotspots,
    candidates,
    buildingIds,
  );
  if (!registry || regProblems.length) fail(regProblems, 'registry validation');
  if (!registry) return;

  // ---- 2. the committed manifest (derived records are carried over from it unless --derive)
  let committed: IsometricArtManifest | null = null;
  if (existsSync(abs(ART_MANIFEST_PATH))) {
    const parsed = isometricArtManifestSchema.safeParse(readJson(ART_MANIFEST_PATH));
    if (parsed.success) committed = parsed.data;
    else if (check || verify || distDir)
      fail(
        parsed.error.issues.map((i) => `manifest ${i.path.join('.')}: ${i.message}`),
        'manifest schema',
      );
  } else if (check || verify || distDir)
    fail([`${ART_MANIFEST_PATH} is missing (run npm run art:build)`], 'check');

  // ---- 2a. --check-dist: the production build (after vite build)
  if (distDir) {
    if (!committed) return;
    const distRoot = resolve(root, distDir);
    const problems = checkDist(committed, readFileSync(abs(ART_MANIFEST_PATH)), {
      read: (rel) => (existsSync(join(distRoot, rel)) ? readFileSync(join(distRoot, rel)) : null),
      list: () => listFiles(distRoot).map((f) => relative(distRoot, f).split('\\').join('/')),
      sha256: sha256Hex,
    });
    if (problems.length) fail(problems, `production build check (${distDir})`);
    console.log(
      `art: ${distDir} OK — manifest and ${publishedFiles(committed).length} published files byte-identical; precache light only; loader bundled`,
    );
    return;
  }

  const fileSha = (url: string): string | null => {
    const p = join(abs(ART_PUBLIC_DIR), url);
    return existsSync(p) ? sha256Hex(readFileSync(p)) : null;
  };

  // ---- 2b. --verify: Chromium re-derivation (determinism) + equivalence of the committed copies
  if (verify) {
    if (!committed) return;
    const problems: string[] = [];
    const runA = await renderAll(registry, committed.assets);
    const runB = await renderAll(registry, committed.assets);
    let identical = 0;
    let sameAsCommitted = 0;
    let total = 0;
    for (const [assetId, a] of runA.byAsset) {
      const b = runB.byAsset.get(assetId);
      a.files.forEach((f, i) => {
        total++;
        const other = b?.files[i];
        if (other && sha256Hex(other.bytes) === sha256Hex(f.bytes)) identical++;
        else problems.push(`${assetId}: ${f.url} differs between two derivations (not deterministic)`);
        if (fileSha(f.url) === sha256Hex(f.bytes)) sameAsCommitted++;
      });
    }
    const measured = await measureAll(registry, committed.assets, (_id, url) =>
      readFileSync(join(abs(ART_PUBLIC_DIR), url)),
    );
    // Pixel identity of a lossless copy is only testable where this Chromium decodes the original
    // exactly as the one that made it — proven when it re-derives the committed bytes. Elsewhere
    // (another CPU/OS colour-conversion path) the native check uses the lossy bound; the
    // whole-image downscaled bounds and the negative controls apply unchanged.
    const strictLossless = sameAsCommitted === total;
    for (const a of measured.assets) {
      for (const g of a.groups) {
        const fails = equivalenceFailures(g, g.lossless && strictLossless);
        console.log(
          `art: ${a.assetId} ${g.label.padEnd(9)} native psnr ${g.native.psnr} maxAbs ${g.native.maxAbs} | downscaled psnr ${g.downscaled.psnr} meanAbs ${g.downscaled.meanAbs} fracOver16 ${g.downscaled.fracOver16} → ${fails.length ? 'FAIL' : 'ok'}`,
        );
        if (fails.length)
          problems.push(`${a.assetId}: committed ${g.label} not equivalent: ${fails.join('; ')}`);
      }
      for (const c of a.controls) {
        console.log(
          `art: ${a.assetId} ${c.label} downscaled psnr ${c.downscaled.psnr} fracOver16 ${c.downscaled.fracOver16} → ${c.failsThresholds ? 'rejected (as it must be)' : 'ACCEPTED'}`,
        );
        if (!c.failsThresholds)
          problems.push(`${a.assetId}: negative control ${c.label} passes the thresholds`);
      }
    }
    console.log(
      `art: verify — Chromium ${runA.version}; ${identical}/${total} derived files byte-identical across two runs; ${sameAsCommitted}/${total} byte-identical to the committed copies${
        strictLossless
          ? ' (lossless copies required pixel-identical)'
          : ' (a different Chromium/OS may decode or encode differently: lossless copies were held to the lossy native bound; the downscaled bounds are unchanged)'
      }`,
    );
    if (problems.length) fail(problems, 'verify');
    return;
  }

  // ---- 2c. derived records: newly made (--derive) or carried over from the committed manifest
  let derived = new Map<string, readonly ManifestDerived[]>(
    (committed?.assets ?? []).map((a) => [a.assetId, a.derived]),
  );
  let report: EquivalenceReport | null = null;
  if (derive) {
    // A provisional manifest (no derived records) supplies source sizes/sha256 for the jobs.
    const sha = (p: string) => sha256Hex(readFileSync(abs(p)));
    const base = buildArtManifest({
      registry,
      inventory,
      hotspots,
      sha256: {
        registry: sha(ART_REGISTRY_PATH),
        inventory: sha(ART_INVENTORY_PATH),
        hotspots: sha(ART_HOTSPOTS_PATH),
      },
      derived: new Map(),
    });
    const rendered = await renderAll(registry, base.assets);
    derived = new Map();
    const written = new Set<string>();
    const problems: string[] = [];
    for (const r of registry.assets) {
      const m = base.assets.find((a) => a.assetId === r.assetId)!;
      const out = rendered.byAsset.get(r.assetId);
      if (!out) {
        derived.set(r.assetId, []);
        continue;
      }
      const records: ManifestDerived[] = [];
      let i = 0;
      for (const spec of r.derive)
        for (const e of expectedDerived(r.assetId, spec, m.source.width, m.source.height)) {
          const f = out.files[i++]!;
          if (f.url !== e.url || f.width !== e.width || f.height !== e.height)
            problems.push(
              `${r.assetId}: rendered ${f.url} ${f.width}x${f.height} != expected ${e.url} ${e.width}x${e.height}`,
            );
          for (const p of encodingProblems(f.bytes, spec)) problems.push(`${r.assetId}: ${f.url}: ${p}`);
          const target = join(abs(ART_PUBLIC_DIR), e.url);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, f.bytes);
          written.add(e.url);
          records.push({
            purpose: e.purpose,
            url: e.url,
            sha256: sha256Hex(f.bytes),
            sourceSha256: m.source.sha256,
            bytes: f.bytes.length,
            width: e.width,
            height: e.height,
            mime: e.mime,
            ...(e.tile ? { tile: e.tile } : {}),
          });
        }
      derived.set(r.assetId, records);
    }
    if (problems.length) fail(problems, 'derive');
    // Remove derived files no spec produces any more (generated directory only; originals are never touched).
    for (const f of listFiles(join(abs(ART_PUBLIC_DIR), 'derived'))) {
      const rel = relative(abs(ART_PUBLIC_DIR), f).split('\\').join('/');
      if (!written.has(rel)) rmSync(f);
    }
    const withDerived = base.assets.map((a) => ({ ...a, derived: [...(derived.get(a.assetId) ?? [])] }));
    const measured = await measureAll(registry, withDerived, (_id, url) =>
      readFileSync(join(abs(ART_PUBLIC_DIR), url)),
    );
    report = equivalenceReport(measured);
    const failing = measured.assets.flatMap((a) => [
      ...a.groups
        .filter((g) => !g.pass)
        .map(
          (g) =>
            `${a.assetId}: ${g.label} is not visually equivalent: ${equivalenceFailures(g, g.lossless).join('; ')}`,
        ),
      ...a.controls
        .filter((c) => !c.failsThresholds)
        .map((c) => `${a.assetId}: negative control ${c.label} passes`),
    ]);
    if (failing.length) fail(failing, 'visual equivalence');
    console.log(
      `art: derived ${written.size} files with Chromium ${rendered.version}; every group visually equivalent; every negative control rejected`,
    );
  }

  const sha = (p: string) => sha256Hex(readFileSync(abs(p)));
  const manifest = buildArtManifest({
    registry,
    inventory,
    hotspots,
    sha256: {
      registry: sha(ART_REGISTRY_PATH),
      inventory: sha(ART_INVENTORY_PATH),
      hotspots: sha(ART_HOTSPOTS_PATH),
    },
    derived,
  });
  const mappingDoc = await formatWithPrettier(renderMappingMarkdown(manifest), abs(ART_MAPPING_DOC_PATH));
  const manifestText = await formatWithPrettier(
    `${JSON.stringify(manifest, null, 2)}\n`,
    abs(ART_MANIFEST_PATH),
  );

  // ---- integrity checks shared by build and check (pure; integrity.ts)
  const integrity: string[] = [];
  const dupGroups = findDuplicateOriginals(new Map([...originals].map(([f, b]) => [f, sha256Hex(b)])));
  integrity.push(...checkDuplicatesHandled(dupGroups, manifest, registry));
  integrity.push(...externalUrlsInManifest(manifest).map((u) => `manifest points at another origin: ${u}`));
  for (const a of manifest.assets) {
    const specs = registry.assets.find((r) => r.assetId === a.assetId)?.derive ?? [];
    for (const d of a.derived) {
      const spec = specs.find((s) => (d.purpose === 'tile' ? 'tiles' : d.purpose) === s.purpose);
      const p = join(abs(ART_PUBLIC_DIR), d.url);
      if (spec && existsSync(p))
        for (const e of encodingProblems(readFileSync(p), spec))
          integrity.push(`${a.assetId}: ${d.url}: ${e}`);
    }
  }
  const coverage = associationCoverage(manifest);
  for (const s of coverage.missing) integrity.push(`subject ${s}: no association record`);
  for (const s of coverage.orphan) integrity.push(`association ${s}: no such subject`);
  const reportRaw: unknown =
    report ?? (existsSync(abs(EQUIVALENCE_REPORT_PATH)) ? readJson(EQUIVALENCE_REPORT_PATH) : null);
  integrity.push(...validateEquivalenceReport(reportRaw, manifest, registry));
  const coverageLine = `associations — verified ${coverage.verified.length}, approximate ${coverage.approximate.length}, unresolved ${coverage.unresolved.length} (of ${manifest.subjects.length} subjects; unresolved ones await owner evidence)`;

  if (check) {
    const problems: string[] = [...integrity];
    if (JSON.stringify(committed) !== JSON.stringify(manifest))
      problems.push(
        `${ART_MANIFEST_PATH} is stale: the registry, inventory or hotspots changed (run npm run art:build)`,
      );
    for (const a of manifest.assets) {
      if (!a.original) continue;
      const got = fileSha(a.original.url);
      if (got === null)
        problems.push(`${ART_PUBLIC_DIR}/${a.original.url} is missing (run npm run art:build)`);
      else if (got !== a.source.sha256)
        problems.push(
          `${ART_PUBLIC_DIR}/${a.original.url} differs from the original ${a.source.originalPath}`,
        );
    }
    problems.push(...validateDerived(manifest, registry, fileSha));
    const expected = new Set([...publishedFiles(manifest), 'manifest.json']);
    for (const f of listFiles(abs(ART_PUBLIC_DIR))) {
      const rel = relative(abs(ART_PUBLIC_DIR), f).split('\\').join('/');
      if (!expected.has(rel)) problems.push(`${ART_PUBLIC_DIR}/${rel} is not in the manifest (stale file)`);
    }
    const doc = existsSync(abs(ART_MAPPING_DOC_PATH)) ? readFileSync(abs(ART_MAPPING_DOC_PATH), 'utf8') : '';
    if (doc.replace(/\r\n/g, '\n') !== mappingDoc)
      problems.push(`${ART_MAPPING_DOC_PATH} is stale (run npm run art:build)`);
    if (problems.length) fail(problems, 'check');
    const subjects = manifest.subjects.length;
    console.log(
      `art: check OK — ${manifest.assets.filter((a) => a.original).length} originals, ${manifest.hotspots.length} hotspots, ${subjects} subjects, ${publishedFiles(manifest).length} published files (${manifest.assets.reduce((n, a) => n + a.derived.length, 0)} derived, visually equivalent)`,
    );
    console.log(`art: ${coverageLine}`);
    return;
  }

  // ---- 3. publish: unchanged copies of the canonical originals, manifest, report, mapping doc
  mkdirSync(join(abs(ART_PUBLIC_DIR), 'original'), { recursive: true });
  for (const a of manifest.assets) {
    if (!a.original) continue;
    const target = join(abs(ART_PUBLIC_DIR), a.original.url);
    if (fileSha(a.original.url) !== a.source.sha256) copyFileSync(abs(a.source.originalPath), target);
    if (fileSha(a.original.url) !== a.source.sha256)
      fail([`copy of ${a.source.originalPath} does not match`], 'publish');
  }
  const derivedProblems = validateDerived(manifest, registry, fileSha);
  if (derivedProblems.length) fail(derivedProblems, 'derived copies');
  if (integrity.length) fail(integrity, 'integrity');
  writeFileSync(abs(ART_MANIFEST_PATH), manifestText);
  writeFileSync(abs(ART_MAPPING_DOC_PATH), mappingDoc);
  if (report) {
    mkdirSync(dirname(abs(EQUIVALENCE_REPORT_PATH)), { recursive: true });
    writeFileSync(
      abs(EQUIVALENCE_REPORT_PATH),
      await formatWithPrettier(`${JSON.stringify(report, null, 2)}\n`, abs(EQUIVALENCE_REPORT_PATH)),
    );
  }
  const stale = listFiles(abs(ART_PUBLIC_DIR))
    .map((f) => relative(abs(ART_PUBLIC_DIR), f).split('\\').join('/'))
    .filter((f) => f !== 'manifest.json' && !publishedFiles(manifest).includes(f));
  if (stale.length) console.warn(`art: files not in the manifest (remove them): ${stale.join(', ')}`);
  console.log(
    `art: wrote ${ART_MANIFEST_PATH} (${manifest.assets.length} assets, ${manifest.hotspots.length} hotspots, ${manifest.subjects.length} subjects) and ${ART_MAPPING_DOC_PATH}`,
  );
  console.log(`art: ${coverageLine}`);
}

await main();
