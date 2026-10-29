/**
 * The e2e skip policy (docs/QA_STRATEGY.md §Skipped browser tests). A browser
 * test may be skipped only by an explicit rule below: a known reason, the
 * Playwright projects where that skip is expected and, for imagery-dependent
 * skips, the build it applies to. Everything else is a violation: a skip
 * without a reason, an unknown reason, a known reason on the wrong project or
 * build, `test.fixme`, or a test skipped because an earlier one failed.
 *
 * Pure; the Playwright reporter that applies it is
 * scripts/ci/playwright-skip-reporter.ts. CI fails on any violation; local runs
 * print the same summary (E2E_SKIP_POLICY=enforce makes them fail too).
 */

/** The imagery configuration of the build under test (E2E_IMAGERY). CI runs all three (ci.yml). */
export type ImageryBuild = 'none' | 'esri' | 'eox';
export const IMAGERY_BUILDS: readonly ImageryBuild[] = ['none', 'esri', 'eox'];

export const PROJECTS = ['desktop', 'laptop', 'tablet', 'mobile', 'mobile-small'] as const;
export type ProjectName = (typeof PROJECTS)[number];
const PHONES: readonly ProjectName[] = ['mobile', 'mobile-small'];
const NOT_PHONES: readonly ProjectName[] = ['desktop', 'laptop', 'tablet'];
const NOT_EVIDENCE: readonly ProjectName[] = ['laptop', 'tablet', 'mobile-small'];

export interface SkipRule {
  /** The exact reason string passed to test.skip(condition, reason). */
  reason: string;
  /** Projects where this skip is expected (all projects when omitted). */
  projects?: readonly ProjectName[];
  /** Builds where this skip is expected (all builds when omitted). */
  imagery?: readonly ImageryBuild[];
  /** Why the skip is legitimate and where the skipped behaviour IS tested. */
  why: string;
}

export const SKIP_RULES: readonly SkipRule[] = [
  {
    reason: 'evidence: desktop and mobile projects only',
    projects: NOT_EVIDENCE,
    why: 'art-evidence.spec.ts records fidelity evidence on one desktop and one phone profile.',
  },
  {
    reason: 'measured on the desktop and phone profiles',
    projects: NOT_EVIDENCE,
    why: 'isometric-art.spec.ts measures the overview cost on one desktop and one phone profile.',
  },
  {
    reason: 'the keyboard shortcut is advertised on the desktop layout',
    projects: PHONES,
    why: 'Phones have no Ctrl/Cmd+K hint; the phone search entry is covered by mobile.spec.ts.',
  },
  {
    reason: 'every quick-action category has data in this dataset',
    why: 'layers.spec.ts checks the honest empty state only while some quick-action category is empty (data-dependent).',
  },
  {
    reason: 'mouse drag on the desktop layout',
    projects: PHONES,
    why: 'Phones pan by touch; map-modes.spec.ts covers the phone layout separately.',
  },
  {
    reason: 'this build has an imagery provider',
    imagery: ['esri', 'eox'],
    why: 'The "not configured" case runs in the default build (E2E_IMAGERY=none).',
  },
  {
    reason: 'build without VITE_ARCGIS_API_KEY',
    imagery: ['none', 'eox'],
    why: 'The Esri path runs in the CI job built with the test-only key (E2E_IMAGERY=esri).',
  },
  {
    reason: 'no imagery in this build',
    imagery: ['none'],
    why: 'The service-worker imagery check runs in the Esri and EOX CI jobs.',
  },
  {
    reason: 'build without VITE_EOX_BACKDROP',
    imagery: ['none', 'esri'],
    why: 'The EOX path runs in the CI job built with VITE_EOX_BACKDROP=true (E2E_IMAGERY=eox).',
  },
  {
    reason: 'phone layout only (mobile and mobile-small projects)',
    projects: NOT_PHONES,
    why: 'Phone-only bottom-sheet behaviour.',
  },
  { reason: 'phone layout', projects: NOT_PHONES, why: 'studio-mobile.spec.ts is the phone Studio flow.' },
  {
    reason: 'desktop and tablet layouts',
    projects: PHONES,
    why: 'studio-records.spec.ts uses the desktop/tablet Studio; phones are covered by studio-mobile.spec.ts.',
  },
  {
    reason: 'desktop and tablet layouts (phones: studio-mobile.spec.ts)',
    projects: PHONES,
    why: 'Phones are covered by studio-mobile.spec.ts.',
  },
  {
    reason: 'Phones place with the centre pin.',
    projects: PHONES,
    why: 'suggest.spec.ts covers the centre-pin placement on phones in its own test.',
  },
];

export interface SkippedTest {
  /** Title path, for messages. */
  title: string;
  project: string;
  /** Annotations of the test and its results (type + description). */
  annotations: ReadonlyArray<{ type: string; description?: string | undefined }>;
}

export interface SkipSummaryRow {
  reason: string;
  project: string;
  count: number;
}

export interface SkipEvaluation {
  rows: SkipSummaryRow[];
  violations: string[];
  total: number;
}

const isImagery = (v: string | undefined): v is ImageryBuild => IMAGERY_BUILDS.includes(v as ImageryBuild);

/** E2E_IMAGERY, defaulting to the default build. An unknown value is itself reported by evaluateSkips. */
export function imageryFromEnv(value: string | undefined): ImageryBuild | null {
  if (value === undefined || value === '') return 'none';
  return isImagery(value) ? value : null;
}

/** Applies the policy to every skipped test of a run. */
export function evaluateSkips(
  skipped: readonly SkippedTest[],
  imagery: ImageryBuild | null,
  rules: readonly SkipRule[] = SKIP_RULES,
): SkipEvaluation {
  const violations: string[] = [];
  if (imagery === null) violations.push(`E2E_IMAGERY must be one of ${IMAGERY_BUILDS.join(', ')}.`);
  const counts = new Map<string, SkipSummaryRow>();
  for (const t of skipped) {
    const where = `"${t.title}" [${t.project}]`;
    if (t.annotations.some((a) => a.type === 'fixme')) {
      violations.push(`${where} is marked fixme; fix it or delete it, never park it in CI.`);
      continue;
    }
    const reasons = t.annotations
      .filter((a) => a.type === 'skip')
      .map((a) => a.description?.trim() ?? '')
      .filter((r) => r !== '');
    const reason = reasons[0];
    const key = `${reason ?? '(no reason)'}\u0000${t.project}`;
    const row = counts.get(key) ?? { reason: reason ?? '(no reason)', project: t.project, count: 0 };
    row.count++;
    counts.set(key, row);
    if (t.annotations.some((a) => a.type === 'skip') && reason === undefined) {
      violations.push(`${where} was skipped without a reason.`);
      continue;
    }
    if (reason === undefined) {
      violations.push(
        `${where} did not run (no skip annotation: an earlier failure, an interruption or a timeout).`,
      );
      continue;
    }
    const rule = rules.find((r) => r.reason === reason);
    if (!rule) {
      violations.push(
        `${where} was skipped for an unlisted reason "${reason}" (add a rule in scripts/ci/skip-policy.ts or run it).`,
      );
      continue;
    }
    if (rule.projects && !(rule.projects as readonly string[]).includes(t.project))
      violations.push(`${where} was skipped ("${reason}") on a project where it must run.`);
    if (rule.imagery && imagery !== null && !rule.imagery.includes(imagery))
      violations.push(
        `${where} was skipped ("${reason}") in the ${imagery} imagery build, where it must run.`,
      );
  }
  const rows = [...counts.values()].sort(
    (a, b) => a.reason.localeCompare(b.reason) || a.project.localeCompare(b.project),
  );
  return { rows, violations, total: skipped.length };
}

/** Markdown summary: one row per reason with its count per project. */
export function formatSkipSummary(ev: SkipEvaluation, imagery: ImageryBuild | null, ran: number): string[] {
  const reasons = [...new Set(ev.rows.map((r) => r.reason))];
  const lines = [
    `### E2E skip summary (imagery build: ${imagery ?? 'invalid'})`,
    '',
    `${ran} tests ran, ${ev.total} were skipped, ${ev.violations.length} policy violation(s).`,
    '',
  ];
  if (reasons.length > 0) {
    lines.push(
      `| Reason | ${PROJECTS.join(' | ')} | Total |`,
      `| --- | ${PROJECTS.map(() => '---:').join(' | ')} | ---: |`,
    );
    for (const reason of reasons) {
      const per = PROJECTS.map(
        (p) => ev.rows.find((r) => r.reason === reason && r.project === p)?.count ?? 0,
      );
      const other = ev.rows
        .filter((r) => r.reason === reason && !(PROJECTS as readonly string[]).includes(r.project))
        .reduce((s, r) => s + r.count, 0);
      lines.push(`| ${reason} | ${per.join(' | ')} | ${per.reduce((s, n) => s + n, 0) + other} |`);
    }
    lines.push('');
  }
  for (const v of ev.violations) lines.push(`- VIOLATION: ${v}`);
  return lines;
}
