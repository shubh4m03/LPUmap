/**
 * Count-change guard (suspicious-change detection against a baseline dataset)
 * and the opt-in website link check.
 *
 * The baseline is the dataset currently deployed — by default the manifest
 * committed at git HEAD (scripts/lib/baseline.ts), which may be an older
 * schema version: its counts are compared key by key. A count that moves by
 * more than `warn` (15 %) is a warning; more than `error` (40 %) fails the
 * build, so a refresh that loses a large share of campus data never replaces
 * the deployed map. Landmark removal is checked separately and is ALWAYS an
 * error (scripts/lib/landmarks.ts).
 *
 * An intentional large change (e.g. the v1 → v2 campus-only migration) is
 * acknowledged explicitly, never by disabling the guard:
 *  - data/curated/count-change-acceptance.json — a dated, attributed reason
 *    pinned to the baseline `datasetVersion` it accepts (it stops applying as
 *    soon as the baseline changes, and is then reported as stale); or
 *  - `--accept-count-changes "<reason>"` for a one-off local run.
 * Accepted changes stay listed as warnings, with the reason, and are written
 * to docs/DATA_QUALITY_REPORT.md and docs/CAMPUS_BUILDING_COVERAGE.md.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Manifest, Place } from '../../src/data/schema.ts';
import type { IssueSink } from './validate-geometry.ts';

export interface CountThresholds {
  /** Relative change above which a warning is raised. */
  warn: number;
  /** Relative change above which the build fails (unless accepted). */
  error: number;
  /**
   * Proportionality: a change is only material when it also moves the count by
   * at least this many records (3 → 1 is 67 % but not a regression signal).
   */
  minAbsolute: number;
}

export const DEFAULT_COUNT_THRESHOLDS: CountThresholds = { warn: 0.15, error: 0.4, minAbsolute: 5 };

/** The dataset a build is compared with. */
export interface CountBaseline {
  /** Where it came from: the manifest committed at git HEAD, the build cache, the replaced output, or a CLI path. */
  origin: 'committed' | 'cache' | 'output' | 'explicit' | 'test';
  /** Human-readable reference, e.g. 'git HEAD:public/data/manifest.json'. */
  ref: string;
  schemaVersion: number | null;
  datasetVersion: string;
  counts: Record<string, number>;
}

/** An explicit acknowledgement of a large, intentional count change. */
export interface CountAcceptance {
  origin: 'curated' | 'cli';
  reason: string;
  acceptedBy: string | null;
  acceptedAt: string | null;
  /** The baseline dataset version the acceptance is pinned to (curated acceptances only). */
  baselineDatasetVersion: string | null;
}

export interface CountChange {
  key: string;
  before: number;
  after: number | null;
  /** |after − before| / before; null when the key disappeared. */
  relative: number | null;
  level: 'warning' | 'error' | 'accepted';
}

export interface CountGuardResult {
  baseline: CountBaseline | null;
  acceptance: CountAcceptance | null;
  /** Material changes only (above the warn threshold, or a disappeared key), sorted by key. */
  changes: CountChange[];
  /** Curated acceptances that do not match the current baseline (should be removed once committed). */
  staleAcceptances: string[];
}

export const COUNT_ACCEPTANCE_FILE = 'count-change-acceptance.json';

export const countAcceptanceFileSchema = z.strictObject({
  $comment: z.string().optional(),
  acceptances: z.array(
    z.strictObject({
      baselineDatasetVersion: z.string().regex(/^[0-9a-f]{12}$/),
      reason: z.string().trim().min(20),
      acceptedBy: z.string().trim().min(1),
      acceptedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  ),
});
export type CountAcceptanceFile = z.infer<typeof countAcceptanceFileSchema>;

/** Reads <curatedDir>/count-change-acceptance.json (absent = no acceptances). */
export function readCountAcceptances(curatedDir: string | null | undefined): CountAcceptanceFile | null {
  if (!curatedDir) return null;
  const path = join(curatedDir, COUNT_ACCEPTANCE_FILE);
  if (!existsSync(path)) return null;
  const parsed = countAcceptanceFileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) throw new Error(`${path} is invalid:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/**
 * The acceptance that applies to `baseline`: a CLI reason wins; otherwise the
 * curated entry pinned to this baseline's datasetVersion. Entries pinned to
 * any other version are returned as stale.
 */
export function resolveAcceptance(
  baseline: CountBaseline | null,
  file: CountAcceptanceFile | null,
  cliReason: string | null | undefined,
): { acceptance: CountAcceptance | null; stale: string[] } {
  const entries = file?.acceptances ?? [];
  const stale = entries
    .filter((e) => !baseline || e.baselineDatasetVersion !== baseline.datasetVersion)
    .map(
      (e) =>
        `${COUNT_ACCEPTANCE_FILE}: acceptance for baseline ${e.baselineDatasetVersion} (${e.acceptedAt}, ${e.acceptedBy}) no longer matches the baseline${baseline ? ` ${baseline.datasetVersion}` : ''}; remove it`,
    );
  const reason = cliReason?.trim();
  if (reason) {
    if (reason.length < 20)
      throw new Error(
        '--accept-count-changes needs a reason of at least 20 characters saying why the change is intended',
      );
    return {
      acceptance: {
        origin: 'cli',
        reason,
        acceptedBy: null,
        acceptedAt: null,
        baselineDatasetVersion: baseline?.datasetVersion ?? null,
      },
      stale,
    };
  }
  const match = baseline
    ? entries.find((e) => e.baselineDatasetVersion === baseline.datasetVersion)
    : undefined;
  return {
    acceptance: match
      ? {
          origin: 'curated',
          reason: match.reason,
          acceptedBy: match.acceptedBy,
          acceptedAt: match.acceptedAt,
          baselineDatasetVersion: match.baselineDatasetVersion,
        }
      : null,
    stale,
  };
}

/** Pure: compares every count key of the baseline with the current manifest. */
export function evaluateCountGuard(
  current: Pick<Manifest, 'counts'>,
  baseline: CountBaseline | null,
  acceptance: CountAcceptance | null,
  thresholds: Partial<CountThresholds> = {},
  staleAcceptances: string[] = [],
): CountGuardResult {
  const t = { ...DEFAULT_COUNT_THRESHOLDS, ...thresholds };
  const changes: CountChange[] = [];
  if (baseline) {
    for (const key of Object.keys(baseline.counts).sort()) {
      const prev = baseline.counts[key]!;
      const cur = current.counts[key];
      if (cur === undefined) {
        changes.push({ key, before: prev, after: null, relative: null, level: 'warning' });
        continue;
      }
      const delta = Math.abs(cur - prev);
      if (prev === 0) {
        if (cur > 0 && key.startsWith('graph:'))
          changes.push({ key, before: 0, after: cur, relative: null, level: 'warning' });
        continue;
      }
      const rel = delta / prev;
      if (delta < t.minAbsolute || rel <= t.warn) continue;
      const level = rel > t.error ? (acceptance ? 'accepted' : 'error') : 'warning';
      changes.push({ key, before: prev, after: cur, relative: rel, level });
    }
  }
  return { baseline, acceptance, changes, staleAcceptances };
}

/** Reports a guard result as issues (count-change / count-missing / count-acceptance-stale). */
export function reportCountGuard(
  r: CountGuardResult,
  thresholds: Partial<CountThresholds>,
  c: IssueSink,
): void {
  const t = { ...DEFAULT_COUNT_THRESHOLDS, ...thresholds };
  const pct = (v: number) => `${Math.round(v * 100)} %`;
  for (const ch of r.changes) {
    if (ch.after === null) {
      c.warn('count-missing', `count "${ch.key}" disappeared (was ${ch.before})`);
      continue;
    }
    if (ch.relative === null) {
      c.warn('count-change', `count "${ch.key}" changed ${ch.before} → ${ch.after}`);
      continue;
    }
    const msg = `count "${ch.key}" changed ${ch.before} → ${ch.after} (${pct(ch.relative)})`;
    if (ch.level === 'error') c.error('count-change', `${msg}, above the ${pct(t.error)} limit`);
    else if (ch.level === 'accepted')
      c.warn(
        'count-change',
        `${msg}, above the ${pct(t.error)} limit — accepted (see count-change-accepted)`,
      );
    else c.warn('count-change', `${msg}, above ${pct(t.warn)}`);
  }
  const accepted = r.changes.filter((ch) => ch.level === 'accepted').length;
  if (accepted > 0 && r.acceptance) {
    const a = r.acceptance;
    const who =
      a.origin === 'curated'
        ? `data/curated/${COUNT_ACCEPTANCE_FILE} (${a.acceptedBy}, ${a.acceptedAt})`
        : '--accept-count-changes';
    c.warn(
      'count-change-accepted',
      `${accepted} count change(s) above the ${pct(t.error)} limit accepted by ${who}: ${a.reason}`,
    );
  }
  for (const s of r.staleAcceptances) c.warn('count-acceptance-stale', s);
}

/** Markdown section recording the guard outcome (baseline, acceptance with reason, each material change). */
export function countGuardMarkdown(r: CountGuardResult | null | undefined, heading = '##'): string[] {
  const out = [`${heading} Count-change guard`, ''];
  if (!r || !r.baseline) {
    out.push('No baseline dataset was available, so count changes were not checked.', '');
    return out;
  }
  const b = r.baseline;
  out.push(
    `Baseline: dataset \`${b.datasetVersion}\` (schema version ${b.schemaVersion ?? 'unknown'}) from ${b.ref}. ` +
      `Thresholds: warn above ${DEFAULT_COUNT_THRESHOLDS.warn * 100} %, fail above ${DEFAULT_COUNT_THRESHOLDS.error * 100} % ` +
      `(changes of fewer than ${DEFAULT_COUNT_THRESHOLDS.minAbsolute} records are ignored); a missing landmark always fails.`,
    '',
  );
  if (r.acceptance) {
    const a = r.acceptance;
    out.push(
      `**Accepted large change** (${a.origin === 'curated' ? `data/curated/${COUNT_ACCEPTANCE_FILE}, ${a.acceptedBy}, ${a.acceptedAt}` : '--accept-count-changes'}): ${a.reason}`,
      '',
    );
  }
  for (const s of r.staleAcceptances) out.push(`- Stale acceptance: ${s}`);
  if (r.staleAcceptances.length) out.push('');
  if (r.changes.length === 0) {
    out.push('No count moved beyond the warning threshold.', '');
    return out;
  }
  out.push('| Count | Baseline | This build | Change | Outcome |', '| --- | --- | --- | --- | --- |');
  for (const ch of r.changes) {
    const change = ch.relative === null ? '–' : `${Math.round(ch.relative * 100)} %`;
    out.push(`| \`${ch.key}\` | ${ch.before} | ${ch.after ?? 'missing'} | ${change} | ${ch.level} |`);
  }
  out.push('');
  return out;
}

/** Back-compatible wrapper: compares against a manifest, accepting with a boolean. */
export function checkCounts(
  current: Manifest,
  previous: Manifest,
  thresholds: Partial<CountThresholds>,
  accept: boolean,
  c: IssueSink,
): void {
  const baseline: CountBaseline = {
    origin: 'test',
    ref: 'previous manifest',
    schemaVersion: previous.schemaVersion,
    datasetVersion: previous.datasetVersion,
    counts: previous.counts,
  };
  const acceptance: CountAcceptance | null = accept
    ? {
        origin: 'cli',
        reason: 'accepted by the caller',
        acceptedBy: null,
        acceptedAt: null,
        baselineDatasetVersion: null,
      }
    : null;
  reportCountGuard(evaluateCountGuard(current, baseline, acceptance, thresholds), thresholds, c);
}

export async function checkLinks(
  places: Place[],
  opts: { fetchImpl: typeof fetch; timeoutMs?: number },
  c: IssueSink,
): Promise<void> {
  const urls = [...new Set(places.flatMap((p) => (p.contact?.website ? [p.contact.website] : [])))].sort();
  for (const url of urls) {
    try {
      const res = await opts.fetchImpl(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10000),
      });
      if (!res.ok) c.warn('link', `${url} answered HTTP ${res.status}`);
    } catch (e) {
      c.warn('link', `${url} unreachable: ${(e as Error).message}`);
    }
  }
}
