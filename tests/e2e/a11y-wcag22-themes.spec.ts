/**
 * G-17: axe-core with the WCAG 2.2 AA rule set (wcag2a … wcag22aa) on the
 * surfaces the older scans missed or ran without 2.2 — the owner admin
 * (sign-in, queue, locations, overrides, history, quality, Building Studio,
 * Templates, Artwork), the public "Suggest a missing place" panel and the
 * illustrated overview — each in the LIGHT and the DARK theme (the theme
 * follows the system colour scheme, emulated here). Real server, real build
 * (tests/e2e/backend). No rule is disabled; MapLibre's own canvas inside the
 * admin is excluded exactly as in admin-auth.spec.ts (the public map suite
 * covers it).
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';
import { expect, isPhone, NEAR_PATHS, test } from './backend/fixtures.ts';

const WCAG22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function scan(
  page: Page,
  testInfo: TestInfo,
  state: string,
  opts: { include?: string; exclude?: string } = {},
) {
  let builder = new AxeBuilder({ page }).withTags(WCAG22_AA);
  if (opts.include) builder = builder.include(opts.include);
  if (opts.exclude) builder = builder.exclude(opts.exclude);
  const results = await builder.analyze();
  const found = results.violations.map(
    (v) => `${state} [${v.impact}] ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  await testInfo.attach(`axe ${state}`, {
    body: found.join('\n') || 'no violations',
    contentType: 'text/plain',
  });
  return found;
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`WCAG 2.2 AA, ${theme} theme`, () => {
    test.use({ colorScheme: theme });

    const themed = async (page: Page) => expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    test(`admin sign-in and every admin section (${theme})`, async ({ page, admin }, testInfo) => {
      test.setTimeout(180_000);
      const found: string[] = [];
      await page.goto('/admin');
      await expect(page.getByLabel('Owner password')).toBeVisible();
      await themed(page);
      found.push(...(await scan(page, testInfo, 'sign-in')));

      await admin.signIn('/admin/queue');
      const screens: ReadonlyArray<readonly [string, (p: Page) => Promise<void>]> = [
        [
          '/admin/queue',
          (p) => expect(p.getByRole('heading', { name: 'Moderation queue', level: 1 })).toBeVisible(),
        ],
        [
          '/admin/locations/new',
          (p) => expect(p.getByRole('heading', { name: 'New location', level: 1 })).toBeVisible(),
        ],
        [
          '/admin/overrides?tab=orphans',
          (p) => expect(p.getByRole('heading', { name: 'Base-place overrides', level: 1 })).toBeVisible(),
        ],
        ['/admin/audit', (p) => expect(p.getByRole('heading', { name: 'History', level: 1 })).toBeVisible()],
        [
          '/admin/quality',
          (p) => expect(p.getByRole('heading', { name: 'Quality', level: 1 })).toBeVisible(),
        ],
        ['/admin/studio', (p) => expect(p.getByTestId('studio-workspace')).toBeVisible()],
        [
          '/admin/templates',
          (p) => expect(p.getByRole('heading', { name: 'Templates', level: 1 })).toBeVisible(),
        ],
        [
          '/admin/artwork',
          (p) => expect(p.getByRole('heading', { name: 'Artwork', level: 1 })).toBeVisible(),
        ],
      ];
      for (const [path, ready] of screens) {
        await admin.goto(path);
        await ready(page);
        await themed(page);
        found.push(...(await scan(page, testInfo, path, { exclude: '.maplibregl-map' })));
      }
      expect(found).toEqual([]);
    });

    test(`suggest a missing place (${theme})`, async ({ page, atlas }, testInfo) => {
      await atlas.open({ view: '2d' });
      await themed(page);
      await page.getByRole('button', { name: 'Menu' }).click();
      await page.getByRole('button', { name: 'Suggest a missing place' }).click();
      await expect(page.getByRole('heading', { name: /Where is it\?/ })).toBeVisible();
      const panel = isPhone(page) ? '[role="region"], [role="dialog"]' : 'aside';
      const found = await scan(page, testInfo, 'suggest: where', { include: panel });
      if (isPhone(page)) {
        await expect(page.getByTestId('edit-reticle')).toBeVisible();
        await page.getByRole('button', { name: 'Use this position' }).click();
      } else {
        const at = await atlas.project([NEAR_PATHS[0], NEAR_PATHS[1]]);
        expect(at).not.toBeNull();
        await page.mouse.click(at!.x, at!.y);
        await page.getByRole('button', { name: 'Continue' }).click();
      }
      await expect(page.getByRole('heading', { name: /About the place/ })).toBeVisible();
      found.push(...(await scan(page, testInfo, 'suggest: about', { include: panel })));
      await page.getByRole('button', { name: 'Send for review' }).click();
      found.push(...(await scan(page, testInfo, 'suggest: errors', { include: panel })));
      expect(found).toEqual([]);
    });

    test(`illustrated overview with a selection (${theme})`, async ({ page }, testInfo) => {
      await page.goto('/?view=iso&iso=art');
      await expect(page.getByTestId('art-view')).toBeVisible();
      await themed(page);
      const found = await scan(page, testInfo, 'overview');
      await page.locator('[data-hotspot-id="hs-pin-25"]').focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('art-detail-card')).toBeVisible();
      found.push(...(await scan(page, testInfo, 'overview: selection')));
      expect(found).toEqual([]);
    });
  });
}
