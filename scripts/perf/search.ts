/**
 * Search latency on the REAL index (docs/PERFORMANCE.md §Search latency).
 *
 *   node scripts/perf/search.ts [--runs 3] [--queries 200] [--seed 20261023] [--check] [--json <file>]
 *
 * Builds the app's own services from public/data and the artwork manifest
 * (buildServices: places, categories, artwork items, layers and commands —
 * exactly the index the search palette uses), runs one warm-up pass, then
 * times index.search(q) for a fixed, seeded mix of queries: fixed realistic
 * queries, typing prefixes of 1–6 characters, full titles, one-character typos
 * and single words from titles. Prints p50/p95/max/mean per run. With --check,
 * exits 1 if any run's p95 is at or over APP_CONFIG.performance.searchBudgetMs.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildServices } from '../../src/app/data/services.ts';
import { APP_CONFIG } from '../../src/config/index.ts';
import { parseArgs } from '../lib/args.ts';
import {
  environmentLine,
  loadArtworkManifestFromDisk,
  loadCampusDataFromDisk,
  ms,
  seededRandom,
  summarize,
  type TimingSummary,
} from './lib.ts';

/** Realistic queries (names, codes, abbreviations, a miss), kept from the 2026-10-23 method. */
export const FIXED_QUERIES = [
  'library',
  'atm',
  'school of',
  'block 34',
  'xyz',
  'hostel',
  'food',
  'parking',
  'sports',
  'health',
  'gate',
  'cricket',
  'mall',
  'design',
  'engineering',
  'block-25',
  '25',
  'girls hostal',
  'unnamed building',
  'park',
] as const;

/** A deterministic query mix of `count` queries drawn from the index's own titles. */
export function buildQueries(titles: readonly string[], count: number, seed: number): string[] {
  const rnd = seededRandom(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;
  const out: string[] = [...FIXED_QUERIES];
  const usable = titles.filter((t) => t.trim().length >= 3);
  if (usable.length === 0) return out.slice(0, count);
  while (out.length < count) {
    const title = pick(usable);
    const kind = out.length % 4;
    if (kind === 0) out.push(title.slice(0, 1 + Math.floor(rnd() * 6)));
    else if (kind === 1) out.push(title);
    else if (kind === 2) {
      const i = Math.floor(rnd() * title.length);
      const ch = String.fromCharCode(97 + Math.floor(rnd() * 26));
      out.push(title.slice(0, i) + ch + title.slice(i + 1));
    } else {
      const words = title.split(/\s+/).filter((w) => w.length >= 3);
      out.push(words.length > 0 ? pick(words) : title);
    }
  }
  return out.slice(0, count);
}

export interface SearchMeasurement {
  datasetVersion: string;
  /** Illustration subjects joined into the index (0 when the artwork manifest did not load). */
  artworkItems: number;
  docs: number;
  queries: number;
  withHits: number;
  buildServicesMs: number;
  runs: TimingSummary[];
  budgetMs: number;
}

export function measureSearch(opts: { runs: number; queries: number; seed: number }): SearchMeasurement {
  const data = loadCampusDataFromDisk();
  const manifest = loadArtworkManifestFromDisk();
  const t0 = performance.now();
  const services = buildServices(data, {
    artwork: manifest
      ? { manifest, unavailableReason: null }
      : { manifest: null, unavailableReason: 'artwork manifest missing' },
  });
  const buildServicesMs = performance.now() - t0;
  const index = services.searchIndex;
  const titles = [
    ...services.directory.all.map((p) => p.displayName),
    ...services.buildingDirectory.entries.map((e) => e.title),
  ].filter((t) => t.length > 0);
  const queries = buildQueries(titles, opts.queries, opts.seed);
  let withHits = 0;
  for (const q of queries) if (index.search(q).length > 0) withHits++; // warm-up pass (also counts hits)
  const runs: TimingSummary[] = [];
  for (let r = 0; r < opts.runs; r++) {
    const times: number[] = [];
    for (const q of queries) {
      const s = performance.now();
      index.search(q);
      times.push(performance.now() - s);
    }
    runs.push(summarize(times));
  }
  return {
    datasetVersion: data.manifest.datasetVersion,
    artworkItems: services.buildingDirectory.artwork?.subjects.size ?? 0,
    docs: index.size,
    queries: queries.length,
    withHits,
    buildServicesMs,
    runs,
    budgetMs: APP_CONFIG.performance.searchBudgetMs,
  };
}

async function main(): Promise<number> {
  const { values, flags } = parseArgs(process.argv.slice(2), ['runs', 'queries', 'seed', 'json'], ['check']);
  const m = measureSearch({
    runs: Number(values.runs ?? 3),
    queries: Number(values.queries ?? 200),
    seed: Number(values.seed ?? 20261023),
  });
  console.log(`Search latency — dataset ${m.datasetVersion}; ${await environmentLine()}`);
  console.log(
    `Index: ${m.docs} docs; artwork manifest ${m.artworkItems > 0 ? `loaded (${m.artworkItems} illustration subjects)` : 'NOT loaded'} (buildServices ${ms(m.buildServicesMs)}, cold). Queries: ${m.queries}, ${m.withHits} with at least one hit.`,
  );
  console.log('| Run | p50 | p95 | max | mean |');
  console.log('| --- | --- | --- | --- | --- |');
  m.runs.forEach((r, i) =>
    console.log(`| ${i + 1} | ${ms(r.p50)} | ${ms(r.p95)} | ${ms(r.max)} | ${ms(r.mean)} |`),
  );
  if (values.json) writeFileSync(values.json, `${JSON.stringify(m, null, 2)}\n`);
  const worst = Math.max(...m.runs.map((r) => r.p95));
  const verdict = worst < m.budgetMs ? 'met' : 'NOT met';
  console.log(`Budget p95 < ${m.budgetMs} ms: ${verdict} (worst p95 ${ms(worst)}).`);
  return flags.has('check') && worst >= m.budgetMs ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
