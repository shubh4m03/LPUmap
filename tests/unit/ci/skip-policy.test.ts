// @vitest-environment node
/**
 * The e2e skip policy (scripts/ci/skip-policy.ts): a browser test is skipped
 * only by an explicit rule (known reason, expected project, expected imagery
 * build); everything else is a violation that fails CI. The rules and the
 * specs must agree: every literal skip reason in tests/e2e has a rule, and
 * every rule is still used.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluateSkips,
  formatSkipSummary,
  imageryFromEnv,
  SKIP_RULES,
  type SkippedTest,
} from '../../../scripts/ci/skip-policy.ts';

const skip = (reason: string | undefined, project = 'desktop', title = 't'): SkippedTest => ({
  title,
  project,
  annotations: reason === undefined ? [] : [{ type: 'skip', description: reason }],
});

describe('evaluateSkips', () => {
  it('accepts a listed reason on an expected project and counts it', () => {
    const ev = evaluateSkips(
      [
        skip('phone layout only (mobile and mobile-small projects)', 'desktop'),
        skip('phone layout only (mobile and mobile-small projects)', 'tablet'),
        skip('mouse drag on the desktop layout', 'mobile'),
      ],
      'none',
    );
    expect(ev.violations).toEqual([]);
    expect(ev.total).toBe(3);
    expect(ev.rows).toContainEqual({
      reason: 'phone layout only (mobile and mobile-small projects)',
      project: 'tablet',
      count: 1,
    });
  });

  it('rejects a skip without a reason, an unlisted reason and a test that never ran', () => {
    const noReason: SkippedTest = { title: 'a', project: 'desktop', annotations: [{ type: 'skip' }] };
    const ev = evaluateSkips(
      [noReason, skip('flaky on CI', 'desktop', 'b'), skip(undefined, 'laptop', 'c')],
      'none',
    );
    expect(ev.violations).toHaveLength(3);
    expect(ev.violations[0]).toMatch(/without a reason/);
    expect(ev.violations[1]).toMatch(/unlisted reason "flaky on CI"/);
    expect(ev.violations[2]).toMatch(/did not run/);
  });

  it('rejects a listed reason on a project where the test must run', () => {
    const ev = evaluateSkips(
      [skip('phone layout only (mobile and mobile-small projects)', 'mobile')],
      'none',
    );
    expect(ev.violations).toEqual([expect.stringMatching(/on a project where it must run/)]);
  });

  it('rejects an imagery skip in the build that provides that imagery', () => {
    expect(evaluateSkips([skip('build without VITE_ARCGIS_API_KEY')], 'none').violations).toEqual([]);
    expect(evaluateSkips([skip('build without VITE_ARCGIS_API_KEY')], 'esri').violations).toEqual([
      expect.stringMatching(/in the esri imagery build, where it must run/),
    ]);
    expect(evaluateSkips([skip('this build has an imagery provider')], 'none').violations).toHaveLength(1);
  });

  it('rejects fixme and an unknown E2E_IMAGERY value', () => {
    const fixme: SkippedTest = { title: 'f', project: 'desktop', annotations: [{ type: 'fixme' }] };
    expect(evaluateSkips([fixme], 'none').violations).toEqual([expect.stringMatching(/fixme/)]);
    expect(imageryFromEnv(undefined)).toBe('none');
    expect(imageryFromEnv('eox')).toBe('eox');
    expect(imageryFromEnv('google')).toBeNull();
    expect(evaluateSkips([], null).violations).toEqual([expect.stringMatching(/E2E_IMAGERY/)]);
  });

  it('summarises counts per reason and project', () => {
    const ev = evaluateSkips(
      [
        skip('mouse drag on the desktop layout', 'mobile'),
        skip('mouse drag on the desktop layout', 'mobile-small'),
      ],
      'none',
    );
    const lines = formatSkipSummary(ev, 'none', 10);
    expect(lines).toContain('10 tests ran, 2 were skipped, 0 policy violation(s).');
    expect(lines).toContain('| mouse drag on the desktop layout | 0 | 0 | 0 | 1 | 1 | 2 |');
  });
});

describe('the rules match the specs', () => {
  const dir = join(__dirname, '../../e2e');
  const reasons = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.spec.ts'))) {
    const text = readFileSync(join(dir, f), 'utf8');
    for (const m of text.matchAll(/test\.(?:describe\.)?skip\(([^;]*?),\s*'([^']+)'\s*\)/g))
      reasons.add(m[2]!);
  }

  it('every literal skip reason in tests/e2e has a rule', () => {
    expect(reasons.size).toBeGreaterThan(0);
    const listed = new Set(SKIP_RULES.map((r) => r.reason));
    expect([...reasons].filter((r) => !listed.has(r))).toEqual([]);
  });

  it('every rule is still used by a spec, and says why', () => {
    for (const rule of SKIP_RULES) {
      expect(reasons.has(rule.reason), `rule "${rule.reason}" is used`).toBe(true);
      expect(rule.why.length).toBeGreaterThan(10);
    }
  });
});
