/**
 * Rollback DRILL (opt-in, slow): performs the documented static rollback —
 * `git revert <v2 data commit>` — in an ISOLATED temporary clone and checks
 * that it restores the v1 data files, DATA_SCHEMA_VERSION and the data-cache
 * name together (docs/DATA_ROLLBACK.md §2). Never touches this checkout's
 * history, any deployed site or any shared database.
 *
 *   LPU_ROLLBACK_DRILL=1     git level: clone, find the v1→v2 flip commit,
 *                            check it is atomic, revert it, verify the tree.
 *   LPU_ROLLBACK_DRILL=full  also, in the reverted clone: `npm run data:check`
 *                            reproduces the v1 files byte for byte (what the
 *                            Pages build runs), `vite build` emits ONE precache
 *                            manifest whose data entries are exactly the v1
 *                            files with content revisions, `npm run smoke`
 *                            passes, and the v1 server suite passes.
 *
 * Uncommitted work in this checkout is overlaid onto the clone and committed
 * THERE as a simulated "v2 commit" (so the drill also works before the lead
 * commits). Once v2 is committed, the overlay is empty and the drill reverts
 * the real commit. node_modules is shared through a directory junction that is
 * removed before the clone is deleted.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../helpers/test-db.ts';
import { dataCacheIn, schemaVersionIn } from './version-text.ts';

const MODE = process.env.LPU_ROLLBACK_DRILL ?? '';
const FULL = MODE === 'full';
const SLOW = 900_000;

/** Drill notes go to the console and, when LPU_ROLLBACK_DRILL_LOG names a file, are appended there (CI artifact). */
const note = (line: string): void => {
  console.info(`[drill] ${line}`);
  const log = process.env.LPU_ROLLBACK_DRILL_LOG;
  if (log) appendFileSync(log, `${new Date().toISOString()} ${line}\n`);
};

const git = (cwd: string, ...args: string[]): string =>
  execFileSync(
    'git',
    ['-C', cwd, '-c', 'user.name=Rollback Drill', '-c', 'user.email=drill@localhost', ...args],
    {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    },
  );
const gitOk = (cwd: string, ...args: string[]): boolean =>
  spawnSync('git', ['-C', cwd, ...args], { stdio: 'ignore' }).status === 0;
const showAt = (cwd: string, rev: string, path: string): string | null => {
  try {
    return git(cwd, 'show', `${rev}:${path}`);
  } catch {
    return null;
  }
};
const manifestVersionAt = (cwd: string, rev: string): number | null => {
  const m = showAt(cwd, rev, 'public/data/manifest.json');
  return m ? ((JSON.parse(m) as { schemaVersion?: number }).schemaVersion ?? null) : null;
};
/** Runs an npm/npx command in `cwd`; returns exit status and the tail of its output. */
const npm = (cwd: string, cmd: string): { status: number | null; tail: string } => {
  // Run like CI/Pages would: without the test runner's NODE_ENV=test / VITEST* variables
  // (they would switch vite and workbox into test/development mode).
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k !== 'NODE_ENV' && k !== 'TEST' && !k.startsWith('VITEST')),
  );
  const r = spawnSync(cmd, { cwd, env, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status, tail: `${r.stdout ?? ''}\n${r.stderr ?? ''}`.slice(-3000) };
};

describe.skipIf(MODE === '')('rollback drill: git revert of the v2 data commit (isolated clone)', () => {
  let tmp = '';
  let clone = '';
  let flip = '';
  let parent = '';
  let simulated = false;
  let junction = '';

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'lpu-rollback-drill-'));
    clone = join(tmp, 'repo');
    execFileSync('git', ['clone', '--quiet', '--no-hardlinks', REPO_ROOT, clone]);
    // Overlay uncommitted work (tracked + untracked, never git-ignored files such as reference/).
    const listed = execFileSync(
      'git',
      ['-C', REPO_ROOT, 'ls-files', '-z', '-c', '-o', '--exclude-standard'],
      {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
    )
      .split('\0')
      .filter((p) => p !== '');
    for (const rel of new Set(listed)) {
      const from = join(REPO_ROOT, rel);
      const to = join(clone, rel);
      if (existsSync(from)) {
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
      } else rmSync(to, { force: true });
    }
    if (git(clone, 'status', '--porcelain').trim() !== '') {
      git(clone, 'add', '-A');
      git(clone, 'commit', '-q', '-m', 'drill: v2 working tree (simulated data commit)');
      simulated = true;
    }
  }, SLOW);

  afterAll(() => {
    if (junction && existsSync(junction)) {
      try {
        unlinkSync(junction);
      } catch {
        rmdirSync(junction);
      }
    }
    // The shared node_modules must survive the cleanup.
    expect(existsSync(join(REPO_ROOT, 'node_modules', 'vitest'))).toBe(true);
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }, SLOW);

  it('finds the commit that flips the dataset from schema v1 to v2', () => {
    const commits = git(clone, 'log', '--format=%H', '--', 'public/data/manifest.json')
      .split('\n')
      .filter((c) => c !== '');
    for (const c of commits) {
      if (manifestVersionAt(clone, c) === 2 && manifestVersionAt(clone, `${c}^`) === 1) {
        flip = c;
        break;
      }
    }
    expect(flip, 'a v1→v2 flip commit').not.toBe('');
    parent = git(clone, 'rev-parse', `${flip}^`).trim();
    note(
      `flip commit ${flip.slice(0, 12)}${simulated ? ' (simulated from the working tree)' : ''}; parent ${parent.slice(0, 12)}`,
    );
  });

  it('the flip is ATOMIC: data, DATA_SCHEMA_VERSION and the cache name change in the same commit', () => {
    const changed = git(clone, 'diff', '--name-only', parent, flip).split('\n');
    for (const f of ['public/data/manifest.json', 'src/data/schema.ts', 'src/config/index.ts'])
      expect(changed, `${f} must change in the flip commit (otherwise a revert is not atomic)`).toContain(f);
    expect(schemaVersionIn(showAt(clone, parent, 'src/data/schema.ts') ?? '')).toBe(1);
    expect(schemaVersionIn(showAt(clone, flip, 'src/data/schema.ts') ?? '')).toBe(2);
    expect(dataCacheIn(showAt(clone, parent, 'src/config/index.ts') ?? '')).toBe('lpu-atlas-data-v1');
    expect(dataCacheIn(showAt(clone, flip, 'src/config/index.ts') ?? '')).toBe('lpu-atlas-data-v2');
  });

  it('`git revert --no-edit <flip>` applies cleanly and restores v1 data + schema version + cache name together', () => {
    git(clone, 'revert', '--no-edit', flip);
    const read = (p: string) => readFileSync(join(clone, p), 'utf8');
    expect(schemaVersionIn(read('src/data/schema.ts'))).toBe(1);
    expect(dataCacheIn(read('src/config/index.ts'))).toBe('lpu-atlas-data-v1');
    expect((JSON.parse(read('public/data/manifest.json')) as { schemaVersion: number }).schemaVersion).toBe(
      1,
    );
    for (const f of readdirSync(join(clone, 'public/data')).filter((x) => x.endsWith('.json'))) {
      const j = JSON.parse(read(`public/data/${f}`)) as { schemaVersion?: number };
      if (j.schemaVersion !== undefined) expect(j.schemaVersion, f).toBe(1);
    }
    for (const v2Only of ['context-places.json', 'detections.geojson', 'boundary-review.json'])
      expect(existsSync(join(clone, 'public/data', v2Only)), v2Only).toBe(false);
    // When nothing after the flip touched them, these trees are byte-identical to the v1 parent.
    const paths = [
      'public/data',
      'src/data',
      'src/config',
      'server',
      'migrations',
      'functions',
      'src/community',
    ];
    const later = git(clone, 'log', '--format=%H', `${flip}..HEAD~1`, '--', ...paths).trim();
    if (later === '') expect(gitOk(clone, 'diff', '--quiet', parent, 'HEAD', '--', ...paths)).toBe(true);
  });

  it.skipIf(!FULL)(
    'reverted clone: data:check reproduces the v1 files, one precache manifest pins them, smoke and v1 server suite pass',
    () => {
      junction = join(clone, 'node_modules');
      symlinkSync(join(REPO_ROOT, 'node_modules'), junction, 'junction');

      const data = npm(clone, 'npm run -s data:check');
      expect(data.status, data.tail).toBe(0);
      // The Pages build regenerates public/data from the committed snapshot: it must equal the reverted v1 files.
      expect(
        git(clone, 'status', '--porcelain', '--', 'public/data').trim(),
        'data:check changed public/data',
      ).toBe('');

      const build = npm(clone, 'npx vite build');
      expect(build.status, build.tail).toBe(0);
      const sw = readFileSync(join(clone, 'dist', 'sw.js'), 'utf8');
      const calls = [...sw.matchAll(/precacheAndRoute\(\[/g)].map((m) => sw.slice(m.index, m.index + 80));
      expect(calls.length, `exactly one precache manifest:\n${calls.join('\n')}`).toBe(1);
      const entries = new Map<string, string | null>();
      for (const m of sw.matchAll(/\{[^{}]*\}/g)) {
        const url = /["']?url["']?:\s*["']([^"']+)["']/.exec(m[0])?.[1];
        if (!url) continue;
        const rev = /["']?revision["']?:\s*(null|["'][^"']*["'])/.exec(m[0])?.[1];
        entries.set(url, rev === undefined || rev === 'null' ? null : rev.slice(1, -1));
      }
      expect(entries.size, `precache entries parsed from:\n${calls[0] ?? sw.slice(0, 400)}`).toBeGreaterThan(
        0,
      );
      const dataFiles = readdirSync(join(clone, 'dist', 'data')).filter((f) => /\.(json|geojson)$/.test(f));
      expect(
        [...entries.keys()].filter((u) => u.startsWith('data/') && !u.includes('/', 5)).sort(),
        'every data file is precached, and nothing else under data/',
      ).toEqual(dataFiles.map((f) => `data/${f}`).sort());
      for (const f of dataFiles) {
        const md5 = createHash('md5')
          .update(readFileSync(join(clone, 'dist', 'data', f)))
          .digest('hex');
        expect(entries.get(`data/${f}`), `precache revision of data/${f}`).toBe(md5);
      }
      expect(entries.has('data/context-places.json')).toBe(false);

      note(`precache: ${entries.size} entries, ${dataFiles.length} data files pinned by content revision`);
      note('data:check reproduced public/data byte for byte');

      const smoke = npm(clone, 'npm run -s smoke');
      expect(smoke.status, smoke.tail).toBe(0);
      note(
        `smoke: ${smoke.tail
          .split('\n')
          .filter((l) => /Smoke OK/.test(l))
          .join(' ')}`,
      );

      const server = npm(clone, 'npx vitest run -c vitest.server.config.ts');
      expect(server.status, server.tail).toBe(0);
      note(
        `v1 server suite in the reverted clone:${server.tail
          .split('\n')
          .filter((l) => /Test Files|Tests /.test(l))
          .join(' ')}`,
      );
    },
    SLOW,
  );
});
