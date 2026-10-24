/**
 * Building Studio end to end against the REAL server (tests/e2e/backend:
 * the production build + the real handlers over a fresh local D1). Nothing
 * is mocked except one injected 500 to prove a failed save is shown as a
 * failure.
 *
 * Desktop: template selection → placement preview (typed coordinates, metre
 * offsets) → customise → save draft → reload (reopened from the server) →
 * undo/redo across a save → failed save → validate → publish with
 * acknowledgements → visible in Realistic 3D, the isometric overview, search
 * and the directory with the same id → archive (gone) → restore. A second
 * browser context sees the persisted state; unauthenticated visitors reach
 * no Studio control and the API refuses them.
 */
import { join } from 'node:path';
import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';
import { haversineM } from '../../src/distance/geodesic.ts';
import { adminPassword, CLIENT_HEADER } from './backend/config.ts';
import { expect, isPhone, SCREENSHOT_DIR, test } from './backend/fixtures.ts';

const state = (page: Page) => page.getByTestId('studio-state-label');

/** Each desktop project places its building in its own spot (the database is shared by the run). */
const SPOTS: Record<string, readonly [number, number]> = {
  desktop: [75.7032, 31.2533],
  laptop: [75.70385, 31.25355],
  tablet: [75.7029, 31.2536],
};

/** Narrow layouts (tablet) start with the side panels collapsed: open them when needed. */
async function showPanel(page: Page, which: 'library' | 'inspector'): Promise<void> {
  const id = which === 'library' ? 'studio-left-panel' : 'studio-inspector';
  // The toggle states whether its panel is open (aria-expanded); wait for the workspace first.
  const toggle = page.locator(`button[aria-controls="${id}"]`);
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(page.locator(`#${id}`)).toBeVisible();
}

async function signedInContext(
  browser: Browser,
  client: string,
  path: string,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    extraHTTPHeaders: { [CLIENT_HEADER]: client },
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  await page.goto(path);
  await page.getByLabel('Owner password').fill(adminPassword());
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('studio-workspace')).toBeVisible();
  return { ctx, page };
}

/** Fills every open acknowledgement field (warnings depend on what else is on the shared map). */
async function acknowledgeAll(scope: Page | ReturnType<Page['getByRole']>): Promise<void> {
  const fields = scope.locator('[data-testid^="studio-ack-"]');
  const n = await fields.count();
  for (let i = 0; i < n; i++) await fields.nth(i).fill('E2E check: acknowledged for the automated test');
}

test.describe('Building Studio (desktop, laptop, tablet)', () => {
  test.skip(({ page }) => isPhone(page), 'desktop and tablet layouts (phones: studio-mobile.spec.ts)');
  test.setTimeout(240_000);

  test('unauthenticated visitors reach no Studio control, and the API refuses them', async ({
    page,
    api,
  }) => {
    await page.goto('/admin/studio');
    await expect(page.getByLabel('Owner password')).toBeVisible();
    await expect(page.getByTestId('studio-workspace')).toHaveCount(0);
    await expect(page.getByRole('toolbar')).toHaveCount(0);
    for (const path of ['/api/admin/studio/buildings', '/api/admin/studio/library'])
      expect((await api.get(path)).status(), path).toBe(401);
    expect(
      (await api.post('/api/admin/studio/validate', { data: {} })).status(),
      'a write without a session',
    ).toBe(401);
  });

  test('place → customise → save → reload → publish → visible everywhere → archive → restore', async ({
    page,
    admin,
    shot,
    unique,
    browser,
    client,
    problems,
  }, testInfo) => {
    const spot = SPOTS[testInfo.project.name] ?? SPOTS.desktop!;
    const name = unique('E2E studio hostel');
    // e2e=1 installs the read-only map test hook (window.__ATLAS_MAP__).
    await admin.signIn('/admin/studio?e2e=1');
    await expect(page.getByTestId('studio-workspace')).toBeVisible();
    await expect(state(page)).toHaveText('Nothing open');

    // --- template selection ---
    await showPanel(page, 'library');
    await page.getByRole('searchbox', { name: 'Search templates' }).fill('hostel');
    await page.getByTestId('studio-template-hostel-multistorey').click();
    const preview = page.getByTestId('studio-template-preview');
    await expect(preview).toContainText('Multi-storey hostel');
    await expect(preview).toContainText('Generic prefab');
    await expect(preview.locator('img')).toHaveAttribute('src', /^data:image\/svg\+xml/);
    await shot('studio-1-template-selection');

    // --- placement preview: typed coordinates, then a metre offset ---
    await page.getByTestId('studio-place-template').click();
    await expect(state(page)).toHaveText(/Placing \(preview only, nothing saved\)/);
    await page.getByTestId('studio-place-lon').fill(String(spot[0]));
    await page.getByTestId('studio-place-lat').fill(String(spot[1]));
    await page.getByTestId('studio-place-east').fill('10');
    await page.getByRole('button', { name: 'Move by 10 m east, 0 m north' }).click();
    const lon = Number(await page.getByTestId('studio-place-lon').inputValue());
    const lat = Number(await page.getByTestId('studio-place-lat').inputValue());
    // Fields show 5 decimals of a degree (about 1 m); the move itself is in metres (≈ 10 m east).
    const movedM = haversineM([lon, lat], [spot[0], spot[1]]);
    expect(movedM).toBeGreaterThan(8);
    expect(movedM).toBeLessThan(12);
    await expect(page.getByTestId('studio-placement-check')).toContainText(
      /checked by the server|Warning|Error/,
    );
    await expect
      .poll(() => page.evaluate(() => window.__ATLAS_MAP__?.getRealistic3D()?.layer?.instances ?? 0))
      .toBeGreaterThan(0);
    await shot('studio-2-placement-preview');
    await page.getByTestId('studio-confirm-placement').click();
    await expect(state(page)).toHaveText('Unsaved local changes (not on the server yet)');

    // --- customise: name (test data), appearance preset, a step move with undo/redo ---
    await showPanel(page, 'inspector');
    await page.getByTestId('studio-tool-info').click();
    await page.getByTestId('studio-name').fill(name);
    await page.getByTestId('studio-tool-appearance').click();
    await page.getByRole('button', { name: /Red brick/ }).click();
    await expect(page.getByTestId('studio-wall-colour')).toHaveValue('#a5523a');
    await page.getByRole('button', { name: 'Move 1 m north' }).click();
    await page.getByTestId('studio-undo').click();
    await page.getByTestId('studio-redo').click();
    await shot('studio-3-selected-model-customisation');

    // --- save draft: created on the server, URL names the record ---
    await page.getByTestId('studio-save').click();
    await expect(state(page)).toHaveText('Saved draft (rev 1)');
    await expect(page).toHaveURL(/\/admin\/studio\/stu%3A[a-z2-7]+$/);
    const id = decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!);

    // --- undo across a save makes it unsaved again; redo makes it clean ---
    await page.getByTestId('studio-undo').click();
    await expect(state(page)).toHaveText('Unsaved local changes');
    await page.getByTestId('studio-redo').click();
    await expect(state(page)).toHaveText('Saved draft (rev 1)');

    // --- reload: the draft is reopened from the server (e2e=1 again, for the read-only map hook) ---
    await page.goto(`${new URL(page.url()).pathname}?e2e=1`);
    await expect(state(page)).toHaveText('Saved draft (rev 1)');
    // Undo + redo ended exactly at the saved state: no stale crash-recovery offer.
    await expect(page.getByTestId('studio-recovery')).toHaveCount(0);
    await showPanel(page, 'inspector');
    await page.getByTestId('studio-tool-info').click();
    await expect(page.getByTestId('studio-name')).toHaveValue(name);
    // The reopened draft is drawn again (not just listed) before the screenshot.
    await expect
      .poll(() => page.evaluate(() => window.__ATLAS_MAP__?.getRealistic3D()?.layer?.instances ?? 0), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    await shot('studio-4-saved-draft');
    // The Buildings list shows the saved draft (the owner's list of studio records).
    await showPanel(page, 'library');
    await page.locator('#studio-left-panel').getByText('Buildings', { exact: true }).click();
    await expect(page.getByTestId(`studio-record-${id}`)).toBeVisible();
    await shot('studio-4b-buildings-list');
    await page.locator('#studio-left-panel').getByText('Library', { exact: true }).click();

    // --- a second browser context sees the persisted draft ---
    const second = await signedInContext(browser, client, `/admin/studio/${encodeURIComponent(id)}`);
    await expect(state(second.page)).toHaveText('Saved draft (rev 1)');

    // --- a failed save (injected 500) is shown as a failure, never as success ---
    await page.route('**/api/admin/studio/buildings/*/draft', (route) =>
      route.fulfill({
        status: 500,
        json: { error: { code: 'internal', message: 'Injected failure (test)' } },
      }),
    );
    await page.getByTestId('studio-tool-appearance').click();
    await page.getByRole('button', { name: /Sandstone/ }).click();
    await page.getByTestId('studio-save').click();
    await expect(page.getByTestId('studio-error')).toContainText('Not saved.');
    await expect(state(page)).toHaveText('Unsaved local changes');
    await expect(page.getByTestId('studio-notice')).toHaveCount(0);
    await page.unroute('**/api/admin/studio/buildings/*/draft');
    // The injected 500 is logged by the browser as a resource error: expected here, and only here.
    const injected = problems.findIndex((p) => /status of 500/.test(p));
    if (injected >= 0) problems.splice(injected, 1);
    await page.getByTestId('studio-save').click();
    await expect(state(page)).toHaveText('Saved draft (rev 2)');

    // --- validate and publish with acknowledgements ---
    await expect(page.getByTestId('studio-publish')).toBeEnabled({ timeout: 20_000 });
    await page.getByTestId('studio-publish').click();
    const dialog = page.getByRole('dialog', { name: /Publish/ });
    await expect(dialog.getByTestId('studio-change-list')).toContainText(
      'First publication of this building.',
    );
    await dialog.getByTestId('studio-change-summary').fill('E2E: first publication of the test hostel');
    await acknowledgeAll(page);
    await dialog.getByTestId('studio-confirm-publish').click();
    await expect(dialog).toBeHidden();
    await expect(state(page)).toHaveText('Published (version 1)');

    // --- the public app after a refresh: Realistic 3D, overview, search and directory, same id ---
    const pub = await page.context().newPage();
    await pub.goto(`/?place=${encodeURIComponent(id)}&view=3d&e2e=1`);
    await expect
      .poll(() => pub.evaluate(() => window.__ATLAS_MAP__?.getSelectedId() ?? null), { timeout: 30_000 })
      .toBe(id);
    await expect
      .poll(() => pub.evaluate(() => window.__ATLAS_MAP__?.getRealistic3D()?.layer?.instances ?? 0))
      .toBeGreaterThan(0);
    await expect(pub.getByRole('article', { name })).toBeVisible();
    await shotOf(pub, testInfo, 'studio-5-published-realistic-3d');

    await pub.goto(`/?place=${encodeURIComponent(id)}&view=iso&e2e=1`);
    await expect
      .poll(() => pub.evaluate(() => window.__ATLAS_ISO__?.getSelectedId() ?? null), { timeout: 30_000 })
      .toBe(id);
    await shotOf(pub, testInfo, 'studio-6-published-isometric');

    await pub.goto('/?e2e=1');
    await pub.getByRole('button', { name: /^Search places/ }).click();
    const palette = pub.getByRole('dialog', { name: 'Search the campus atlas' });
    await palette.getByRole('combobox').fill(name);
    const option = palette.getByRole('option', { name: new RegExp(`^${name}`) });
    await expect(option).toHaveCount(1);
    await option.click();
    await expect(palette).toBeHidden();
    await expect(pub.getByRole('article', { name })).toBeVisible();
    await pub.getByRole('button', { name: 'Menu' }).click();
    await pub
      .getByRole('dialog', { name: 'Menu' })
      .getByRole('button', { name: 'Building directory' })
      .click();
    await expect(pub.getByRole('complementary', { name: 'Building directory' })).toContainText(name);

    // --- archive: gone from the public map; restore: back ---
    await page.getByTestId('studio-archive').click();
    await page.getByTestId('studio-confirm-archive').click();
    await expect(state(page)).toHaveText('Archived');
    await pub.goto(`/?place=${encodeURIComponent(id)}&view=3d&e2e=1`);
    await pub.waitForTimeout(3000);
    expect(await pub.evaluate(() => window.__ATLAS_MAP__?.getSelectedId() ?? null)).not.toBe(id);
    await expect(pub.getByRole('article', { name })).toHaveCount(0);

    await page.getByTestId('studio-restore').click();
    await expect(state(page)).toHaveText('Published (version 1)');
    await pub.goto(`/?place=${encodeURIComponent(id)}&view=3d&e2e=1`);
    await expect
      .poll(() => pub.evaluate(() => window.__ATLAS_MAP__?.getSelectedId() ?? null), { timeout: 30_000 })
      .toBe(id);

    // --- the second context sees the published state after a reload ---
    await second.page.reload();
    await expect(state(second.page)).toHaveText('Published (version 1)');
    await second.ctx.close();
    await pub.close();
  });
});

/** Screenshot of another page into the shared admin screenshot folder (attached to the report). */
async function shotOf(p: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = join(SCREENSHOT_DIR, `${testInfo.project.name}-${name}.png`);
  await p.screenshot({ path, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}
