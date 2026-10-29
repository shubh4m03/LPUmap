/**
 * Fails when the Playwright Chromium is not installed.
 *
 *   node scripts/ci/require-browsers.ts
 *
 * Browser-dependent Vitest suites (tests/integration/isometric-art-derive.test.ts)
 * skip themselves when Chromium is missing, so a developer without browsers can
 * still run `npm test`. CI must never take that silent path: it installs
 * Chromium before the unit tests and runs this check first (ci.yml), so a
 * missing or broken install fails the job instead of skipping the suite.
 */
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

const path = chromium.executablePath();
if (!path || !existsSync(path)) {
  console.error(
    `Playwright Chromium is not installed (expected at ${path || '<unknown>'}). Run "npx playwright install --with-deps chromium".`,
  );
  process.exitCode = 1;
} else {
  console.log(`Playwright Chromium present: ${path}`);
}
