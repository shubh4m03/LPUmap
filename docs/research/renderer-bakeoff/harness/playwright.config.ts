/**
 * Gate 3 perf project (research harness). Run after building the harness:
 *   BAKEOFF_OUT=<tmp> npx vite build -c docs/research/renderer-bakeoff/harness/vite.config.ts
 *   BAKEOFF_OUT=<tmp> npx playwright test -c docs/research/renderer-bakeoff/harness/playwright.config.ts
 * Chromium only (CDP CPU throttling). Headless Chromium renders WebGL with
 * SwiftShader (CPU), so absolute WebGL frame times are NOT device numbers.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.BAKEOFF_PORT ?? 4471);

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.perf\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 600_000,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${PORT}`,
    contextOptions: { reducedMotion: 'no-preference' },
  },
  webServer: {
    command: `npx vite preview -c docs/research/renderer-bakeoff/harness/vite.config.ts --port ${PORT} --strictPort`,
    cwd: '../../../../',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
