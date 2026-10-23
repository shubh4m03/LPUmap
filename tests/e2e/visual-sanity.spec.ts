/**
 * Visual sanity in every viewport: the map is really drawn and sized, the page
 * never scrolls sideways, key states are captured as screenshots (attachments,
 * not pixel baselines: WebGL output differs between machines), and the app
 * degrades to the list view when WebGL is missing. Console errors, page errors,
 * unhandled rejections and failed /data/, /fonts/, /assets/ requests fail any
 * test through the automatic `health` fixture.
 */
import { MAP_MESSAGES } from '../../src/map/errors.ts';
import { CAMPUS_BUILDING } from './fixtures/data.ts';
import { expect, test } from './fixtures/test.ts';

test.describe('visual sanity', () => {
  test('map fills its area, canvas is drawn, no sideways scroll; key states captured', async ({
    atlas,
    page,
  }) => {
    await atlas.open();
    const map = page.getByTestId('atlas-map');
    const mapBox = await map.boundingBox();
    expect(mapBox?.height ?? 0, 'map container height').toBeGreaterThan(200);
    const canvas = await atlas.mapCanvas.evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height }));
    expect(canvas.w).toBeGreaterThan(0);
    expect(canvas.h).toBeGreaterThan(0);
    expect((await atlas.renderedBuildingIds()).length, 'buildings are drawn').toBeGreaterThan(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await atlas.screenshot('home');

    await atlas.searchAndChoose(CAMPUS_BUILDING.name);
    await expect(atlas.placeArticle(CAMPUS_BUILDING.name)).toBeVisible();
    await atlas.screenshot('details');

    await page.getByRole('button', { name: 'Menu' }).click();
    await page
      .getByRole('dialog', { name: 'Menu' })
      .getByRole('button', { name: /^Switch to (dark|light) theme$/ })
      .click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', /^(dark|light)$/);
    await expect.poll(() => page.evaluate(() => window.__ATLAS_MAP__!.isStyleLoaded())).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
    await atlas.screenshot('details, other theme');
  });

  test('without WebGL the list view explains why and search still works', async ({ atlas, page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
        return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
    await page.goto('/?e2e=1');
    await expect(page.getByText(MAP_MESSAGES.webglUnavailable)).toBeVisible();
    await expect(page.getByTestId('atlas-map')).toHaveCount(0);
    await atlas.screenshot('list view');

    await atlas.searchAndChoose(CAMPUS_BUILDING.name);
    await expect(
      atlas.placeArticle(CAMPUS_BUILDING.name).getByRole('heading', { name: CAMPUS_BUILDING.name }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
  });
});
