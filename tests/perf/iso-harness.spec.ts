/**
 * Isometric overview + building directory in a real browser (desktop and
 * mobile): axe scans, selection shared between the list and the canvas,
 * keyboard navigation, and screenshots for review (test-results/iso-harness/).
 */
import AxeBuilder from '@axe-core/playwright';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const SHOTS = resolve(process.cwd(), 'test-results/iso-harness');
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function open(page: Page, colorScheme: 'light' | 'dark' = 'light') {
  await page.emulateMedia({ colorScheme });
  await page.goto('/?e2e=1');
  await page.waitForFunction(() => (window.__ATLAS_ISO__?.getFrameStats().fullRedraws ?? 0) > 0, undefined, {
    timeout: 60_000,
  });
  return page.getByRole('img', { name: /isometric campus overview/i });
}
const shot = (page: Page, name: string) =>
  page.screenshot({ path: resolve(SHOTS, `${test.info().project.name}-${name}.png`) });

test('renders the real campus and passes axe (light and dark)', async ({ page }) => {
  const canvas = await open(page);
  await expect(canvas).toBeVisible();
  const order = await page.evaluate(() => window.__ATLAS_ISO__!.getDrawOrder());
  expect(order.length).toBeGreaterThan(100);
  expect(await page.evaluate(() => window.__ATLAS_ISO__!.getFrameStats().cycles)).toBe(0);
  await shot(page, 'overview-light');
  const light = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(
    light.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);

  await open(page, 'dark');
  await shot(page, 'overview-dark');
  const dark = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(dark.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual(
    [],
  );
});

test('the directory panel passes axe, finds a map key and selects in the overview', async ({ page }) => {
  await open(page);
  const directory = page.locator('#harness-directory');
  const scan = await new AxeBuilder({ page }).include('#harness-directory').withTags(WCAG).analyze();
  expect(scan.violations.map((v) => v.id)).toEqual([]);

  const buildings = (await (await page.request.get('/data/buildings.geojson')).json()) as {
    features: { properties: { id: string; name: string | null; directoryKey: string | null } }[];
  };
  const keyed = buildings.features.find(
    (f) => f.properties.name === null && f.properties.directoryKey,
  )!.properties;
  await directory.getByLabel('Search buildings or map keys').fill(keyed.directoryKey!);
  await directory.getByRole('button', { name: new RegExp(`Building ${keyed.directoryKey}`) }).click();
  await expect.poll(() => page.evaluate(() => window.__ATLAS_ISO__!.getSelectedId())).toBe(keyed.id);
  const card = page.getByRole('region', { name: 'Selected building' });
  await expect(card).toContainText(`Building ${keyed.directoryKey}`);
  await expect(card).toContainText('not an official block number');
  // The canvas draws the selected building's key label.
  await expect.poll(() => page.evaluate(() => window.__ATLAS_ISO__!.getPlacedLabelIds())).toContain(keyed.id);
  await page.waitForTimeout(400);
  await shot(page, 'selected-from-directory');
});

test('a click or tap on a building selects it; keyboard pans, zooms, rotates and opens the directory', async ({
  page,
}, info) => {
  const canvas = await open(page);
  const buildings = (await (await page.request.get('/data/buildings.geojson')).json()) as {
    features: { properties: { id: string; anchorLon: number; anchorLat: number; renderHeightM: number } }[];
  };
  const order: string[] = await page.evaluate(() => window.__ATLAS_ISO__!.getDrawOrder());
  const top = buildings.features.find((f) => f.properties.id === order.at(-1))!.properties;
  const pt = (await page.evaluate(({ lngLat, z }) => window.__ATLAS_ISO__!.projectToViewport(lngLat, z), {
    lngLat: [top.anchorLon, top.anchorLat] as [number, number],
    z: top.renderHeightM,
  }))!;
  if (info.project.name.includes('mobile')) await page.touchscreen.tap(pt.x, pt.y + 1);
  else await page.mouse.click(pt.x, pt.y + 1);
  await expect.poll(() => page.evaluate(() => window.__ATLAS_ISO__!.getSelectedId())).not.toBeNull();

  await canvas.focus();
  const v0 = await page.evaluate(() => window.__ATLAS_ISO__!.getView());
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('+');
  await page.keyboard.press('r');
  const v1 = await page.evaluate(() => window.__ATLAS_ISO__!.getView());
  expect(v1.center).not.toEqual(v0.center);
  expect(v1.pxPerMetre).toBeGreaterThan(v0.pxPerMetre);
  expect(v1.rotation).toBe((v0.rotation + 1) % 4);
  await page.keyboard.press('d');
  await expect(page.getByLabel('Search buildings or map keys')).toBeFocused();
  await page.waitForTimeout(300);
  await shot(page, 'zoomed-rotated');
});
