// @vitest-environment node
/**
 * Runs the real CLI (node scripts/build-data.ts, native type stripping) on the
 * synthetic fixture twice and checks byte-identical, schema-valid output.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  basemapFileSchema,
  boundaryFileSchema,
  boundaryReviewFileSchema,
  buildingsFileSchema,
  contextPlacesFileSchema,
  DATA_FILES,
  detectionsFileSchema,
  graphFileSchema,
  manifestSchema,
  placesFileSchema,
  relationsFileSchema,
} from '../../src/data/schema.ts';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const input = join(repo, 'tests/fixtures/osm/synthetic-campus');
const curated = join(repo, 'tests/fixtures/osm/synthetic-curated');
const detections = join(repo, 'tests/fixtures/osm/synthetic-detections');
let tmp: string;

const build = (out: string, extra: string[] = []) =>
  execFileSync(
    process.execPath,
    [
      'scripts/build-data.ts',
      '--input',
      input,
      '--curated',
      curated,
      '--out',
      out,
      '--relation',
      '900001',
      ...extra,
    ],
    { cwd: repo, encoding: 'utf8' },
  );

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pipeline-'));
  build(join(tmp, 'a'), ['--cache', join(tmp, 'cache'), '--report', join(tmp, 'REPORT.md')]);
  build(join(tmp, 'b'));
  build(join(tmp, 'a'), ['--cache', join(tmp, 'cache'), '--report', join(tmp, 'REPORT.md')]); // rebuild in place
  build(join(tmp, 'd'), ['--detections', detections, '--coverage', join(tmp, 'COVERAGE.md')]);
  build(join(tmp, 'd2'), ['--detections', detections]);
});

const hashes = (dir: string) =>
  Object.fromEntries(
    readdirSync(dir).map((f) => [f, existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '']),
  );
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('build-data CLI on the synthetic fixture', () => {
  it('produces byte-identical output across rebuilds', () => {
    const files = readdirSync(join(tmp, 'a')).sort();
    expect(files).toEqual(Object.values(DATA_FILES).sort());
    for (const f of files) {
      expect(readFileSync(join(tmp, 'b', f), 'utf8'), f).toBe(readFileSync(join(tmp, 'a', f), 'utf8'));
    }
  });

  it('writes schema-valid files with a content-derived version and real counts', () => {
    const read = (f: string) => JSON.parse(readFileSync(join(tmp, 'a', f), 'utf8')) as unknown;
    const manifest = manifestSchema.parse(read(DATA_FILES.manifest));
    boundaryFileSchema.parse(read(DATA_FILES.boundary));
    buildingsFileSchema.parse(read(DATA_FILES.buildings));
    basemapFileSchema.parse(read(DATA_FILES.basemap));
    const places = placesFileSchema.parse(read(DATA_FILES.places)).places;
    relationsFileSchema.parse(read(DATA_FILES.relations));
    const graph = graphFileSchema.parse(read(DATA_FILES.graph));
    expect(manifest.datasetVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(manifest.builtFrom).toBe('2026-01-01T00:00:00Z');
    expect(manifest.bbox).toEqual([75.688, 31.238, 75.692, 31.242]);
    expect(manifest.counts).toMatchObject({
      places: places.length,
      buildings: 4, // v2: the off-campus cafe footprint is excluded (v1 counted 5 footprints)
      'buildings:outsideExcluded': 1,
      contextPlaces: 2,
      'graph:nodes': graph.nodes.length,
      'graph:edges': 13,
      'graph:components': 3,
      'kind:organization': 2,
      'heightSource:osm-height': 1,
    });
    expect(manifest.sources.map((s) => s.id)).toEqual([
      'osm',
      'curated:example-org-directory',
      'curated:example-org-signage',
      'curated:example-org-survey',
      'curated:synthetic-report',
    ]);
  });

  it('shows a curated building name on the map footprint as well as in places', () => {
    const read = (f: string) => JSON.parse(readFileSync(join(tmp, 'a', f), 'utf8')) as unknown;
    const places = placesFileSchema.parse(read(DATA_FILES.places)).places;
    const buildings = buildingsFileSchema.parse(read(DATA_FILES.buildings)).features;
    const overridden = places.find((p) => p.id === 'osm:way/201');
    const footprint = buildings.find((f) => f.properties.id === 'osm:way/201');
    expect(overridden).toMatchObject({ name: 'Synthetic Admin Block', displayName: 'Synthetic Admin Block' });
    expect(footprint?.properties).toMatchObject({
      name: 'Synthetic Admin Block',
      displayName: 'Synthetic Admin Block',
    });
    for (const f of buildings) {
      const p = places.find((x) => x.id === f.properties.id);
      expect(p, f.properties.id).toBeDefined();
      expect(f.properties).toMatchObject({
        name: p!.name,
        displayName: p!.displayName,
        categoryId: p!.categoryId,
      });
    }
  });

  it('keeps the previous manifest for change detection and writes the markdown report', () => {
    const prev = manifestSchema.parse(
      JSON.parse(readFileSync(join(tmp, 'cache', 'previous-manifest.json'), 'utf8')),
    );
    const cur = manifestSchema.parse(JSON.parse(readFileSync(join(tmp, 'a', DATA_FILES.manifest), 'utf8')));
    expect(prev.datasetVersion).toBe(cur.datasetVersion);
    const md = readFileSync(join(tmp, 'REPORT.md'), 'utf8');
    expect(md).toContain(`Dataset \`${cur.datasetVersion}\``);
    // v2 columns: campus | nearby outside (context layer) | status
    expect(md).toMatch(/Drinking water\s*\|\s*1\s*\|\s*0\s*\|\s*sparse/);
    expect(md).toContain('`osm:way/202` Unnamed building (on-campus)');
  });

  it('writes every v2 file with campus/context separation', () => {
    const read = (f: string) => JSON.parse(readFileSync(join(tmp, 'a', f), 'utf8')) as unknown;
    const ctx = contextPlacesFileSchema.parse(read(DATA_FILES.contextPlaces)).places;
    expect(ctx.map((p) => p.id).sort()).toEqual(['osm:way/205', 'osm:way/206']);
    const review = boundaryReviewFileSchema.parse(read(DATA_FILES.boundaryReview));
    expect(review.items).toEqual([]);
    expect(detectionsFileSchema.parse(read(DATA_FILES.detections)).features).toEqual([]);
  });

  it('ships unmatched detections with confirmations and the CDLA text, byte-identically', () => {
    const files = readdirSync(join(tmp, 'd')).sort();
    expect(files).toEqual([...Object.values(DATA_FILES), 'licenses'].sort());
    for (const f of files.filter((x) => x !== 'licenses'))
      expect(readFileSync(join(tmp, 'd2', f), 'utf8'), f).toBe(readFileSync(join(tmp, 'd', f), 'utf8'));
    const read = (f: string) => JSON.parse(readFileSync(join(tmp, 'd', f), 'utf8')) as unknown;
    const det = detectionsFileSchema.parse(read(DATA_FILES.detections)).features.map((f) => f.properties);
    expect(det.map((p) => [p.source, p.geometryKind, p.confirmedBy, p.matchedOsmId])).toEqual([
      ['google-open-buildings', 'point', [], null],
      ['microsoft-ml', 'footprint', ['google-open-buildings'], null],
    ]);
    for (const p of det) expect(p).toMatchObject({ campusStatus: 'inside', reviewStatus: 'unreviewed' });
    const manifest = manifestSchema.parse(read(DATA_FILES.manifest));
    expect(manifest.counts).toMatchObject({
      detections: 2,
      'detections:microsoft-ml': 1,
      'detections:google-open-buildings': 1,
    });
    const ms = manifest.sources.find((x) => x.id === 'microsoft-ml-buildings');
    expect(ms).toMatchObject({
      license: 'CDLA-Permissive-2.0',
      licenseTextPath: 'data/licenses/CDLA-Permissive-2.0.txt',
    });
    expect(readFileSync(join(tmp, 'd', 'licenses', 'CDLA-Permissive-2.0.txt'), 'utf8')).toMatch(/SYNTHETIC/);
    // detections never become buildings or places
    const buildings = buildingsFileSchema
      .parse(read(DATA_FILES.buildings))
      .features.map((f) => f.properties.id);
    const places = placesFileSchema.parse(read(DATA_FILES.places)).places.map((p) => p.id);
    for (const p of det) {
      expect(buildings).not.toContain(p.id);
      expect(places).not.toContain(p.id);
    }
    const coverage = readFileSync(join(tmp, 'COVERAGE.md'), 'utf8');
    expect(coverage).toMatch(/\*\*Microsoft detections shipped\*\*\s*\|\s*\*\*1\*\*/);
    expect(coverage).toContain('GENERATED by scripts/build-data.ts');
  });

  it('leaves the output untouched when validation fails', () => {
    const out = join(tmp, 'guarded');
    cpSync(join(tmp, 'a'), out, { recursive: true });
    const before = hashes(out);
    const badCurated = join(tmp, 'bad-curated');
    cpSync(curated, badCurated, { recursive: true });
    writeFileSync(
      join(badCurated, 'landmarks.json'),
      JSON.stringify({
        landmarks: [{ id: 'osm:way/999999', in: ['buildings'], why: 'test: a vanished landmark' }],
      }),
    );
    const r = spawnSync(
      process.execPath,
      [
        'scripts/build-data.ts',
        '--input',
        input,
        '--curated',
        badCurated,
        '--out',
        out,
        '--relation',
        '900001',
      ],
      { cwd: repo, encoding: 'utf8' },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/landmark-missing.*osm:way\/999999/);
    expect(r.stderr).toMatch(/output directory was NOT changed/);
    expect(hashes(out)).toEqual(before);
  });

  it('count-change guard: a > 40 % change fails unless acknowledged with a recorded reason', () => {
    // The baseline here is the dataset being replaced (the output is outside the repository, so there
    // is no committed git HEAD manifest); it claims three times as many places as the build produces.
    const out = join(tmp, 'guard-counts');
    cpSync(join(tmp, 'a'), out, { recursive: true });
    const mPath = join(out, DATA_FILES.manifest);
    const m = manifestSchema.parse(JSON.parse(readFileSync(mPath, 'utf8')));
    writeFileSync(
      mPath,
      `${JSON.stringify({ ...m, counts: { ...m.counts, places: m.counts.places! * 3 } }, null, 2)}\n`,
    );
    const before = hashes(out);
    const run = (extra: string[], cur = curated) =>
      spawnSync(
        process.execPath,
        [
          'scripts/build-data.ts',
          '--input',
          input,
          '--curated',
          cur,
          '--out',
          out,
          '--relation',
          '900001',
          ...extra,
        ],
        { cwd: repo, encoding: 'utf8' },
      );

    const refused = run([]);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(
      /error \[count-change\] count "places" changed \d+ → \d+ \(67 %\), above the 40 % limit/,
    );
    expect(hashes(out)).toEqual(before);

    const tooShort = run(['--accept-count-changes', 'ok']);
    expect(tooShort.status).toBe(1);
    expect(tooShort.stderr).toMatch(/at least 20 characters/);
    expect(hashes(out)).toEqual(before);

    const report = join(tmp, 'GUARD-REPORT.md');
    const accepted = run([
      '--accept-count-changes',
      'synthetic test: places intentionally reduced',
      '--report',
      report,
    ]);
    expect(accepted.status, accepted.stderr).toBe(0);
    expect(accepted.stderr).toMatch(
      /warning \[count-change-accepted\] 1 count change\(s\) .*synthetic test: places intentionally reduced/,
    );
    const md = readFileSync(report, 'utf8');
    expect(md).toContain('## Count-change guard');
    expect(md).toContain(
      '**Accepted large change** (--accept-count-changes): synthetic test: places intentionally reduced',
    );
    expect(md).toMatch(/\|\s*`places`\s*\|\s*\d+\s*\|\s*\d+\s*\|\s*67 %\s*\|\s*accepted\s*\|/); // prettier-aligned table

    // Identical rebuild (the baseline is now this very dataset, as in CI after the commit): no acceptance
    // is needed and the recorded guard block is kept verbatim, so the committed report stays in sync.
    const again = run(['--report', report]);
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toMatch(/count-change baseline: [0-9a-f]{12} \(schema 2\) from .*manifest\.json/);
    expect(readFileSync(report, 'utf8')).toBe(md);

    // Durable form: a curated acceptance pinned to the baseline's datasetVersion.
    writeFileSync(
      mPath,
      `${JSON.stringify({ ...m, datasetVersion: 'abcdefabcdef', counts: { ...m.counts, places: m.counts.places! * 3 } }, null, 2)}\n`,
    );
    const pinned = join(tmp, 'pinned-curated');
    cpSync(curated, pinned, { recursive: true });
    const acceptance = (version: string) =>
      writeFileSync(
        join(pinned, 'count-change-acceptance.json'),
        JSON.stringify({
          acceptances: [
            {
              baselineDatasetVersion: version,
              reason: 'synthetic test: reviewed and intended',
              acceptedBy: 'test',
              acceptedAt: '2026-01-01',
            },
          ],
        }),
      );
    acceptance('0123456789ab'); // pinned to another baseline: does not apply, reported as stale
    const stale = run([], pinned);
    expect(stale.status).toBe(1);
    expect(stale.stderr).toMatch(/count-acceptance-stale/);
    acceptance('abcdefabcdef');
    const curatedOk = run([], pinned);
    expect(curatedOk.status, curatedOk.stderr).toBe(0);
    expect(curatedOk.stderr).toMatch(
      /accepted by data\/curated\/count-change-acceptance\.json \(test, 2026-01-01\)/,
    );
  });

  it('passes validate-data and fails loudly on bad input', () => {
    const ok = spawnSync(process.execPath, ['scripts/validate-data.ts', '--dir', join(tmp, 'a')], {
      cwd: repo,
      encoding: 'utf8',
    });
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toMatch(/0 errors/);
    const missing = spawnSync(
      process.execPath,
      [
        'scripts/build-data.ts',
        '--input',
        input,
        '--curated',
        curated,
        '--out',
        join(tmp, 'c'),
        '--relation',
        '424242',
      ],
      { cwd: repo, encoding: 'utf8' },
    );
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/relation 424242 is missing/);
  });
});
