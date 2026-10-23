/** Workflow E — phone usability: search pill, bottom sheet, route action, layers, theme, layout fit. */
import type { Locator, Page } from '@playwright/test';
import { FACILITY } from './fixtures/data.ts';
import type { Atlas } from './fixtures/atlas.ts';
import { expect, test } from './fixtures/test.ts';

const { place, categoryLabel } = FACILITY;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, `${locator.toString()} has a layout box`).not.toBeNull();
  return box!;
}

async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, 'page never scrolls sideways').toBeLessThanOrEqual(innerWidth);
}

/** The always-visible controls of the phone layout. */
function essentialControls(page: Page): Locator[] {
  const controls = page.getByRole('group', { name: 'Map controls' }).getByRole('button');
  return [
    page.getByRole('button', { name: /^Search places/ }),
    page.getByRole('button', { name: 'Menu' }),
    controls,
    page.getByRole('link', { name: /OpenStreetMap contributors/ }),
  ];
}

/** Every essential control is fully inside the viewport and, if a sheet is given, not under it. */
async function expectControlsClear(atlas: Atlas, sheet?: Locator) {
  const { page } = atlas;
  const vp = page.viewportSize()!;
  const sheetBox = sheet ? await boxOf(sheet) : null;
  for (const group of essentialControls(page)) {
    const n = await group.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const el = group.nth(i);
      await expect(el).toBeVisible();
      const b = await boxOf(el);
      const name = (await el.getAttribute('aria-label')) ?? (await el.innerText());
      expect(b.x, `${name} left edge`).toBeGreaterThanOrEqual(0);
      expect(b.y, `${name} top edge`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, `${name} right edge`).toBeLessThanOrEqual(vp.width);
      expect(b.y + b.height, `${name} bottom edge`).toBeLessThanOrEqual(vp.height);
      if (sheetBox) expect(overlaps(b, sheetBox), `${name} is not covered by the sheet`).toBe(false);
    }
  }
}

/** Taps the sheet handle until it rests at `snap`. */
async function snapSheetTo(sheet: Locator, snap: 'peek' | 'half' | 'full') {
  for (let i = 0; i < 3 && (await sheet.getAttribute('data-snap')) !== snap; i++) {
    await sheet.getByRole('button', { name: /^Resize / }).click();
  }
  await expect(sheet).toHaveAttribute('data-snap', snap);
}

test.describe('E · mobile usability', () => {
  test.beforeEach(({ atlas }) => {
    test.skip(!atlas.isMobile, 'phone layout only (mobile and mobile-small projects)');
  });

  test('layout fits the screen and nothing essential is clipped', async ({ atlas, page }) => {
    await atlas.open();
    await expectNoHorizontalOverflow(page);
    await expectControlsClear(atlas);
    const quick = page.getByRole('navigation', { name: 'Find nearby' });
    const qb = await boxOf(quick);
    expect(qb.x).toBeGreaterThanOrEqual(0);
    expect(qb.x + qb.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(qb.y + qb.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await atlas.screenshot('mobile home');
  });

  test('search pill → facility → sheet opens, closes by button and by Back; route action reachable', async ({
    atlas,
    page,
  }) => {
    await atlas.open();
    await atlas.searchAndChoose(place.name);
    const sheet = page.locator('[data-snap]');
    await expect(sheet).toBeVisible();
    await expect(atlas.placeArticle(place.name).getByRole('heading', { name: place.name })).toBeVisible();
    await expect.poll(() => atlas.selectedId()).toBe(place.id);

    // Close with the sheet's own button.
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
    await expect.poll(() => atlas.selectedId()).toBeNull();

    // Open again from the quick actions → category list, then close with the browser Back button.
    await page
      .getByRole('navigation', { name: 'Find nearby' })
      .getByRole('button', { name: categoryLabel })
      .click();
    const categorySheet = atlas.panel(categoryLabel);
    await expect(categorySheet).toBeVisible();
    await categorySheet
      .getByRole('button', { name: new RegExp(`^${place.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })
      .first()
      .click();
    await expect(atlas.placeArticle(place.name)).toBeVisible();
    await page.goBack();
    await expect(atlas.placeArticle(place.name)).toBeHidden();
    await expect.poll(() => atlas.selectedId()).toBeNull();
    // Still inside the app (Back closed a layer, it did not leave the page).
    await expect(page).toHaveURL(/e2e=1/);
    await atlas.waitForMapReady();

    // Peek state: the sheet sits low and covers no control; the route action stays reachable.
    await atlas.searchAndChoose(place.name);
    await expect(sheet).toBeVisible();
    await snapSheetTo(sheet, 'peek');
    await atlas.dismissToasts();
    await expectControlsClear(atlas, sheet);
    await expectNoHorizontalOverflow(page);
    await atlas.screenshot('sheet at peek');
    await snapSheetTo(sheet, 'half');
    const directions = atlas.placeArticle(place.name).getByRole('button', { name: 'Directions to here' });
    await directions.scrollIntoViewIfNeeded();
    await expect(directions).toBeInViewport();
    await directions.click();
    await expect(atlas.panel('Directions')).toBeVisible();
    await expect(atlas.panel('Directions').getByRole('region', { name: 'Destination' })).toContainText(
      place.displayName,
    );
    await expectNoHorizontalOverflow(page);
  });

  test('layers sheet opens and the theme switch applies data-theme', async ({ atlas, page }) => {
    await atlas.open();
    await page
      .getByRole('group', { name: 'Map controls' })
      .getByRole('button', { name: 'Map layers' })
      .click();
    const layers = atlas.panel('Map layers');
    await expect(layers).toBeVisible();
    await expect(layers.getByRole('switch', { name: 'Show labels' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await atlas.screenshot('layers sheet');
    await layers.getByRole('button', { name: 'Close' }).click();
    await expect(layers).toBeHidden();

    const html = page.locator('html');
    const before = await html.getAttribute('data-theme');
    const target = before === 'dark' ? 'light' : 'dark';
    await page.getByRole('button', { name: 'Menu' }).click();
    await page
      .getByRole('dialog', { name: 'Menu' })
      .getByRole('button', { name: `Switch to ${target} theme` })
      .click();
    await expect(html).toHaveAttribute('data-theme', target);
    await expectNoHorizontalOverflow(page);
    await atlas.screenshot(`${target} theme`);
  });
});
