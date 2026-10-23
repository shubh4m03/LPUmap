/**
 * axe-core scans of the real pages (layout and colour contrast included) in
 * every viewport. No serious or critical violation is allowed. No rule is
 * disabled; the map canvas is a single labelled region and is scanned too.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';
import { CAMPUS_BUILDING, ROUTE_PAIR } from './fixtures/data.ts';
import type { Atlas } from './fixtures/atlas.ts';
import { planRoute } from './fixtures/flows.ts';
import { expect, test } from './fixtures/test.ts';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function expectNoSeriousViolations(page: Page, testInfo: TestInfo, state: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const summary = results.violations.map(
    (v) =>
      `[${v.impact}] ${v.id}: ${v.help}\n` +
      v.nodes.map((n) => `    ${n.target.join(' ')} — ${n.failureSummary}`).join('\n'),
  );
  await testInfo.attach(`axe ${state}`, {
    body: summary.join('\n') || 'no violations',
    contentType: 'text/plain',
  });
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    state,
  ).toEqual([]);
}

async function openMenuItem(atlas: Atlas, item: string) {
  await atlas.page.getByRole('button', { name: 'Menu' }).click();
  await atlas.page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: item }).click();
}

test.describe('accessibility scans @a11y', () => {
  test('initial view, search palette and place details @a11y', async ({ atlas, page }, testInfo) => {
    await atlas.open();
    await expectNoSeriousViolations(page, testInfo, 'initial view');

    const palette = await atlas.openSearch();
    await palette.getByRole('combobox').fill(CAMPUS_BUILDING.name);
    await expect(atlas.paletteOption(CAMPUS_BUILDING.name)).toBeVisible();
    await expectNoSeriousViolations(page, testInfo, 'palette open');

    await atlas.paletteOption(CAMPUS_BUILDING.name).click();
    await expect(atlas.placeArticle(CAMPUS_BUILDING.name)).toBeVisible();
    await expectNoSeriousViolations(page, testInfo, 'place details');
  });

  test('directions panel with a route @a11y', async ({ atlas, page }, testInfo) => {
    await planRoute(atlas, ROUTE_PAIR.from, ROUTE_PAIR.to);
    await expect(atlas.panel('Directions').getByTestId('route-summary')).toBeVisible();
    await expectNoSeriousViolations(page, testInfo, 'directions');
  });

  test('layers panel and settings @a11y', async ({ atlas, page }, testInfo) => {
    await atlas.open();
    await page
      .getByRole('group', { name: 'Map controls' })
      .getByRole('button', { name: 'Map layers' })
      .click();
    await expect(atlas.panel('Map layers')).toBeVisible();
    await expectNoSeriousViolations(page, testInfo, 'layers');
    await atlas.closePanel(atlas.panel('Map layers'));

    await openMenuItem(atlas, 'Settings & privacy');
    await expect(atlas.panel(/Settings/)).toBeVisible();
    await expectNoSeriousViolations(page, testInfo, 'settings');
  });

  test('report dialog, form and review @a11y', async ({ atlas, page }, testInfo) => {
    await atlas.open({ place: CAMPUS_BUILDING.id });
    await atlas
      .placeArticle(CAMPUS_BUILDING.name)
      .getByRole('button', { name: 'Report a correction' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Suggest a correction' });
    await expect(dialog).toBeVisible();
    await expectNoSeriousViolations(page, testInfo, 'report form');

    await dialog
      .getByRole('combobox', { name: 'What needs correcting?' })
      .selectOption({ label: 'Wrong name' });
    await dialog
      .getByRole('textbox', { name: 'Details' })
      .fill('The sign at the entrance shows a different name.');
    await dialog.getByRole('button', { name: 'Review report' }).click();
    await expect(dialog.getByText('Nothing has been sent.')).toBeVisible();
    await expectNoSeriousViolations(page, testInfo, 'report review');
  });
});
