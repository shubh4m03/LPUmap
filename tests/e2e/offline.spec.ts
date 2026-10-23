/** Workflow F — offline recovery through the service-worker precache. */
import { OFFLINE_MESSAGE } from '../../src/components/offline/messages.ts';
import { CAMPUS_BUILDING, ROUTE_PAIR, THIN_CATEGORY_LABELS } from './fixtures/data.ts';
import { planRoute } from './fixtures/flows.ts';
import { expect, test } from './fixtures/test.ts';

test.describe('F · offline recovery', () => {
  test('after one online visit the app reloads offline, searches, routes, and states what needs a connection', async ({
    atlas,
    context,
    page,
  }) => {
    test.slow();
    await atlas.open();
    // The precache is complete once the worker is activated; a reload puts the page under its control.
    await page.waitForFunction(
      async () => (await navigator.serviceWorker.ready).active?.state === 'activated',
      null,
      { timeout: 30_000 },
    );
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await atlas.waitForMapReady();

    await context.setOffline(true);
    await page.reload();
    await atlas.waitForMapReady();
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);

    const banner = page.getByRole('status').filter({ hasText: OFFLINE_MESSAGE });
    await expect(banner).toBeVisible();
    await atlas.screenshot('offline');

    // Search works from the cached dataset.
    await atlas.searchAndChoose(CAMPUS_BUILDING.name);
    await expect.poll(() => atlas.selectedId()).toBe(CAMPUS_BUILDING.id);
    await expect(atlas.placeArticle(CAMPUS_BUILDING.name)).toBeVisible();

    // The quality report is precached, so About shows it (not a false "unavailable").
    await page.getByRole('button', { name: 'Menu' }).click();
    await page
      .getByRole('dialog', { name: 'Menu' })
      .getByRole('button', { name: 'About & data sources' })
      .click();
    const about = atlas.panel(/About/);
    await expect(about).toBeVisible();
    await expect(about).not.toContainText('could not be loaded');
    for (const label of THIN_CATEGORY_LABELS.slice(0, 3)) await expect(about).toContainText(label);

    // Links that need the network are called out by the offline banner.
    await expect(banner).toContainText('corrections links and data refresh need a connection');

    // Routing works offline (the graph is cached).
    await planRoute(atlas, ROUTE_PAIR.from, ROUTE_PAIR.to);
    await expect.poll(() => atlas.routeCoordinateCount()).toBeGreaterThan(1);
    await expect(banner).toBeVisible();

    await context.setOffline(false);
    await expect(banner).toBeHidden();
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  });
});
