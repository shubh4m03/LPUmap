/**
 * Page-load timings of a production build (docs/PERFORMANCE.md §Page load).
 * No budget is defined for page load, so this prints numbers and never fails
 * on them; it exits 1 only when the page cannot be measured.
 *
 *   npx vite build --outDir <dir> --emptyOutDir
 *   npx vite preview --outDir <dir> --port <port> --strictPort     (another terminal)
 *   node scripts/perf/load.ts --url http://localhost:<port> [--runs 5] [--view 2d] [--json <file>]
 *
 * Headless Chromium (Playwright), service workers BLOCKED so every run is a
 * cold network load, one fresh context per run, two viewports (1440×900 and a
 * 390×844 phone at DPR 2). Reported per viewport as the median of the runs:
 * first contentful paint, DOMContentLoaded, and "map style loaded" (the time
 * from navigation start until window.__ATLAS_MAP__.isStyleLoaded() is true on
 * `/?e2e=1`, which includes downloading and validating the data, building the
 * services and MapLibre starting its worker and style). Headless Chromium may
 * draw WebGL in software. Localhost has no network latency, so these are
 * CPU-side costs, not real-world load times. Use any port except the owner's.
 */
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { parseArgs } from '../lib/args.ts';
import { environmentLine, percentile } from './lib.ts';

interface Sample {
  fcp: number | null;
  dcl: number;
  mapStyleLoaded: number;
}

const VIEWPORTS = [
  { name: '1440 × 900', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false },
  { name: '390 × 844 (DPR 2)', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true },
] as const;

const median = (v: number[]): number => percentile(v, 0.5);

async function main(): Promise<number> {
  const { values } = parseArgs(process.argv.slice(2), ['url', 'runs', 'view', 'json'], []);
  if (!values.url) {
    console.error(
      'perf:load: --url http://localhost:<port> (a running `vite preview` of a production build) is required.',
    );
    return 1;
  }
  const runs = Number(values.runs ?? 5);
  const view = values.view ? `&view=${encodeURIComponent(values.view)}` : '';
  const target = `${values.url.replace(/\/$/, '')}/?e2e=1${view}`;
  const browser = await chromium.launch();
  const results: Array<{ viewport: string; samples: Sample[] }> = [];
  try {
    for (const vp of VIEWPORTS) {
      const samples: Sample[] = [];
      for (let i = 0; i < runs; i++) {
        const context = await browser.newContext({
          viewport: vp.viewport,
          deviceScaleFactor: vp.deviceScaleFactor,
          isMobile: vp.isMobile,
          hasTouch: vp.isMobile,
          serviceWorkers: 'block',
        });
        const page = await context.newPage();
        await page.goto(target, { waitUntil: 'commit' });
        const styleHandle = await page.waitForFunction(
          () => {
            const hook = (window as unknown as { __ATLAS_MAP__?: { isStyleLoaded(): boolean } })
              .__ATLAS_MAP__;
            return hook?.isStyleLoaded() ? performance.now() : false;
          },
          undefined,
          { polling: 'raf', timeout: 60_000 },
        );
        const mapStyleLoaded = (await styleHandle.jsonValue()) as number;
        const timing = await page.evaluate(() => {
          const nav = performance.getEntriesByType('navigation')[0] as
            PerformanceNavigationTiming | undefined;
          const fcp = performance.getEntriesByName('first-contentful-paint')[0];
          return { dcl: nav?.domContentLoadedEventEnd ?? Number.NaN, fcp: fcp ? fcp.startTime : null };
        });
        samples.push({ fcp: timing.fcp, dcl: timing.dcl, mapStyleLoaded });
        await context.close();
      }
      results.push({ viewport: vp.name, samples });
    }
  } finally {
    await browser.close();
  }
  console.log(`Page load — ${target}; ${runs} cold runs per viewport (median); ${await environmentLine()}`);
  console.log('| Viewport | FCP | DOMContentLoaded | Map style loaded |');
  console.log('| --- | --- | --- | --- |');
  for (const r of results) {
    const fcps = r.samples.map((s) => s.fcp).filter((v): v is number => v !== null);
    const fmt = (v: number) => (Number.isFinite(v) ? `${Math.round(v)} ms` : 'n/a');
    console.log(
      `| ${r.viewport} | ${fmt(median(fcps))} | ${fmt(median(r.samples.map((s) => s.dcl)))} | ${fmt(median(r.samples.map((s) => s.mapStyleLoaded)))} |`,
    );
  }
  if (values.json) writeFileSync(values.json, `${JSON.stringify({ target, runs, results }, null, 2)}\n`);
  return 0;
}

try {
  process.exitCode = await main();
} catch (e) {
  console.error(`perf:load failed: ${(e as Error).message}`);
  process.exitCode = 1;
}
