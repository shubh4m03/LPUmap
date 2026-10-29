/**
 * Refreshes the raw OpenStreetMap snapshot in data/raw/osm/ (network).
 * A normal build never needs this: the snapshot is committed.
 *
 *   node scripts/fetch-osm.ts [--force] [--out data/raw/osm] [--relation 21599790]
 *
 * Without --force nothing is downloaded when a snapshot and SOURCE.json exist.
 * Requests carry the neutral User-Agent `LPU-Campus-Atlas-research/0.1`, a
 * timeout and bounded retries (scripts/lib/http.ts); no contact or personal
 * identifier is ever sent.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/args.ts';
import { CAMPUS_RELATION_ID } from './lib/build-boundary.ts';
import { fetchSnapshot } from './lib/fetch-osm-lib.ts';

const root = resolve(fileURLToPath(import.meta.url), '../..');

async function main(): Promise<void> {
  const { values, flags } = parseArgs(process.argv.slice(2), ['out', 'relation'], ['force']);
  const relationId = values.relation ? Number(values.relation) : CAMPUS_RELATION_ID;
  if (!Number.isSafeInteger(relationId)) throw new Error('--relation must be an OSM relation id');
  const rawDir = resolve(values.out ?? resolve(root, 'data/raw/osm'));
  const result = await fetchSnapshot({
    rawDir,
    relationId,
    force: flags.has('force'),
    fetchImpl: fetch,
    now: () => new Date(),
    log: (m) => console.log(m),
  });
  if (result.status === 'cached') {
    console.log(`Snapshot already present in ${rawDir}; nothing fetched (use --force to refresh).`);
  } else {
    console.log(
      `Fetched OSM snapshot via ${result.meta.method} (bbox ${result.meta.bbox.join(', ')}) at ${result.meta.retrievedAt}.\n` +
        'Next: npm run data:check, then review docs/DATA_QUALITY_REPORT.md before committing.',
    );
  }
}

main().catch((e: unknown) => {
  console.error(`fetch-osm failed: ${(e as Error).message}`);
  process.exit(1);
});
