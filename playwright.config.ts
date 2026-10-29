import { defineConfig, devices } from '@playwright/test';
import { ADMIN_PASSWORD_ENV, adminPassword, BACKEND_PORT, BACKEND_URL } from './tests/e2e/backend/config.ts';

// Viewports required by docs/QA_STRATEGY.md. The suite runs against the
// production build (vite preview) so the service worker and data files are
// exercised exactly as deployed: run `npx vite build` first.
// PW_PORT lets a run use its own preview server when another one already holds 4173.
const PORT = Number(process.env.PW_PORT ?? 4173);
// E2E_DIST serves a build from another directory (both servers), so a run never has to rebuild dist/.
const PREVIEW_OUT_DIR = process.env.E2E_DIST ? ` --outDir "${process.env.E2E_DIST}"` : '';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // WebGL runs on the CPU (SwiftShader) in headless Chromium; cap parallel maps.
  workers: process.env.CI ? 2 : 6,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Every skipped test is counted by reason and project and checked against the explicit skip
  // rules in scripts/ci/skip-policy.ts; in CI (or with E2E_SKIP_POLICY=enforce) a skip outside
  // those rules fails the run. E2E_IMAGERY (none | esri | eox) names the build's imagery setup.
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['./scripts/ci/playwright-skip-reporter.ts']]
    : [['list'], ['./scripts/ci/playwright-skip-reporter.ts']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Camera moves jump instead of flying, so map state settles deterministically.
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'laptop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    {
      name: 'tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 768, height: 1024 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'mobile-small',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 360, height: 800 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
      },
    },
  ],
  webServer: [
    {
      command: `npx vite preview --port ${PORT} --strictPort${PREVIEW_OUT_DIR}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
    {
      // The REAL server handlers over a fresh local in-memory D1 (tests/e2e/backend/server.ts),
      // serving the same build, for the admin and suggestion specs. Password mode with a
      // throwaway password generated for this run (never written to disk).
      command: 'node tests/e2e/backend/server.ts',
      url: `${BACKEND_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 120000,
      env: { [ADMIN_PASSWORD_ENV]: adminPassword(), E2E_BACKEND_PORT: String(BACKEND_PORT) },
    },
  ],
});
