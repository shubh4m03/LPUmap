// @vitest-environment node
/**
 * Builds the committed real OSM snapshot into a temp dir and checks the
 * truthfulness rules that matter most for LPU (no network involved).
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Place } from '../../src/data/schema.ts';
import { runBuild } from '../../scripts/lib/pipeline.ts';
import type { BuildResult } from '../../scripts/lib/pipeline.ts';
import { validateDataset } from '../../scripts/lib/validate.ts';

const repo = fileURLToPath(new URL('../..', import.meta.url));
let tmp: string;
let result: BuildResult;
let places: Map<string, Place>;
/** v2: off-campus POIs live in context-places.json (opt-in layer), never in places.json. */
let context: Map<string, Place>;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pipeline-real-'));
  // Empty curated dir: OSM-only truths must hold regardless of curated records.
  result = runBuild({
    inputDir: join(repo, 'data/raw/osm'),
    curatedDir: join(tmp, 'no-curated'),
    outDir: join(tmp, 'out'),
  });
  const list = (JSON.parse(readFileSync(join(tmp, 'out', 'places.json'), 'utf8')) as { places: Place[] })
    .places;
  places = new Map(list.map((p) => [p.id, p]));
  const ctx = (
    JSON.parse(readFileSync(join(tmp, 'out', 'context-places.json'), 'utf8')) as { places: Place[] }
  ).places;
  context = new Map(ctx.map((p) => [p.id, p]));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('real LPU snapshot', () => {
  it('validates with zero errors', async () => {
    const r = await validateDataset({ dir: join(tmp, 'out') });
    expect(r.errors).toEqual([]);
  });

  it('uses the campus relation as boundary and campus place', () => {
    expect(result.manifest.bbox).toEqual([75.6973474, 31.2457534, 75.7091258, 31.2607949]);
    expect(places.get('osm:relation/21599790')).toMatchObject({
      name: 'Lovely Professional University',
      kind: 'area',
      categoryId: 'university',
    });
  });

  it('does not present the "Law gate" neighbourhood as a gate or campus entrance', () => {
    // v2: it lies outside the boundary, so it is a context place only (v1 listed it among campus places).
    expect(places.has('osm:way/752027029')).toBe(false);
    const law = context.get('osm:way/752027029')!;
    expect(law.kind).not.toBe('gate');
    expect(law.categoryId).not.toBe('gate');
    expect(law.description).toMatch(/not a campus entrance/);
  });

  it('labels the ceremonial "Green valley main gate" without claiming it is open', () => {
    expect(places.has('osm:node/12031088561')).toBe(false);
    const g = context.get('osm:node/12031088561')!;
    expect(g).toMatchObject({ kind: 'gate', campusZone: 'off-campus-nearby' });
    expect(g.description).toMatch(/ceremonial gate.*not recorded/);
  });

  it('keeps unnamed buildings unnamed and heights honest', () => {
    const unnamed = [...places.values()].filter((p) => p.kind === 'building' && p.name === null);
    expect(unnamed.length).toBe(result.manifest.counts['buildings:unnamed']);
    expect(unnamed.every((p) => /^Unnamed building( · \d+ floors?)?$/.test(p.displayName))).toBe(true);
    expect(places.get('osm:relation/7099162')).toMatchObject({
      kind: 'building',
      levels: 10,
      heightSource: 'osm-levels-estimate',
    });
    expect(result.manifest.counts['heightSource:osm-height']).toBe(0);
  });

  it('marks every OSM record imported, never verified', () => {
    for (const p of [...places.values(), ...context.values()])
      expect(p.provenance.verificationStatus).toBe('imported');
  });

  it('ships campus places only in places.json and no building in the context layer', () => {
    for (const p of places.values()) expect(p.campusZone).toBe('on-campus');
    for (const p of context.values()) {
      expect(p.campusZone).toBe('off-campus-nearby');
      expect(p.kind).not.toBe('building');
      expect(p.buildingId).toBeUndefined();
    }
    expect(result.manifest.counts.buildings).toBe(result.quality.membership.inventory.total);
    expect(
      result.quality.membership.outside.length + result.quality.membership.uncertain.length,
    ).toBeGreaterThan(0);
  });

  it('reports the graph structure without synthetic links', () => {
    expect(result.quality.graph.components).toBe(result.manifest.counts['graph:components']);
    expect(result.quality.graph.componentSizes.reduce((a, b) => a + b, 0)).toBe(result.quality.graph.nodes);
  });
});
