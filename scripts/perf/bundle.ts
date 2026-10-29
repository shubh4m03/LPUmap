/**
 * Bundle sizes of a production build against the enforced budgets
 * (docs/PERFORMANCE.md §Bundle budgets).
 *
 *   npx vite build && node scripts/perf/bundle.ts [--dist dist] [--json <file>] [--list]
 *
 * Prints the measured values against each budget (gzip is level 9 from Node
 * zlib) and exits 1 on any budget or isolation rule the build breaks: chunk
 * size, public entry, start-up JS and CSS, the isometric overview chunk, the
 * precache total, MapLibre and admin code kept out of the entry and the
 * overview. --list also prints every chunk with its size.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from '../lib/args.ts';
import { parsePrecacheUrls } from '../lib/smoke-web.ts';
import { analyzeBundle, BUNDLE_BUDGETS, checkBundle, formatBundleReport } from './bundle-budget.ts';
import { REPO_ROOT } from './lib.ts';

function main(): number {
  const { values, flags } = parseArgs(process.argv.slice(2), ['dist', 'json'], ['list']);
  const dist = resolve(values.dist ?? join(REPO_ROOT, 'dist'));
  if (!existsSync(join(dist, 'index.html'))) {
    console.error(`perf:bundle: ${dist}/index.html not found. Run "npx vite build" first.`);
    return 1;
  }
  const read = (file: string): Uint8Array | null => {
    const p = join(dist, file);
    return existsSync(p) && statSync(p).isFile() ? new Uint8Array(readFileSync(p)) : null;
  };
  const sw = read('sw.js');
  const report = analyzeBundle({
    indexHtml: readFileSync(join(dist, 'index.html'), 'utf8'),
    assetFiles: readdirSync(join(dist, 'assets')).map((n) => `assets/${n}`),
    read,
    precacheUrls: sw ? parsePrecacheUrls(new TextDecoder().decode(sw)) : null,
    size: (file) => {
      const p = join(dist, file);
      return existsSync(p) ? statSync(p).size : null;
    },
  });
  console.log(`Bundle budgets — ${dist}`);
  for (const line of formatBundleReport(report)) console.log(line);
  if (flags.has('list')) {
    console.log('\n| Chunk | Raw | gzip |\n| --- | --- | --- |');
    for (const c of [...report.chunks].sort((a, b) => b.rawBytes - a.rawBytes))
      console.log(`| ${c.file} | ${c.rawBytes} B | ${c.gzipBytes} B |`);
  }
  if (values.json)
    writeFileSync(values.json, `${JSON.stringify({ budgets: BUNDLE_BUDGETS, report }, null, 2)}\n`);
  const problems = checkBundle(report, read);
  if (problems.length > 0) {
    console.error(`\nperf:bundle FAILED (${problems.length}):`);
    for (const p of problems) console.error(`  - ${p}`);
    return 1;
  }
  console.log('\nperf:bundle OK: every budget and isolation rule holds.');
  return 0;
}

process.exitCode = main();
