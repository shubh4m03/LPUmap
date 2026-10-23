/**
 * Builds public/data/* from the committed raw OSM snapshot and curated records.
 * Never touches the network.
 *
 *   node scripts/build-data.ts [--input data/raw/osm] [--curated data/curated] [--out public/data]
 *                              [--cache data/.cache] [--report docs/DATA_QUALITY_REPORT.md]
 *                              [--schemas data/schemas] [--relation 21599790]
 *
 * Passing --out without --report/--cache/--schemas skips those side outputs,
 * so tests can build fixtures into a temp directory without touching the repo.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/args.ts';
import { formatGeneratedFiles } from './lib/format-generated.ts';
import { runBuild } from './lib/pipeline.ts';

const root = resolve(fileURLToPath(import.meta.url), '../..');

async function main(): Promise<void> {
  const { values } = parseArgs(
    process.argv.slice(2),
    ['input', 'curated', 'out', 'cache', 'report', 'schemas', 'relation'],
    [],
  );
  const defaultOut = values.out === undefined;
  const opt = (key: string, fallback: string) =>
    values[key] !== undefined ? resolve(values[key]) : defaultOut ? resolve(root, fallback) : null;
  const relation = values.relation !== undefined ? Number(values.relation) : undefined;
  if (relation !== undefined && !Number.isSafeInteger(relation))
    throw new Error('--relation must be an OSM relation id');

  const result = runBuild({
    inputDir: resolve(values.input ?? resolve(root, 'data/raw/osm')),
    curatedDir: resolve(values.curated ?? resolve(root, 'data/curated')),
    outDir: resolve(values.out ?? resolve(root, 'public/data')),
    cacheDir: opt('cache', 'data/.cache'),
    reportPath: opt('report', 'docs/DATA_QUALITY_REPORT.md'),
    schemasDir: opt('schemas', 'data/schemas'),
    ...(relation !== undefined ? { relationId: relation } : {}),
  });
  const formatNote = await formatGeneratedFiles(result.generatedFiles);
  if (formatNote) console.warn(`warning: ${formatNote}`);
  const c = result.manifest.counts;
  console.log(
    `Built dataset ${result.manifest.datasetVersion} → ${result.outDir}\n` +
      `  places ${c.places}, buildings ${c.buildings} (${c['buildings:unnamed']} unnamed), relations ${c.relations}\n` +
      `  graph ${c['graph:nodes']} nodes / ${c['graph:edges']} edges / ${c['graph:components']} components\n` +
      `  places not connected to the graph: ${c['places:notConnected']}`,
  );
}

main().catch((e: unknown) => {
  console.error(`build-data failed: ${(e as Error).message}`);
  process.exit(1);
});
