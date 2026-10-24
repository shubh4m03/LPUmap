/**
 * Shared Playwright fixtures:
 *
 * - `health` (automatic): collects console errors, page errors, unhandled
 *   promise rejections and failed local requests (/data/, /fonts/, /assets/)
 *   during the test, and fails the test at the end if any occurred.
 * - `atlas`: the page object in fixtures/atlas.ts.
 * - `syntheticPublication` (option, default false): serve the synthetic
 *   owner publication of fixtures/publication.ts at /api/locations through
 *   route interception (never a live backend). Off: /api/locations is
 *   whatever the preview server answers (no API, as on static hosting).
 */
import { test as base, expect } from '@playwright/test';
import { Atlas } from './atlas.ts';
import { syntheticPublicationBody } from './publication.ts';

/** Same-origin paths whose failure means the deployed app is broken. */
const LOCAL_ASSET_PATH = /^\/(data|fonts|assets)\//;

export interface Health {
  /** Problems seen so far in this test. */
  readonly problems: readonly string[];
}

export const test = base.extend<{
  health: Health;
  atlas: Atlas;
  syntheticPublication: boolean;
  publicationRoute: void;
}>({
  syntheticPublication: [false, { option: true }],

  // Context-level, so a request made by a service worker would be intercepted too (Chromium).
  publicationRoute: [
    async ({ context, syntheticPublication }, provide) => {
      if (syntheticPublication)
        await context.route('**/api/locations', (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: { 'Cache-Control': 'no-cache' },
            body: JSON.stringify(syntheticPublicationBody()),
          }),
        );
      await provide();
    },
    { auto: true },
  ],

  health: [
    async ({ page, baseURL }, provide, testInfo) => {
      const problems: string[] = [];
      const origin = new URL(baseURL ?? 'http://localhost').origin;
      const isLocalAsset = (url: string) => {
        const u = new URL(url);
        return u.origin === origin && LOCAL_ASSET_PATH.test(u.pathname);
      };

      await page.addInitScript(() => {
        window.addEventListener('unhandledrejection', (e) => {
          const reason: unknown = e.reason;
          console.error(`[unhandledrejection] ${reason instanceof Error ? reason.message : String(reason)}`);
        });
      });
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        problems.push(`console.error: ${msg.text()}`);
      });
      page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
      page.on('requestfailed', (req) => {
        const failure = req.failure()?.errorText ?? 'unknown';
        // A request the app itself cancelled (MapLibre dropping a glyph range it no longer
        // needs, a panel aborting its fetch on close) is not a broken file.
        if (failure === 'net::ERR_ABORTED') return;
        if (isLocalAsset(req.url())) problems.push(`request failed: ${req.url()} (${failure})`);
      });
      page.on('response', (res) => {
        if (res.status() >= 400 && isLocalAsset(res.url()))
          problems.push(`HTTP ${res.status()}: ${res.url()}`);
      });

      await provide({
        get problems() {
          return problems;
        },
      });

      if (problems.length > 0) await testInfo.attach('health-problems', { body: problems.join('\n') });
      expect(problems, 'console errors, page errors or failed local requests during the test').toEqual([]);
    },
    { auto: true },
  ],

  atlas: async ({ page, health }, provide, testInfo) => {
    await provide(new Atlas(page, testInfo, health));
  },
});

export { expect };
