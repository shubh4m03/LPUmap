/**
 * Assigns map keys (Decision D6) and writes the committed lock
 * data/curated/directory-keys.json. This is the ONLY command that writes the
 * lock; `npm run data:build` only reads it.
 *
 *   npm run data:keys [-- --date YYYY-MM-DD] [--renumber] [--check]
 *
 *  - New eligible campus buildings are appended with the next free sequence in
 *    their grid cell; existing keys never move.
 *  - Keys of buildings that left the inventory are retired (never reused within
 *    a lock version), unless a new building replaces the old footprint with
 *    IoU ≥ 0.5 (the old geometry is read from the current public/data), in
 *    which case the key moves to it.
 *  - --renumber starts a new lock version and recomputes every key in Hilbert
 *    order (favourites store ids, not keys, so they keep working).
 *  - --check exits 1 when the lock is not up to date (for CI), writing nothing.
 *
 * Keys are presentation ids, not official LPU block numbers.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBoundary } from '../src/geo/boundary.ts';
import type { PolygonalGeometry } from '../src/geo/boundary.ts';
import { parseArgs } from './lib/args.ts';
import { assignKeys, isKeyEligible, LOCK_FILE, readLock } from './lib/directory-keys.ts';
import { computeBuild } from './lib/pipeline.ts';

const root = resolve(fileURLToPath(import.meta.url), '../..');

function previousFootprints(path: string): Map<string, PolygonalGeometry> {
  const out = new Map<string, PolygonalGeometry>();
  if (!existsSync(path)) return out;
  try {
    const fc = JSON.parse(readFileSync(path, 'utf8')) as {
      features?: Array<{ geometry?: PolygonalGeometry; properties?: { id?: string } }>;
    };
    for (const f of fc.features ?? [])
      if (f.properties?.id && (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon'))
        out.set(f.properties.id, f.geometry);
  } catch {
    // no previous dataset: no key transfers
  }
  return out;
}

/** Formats like `npm run format` so the committed lock passes format:check; plain JSON when Prettier is absent. */
async function formatJson(text: string, filepath: string): Promise<string> {
  try {
    const prettier = await import('prettier');
    const options = (await prettier.resolveConfig(filepath)) ?? {};
    return await prettier.format(text, { ...options, filepath });
  } catch {
    return text;
  }
}

async function main(): Promise<number> {
  const { values, flags } = parseArgs(
    process.argv.slice(2),
    ['date', 'curated', 'input', 'data'],
    ['renumber', 'check'],
  );
  const curatedDir = resolve(values.curated ?? resolve(root, 'data/curated'));
  const lockPath = join(curatedDir, LOCK_FILE);
  const date = values.date ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date must be YYYY-MM-DD');
  const dataDir = resolve(values.data ?? resolve(root, 'public/data'));

  const build = computeBuild({
    inputDir: resolve(values.input ?? resolve(root, 'data/raw/osm')),
    curatedDir,
    outDir: dataDir,
    keysLockPath: null,
    previousManifest: null,
  });
  const eligible = build.keyCandidates.filter((c) => isKeyEligible(c));
  const current = new Map(build.inventory.map((r) => [r.id, r.geometry]));
  const old = previousFootprints(join(dataDir, 'buildings.geojson'));
  const previous = readLock(lockPath);
  const result = assignKeys(previous, eligible, {
    date,
    renumber: flags.has('renumber'),
    iou: (oldId, newId) => {
      const a = old.get(oldId);
      const b = current.get(newId);
      if (!a || !b) return null;
      try {
        const region = createBoundary(a);
        const inter = region.intersectionAreaM2(b);
        return inter / (region.areaM2 + createBoundary(b).areaM2 - inter);
      } catch {
        return null;
      }
    },
  });
  const text = await formatJson(`${JSON.stringify(result.lock, null, 2)}\n`, lockPath);
  const unchanged = existsSync(lockPath) && readFileSync(lockPath, 'utf8') === text;
  console.log(
    `Map keys: ${Object.keys(result.lock.keys).length} keyed (lock version ${result.lock.version}); ` +
      `${result.added.length} added, ${result.retired.length} retired, ${result.transferred.length} transferred, ` +
      `${result.unkeyable.length} outside the key grid.`,
  );
  for (const t of result.transferred)
    console.log(`  transferred ${t.key}: ${t.from} → ${t.to} (IoU ${t.iou.toFixed(2)})`);
  for (const r of result.retired) console.log(`  retired ${r.key} (${r.id})`);
  for (const id of result.unkeyable) console.log(`  cannot key ${id}: anchor outside the grid`);
  if (flags.has('check')) {
    if (!unchanged) console.error(`${lockPath} is not up to date; run "npm run data:keys".`);
    return unchanged ? 0 : 1;
  }
  if (!unchanged) writeFileSync(lockPath, text);
  console.log(unchanged ? `${lockPath} already up to date.` : `Wrote ${lockPath}. Next: npm run data:check.`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(`assign-directory-keys failed: ${(e as Error).message}`);
    process.exit(1);
  },
);
