import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { ISO_HARNESS_PORT } from './iso-harness-port.ts';

/**
 * Isometric overview checks against the production-built harness page
 * (docs/ISOMETRIC_AND_3D_DESIGN.md §9.2, Decision D8):
 *
 *   npx playwright test -c tests/perf/playwright.iso.config.ts                   # all
 *   npx playwright test -c tests/perf/playwright.iso.config.ts --project=perf    # budgets only
 *
 * The `perf` project uses Chromium (CDP CPU throttling) with motion enabled and
 * writes its measurements to test-results/perf/iso.json. The harness projects
 * run the axe scan, interaction checks and screenshots on desktop and mobile.
 * Port 4420 is used so the owner's preview server is never touched.
 */
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  outputDir: '../../test-results/iso-harness-artifacts',
  use: {
    baseURL: `http://localhost:${ISO_HARNESS_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'perf',
      testMatch: /iso\.perf\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        contextOptions: { reducedMotion: 'no-preference' },
      },
    },
    {
      name: 'harness-desktop',
      testMatch: /iso-harness\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        contextOptions: { reducedMotion: 'reduce' },
      },
    },
    {
      name: 'harness-mobile',
      testMatch: /iso-harness\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
        contextOptions: { reducedMotion: 'reduce' },
      },
    },
  ],
  webServer: {
    command:
      'npx vite build --config tests/perf/vite.iso-harness.config.ts && ' +
      `npx vite preview --config tests/perf/vite.iso-harness.config.ts --port ${ISO_HARNESS_PORT} --strictPort`,
    cwd: resolve(import.meta.dirname, '../..'),
    url: `http://localhost:${ISO_HARNESS_PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
