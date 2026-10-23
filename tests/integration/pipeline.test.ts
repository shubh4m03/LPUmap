// @vitest-environment node
/**
 * Runs the real CLI (node scripts/build-data.ts, native type stripping) on the
 * synthetic fixture twice and checks byte-identical, schema-valid output.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  basemapFileSchema,
  boundaryFileSchema,
  buildingsFileSchema,
  DATA_FILES,
  graphFileSchema,
  manifestSchema,
  placesFileSchema,
  relationsFileSchema,
} from '../../src/data/schema.ts';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const input = join(repo, 'tests/fixtures/osm/synthetic-campus');
const curated = join(repo, 'tests/fixtures/osm/synthetic-curated');
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
});
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
      buildings: 5,
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
    expect(md).toMatch(/Drinking water\s*\|\s*1\s*\|\s*1\s*\|\s*sparse/);
    expect(md).toContain('`osm:way/202` Unnamed building (on-campus)');
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
