/**
 * Validates public/data/* (schemas + invariants + v2 regression guards). Exit code 1 on any error.
 *
 *   node scripts/validate-data.ts [--dir public/data] [--previous <manifest.json>]
 *                                 [--curated data/curated] [--check-links]
 *                                 [--accept-count-changes "<why this large change is intended>"]
 *
 * Count-change baseline (scripts/lib/baseline.ts): --previous when given (any
 * schema version); otherwise, for the default --dir, the manifest committed at
 * git HEAD, then a valid current-schema data/.cache/previous-manifest.json.
 * Acknowledgements: data/curated/count-change-acceptance.json (pinned to the
 * baseline datasetVersion) or --accept-count-changes with a reason.
 * --check-links sends HEAD requests to every website (network; off by default).
 * Landmarks come from <curated>/landmarks.json (default data/curated).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/args.ts';
import { looseBaseline, resolveBaseline } from './lib/baseline.ts';
import { readLandmarks } from './lib/landmarks.ts';
import { loadHoursParser } from './lib/publish.ts';
import { validateDataset } from './lib/validate.ts';
import type { Issue } from './lib/validate.ts';
import { readCountAcceptances, resolveAcceptance } from './lib/validate-changes.ts';
import type { CountBaseline } from './lib/validate-changes.ts';

const root = resolve(fileURLToPath(import.meta.url), '../..');

function explicitBaseline(path: string): CountBaseline {
  if (!existsSync(path)) throw new Error(`--previous ${path} does not exist`);
  const b = looseBaseline(JSON.parse(readFileSync(path, 'utf8')), 'explicit', path);
  if (!b) throw new Error(`--previous ${path} is not a manifest (needs datasetVersion and counts)`);
  return b;
}

function summarise(kind: string, issues: Issue[]): void {
  const byCode = new Map<string, number>();
  for (const i of issues) byCode.set(i.code, (byCode.get(i.code) ?? 0) + 1);
  const parts = [...byCode.entries()].sort().map(([code, n]) => `${code} ×${n}`);
  console.log(`${issues.length} ${kind}${parts.length ? ` (${parts.join(', ')})` : ''}`);
}

async function main(): Promise<number> {
  const { values, flags } = parseArgs(
    process.argv.slice(2),
    ['dir', 'previous', 'curated', 'accept-count-changes'],
    ['check-links'],
  );
  const defaultDir = values.dir === undefined;
  const dir = resolve(values.dir ?? resolve(root, 'public/data'));
  // The committed/cached baseline belongs to the default output; a custom --dir needs an explicit --previous.
  const baseline = values.previous
    ? explicitBaseline(resolve(values.previous))
    : defaultDir
      ? resolveBaseline({ repoRoot: root, outDir: dir, cacheDir: resolve(root, 'data/.cache') })
      : null;
  const hours = await loadHoursParser(root);
  // Landmarks and acceptances belong to the default dataset; a custom --dir needs an explicit --curated.
  const curatedDir =
    values.curated !== undefined
      ? resolve(values.curated)
      : defaultDir
        ? resolve(root, 'data/curated')
        : null;
  const { acceptance, stale } = resolveAcceptance(
    baseline,
    readCountAcceptances(curatedDir),
    values['accept-count-changes'] ?? null,
  );
  const result = await validateDataset({
    dir,
    baseline,
    acceptance,
    staleAcceptances: stale,
    parseHours: hours.parse,
    checkLinks: flags.has('check-links') ? { fetchImpl: fetch } : null,
    landmarks: curatedDir ? readLandmarks(curatedDir) : null,
  });
  const notes = hours.note ? [hours.note] : [];
  if (!baseline) notes.push('count-change detection skipped: no baseline manifest');
  else
    console.log(
      `count-change baseline: ${baseline.datasetVersion} (schema ${baseline.schemaVersion ?? '?'}) from ${baseline.ref}`,
    );
  if (acceptance)
    console.log(`large count changes acknowledged (${acceptance.origin}): ${acceptance.reason}`);
  for (const w of result.warnings) console.warn(`warning [${w.code}] ${w.message}`);
  for (const n of notes) console.warn(`warning [skipped] ${n}`);
  for (const e of result.errors) console.error(`error [${e.code}] ${e.message}`);
  summarise('warnings', [
    ...result.warnings,
    ...notes.map((message) => ({ level: 'warning' as const, code: 'skipped', message })),
  ]);
  summarise('errors', result.errors);
  console.log(result.errors.length === 0 ? `Dataset in ${dir} is valid.` : `Dataset in ${dir} is INVALID.`);
  return result.errors.length === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(`validate-data failed: ${(e as Error).message}`);
    process.exit(1);
  },
);
