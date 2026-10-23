/**
 * Which dataset a build is compared with (count-change guard, before/after
 * diff in docs/CAMPUS_BUILDING_COVERAGE.md).
 *
 * Order:
 *  1. the manifest COMMITTED at git HEAD for the output directory (the dataset
 *     that is deployed) — any schema version, compared count key by count key;
 *  2. data/.cache/previous-manifest.json, only when it is a valid manifest of
 *     the CURRENT schema (a stale v1 cache is ignored, not trusted);
 *  3. the manifest currently in the output directory, same condition.
 * None found → the guard is skipped with a warning (first build of a fresh clone).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { DATA_FILES, manifestSchema } from '../../src/data/schema.ts';
import type { CountBaseline } from './validate-changes.ts';

/** Accepts any manifest-like object with a string datasetVersion and numeric counts. */
export function looseBaseline(
  raw: unknown,
  origin: CountBaseline['origin'],
  ref: string,
): CountBaseline | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { schemaVersion?: unknown; datasetVersion?: unknown; counts?: unknown };
  if (typeof o.datasetVersion !== 'string' || !o.counts || typeof o.counts !== 'object') return null;
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(o.counts as Record<string, unknown>))
    if (typeof v === 'number' && Number.isFinite(v)) counts[k] = v;
  return {
    origin,
    ref,
    schemaVersion: typeof o.schemaVersion === 'number' ? o.schemaVersion : null,
    datasetVersion: o.datasetVersion,
    counts,
  };
}

/** A manifest file of the CURRENT schema, or null (absent, unreadable or another schema version). */
export function currentSchemaBaseline(path: string, origin: CountBaseline['origin']): CountBaseline | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = manifestSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.success ? looseBaseline(parsed.data, origin, path) : null;
  } catch {
    return null;
  }
}

/** `git show HEAD:<outDir>/manifest.json` when outDir lies inside the repository; null otherwise. */
export function committedBaseline(repoRoot: string, outDir: string): CountBaseline | null {
  const rel = relative(repoRoot, outDir);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  const spec = `HEAD:${rel.split(/[\\/]+/).join('/')}/${DATA_FILES.manifest}`;
  try {
    const text = execFileSync('git', ['show', spec], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 16 * 1024 * 1024,
    });
    return looseBaseline(JSON.parse(text), 'committed', `git ${spec}`);
  } catch {
    return null; // not a git checkout, no commit yet, or the file is not committed
  }
}

export function resolveBaseline(opts: {
  repoRoot?: string | null;
  outDir: string;
  cacheDir?: string | null;
}): CountBaseline | null {
  return (
    (opts.repoRoot ? committedBaseline(opts.repoRoot, opts.outDir) : null) ??
    (opts.cacheDir ? currentSchemaBaseline(join(opts.cacheDir, 'previous-manifest.json'), 'cache') : null) ??
    currentSchemaBaseline(join(opts.outDir, DATA_FILES.manifest), 'output')
  );
}
