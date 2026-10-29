/**
 * Playwright reporter that counts every skipped e2e test by reason and project
 * and applies the skip policy (scripts/ci/skip-policy.ts). It prints the
 * summary at the end of every run, writes it to test-results/skip-summary.json
 * (and to the GitHub job summary when GITHUB_STEP_SUMMARY is set) and, in CI or
 * with E2E_SKIP_POLICY=enforce, turns any violation into a failed run.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FullResult, Reporter, Suite, TestCase } from '@playwright/test/reporter';
import { evaluateSkips, formatSkipSummary, imageryFromEnv, type SkippedTest } from './skip-policy.ts';

export default class SkipPolicyReporter implements Reporter {
  private root: Suite | null = null;

  onBegin(_config: unknown, suite: Suite): void {
    this.root = suite;
  }

  printsToStdio(): boolean {
    return false;
  }

  async onEnd(result: FullResult): Promise<{ status?: FullResult['status'] } | undefined> {
    const tests: TestCase[] = this.root?.allTests() ?? [];
    const skipped: SkippedTest[] = tests
      .filter((t) => t.outcome() === 'skipped')
      .map((t) => ({
        title: t.titlePath().filter(Boolean).slice(1).join(' › '),
        project: t.parent.project()?.name ?? '(no project)',
        annotations: [...t.annotations, ...t.results.flatMap((r) => r.annotations ?? [])],
      }));
    const imagery = imageryFromEnv(process.env.E2E_IMAGERY);
    const ev = evaluateSkips(skipped, imagery);
    const ran = tests.length - skipped.length;
    const lines = formatSkipSummary(ev, imagery, ran);
    console.log(`\n${lines.join('\n')}\n`);
    const out = join('test-results', 'skip-summary.json');
    try {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify({ imagery, ran, ...ev }, null, 2)}\n`);
      if (process.env.GITHUB_STEP_SUMMARY)
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
    } catch {
      // The summary on stdout is the record; a read-only directory must not hide the verdict.
    }
    const enforce = !!process.env.CI || process.env.E2E_SKIP_POLICY === 'enforce';
    if (enforce && ev.violations.length > 0 && result.status === 'passed') {
      console.error(`E2E skip policy: ${ev.violations.length} violation(s); failing the run.`);
      return { status: 'failed' };
    }
    return undefined;
  }
}
