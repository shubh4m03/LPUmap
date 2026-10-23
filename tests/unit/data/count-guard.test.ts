// @vitest-environment node
/**
 * Count-change guard: thresholds (warn > 15 %, error > 40 %, proportionate),
 * baseline resolution (committed git HEAD of any schema, else a VALID
 * current-schema cache/output manifest — a stale v1 cache is ignored), and the
 * explicit acknowledgement (curated, pinned to a baseline version, or a CLI
 * reason) that downgrades — never hides — large intentional changes. Landmark
 * removal is never accepted.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Manifest } from '../../../src/data/schema.ts';
import {
  committedBaseline,
  currentSchemaBaseline,
  looseBaseline,
  resolveBaseline,
} from '../../../scripts/lib/baseline.ts';
import { runBuild } from '../../../scripts/lib/pipeline.ts';
import { validateDataset } from '../../../scripts/lib/validate.ts';
import {
  COUNT_ACCEPTANCE_FILE,
  countGuardMarkdown,
  evaluateCountGuard,
  readCountAcceptances,
  reportCountGuard,
  resolveAcceptance,
} from '../../../scripts/lib/validate-changes.ts';
import type { CountAcceptance, CountBaseline } from '../../../scripts/lib/validate-changes.ts';
import type { Issue } from '../../../scripts/lib/validate.ts';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const fixture = (p: string) => join(repo, 'tests/fixtures/osm', p);

const base = (counts: Record<string, number>, datasetVersion = 'aaaaaaaaaaaa'): CountBaseline => ({
  origin: 'test',
  ref: 'synthetic',
  schemaVersion: 1,
  datasetVersion,
  counts,
});
const cli = (reason: string): CountAcceptance => ({
  origin: 'cli',
  reason,
  acceptedBy: null,
  acceptedAt: null,
  baselineDatasetVersion: null,
});
const issues = (r: ReturnType<typeof evaluateCountGuard>) => {
  const out: Issue[] = [];
  reportCountGuard(
    r,
    {},
    {
      error: (code, message) => out.push({ level: 'error', code, message }),
      warn: (code, message) => out.push({ level: 'warning', code, message }),
    },
  );
  return out;
};

describe('evaluateCountGuard', () => {
  const prev = base({ a: 100, b: 100, c: 100, d: 10, e: 100, gone: 7, 'graph:edges': 0, zero: 0 });
  const cur = { counts: { a: 100, b: 120, c: 59, d: 6, e: 84, 'graph:edges': 12, zero: 50, fresh: 9 } };

  it('warns above 15 %, fails above 40 %, ignores changes of fewer than 5 records, reports vanished keys', () => {
    const r = evaluateCountGuard(cur, prev, null);
    expect(r.changes.map((c) => [c.key, c.level])).toEqual([
      ['b', 'warning'], // +20 %
      ['c', 'error'], // −41 %
      ['e', 'warning'], // −16 %
      ['gone', 'warning'], // disappeared
      ['graph:edges', 'warning'], // 0 → 12 on a graph count
    ]);
    // a (unchanged), d (−40 % but only 4 records), zero (0 → 50, not a graph count), fresh (new) are not material.
    const out = issues(r);
    expect(out.filter((i) => i.level === 'error').map((i) => i.message)).toEqual([
      'count "c" changed 100 → 59 (41 %), above the 40 % limit',
    ]);
    expect(out.map((i) => i.code)).toContain('count-missing');
  });

  it('is exact at the thresholds: 15 % and 40 % themselves do not trigger', () => {
    const r = evaluateCountGuard({ counts: { w: 115, x: 60 } }, base({ w: 100, x: 100 }), null);
    expect(r.changes.map((c) => [c.key, c.level])).toEqual([['x', 'warning']]);
  });

  it('an acceptance downgrades errors to listed "accepted" warnings and records the reason once', () => {
    const r = evaluateCountGuard(cur, prev, cli('intentional synthetic migration for the test'));
    expect(r.changes.find((c) => c.key === 'c')?.level).toBe('accepted');
    const out = issues(r);
    expect(out.filter((i) => i.level === 'error')).toEqual([]);
    expect(out.find((i) => i.code === 'count-change' && i.message.includes('"c"'))?.message).toMatch(
      /accepted/,
    );
    expect(out.filter((i) => i.code === 'count-change-accepted').map((i) => i.message)).toEqual([
      expect.stringMatching(/1 count change\(s\) .* --accept-count-changes: intentional synthetic migration/),
    ]);
    const md = countGuardMarkdown(r).join('\n');
    expect(md).toContain(
      '**Accepted large change** (--accept-count-changes): intentional synthetic migration',
    );
    expect(md).toContain('| `c` | 100 | 59 | 41 % | accepted |');
  });

  it('without a baseline compares nothing and says so in the report', () => {
    const r = evaluateCountGuard(cur, null, null);
    expect(r.changes).toEqual([]);
    expect(countGuardMarkdown(r).join('\n')).toMatch(/No baseline dataset was available/);
  });
});

describe('resolveAcceptance', () => {
  const file = {
    acceptances: [
      {
        baselineDatasetVersion: 'b628c5855b1d',
        reason: 'v1 to v2 campus-only migration, owner decisions 1-3',
        acceptedBy: 'tester',
        acceptedAt: '2026-10-24',
      },
    ],
  };

  it('applies a curated acceptance only to the baseline version it is pinned to', () => {
    const hit = resolveAcceptance(base({}, 'b628c5855b1d'), file, null);
    expect(hit.acceptance).toMatchObject({
      origin: 'curated',
      acceptedBy: 'tester',
      baselineDatasetVersion: 'b628c5855b1d',
    });
    expect(hit.stale).toEqual([]);
    const miss = resolveAcceptance(base({}, '0123456789ab'), file, null);
    expect(miss.acceptance).toBeNull();
    expect(miss.stale).toEqual([
      expect.stringMatching(/b628c5855b1d .*no longer matches the baseline 0123456789ab; remove it/),
    ]);
  });

  it('a CLI reason wins, and must actually say why (≥ 20 characters)', () => {
    expect(
      resolveAcceptance(base({}, '0123456789ab'), file, 'reviewed: OSM removed the Law Gate shops')
        .acceptance,
    ).toMatchObject({
      origin: 'cli',
      baselineDatasetVersion: '0123456789ab',
    });
    expect(() => resolveAcceptance(base({}), null, 'yes')).toThrow(/at least 20 characters/);
    expect(resolveAcceptance(base({}), null, '   ').acceptance).toBeNull();
  });

  it('the committed acceptance file is valid and pinned to the committed v1 dataset', () => {
    const committed = readCountAcceptances(join(repo, 'data/curated'));
    expect(committed?.acceptances.map((a) => a.baselineDatasetVersion)).toEqual(['b628c5855b1d']);
  });
});

describe('baseline resolution', () => {
  let tmp: string;
  let built: string;
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'guard-'));
    built = join(tmp, 'built');
    runBuild({
      inputDir: fixture('synthetic-campus'),
      curatedDir: fixture('synthetic-curated'),
      outDir: built,
      relationId: 900001,
    });
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('accepts a v1 manifest loosely (counts compared key by key) but never trusts it as a cache', () => {
    const v1 = {
      schemaVersion: 1,
      datasetVersion: 'b628c5855b1d',
      counts: { buildings: 535, places: 855, bad: 'x' },
    };
    expect(looseBaseline(v1, 'committed', 'git HEAD')).toEqual({
      origin: 'committed',
      ref: 'git HEAD',
      schemaVersion: 1,
      datasetVersion: 'b628c5855b1d',
      counts: { buildings: 535, places: 855 },
    });
    const cache = join(tmp, 'cache');
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, 'previous-manifest.json'), JSON.stringify(v1));
    expect(currentSchemaBaseline(join(cache, 'previous-manifest.json'), 'cache')).toBeNull();
    // Out-of-repo output, invalid (v1) cache → falls through to the valid output manifest.
    const r = resolveBaseline({ repoRoot: repo, outDir: built, cacheDir: cache });
    const manifest = JSON.parse(readFileSync(join(built, 'manifest.json'), 'utf8')) as Manifest;
    expect(r).toMatchObject({ origin: 'output', datasetVersion: manifest.datasetVersion });
    // A valid current-schema cache wins over the output.
    writeFileSync(
      join(cache, 'previous-manifest.json'),
      JSON.stringify({ ...manifest, datasetVersion: 'cccccccccccc' }),
    );
    expect(resolveBaseline({ repoRoot: repo, outDir: built, cacheDir: cache })).toMatchObject({
      origin: 'cache',
      datasetVersion: 'cccccccccccc',
    });
    expect(resolveBaseline({ repoRoot: null, outDir: join(tmp, 'nowhere'), cacheDir: null })).toBeNull();
  });

  it('reads the dataset committed at git HEAD for an output inside the repository', () => {
    const committed = committedBaseline(repo, join(repo, 'public', 'data'));
    // In a git checkout the committed manifest is the deployed dataset (any schema version).
    if (committed) {
      expect(committed.origin).toBe('committed');
      expect(committed.ref).toBe('git HEAD:public/data/manifest.json');
      expect(committed.datasetVersion).toMatch(/^[0-9a-f]{12}$/);
      expect(committed.counts.buildings).toBeGreaterThan(0);
    }
    expect(committedBaseline(repo, built)).toBeNull(); // outside the repository
  });

  it('a missing landmark fails validation even with an acceptance', async () => {
    const manifest = JSON.parse(readFileSync(join(built, 'manifest.json'), 'utf8')) as Manifest;
    const r = await validateDataset({
      dir: built,
      baseline: base(
        { ...manifest.counts, places: (manifest.counts.places ?? 0) * 3 },
        manifest.datasetVersion,
      ),
      acceptance: cli('intentional synthetic migration for the test'),
      landmarks: { landmarks: [{ id: 'osm:way/999999', in: ['buildings'], why: 'test: vanished landmark' }] },
    });
    expect(r.errors.map((e) => e.code)).toEqual(['landmark-missing']);
    expect(r.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['count-change', 'count-change-accepted']),
    );
    expect(r.countGuard?.changes.map((c) => [c.key, c.level])).toEqual([['places', 'accepted']]);
  });

  it('documents the acceptance file name used by the CLI', () => {
    expect(COUNT_ACCEPTANCE_FILE).toBe('count-change-acceptance.json');
  });
});
