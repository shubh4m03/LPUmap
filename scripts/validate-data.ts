/**
 * Validates public/data/* (schemas + invariants). Exit code 1 on any error.
 *
 *   node scripts/validate-data.ts [--dir public/data] [--previous data/.cache/previous-manifest.json]
 *                                 [--check-links]
 *
 * --check-links sends HEAD requests to every website (network; off by default).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { manifestSchema } from '../src/data/schema.ts';
import type { Manifest } from '../src/data/schema.ts';
import { parseArgs } from './lib/args.ts';
import { validateDataset } from './lib/validate.ts';
import type { Issue } from './lib/validate.ts';

const root = resolve(fileURLToPath(import.meta.url), '../..');

/** The facilities module is optional at pipeline time; skip the hours check when it is absent. */
async function loadHoursParser(): Promise<{ parse: ((raw: string) => unknown) | null; note: string | null }> {
  const path = resolve(root, 'src/facilities/hours.ts');
  if (!existsSync(path))
    return { parse: null, note: 'opening-hours check skipped: src/facilities/hours.ts not found' };
  try {
    const mod = (await import(pathToFileURL(path).href)) as { parseOpeningHours?: (raw: string) => unknown };
    if (typeof mod.parseOpeningHours !== 'function') {
      return { parse: null, note: 'opening-hours check skipped: parseOpeningHours is not exported' };
    }
    return { parse: mod.parseOpeningHours, note: null };
  } catch (e) {
    return {
      parse: null,
      note: `opening-hours check skipped: could not load hours.ts (${(e as Error).message})`,
    };
  }
}

function readPrevious(path: string | undefined, explicit: boolean): Manifest | null {
  if (!path || !existsSync(path)) {
    if (explicit) throw new Error(`--previous ${path} does not exist`);
    return null;
  }
  const parsed = manifestSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    console.warn(`warning: previous manifest ${path} is not a valid manifest; change detection skipped`);
    return null;
  }
  return parsed.data;
}

function summarise(kind: string, issues: Issue[]): void {
  const byCode = new Map<string, number>();
  for (const i of issues) byCode.set(i.code, (byCode.get(i.code) ?? 0) + 1);
  const parts = [...byCode.entries()].sort().map(([code, n]) => `${code} ×${n}`);
  console.log(`${issues.length} ${kind}${parts.length ? ` (${parts.join(', ')})` : ''}`);
}

async function main(): Promise<number> {
  const { values, flags } = parseArgs(process.argv.slice(2), ['dir', 'previous'], ['check-links']);
  const dir = resolve(values.dir ?? resolve(root, 'public/data'));
  // The cached previous manifest belongs to the default output; custom --dir needs an explicit --previous.
  const previousPath = values.previous
    ? resolve(values.previous)
    : values.dir === undefined
      ? resolve(root, 'data/.cache/previous-manifest.json')
      : undefined;
  const previousManifest = readPrevious(previousPath, values.previous !== undefined);
  const hours = await loadHoursParser();
  const result = await validateDataset({
    dir,
    previousManifest,
    parseHours: hours.parse,
    checkLinks: flags.has('check-links') ? { fetchImpl: fetch } : null,
  });
  const notes = hours.note ? [hours.note] : [];
  if (!previousManifest) notes.push('suspicious-change detection skipped: no previous manifest');
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
