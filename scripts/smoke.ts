/**
 * Post-build smoke test of the production bundle in dist/ (no network).
 *
 *   npx vite build && node scripts/smoke.ts [--dist dist] [--data public/data]
 *
 * Verifies the HTML shell, PWA manifest and service worker, the shipped
 * dataset against public/data/manifest.json, dataset invariants, a real
 * search and a real walking route, and scans dist/ for secret patterns.
 * Exits 1 with one readable line per problem.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { graphFileSchema, manifestSchema, placesFileSchema } from '../src/data/schema.ts';
import type { GraphFile, Manifest, Place } from '../src/data/schema.ts';
import { parseArgs } from './lib/args.ts';
import {
  checkDataFiles,
  checkGraphInvariants,
  checkPlaceInvariants,
  checkSchemaVersion,
  runRouteProbe,
  runSearchProbe,
} from './lib/smoke-data.ts';
import {
  checkIndexHtml,
  checkWebManifest,
  findSecrets,
  findSourceMapReferences,
  formatBytes,
  isTextFile,
  parsePrecacheUrls,
} from './lib/smoke-web.ts';

const root = resolve(fileURLToPath(import.meta.url), '../..');

interface Outcome {
  name: string;
  problems: string[];
  note?: string;
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function main(): number {
  const { values } = parseArgs(process.argv.slice(2), ['dist', 'data'], []);
  const dist = resolve(values.dist ?? join(root, 'dist'));
  const dataSrc = resolve(values.data ?? join(root, 'public/data'));
  if (!existsSync(join(dist, 'index.html'))) {
    console.error(`smoke: ${dist}/index.html not found. Run "npx vite build" (or "npm run build") first.`);
    return 1;
  }

  const inDist = (p: string) => join(dist, p);
  const exists = (p: string) => existsSync(inDist(p)) && statSync(inDist(p)).isFile();
  const readText = (p: string) => readFileSync(inDist(p), 'utf8');
  const outcomes: Outcome[] = [];
  const run = (name: string, fn: () => Omit<Outcome, 'name'>) => {
    try {
      outcomes.push({ name, ...fn() });
    } catch (e) {
      outcomes.push({ name, problems: [`check crashed: ${(e as Error).message}`] });
    }
  };

  const html = readText('index.html');
  run('index.html assets', () => ({ problems: checkIndexHtml(html, exists) }));
  run('no source maps referenced from HTML', () => ({
    problems: findSourceMapReferences(html).map((r) => `index.html references a source map: ${r}`),
  }));
  run('web app manifest', () => {
    if (!exists('manifest.webmanifest')) return { problems: ['dist/manifest.webmanifest is missing.'] };
    return { problems: checkWebManifest(JSON.parse(readText('manifest.webmanifest')), exists) };
  });

  let precacheNote = '';
  run('service worker precache', () => {
    if (!exists('sw.js')) return { problems: ['dist/sw.js is missing.'] };
    const urls = parsePrecacheUrls(readText('sw.js'));
    const problems: string[] = [];
    if (urls.length === 0) problems.push('sw.js has no precache manifest.');
    let total = 0;
    for (const url of new Set(urls)) {
      const path = decodeURIComponent(url);
      if (!exists(path)) problems.push(`precached ${url} does not exist in dist/.`);
      else total += statSync(inDist(path)).size;
    }
    for (const required of ['index.html', 'manifest.webmanifest', 'data/manifest.json']) {
      if (!urls.includes(required))
        problems.push(`${required} is not precached; the app would not work offline.`);
    }
    const unique = new Set(urls).size;
    const dupes = urls.length - unique;
    precacheNote = `${unique} files, ${formatBytes(total)}${dupes > 0 ? ` (${dupes} duplicate entries in sw.js)` : ''}`;
    return { problems, note: precacheNote };
  });

  let manifest: Manifest | null = null;
  run('data manifest', () => {
    const srcPath = join(dataSrc, 'manifest.json');
    if (!existsSync(srcPath)) return { problems: [`${srcPath} is missing; run npm run data:check.`] };
    const raw = JSON.parse(readFileSync(srcPath, 'utf8')) as { schemaVersion?: unknown };
    const problems = checkSchemaVersion(raw.schemaVersion);
    const parsed = manifestSchema.safeParse(raw);
    if (!parsed.success)
      problems.push(`public/data/manifest.json is invalid: ${parsed.error.issues[0]?.message}`);
    else manifest = parsed.data;
    if (!exists('data/manifest.json')) problems.push('dist/data/manifest.json is missing.');
    else if (readText('data/manifest.json') !== readFileSync(srcPath, 'utf8')) {
      problems.push('dist/data/manifest.json differs from public/data/manifest.json; rebuild dist.');
    }
    return { problems, note: parsed.success ? `dataset ${parsed.data.datasetVersion}` : '' };
  });
  run('data files match manifest sha256', () => {
    if (!manifest) return { problems: ['skipped: data manifest did not parse.'] };
    return {
      problems: checkDataFiles(manifest, (p) =>
        exists(`data/${p}`) ? readFileSync(inDist(`data/${p}`)) : null,
      ),
    };
  });

  let places: Place[] = [];
  let graph: GraphFile | null = null;
  run('dataset invariants', () => {
    const p = placesFileSchema.safeParse(JSON.parse(readText('data/places.json')));
    const g = graphFileSchema.safeParse(JSON.parse(readText('data/graph.json')));
    const problems: string[] = [];
    if (!p.success) problems.push(`places.json fails schema: ${p.error.issues[0]?.message}`);
    if (!g.success) problems.push(`graph.json fails schema: ${g.error.issues[0]?.message}`);
    if (!p.success || !g.success) return { problems };
    places = p.data.places;
    graph = g.data;
    problems.push(...checkPlaceInvariants(places), ...checkGraphInvariants(graph, places));
    return {
      problems,
      note: `${places.length} places, ${graph.nodes.length} nodes, ${graph.edges.length} edges`,
    };
  });
  run('search finds a real place by name', () =>
    places.length > 0 ? runSearchProbe(places) : { problems: ['skipped: places did not load.'] },
  );
  run('walking route between real places', () =>
    graph ? runRouteProbe(graph, places) : { problems: ['skipped: graph did not load.'] },
  );

  run('no secrets in dist', () => {
    const problems: string[] = [];
    const files = listFiles(dist).filter(isTextFile);
    for (const file of files)
      problems.push(...findSecrets(relative(dist, file).replaceAll('\\', '/'), readFileSync(file, 'utf8')));
    return { problems, note: `${files.length} text files scanned` };
  });

  let failed = 0;
  for (const o of outcomes) {
    const ok = o.problems.length === 0;
    if (!ok) failed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${o.name}${o.note ? ` — ${o.note}` : ''}`);
    for (const p of o.problems) console.log(`      - ${p}`);
  }
  console.log(
    failed === 0
      ? `\nSmoke OK: ${outcomes.length} checks passed. Precache: ${precacheNote || 'n/a'}.`
      : `\nSmoke FAILED: ${failed} of ${outcomes.length} checks failed.`,
  );
  return failed === 0 ? 0 : 1;
}

try {
  process.exit(main());
} catch (e) {
  console.error(`smoke failed: ${(e as Error).message}`);
  process.exit(1);
}
