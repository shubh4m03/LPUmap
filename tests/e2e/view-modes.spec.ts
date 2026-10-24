/**
 * View modes and the owner's publication, end to end (docs/ISOMETRIC_AND_3D_DESIGN.md
 * §8, docs/BUILDING_STUDIO_DESIGN.md §11, test lists C and E):
 *
 *  - switching between Realistic 3D, the isometric overview and 2D keeps the
 *    selection and the ground point;
 *  - a published studio building (synthetic fixture, served by route
 *    interception — never a live backend) is ONE record with ONE id in 3D, the
 *    overview, 2D, search and the directory, always with its illustrative label;
 *  - draft and archived records never appear; routing only through an access node;
 *  - the directory frames the right coordinates and its category filter agrees
 *    across modes; axe finds no serious violation in the overview and directory.
 *
 * Screenshots of every mode are saved under test-results/ for review.
 */
import { writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import type { Locator } from '@playwright/test';
import { VERIFICATION_LABELS } from '../../src/building-studio/schema.ts';
import { haversineM } from '../../src/distance/geodesic.ts';
import { CAMPUS_BUILDING } from './fixtures/data.ts';
import { escapeRegExp, type Atlas } from './fixtures/atlas.ts';
import {
  E2E_ARCHIVED_NAME,
  E2E_DRAFT_NAME,
  E2E_HALL_ANCHOR,
  E2E_HALL_ID,
  E2E_HALL_NAME,
  E2E_KIOSK_ID,
  E2E_KIOSK_NAME,
} from './fixtures/publication.ts';
import { expect, test } from './fixtures/test.ts';

const ILLUSTRATIVE = VERIFICATION_LABELS.unverified;
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function openMenuItem(atlas: Atlas, item: string): Promise<void> {
  await atlas.page.getByRole('button', { name: 'Menu' }).click();
  await atlas.page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: item }).click();
}

async function openDirectory(atlas: Atlas): Promise<Locator> {
  await openMenuItem(atlas, 'Building directory');
  const panel = atlas.panel('Building directory');
  await expect(panel).toBeVisible();
  return panel;
}

async function expectNoSeriousViolations(atlas: Atlas, state: string): Promise<void> {
  const results = await new AxeBuilder({ page: atlas.page }).withTags(WCAG_TAGS).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  await atlas.testInfo.attach(`axe ${state}`, {
    body:
      results.violations
        .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
        .join('\n') || 'no violations',
    contentType: 'text/plain',
  });
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    state,
  ).toEqual([]);
}

test.describe('view modes', () => {
  test('switching modes keeps the selection and the ground point', async ({ atlas, page }) => {
    const target = CAMPUS_BUILDING;
    await atlas.open({ place: target.id });
    await expect.poll(() => atlas.selectedId()).toBe(target.id);
    const before = (await atlas.camera()).center;

    await atlas.switchView('Isometric overview');
    await expect(page).toHaveURL(/view=iso/);
    await expect.poll(() => atlas.isoSelectedId()).toBe(target.id);
    const isoCenter = await page.evaluate(() => window.__ATLAS_ISO__!.getView().center);
    expect(haversineM(isoCenter, before), 'the overview opens on the same ground point').toBeLessThan(60);

    await atlas.switchView('2D map');
    await expect(page).toHaveURL(/view=2d/);
    await expect.poll(() => atlas.selectedId()).toBe(target.id);
    await expect.poll(async () => (await atlas.camera()).pitch).toBe(0);

    await atlas.switchView('3D map');
    await expect.poll(() => atlas.selectedId()).toBe(target.id);
    await expect.poll(async () => (await atlas.camera()).pitch).toBeGreaterThan(0);
    await expect(atlas.placeArticle(target.name)).toBeVisible();
  });

  test('the switcher is one keyboard stop with arrow keys; the overview deep link opens selected', async ({
    atlas,
    page,
  }) => {
    const requested: string[] = [];
    page.on('request', (r) => requested.push(new URL(r.url()).pathname));
    await atlas.openOverview({ place: CAMPUS_BUILDING.id });
    await expect.poll(() => atlas.isoSelectedId()).toBe(CAMPUS_BUILDING.id);
    // The overview never downloads MapLibre (Decision D4): the map chunk loads only for a map mode.
    expect(requested.filter((u) => u.startsWith('/assets/MapStage-'))).toEqual([]);
    const overview = atlas.viewModes.getByRole('radio', { name: 'Isometric overview' });
    await expect(overview).toHaveAttribute('aria-checked', 'true');
    await overview.focus();
    await page.keyboard.press('ArrowDown');
    const map2d = atlas.viewModes.getByRole('radio', { name: '2D map' });
    await expect(map2d).toBeFocused();
    await expect(map2d).toHaveAttribute('aria-checked', 'true');
    await atlas.waitForMapReady();
    await expect.poll(() => atlas.selectedId()).toBe(CAMPUS_BUILDING.id);
  });
});

test.describe('published studio building (synthetic publication)', () => {
  test.use({ syntheticPublication: true, serviceWorkers: 'block' });

  test('one record, one id in 3D, the overview, 2D and search, with its illustrative label', async ({
    atlas,
    page,
  }) => {
    const project = atlas.testInfo.project.name;
    await atlas.open();
    if (
      (await atlas.viewModes.getByRole('radio', { name: '3D map' }).getAttribute('aria-checked')) !== 'true'
    )
      await atlas.switchView('3D map');

    // Search: exactly one result for the building, labelled as an illustrative model.
    const palette = await atlas.openSearch();
    await palette.getByRole('combobox').fill('E2E fixture hall');
    const option = atlas.paletteOption(E2E_HALL_NAME);
    await expect(option).toBeVisible();
    await expect(option).toContainText(ILLUSTRATIVE);
    await expect(
      palette.getByRole('option', { name: new RegExp(`^${escapeRegExp(E2E_HALL_NAME)}`) }),
    ).toHaveCount(1);
    await option.click();
    await expect.poll(() => atlas.selectedId()).toBe(E2E_HALL_ID);
    await expect(atlas.placeArticle(E2E_HALL_NAME)).toContainText(ILLUSTRATIVE);
    await atlas.placeArticle(E2E_HALL_NAME).getByRole('button', { name: 'Save' }).click();
    await atlas.dismissToasts();
    await expect(page).toHaveURL(new RegExp(`place=${encodeURIComponent(E2E_HALL_ID)}`));

    // Realistic 3D: the custom layer draws it (or the extrusion fallback does); picking uses the footprint.
    await expect
      .poll(async () => (await page.evaluate(() => window.__ATLAS_MAP__!.getRealistic3D()))?.studio)
      .toMatch(/^(custom|fallback)$/);
    const r3d = (await page.evaluate(() => window.__ATLAS_MAP__!.getRealistic3D()))!;
    const r3dPath = atlas.testInfo.outputPath('realistic-3d-state.json');
    writeFileSync(r3dPath, JSON.stringify(r3d, null, 2));
    await atlas.testInfo.attach('realistic-3d state', { path: r3dPath, contentType: 'application/json' });
    if (r3d.studio === 'custom') expect(r3d.excludedIds).toContain(E2E_HALL_ID);
    await expect.poll(() => atlas.renderedBuildingIds()).toContain(E2E_HALL_ID);
    await atlas.dismissToasts();
    await atlas.saveScreenshot(`${project}-studio-3d`);

    // The overview draws the same id from the same record.
    await atlas.switchView('Isometric overview');
    await expect.poll(() => atlas.isoSelectedId()).toBe(E2E_HALL_ID);
    expect(await atlas.isoDrawOrder()).toContain(E2E_HALL_ID);
    expect(await atlas.isoDrawOrder()).toContain(E2E_KIOSK_ID);
    await atlas.saveScreenshot(`${project}-studio-overview`);
    // Saved in 3D, listed from the overview under the same id (in both the saved and the recent list).
    await openMenuItem(atlas, 'Saved places');
    await expect(
      atlas
        .panel('Saved places')
        .getByRole('button', { name: new RegExp(`^${escapeRegExp(E2E_HALL_NAME)}`) })
        .first(),
    ).toBeVisible();
    await atlas.closePanel(atlas.panel('Saved places'));

    await atlas.switchView('2D map');
    await expect.poll(() => atlas.selectedId()).toBe(E2E_HALL_ID);
    await expect.poll(() => atlas.renderedBuildingIds()).toContain(E2E_HALL_ID);
    await atlas.saveScreenshot(`${project}-studio-2d`);

    // A shared link opens the same record in any view.
    await page.goto(`/?e2e=1&view=iso&place=${encodeURIComponent(E2E_HALL_ID)}`);
    await atlas.waitForOverviewReady();
    await expect.poll(() => atlas.isoSelectedId()).toBe(E2E_HALL_ID);
  });

  test('the directory lists it once, labelled, and frames its coordinates in every mode', async ({
    atlas,
  }) => {
    await atlas.open();
    const panel = await openDirectory(atlas);
    await panel.getByRole('searchbox', { name: 'Search buildings or map keys' }).fill('E2E fixture');
    const rows = panel.getByRole('listitem').getByRole('button');
    await expect(rows).toHaveCount(2);
    const hallRow = rows.filter({ hasText: E2E_HALL_NAME });
    await expect(hallRow).toHaveCount(1);
    await expect(hallRow).toContainText(ILLUSTRATIVE);
    await expect(rows.filter({ hasText: E2E_KIOSK_NAME })).toHaveCount(1);
    await hallRow.click();
    await expect.poll(() => atlas.selectedId()).toBe(E2E_HALL_ID);
    await expect
      .poll(async () => haversineM((await atlas.camera()).center, E2E_HALL_ANCHOR))
      .toBeLessThan(30);

    // Same row in the overview: the overview centres on the same building.
    await atlas.switchView('Isometric overview');
    await atlas.page.getByRole('button', { name: /^Back to building directory/ }).click();
    const again = atlas.panel('Building directory');
    await again.getByRole('searchbox', { name: 'Search buildings or map keys' }).fill('E2E fixture hall');
    await again.getByRole('listitem').getByRole('button').filter({ hasText: E2E_HALL_NAME }).click();
    await expect.poll(() => atlas.isoSelectedId()).toBe(E2E_HALL_ID);
    await expect
      .poll(async () =>
        haversineM(await atlas.page.evaluate(() => window.__ATLAS_ISO__!.getView().center), E2E_HALL_ANCHOR),
      )
      .toBeLessThan(30);
  });

  test('draft and archived records never appear anywhere', async ({ atlas, page }) => {
    await atlas.open();
    const palette = await atlas.openSearch();
    for (const q of [E2E_DRAFT_NAME, E2E_ARCHIVED_NAME, 'must never appear']) {
      await palette.getByRole('combobox').fill(q);
      await expect(palette.getByRole('option', { name: /must never appear/ })).toHaveCount(0);
    }
    // Escape clears the query first, then closes the palette.
    while (await atlas.palette.isVisible()) await page.keyboard.press('Escape');
    const panel = await openDirectory(atlas);
    await panel.getByRole('searchbox', { name: 'Search buildings or map keys' }).fill('must never appear');
    await expect(panel.getByText('No buildings match')).toBeVisible();
    expect(await atlas.renderedBuildingIds()).not.toContain('stu:eeeeeeeeeeeeeeeeeeeeedraft');
    await atlas.switchView('Isometric overview');
    const order = await atlas.isoDrawOrder();
    expect(order.filter((id) => id.startsWith('stu:')).sort()).toEqual([E2E_HALL_ID, E2E_KIOSK_ID].sort());
  });

  test('directions are offered only for the building with an owner-chosen access node', async ({ atlas }) => {
    await atlas.open({ place: E2E_HALL_ID });
    await expect(
      atlas.placeArticle(E2E_HALL_NAME).getByRole('button', { name: 'Directions to here' }),
    ).toBeEnabled();
    await atlas.open({ place: E2E_KIOSK_ID });
    const kiosk = atlas.placeArticle(E2E_KIOSK_NAME);
    const directions = kiosk.getByRole('button', { name: 'Directions to here' });
    await expect(directions).toBeDisabled();
    await expect(directions).toHaveAccessibleDescription(/Not connected to the mapped path network/);
  });

  test('the directory category filter gives the same buildings in every mode', async ({ atlas }) => {
    await atlas.open();
    const read = async () => {
      const panel = atlas.panel('Building directory');
      await panel.getByRole('combobox', { name: 'Category' }).selectOption('academic');
      return panel.getByRole('listitem').getByRole('button').allInnerTexts();
    };
    await openDirectory(atlas);
    const inMap = await read();
    expect(inMap.some((t) => t.includes(E2E_HALL_NAME))).toBe(true);
    for (const mode of ['Isometric overview', '2D map'] as const) {
      await atlas.switchView(mode);
      await expect(atlas.panel('Building directory')).toBeVisible();
      expect(await read(), mode).toEqual(inMap);
    }
  });

  test('overview, switcher and directory have no serious accessibility violations @a11y', async ({
    atlas,
  }) => {
    await atlas.openOverview({ place: E2E_HALL_ID });
    await expect(atlas.placeArticle(E2E_HALL_NAME)).toBeVisible();
    await expectNoSeriousViolations(atlas, 'overview with a studio building selected');
    await atlas.closePanel(atlas.panel(/place details/));
    await openDirectory(atlas);
    await expectNoSeriousViolations(atlas, 'overview with the directory');
  });
});
