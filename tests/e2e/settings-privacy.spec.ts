/**
 * G-24 — Settings & privacy: turning search history off deletes the recent
 * places and stops recording them (across a reload), and "Clear all local
 * data" removes everything the app stored in this browser.
 */
import type { Page } from '@playwright/test';
import { APP_CONFIG } from '../../src/config/index.ts';
import { CAMPUS_BUILDING, ROUTE_PAIR } from './fixtures/data.ts';
import type { Atlas } from './fixtures/atlas.ts';
import { expect, test } from './fixtures/test.ts';

const PREFIX = `${APP_CONFIG.storage.prefix}:v${APP_CONFIG.storage.version}:`;
const RECENTS_KEY = `${PREFIX}recents`;

/** Every key the app stored under its namespace, with its raw value. */
const appStorage = (page: Page) =>
  page.evaluate((prefix) => {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (key.startsWith(prefix)) out[key] = localStorage.getItem(key)!;
    }
    return out;
  }, `${APP_CONFIG.storage.prefix}:`);

async function openMenuItem(atlas: Atlas, item: string): Promise<void> {
  await atlas.page.getByRole('button', { name: 'Menu' }).click();
  await atlas.page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: item }).click();
}

const second = ROUTE_PAIR.to.id === CAMPUS_BUILDING.id ? ROUTE_PAIR.from : ROUTE_PAIR.to;

test.describe('G-24 · settings and privacy', () => {
  test('turning search history off deletes recent places and stops recording them', async ({
    atlas,
    page,
  }) => {
    // Recents record places the user selects in the app (search, map, lists), not the opening link.
    await atlas.open();
    await atlas.searchAndChoose(CAMPUS_BUILDING.name);
    await expect(atlas.placeArticle(CAMPUS_BUILDING.name)).toBeVisible();
    await expect.poll(async () => (await appStorage(page))[RECENTS_KEY] ?? '').toContain(CAMPUS_BUILDING.id);

    await openMenuItem(atlas, 'Saved places');
    const saved = atlas.panel('Saved places');
    await expect(saved.getByRole('list', { name: 'Recent places' })).toContainText(
      CAMPUS_BUILDING.displayName,
    );

    await openMenuItem(atlas, 'Settings & privacy');
    const settings = atlas.panel(/Settings/);
    const history = settings.getByRole('switch', { name: 'Save search history' });
    await expect(history).toHaveAttribute('aria-checked', 'true');
    await history.click();
    await expect(history).toHaveAttribute('aria-checked', 'false');
    // Deleted at once, not on the next load.
    await expect.poll(async () => RECENTS_KEY in (await appStorage(page))).toBe(false);

    // A place opened now is not remembered, even after a reload.
    await atlas.searchAndChoose(second.name);
    await expect(atlas.placeArticle(second.name)).toBeVisible();
    await page.reload();
    await atlas.waitForMapReady();
    expect(RECENTS_KEY in (await appStorage(page))).toBe(false);
    await openMenuItem(atlas, 'Saved places');
    await expect(atlas.panel('Saved places')).toContainText(
      'Search history is off, so opened places are not remembered.',
    );
    await atlas.screenshot('history off');
    await openMenuItem(atlas, 'Settings & privacy');
    await expect(
      atlas.panel(/Settings/).getByRole('switch', { name: 'Save search history' }),
    ).toHaveAttribute('aria-checked', 'false');
  });

  test('"Clear all local data" asks first, then deletes saved places, recents and settings', async ({
    atlas,
    page,
  }) => {
    await atlas.open();
    await atlas.searchAndChoose(CAMPUS_BUILDING.name);
    const article = atlas.placeArticle(CAMPUS_BUILDING.name);
    await article.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(article.getByRole('button', { name: 'Saved', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect.poll(async () => Object.keys(await appStorage(page)).length).toBeGreaterThanOrEqual(2);
    const before = await appStorage(page);
    expect(Object.values(before).join(' ')).toContain(CAMPUS_BUILDING.id);

    await openMenuItem(atlas, 'Settings & privacy');
    const settings = atlas.panel(/Settings/);
    await expect(settings).toContainText('1 saved place');
    await settings.getByRole('button', { name: 'Clear all local data' }).click();
    const confirm = page.getByRole('dialog', { name: 'Clear all local data?' });
    await expect(confirm).toBeVisible();
    // Cancel keeps everything.
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();
    expect(await appStorage(page)).toEqual(before);

    await settings.getByRole('button', { name: 'Clear all local data' }).click();
    await page
      .getByRole('dialog', { name: 'Clear all local data?' })
      .getByRole('button', { name: 'Clear data' })
      .click();
    await expect(page.getByText(/^Cleared: saved places, recent places, settings/)).toBeVisible();
    await expect.poll(() => appStorage(page)).toEqual({});
    await expect(settings).toContainText('0 saved places and 0 recent places');
    await atlas.screenshot('data cleared');

    // Still empty after a reload: nothing was only hidden.
    await page.reload();
    await atlas.waitForMapReady();
    await openMenuItem(atlas, 'Saved places');
    await expect(atlas.panel('Saved places').getByRole('list', { name: 'Saved places' })).toHaveCount(0);
    expect(Object.keys(await appStorage(page)).filter((k) => k !== RECENTS_KEY)).toEqual([]);
  });
});
