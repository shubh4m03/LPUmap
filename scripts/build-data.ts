/**
 * Builds public/data/* from the committed raw OSM snapshot, the committed
 * detection snapshots and curated records. Never touches the network.
 *
 *   node scripts/build-data.ts [--input data/raw/osm] [--curated data/curated] [--out public/data]
 *                              [--detections data/raw/detections] [--cache data/.cache]
 *                              [--report docs/DATA_QUALITY_REPORT.md] [--coverage docs/CAMPUS_BUILDING_COVERAGE.md]
 *                              [--schemas data/schemas] [--relation 21599790]
 *                              [--accept-count-changes "<why this large change is intended>"]
 *
 * The dataset is written to a staging directory and validated first; only a
 * dataset with zero validation errors replaces the output directory, so a
 * failed refresh never updates the deployed map (scripts/lib/publish.ts).
 *
 * Count-change guard: counts are compared with the dataset committed at git
 * HEAD (scripts/lib/baseline.ts); > 15 % warns, > 40 % fails unless the change
 * is acknowledged with a reason — durably in
 * data/curated/count-change-acceptance.json (pinned to the baseline version)
 * or once with --accept-count-changes "<reason>". The acknowledgement is
 * recorded in both generated reports. A missing landmark always fails.
 *
 * Passing --out without --report/--coverage/--cache/--schemas skips those side
 * outputs, so tests can build fixtures into a temp directory without touching
 * the repo.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/args.ts';
import { formatGeneratedFiles } from './lib/format-generated.ts';
import { buildAndPublish } from './lib/publish.ts';

const root = resolve(fileURLToPath(import.meta.url), '../..');

async function main(): Promise<number> {
  const { values } = parseArgs(
    process.argv.slice(2),
    [
      'input',
      'curated',
      'out',
      'detections',
      'cache',
      'report',
      'coverage',
      'schemas',
      'relation',
      'accept-count-changes',
    ],
    [],
  );
  const defaultOut = values.out === undefined;
  const opt = (key: string, fallback: string) =>
    values[key] !== undefined ? resolve(values[key]) : defaultOut ? resolve(root, fallback) : null;
  const relation = values.relation !== undefined ? Number(values.relation) : undefined;
  if (relation !== undefined && !Number.isSafeInteger(relation))
    throw new Error('--relation must be an OSM relation id');

  const result = await buildAndPublish({
    inputDir: resolve(values.input ?? resolve(root, 'data/raw/osm')),
    curatedDir: resolve(values.curated ?? resolve(root, 'data/curated')),
    outDir: resolve(values.out ?? resolve(root, 'public/data')),
    ...(values.detections !== undefined ? { detectionsDir: resolve(values.detections) } : {}),
    cacheDir: opt('cache', 'data/.cache'),
    reportPath: opt('report', 'docs/DATA_QUALITY_REPORT.md'),
    coveragePath: opt('coverage', 'docs/CAMPUS_BUILDING_COVERAGE.md'),
    schemasDir: opt('schemas', 'data/schemas'),
    acceptCountChanges: values['accept-count-changes'] ?? null,
    repoRoot: root,
    ...(relation !== undefined ? { relationId: relation } : {}),
  });
  for (const w of result.validation.warnings) console.warn(`warning [${w.code}] ${w.message}`);
  const b = result.baseline;
  console.log(
    b
      ? `count-change baseline: ${b.datasetVersion} (schema ${b.schemaVersion ?? '?'}) from ${b.ref}`
      : 'count-change baseline: none',
  );
  if (!result.ok) {
    for (const e of result.validation.errors) console.error(`error [${e.code}] ${e.message}`);
    console.error(
      `build-data: ${result.validation.errors.length} validation error(s); the output directory was NOT changed. ` +
        `The rejected dataset is in ${result.stagingDir} for inspection.`,
    );
    return 1;
  }
  const formatNote = await formatGeneratedFiles(result.generatedFiles);
  if (formatNote) console.warn(`warning: ${formatNote}`);
  const c = result.build.manifest.counts;
  console.log(
    `Built dataset ${result.build.manifest.datasetVersion} → ${resolve(values.out ?? resolve(root, 'public/data'))}\n` +
      `  campus buildings ${c.buildings} (inside ${c['buildings:inside']}, crossing ${c['buildings:crossing']}, ` +
      `${c['buildings:unnamed']} unnamed); held for review ${c['buildings:uncertain']}; outside excluded ${c['buildings:outsideExcluded']}\n` +
      `  campus places ${c.places}, context places ${c.contextPlaces}, detections ${c.detections}, relations ${c.relations}\n` +
      `  graph ${c['graph:nodes']} nodes / ${c['graph:edges']} edges (${c['graph:campusEdges']} on campus) / ${c['graph:components']} components\n` +
      `  map keys ${c['directory:keyed']} of ${c['directory:eligible']} eligible; places not connected to the graph: ${c['places:notConnected']}`,
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(`build-data failed: ${(e as Error).message}`);
    process.exit(1);
  },
);
