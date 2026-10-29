/**
 * Route latency on the REAL graph (docs/PERFORMANCE.md §Route latency).
 *
 *   node scripts/perf/route.ts [--pairs 500] [--alt-pairs 100] [--seed 20261023] [--check] [--json <file>]
 *
 * createRouter(public/data/graph.json), then `--pairs` seeded random pairs per
 * profile drawn from the ROUTABLE campus places (isRoutablePlace: on campus,
 * with a location and a graph node; off-campus places are never routable),
 * timed as place-to-place router.route() calls, plus `--alt-pairs` pairs
 * through router.alternatives() (what the directions panel calls). Failures
 * are counted by reason; the router never bridges graph components, so
 * `no-path` results are real. With --check, exits 1 if any p95 is at or over
 * APP_CONFIG.performance.routeBudgetMs.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { APP_CONFIG } from '../../src/config/index.ts';
import type { Place } from '../../src/data/schema.ts';
import { isRoutablePlace } from '../../src/facilities/directory.ts';
import { createRouter, ROUTE_PROFILES } from '../../src/routing/index.ts';
import type { RouteEndpoint, RouteProfileId, RouteRequest, RouteResult } from '../../src/routing/index.ts';
import { parseArgs } from '../lib/args.ts';
import {
  environmentLine,
  loadCampusDataFromDisk,
  ms,
  seededRandom,
  summarize,
  type TimingSummary,
} from './lib.ts';

export interface RouteRow {
  label: string;
  timing: TimingSummary;
  succeeded: number;
  failures: Record<string, number>;
}

export interface RouteMeasurement {
  datasetVersion: string;
  nodes: number;
  edges: number;
  createRouterMs: number;
  routablePlaces: number;
  rows: RouteRow[];
  budgetMs: number;
}

const endpoint = (p: Place): RouteEndpoint => ({
  kind: 'place',
  placeId: p.id,
  label: p.displayName,
  location: p.location!,
  nodeId: p.graphNodeId!,
});

/** `n` seeded pairs of distinct places. */
export function randomPairs<T>(items: readonly T[], n: number, seed: number): Array<[T, T]> {
  const rnd = seededRandom(seed);
  const out: Array<[T, T]> = [];
  if (items.length < 2) return out;
  while (out.length < n) {
    const a = items[Math.floor(rnd() * items.length)]!;
    const b = items[Math.floor(rnd() * items.length)]!;
    if (a !== b) out.push([a, b]);
  }
  return out;
}

function timeRequests(label: string, reqs: RouteRequest[], call: (r: RouteRequest) => RouteResult): RouteRow {
  const times: number[] = [];
  const failures: Record<string, number> = {};
  let succeeded = 0;
  for (const req of reqs) {
    const t0 = performance.now();
    const res = call(req);
    times.push(performance.now() - t0);
    if (res.ok) succeeded++;
    else failures[res.reason] = (failures[res.reason] ?? 0) + 1;
  }
  return { label, timing: summarize(times), succeeded, failures };
}

export function measureRoutes(opts: { pairs: number; altPairs: number; seed: number }): RouteMeasurement {
  const data = loadCampusDataFromDisk();
  const t0 = performance.now();
  const router = createRouter(data.graph);
  const createRouterMs = performance.now() - t0;
  const routable = data.places.filter(isRoutablePlace);
  const rows: RouteRow[] = [];
  const profiles = Object.keys(ROUTE_PROFILES) as RouteProfileId[];
  for (const profile of profiles) {
    const reqs = randomPairs(routable, opts.pairs, opts.seed).map(([a, b]): RouteRequest => ({
      from: endpoint(a),
      to: endpoint(b),
      profile,
    }));
    // The first call includes the router's lazy set-up (cold); it is part of the row, as in the 2026-10-23 method.
    rows.push(timeRequests(`${profile} (${opts.pairs} pairs)`, reqs, (r) => router.route(r)));
  }
  const altReqs = randomPairs(routable, opts.altPairs, opts.seed + 1).map(([a, b]): RouteRequest => ({
    from: endpoint(a),
    to: endpoint(b),
    profile: 'walk',
  }));
  rows.push(
    timeRequests(
      `alternatives (walk, ${opts.altPairs} pairs)`,
      altReqs,
      (r) =>
        router.alternatives(r)[0] ?? { ok: false, reason: 'no-path', message: 'no alternatives returned' },
    ),
  );
  return {
    datasetVersion: data.manifest.datasetVersion,
    nodes: router.nodeCount,
    edges: router.edgeCount,
    createRouterMs,
    routablePlaces: routable.length,
    rows,
    budgetMs: APP_CONFIG.performance.routeBudgetMs,
  };
}

async function main(): Promise<number> {
  const { values, flags } = parseArgs(
    process.argv.slice(2),
    ['pairs', 'alt-pairs', 'seed', 'json'],
    ['check'],
  );
  const m = measureRoutes({
    pairs: Number(values.pairs ?? 500),
    altPairs: Number(values['alt-pairs'] ?? 100),
    seed: Number(values.seed ?? 20261023),
  });
  console.log(`Route latency — dataset ${m.datasetVersion}; ${await environmentLine()}`);
  console.log(
    `Graph: ${m.nodes} nodes / ${m.edges} edges (createRouter ${ms(m.createRouterMs)}). Routable campus places: ${m.routablePlaces}.`,
  );
  console.log('| Request | p50 | p95 | max (incl. first call) | Succeeded | Failure reasons |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const r of m.rows) {
    const total = r.timing.n;
    const reasons = Object.entries(r.failures)
      .map(([k, v]) => `${v} × \`${k}\``)
      .join(', ');
    console.log(
      `| ${r.label} | ${ms(r.timing.p50)} | ${ms(r.timing.p95)} | ${ms(r.timing.max)} | ${r.succeeded} / ${total} | ${reasons || '—'} |`,
    );
  }
  if (values.json) writeFileSync(values.json, `${JSON.stringify(m, null, 2)}\n`);
  const worst = Math.max(...m.rows.map((r) => r.timing.p95));
  console.log(
    `Budget < ${m.budgetMs} ms (p95): ${worst < m.budgetMs ? 'met' : 'NOT met'} (worst p95 ${ms(worst)}).`,
  );
  return flags.has('check') && worst >= m.budgetMs ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
