/**
 * The guarded build used by `npm run data:build`:
 *
 *   compute → write to a staging directory → validate (schemas, invariants,
 *   landmarks, count-change thresholds against the BASELINE dataset — by
 *   default the one committed at git HEAD, see scripts/lib/baseline.ts) →
 *   only if there are no errors, swap the files into the output directory and
 *   write the generated docs (with the count-change guard outcome recorded).
 *
 * A refresh that fails validation therefore never changes public/data (the
 * deployed map) or the generated reports.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATA_FILES } from '../../src/data/schema.ts';
import { resolveBaseline } from './baseline.ts';
import { DIFF_END, DIFF_START, insertCountGuard } from './coverage-markdown.ts';
import { readLandmarks } from './landmarks.ts';
import { computeBuild, datasetPaths, readTextOrNull, writeDataset, writeSideOutputs } from './pipeline.ts';
import type { BuildOptions, ComputedBuild } from './pipeline.ts';
import { validateDataset } from './validate.ts';
import type { ValidateResult } from './validate.ts';
import { countGuardMarkdown, readCountAcceptances, resolveAcceptance } from './validate-changes.ts';
import type { CountBaseline } from './validate-changes.ts';

export interface PublishOptions extends BuildOptions {
  /**
   * One-off acknowledgement of an intentional large count change: the REASON
   * (`--accept-count-changes "<reason>"`). Recorded in the reports. The
   * durable form is data/curated/count-change-acceptance.json.
   */
  acceptCountChanges?: string | null;
  /** Repository root: the committed baseline (git HEAD) and the optional opening-hours parser. */
  repoRoot?: string;
  /** Explicit baseline (tests); default: resolveBaseline() — git HEAD, then a valid cache/output manifest. */
  baseline?: CountBaseline | null;
}

export type PublishResult =
  | {
      ok: true;
      build: ComputedBuild;
      validation: ValidateResult;
      generatedFiles: string[];
      baseline: CountBaseline | null;
    }
  | { ok: false; validation: ValidateResult; stagingDir: string; baseline: CountBaseline | null };

/** The facilities module is optional at pipeline time; skip the hours check when it is absent. */
export async function loadHoursParser(
  repoRoot: string,
): Promise<{ parse: ((raw: string) => unknown) | null; note: string | null }> {
  const path = join(repoRoot, 'src/facilities/hours.ts');
  if (!existsSync(path))
    return { parse: null, note: 'opening-hours check skipped: src/facilities/hours.ts not found' };
  try {
    const mod = (await import(pathToFileURL(path).href)) as { parseOpeningHours?: (raw: string) => unknown };
    if (typeof mod.parseOpeningHours !== 'function')
      return { parse: null, note: 'opening-hours check skipped: parseOpeningHours is not exported' };
    return { parse: mod.parseOpeningHours, note: null };
  } catch (e) {
    return {
      parse: null,
      note: `opening-hours check skipped: could not load hours.ts (${(e as Error).message})`,
    };
  }
}

export const GUARD_START = '<!-- count-guard:start -->';
export const GUARD_END = '<!-- count-guard:end -->';

/** Replaces the [start, end] block of `generated` with the same block of `existing`, when both have it. */
export function keepBlock(generated: string, existing: string | null, start: string, end: string): string {
  if (!existing) return generated;
  const [ea, eb] = [existing.indexOf(start), existing.indexOf(end)];
  const [ga, gb] = [generated.indexOf(start), generated.indexOf(end)];
  if (ea < 0 || eb < ea || ga < 0 || gb < ga) return generated;
  return generated.slice(0, ga) + existing.slice(ea, eb + end.length) + generated.slice(gb + end.length);
}

function moveInto(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  try {
    renameSync(from, to);
  } catch {
    // e.g. the target is open in another process on Windows: copy instead.
    copyFileSync(from, to);
  }
}

export async function buildAndPublish(opts: PublishOptions): Promise<PublishResult> {
  const outDir = opts.outDir;
  const previousPath = join(outDir, DATA_FILES.manifest);
  const baseline =
    opts.baseline !== undefined
      ? opts.baseline
      : resolveBaseline({ repoRoot: opts.repoRoot ?? null, outDir, cacheDir: opts.cacheDir ?? null });
  const { acceptance, stale } = resolveAcceptance(
    baseline,
    readCountAcceptances(opts.curatedDir),
    opts.acceptCountChanges,
  );
  const build = computeBuild({ ...opts, previousManifest: baseline });

  const staging = `${outDir.replace(/[\\/]+$/, '')}.staging`;
  rmSync(staging, { recursive: true, force: true });
  writeDataset(build, staging);
  const hours = opts.repoRoot ? await loadHoursParser(opts.repoRoot) : { parse: null, note: null };
  const validation = await validateDataset({
    dir: staging,
    baseline,
    acceptance,
    staleAcceptances: stale,
    parseHours: hours.parse,
    landmarks: readLandmarks(opts.curatedDir),
  });
  if (hours.note) validation.warnings.push({ level: 'warning', code: 'skipped', message: hours.note });
  if (!baseline)
    validation.warnings.push({
      level: 'warning',
      code: 'skipped',
      message:
        'count-change thresholds skipped: no baseline (nothing committed at git HEAD for this output, and no valid current-schema cached or output manifest)',
    });
  if (validation.errors.length > 0) return { ok: false, validation, stagingDir: staging, baseline };
  const guard = countGuardMarkdown(validation.countGuard ?? null, '###');
  build.coverageMarkdown = insertCountGuard(build.coverageMarkdown, guard);
  build.qualityMarkdown = [
    build.qualityMarkdown.replace(/\n+$/, ''),
    '',
    GUARD_START,
    '',
    ...countGuardMarkdown(validation.countGuard ?? null),
    GUARD_END,
    '',
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
  // An identical rebuild (the baseline IS this dataset, e.g. CI after the commit) keeps the
  // before/after and guard blocks of the committed docs verbatim: they record the last real change.
  if (baseline && baseline.datasetVersion === build.manifest.datasetVersion) {
    build.coverageMarkdown = keepBlock(
      build.coverageMarkdown,
      readTextOrNull(opts.coveragePath),
      DIFF_START,
      DIFF_END,
    );
    build.qualityMarkdown = keepBlock(
      build.qualityMarkdown,
      readTextOrNull(opts.reportPath),
      GUARD_START,
      GUARD_END,
    );
  }

  if (opts.cacheDir && existsSync(previousPath)) {
    mkdirSync(opts.cacheDir, { recursive: true });
    copyFileSync(previousPath, join(opts.cacheDir, 'previous-manifest.json'));
  }
  // Swap: data files first, the manifest (which names their hashes) last.
  const paths = datasetPaths(build);
  for (const rel of paths.filter((p) => p !== DATA_FILES.manifest))
    moveInto(join(staging, rel), join(outDir, rel));
  moveInto(join(staging, DATA_FILES.manifest), join(outDir, DATA_FILES.manifest));
  // Remove files of an older dataset layout that this build no longer produces.
  const expectedTop = new Set(paths.map((p) => p.split('/')[0]!));
  for (const entry of readdirSync(outDir)) {
    if (expectedTop.has(entry)) continue;
    const full = join(outDir, entry);
    const known = statSync(full).isDirectory() ? entry === 'licenses' : /\.(json|geojson)$/.test(entry);
    if (known) rmSync(full, { recursive: true, force: true });
  }
  rmSync(staging, { recursive: true, force: true });
  const generatedFiles = writeSideOutputs(build, opts);
  return { ok: true, build, validation, generatedFiles, baseline };
}
