/** Layers and categories: label toggle reaches the map; an empty category says so honestly. */
import { LABEL_LAYER_IDS } from '../../src/map/ids.ts';
import { EMPTY_CATEGORY } from './fixtures/data.ts';
import { expect, test } from './fixtures/test.ts';

test.describe('layers and categories', () => {
  test('turning labels off hides every label layer, and on again restores them', async ({ atlas, page }) => {
    await atlas.open();
    await page
      .getByRole('group', { name: 'Map controls' })
      .getByRole('button', { name: 'Map layers' })
      .click();
    const panel = atlas.panel('Map layers');
    const labels = panel.getByRole('switch', { name: 'Show labels' });
    await expect(labels).toBeChecked();
    for (const id of LABEL_LAYER_IDS) await expect.poll(() => atlas.layerVisibility(id)).toBe('visible');

    await labels.click();
    await expect(labels).not.toBeChecked();
    for (const id of LABEL_LAYER_IDS) await expect.poll(() => atlas.layerVisibility(id)).toBe('none');

    await labels.click();
    await expect(labels).toBeChecked();
    for (const id of LABEL_LAYER_IDS) await expect.poll(() => atlas.layerVisibility(id)).toBe('visible');
  });

  test('a category with no mapped places shows an honest empty state', async ({ atlas, page }) => {
    test.skip(!EMPTY_CATEGORY, 'every quick-action category has data in this dataset');
    const category = EMPTY_CATEGORY!;
    await atlas.open();
    const palette = await atlas.openSearch();
    await palette
      .getByRole('group', { name: 'Browse a category' })
      .getByRole('button', { name: category.label })
      .click();
    const panel = atlas.panel(category.label);
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(`No ${category.noun} are mapped yet`);
    await expect(panel).toContainText('we never guess locations');
    await expect(
      page.getByRole('listitem').filter({ has: page.getByRole('button', { name: /On campus|Off campus/ }) }),
    ).toHaveCount(0);
  });
});
