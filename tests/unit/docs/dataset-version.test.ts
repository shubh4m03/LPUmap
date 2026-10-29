// @vitest-environment node
/**
 * Documentation states the CURRENT dataset (audit item G-10): the docs that
 * describe the shipped data cite the datasetVersion and counts of
 * public/data/manifest.json, and no current-state doc presents the retired v1
 * dataset `b628c5855b1d` as current. A data rebuild that changes the version
 * or a count fails here until the docs are updated in the same change.
 *
 * Historical records (audits, the rollback runbook, generated reports, dated
 * measurements) may cite old versions; they are not in CURRENT_STATE_DOCS.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const manifest = JSON.parse(read('public/data/manifest.json')) as {
  datasetVersion: string;
  schemaVersion: number;
  counts: Record<string, number>;
};
const c = manifest.counts;

/** Docs that carry the "Current dataset:" facts paragraph. */
const FACT_DOCS = ['README.md', 'docs/DATA_SOURCES.md', 'docs/modules/data.md'];

/** Docs that describe the system as it is now (a retired dataset version may appear only as history). */
const CURRENT_STATE_DOCS = [
  ...FACT_DOCS,
  'CONTRIBUTING.md',
  'data/README.md',
  'docs/ARCHITECTURE.md',
  'docs/MODULE_CONTRACTS.md',
  'docs/QA_STRATEGY.md',
  'docs/SECURITY_AND_PRIVACY.md',
  'docs/DEPLOYMENT.md',
  'docs/PERFORMANCE.md',
  'docs/modules/map-buildings3d.md',
];
const RETIRED = ['b628c5855b1d'];
/** A line may name a retired version only when it says it is history. */
const HISTORY = /\b(v1|historical|history|rollback|baseline)\b/i;

const num = (s: string) => Number(s.replace(/,/g, ''));

function facts(doc: string) {
  const text = read(doc).replace(/\s+/g, ' ');
  const at = text.indexOf('Current dataset:');
  expect(at, `${doc} has a "Current dataset:" paragraph`).toBeGreaterThanOrEqual(0);
  const para = text.slice(at, at + 700);
  const grab = (re: RegExp, what: string) => {
    const m = re.exec(para);
    expect(m, `${doc}: ${what}`).not.toBeNull();
    return m!;
  };
  return {
    version: grab(/dataset `([0-9a-f]{12})`/, 'dataset version')[1],
    schema: num(grab(/\(schema (\d+)/, 'schema version')[1]!),
    buildings: grab(/\*\*([\d,]+)\*\* campus buildings \(([\d,]+) unnamed\)/, 'buildings'),
    places: grab(/\*\*([\d,]+)\*\* campus places \(([\d,]+) without a map position\)/, 'places'),
    context: num(grab(/\*\*([\d,]+)\*\* places just outside campus/, 'context places')[1]!),
    detections: num(grab(/\*\*([\d,]+)\*\* unverified detected footprints/, 'detections')[1]!),
    graph: grab(/\*\*([\d,]+)\*\* nodes and \*\*([\d,]+)\*\* edges in \*\*([\d,]+)\*\* components/, 'graph'),
  };
}

describe('docs cite the current dataset', () => {
  it.each(FACT_DOCS)('%s states the shipped datasetVersion and counts', (doc) => {
    const f = facts(doc);
    expect(f.version).toBe(manifest.datasetVersion);
    expect(f.schema).toBe(manifest.schemaVersion);
    expect([num(f.buildings[1]!), num(f.buildings[2]!)]).toEqual([c.buildings, c['buildings:unnamed']]);
    expect([num(f.places[1]!), num(f.places[2]!)]).toEqual([c.places, c['places:withoutLocation']]);
    expect(f.context).toBe(c.contextPlaces);
    expect(f.detections).toBe(c.detections);
    expect([num(f.graph[1]!), num(f.graph[2]!), num(f.graph[3]!)]).toEqual([
      c['graph:nodes'],
      c['graph:edges'],
      c['graph:components'],
    ]);
  });

  it('every doc that names "the current dataset" names the shipped one', () => {
    const docs = [
      'README.md',
      'CONTRIBUTING.md',
      'data/README.md',
      ...readdirSync(join(root, 'docs'), { recursive: true, encoding: 'utf8' })
        .filter((p) => p.endsWith('.md'))
        .map((p) => `docs/${p.split('\\').join('/')}`),
    ];
    const wrong: string[] = [];
    for (const doc of docs) {
      const text = read(doc).replace(/\s+/g, ' ');
      for (const m of text.matchAll(/current dataset(?: is|:)?[ *(]*(?:dataset )?`([0-9a-f]{12})`/gi)) {
        if (m[1] !== manifest.datasetVersion) wrong.push(`${doc}: ${m[0]}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it.each(CURRENT_STATE_DOCS)('%s never presents a retired dataset as current', (doc) => {
    const offending = read(doc)
      .split('\n')
      .filter((line) => RETIRED.some((v) => line.includes(v)) && !HISTORY.test(line));
    expect(offending).toEqual([]);
  });
});
