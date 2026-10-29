// @vitest-environment node
/**
 * The gates the project claims to run are the gates it runs
 * (docs/QA_STRATEGY.md §CI stages):
 *
 * - `npm run check` includes the server typecheck and the server suites (G-01),
 *   the browser presence check (G-03), the serial wall-clock budget suites and
 *   the bundle-size budgets (G-04);
 * - CI's `verify` job runs every `check` gate in the same order;
 * - CI installs Chromium before the unit tests, and runs the imagery-dependent
 *   map-modes tests against Esri and EOX builds instead of skipping them;
 * - every Vitest file that times code with a wall clock runs in the serial
 *   `test:perf` step and nowhere in the parallel `test` step;
 * - Playwright always applies the skip policy reporter.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
const ci = read('.github/workflows/ci.yml');

/** `npm run x && vite build && …` → ['x', 'vite build', …] (npm-run names without the prefix). */
function checkGates(): string[] {
  return scripts.check!.split('&&').map((s) =>
    s
      .trim()
      .replace(/^npm run (-s )?/, '')
      .trim(),
  );
}

/** The `run:` commands of one job, in order, normalised to the same names as checkGates(). */
function jobRuns(job: string): string[] {
  const start = ci.indexOf(`\n  ${job}:\n`);
  expect(start, `job ${job} exists`).toBeGreaterThanOrEqual(0);
  const rest = ci.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  const body = next < 0 ? rest : rest.slice(0, next + 1);
  return [...body.matchAll(/^\s+run: (.+)$/gm)].map((m) =>
    m[1]!
      .trim()
      .replace(/^npm run (-s )?/, '')
      .replace(/^npx vite build$/, 'vite build')
      .replace(/^npx playwright test$/, 'test:e2e')
      .split(/\s+--\s+/)[0]!
      .trim(),
  );
}

describe('npm run check', () => {
  const gates = checkGates();

  it('runs the server typecheck and the server suites (they are part of the gate, not optional)', () => {
    expect(gates).toContain('typecheck:server');
    expect(gates).toContain('test:server');
    expect(scripts['typecheck:server']).toBe('tsc --noEmit -p tsconfig.server.json');
    expect(scripts['test:server']).toBe('vitest run -c vitest.server.config.ts');
  });

  it('fails when the Playwright browser is missing, before any test can skip', () => {
    expect(gates).toContain('test:browsers');
    expect(gates.indexOf('test:browsers')).toBeLessThan(gates.indexOf('test'));
  });

  it('runs the wall-clock budget suites serially and checks bundle budgets after the build', () => {
    expect(gates).toContain('test:perf');
    expect(scripts['test:perf']).toMatch(/--no-file-parallelism/);
    expect(gates).toContain('perf:bundle');
    expect(gates.indexOf('perf:bundle')).toBeGreaterThan(gates.indexOf('vite build'));
  });
});

describe('CI (.github/workflows/ci.yml)', () => {
  it('the verify job runs every `npm run check` gate, in the same order', () => {
    const runs = jobRuns('verify');
    let at = -1;
    for (const gate of checkGates()) {
      const i = runs.indexOf(gate, at + 1);
      expect(i, `CI runs "${gate}" after the previous gate (runs: ${runs.join(' | ')})`).toBeGreaterThan(at);
      at = i;
    }
  });

  it('installs Chromium and checks for it before the unit tests', () => {
    const runs = jobRuns('verify');
    const install = runs.findIndex((r) => r.startsWith('npx playwright install'));
    expect(install).toBeGreaterThanOrEqual(0);
    expect(install).toBeLessThan(runs.indexOf('test:browsers'));
    expect(runs.indexOf('test:browsers')).toBeLessThan(runs.indexOf('test'));
  });

  it('runs the imagery-dependent map-modes tests on Esri and EOX builds (synthetic tiles, test-only key)', () => {
    expect(ci).toMatch(/\n {2}imagery-e2e:\n/);
    expect(ci).toMatch(/- imagery: esri\n/);
    expect(ci).toMatch(/- imagery: eox\n/);
    expect(ci).toMatch(/E2E_IMAGERY: \$\{\{ matrix\.imagery \}\}/);
    expect(ci).toMatch(/npx playwright test tests\/e2e\/map-modes\.spec\.ts/);
    const specKey = /const FAKE_KEY = '([^']+)'/.exec(read('tests/e2e/map-modes.spec.ts'))?.[1];
    expect(specKey).toMatch(/^TEST_ONLY_/);
    expect(ci).toContain(`arcgis_key: ${specKey}`);
  });

  it('uses no secrets', () => {
    expect(ci).not.toMatch(/secrets\./);
  });
});

describe('wall-clock budget suites are isolated from the parallel run', () => {
  const excluded = [...(scripts.test ?? '').matchAll(/--exclude (\S+)/g)].map((m) => m[1]!).sort();
  const serial = (scripts['test:perf'] ?? '')
    .split(/\s+/)
    .filter((t) => t.startsWith('tests/'))
    .sort();

  it('`test` excludes exactly the files `test:perf` runs, and they exist', () => {
    expect(serial.length).toBeGreaterThan(0);
    expect(excluded).toEqual(serial);
    for (const f of serial) expect(existsSync(join(root, f)), f).toBe(true);
  });

  it('every Vitest file that measures wall-clock time is in the serial step', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.test\.tsx?$/.test(n)) files.push(relative(root, p).split('\\').join('/'));
      }
    };
    for (const d of ['tests/unit', 'tests/integration', 'tests/coverage']) walk(join(root, d));
    const timed = files.filter((f) => /performance\.now\(\)|\btimeOnce\(|\bmedianTime\(/.test(read(f)));
    expect(timed.length).toBeGreaterThan(0);
    expect(timed.filter((f) => !serial.includes(f))).toEqual([]);
  });
});

describe('Playwright skip policy', () => {
  it('the skip-policy reporter is registered for CI and local runs', () => {
    const config = read('playwright.config.ts');
    const uses = config.match(/'\.\/scripts\/ci\/playwright-skip-reporter\.ts'/g) ?? [];
    expect(uses.length).toBe(2);
    expect(existsSync(join(root, 'scripts/ci/playwright-skip-reporter.ts'))).toBe(true);
  });
});
