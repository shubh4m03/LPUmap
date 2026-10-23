/** Workflow A — campus discovery: search a real building, inspect it, close it. */
import { getCategory } from '../../src/config/categories.ts';
import { haversineM } from '../../src/distance/geodesic.ts';
import { CAMPUS_BUILDING } from './fixtures/data.ts';
import { expect, test } from './fixtures/test.ts';

const place = CAMPUS_BUILDING;
const osmPath = place.id.replace(/^osm:/, '');

test.describe('A · campus discovery', () => {
  test('search a building, see its details and provenance, then close them', async ({ atlas, page }) => {
    await atlas.open();
    await atlas.screenshot('initial view');
    const before = await atlas.camera();

    await atlas.searchAndChoose(place.name);

    await expect.poll(() => atlas.selectedId()).toBe(place.id);
    await expect(page).toHaveURL(new RegExp(`[?&]place=${encodeURIComponent(place.id)}`));
    // The camera moved to the place (centre of the visible map area, closer zoom).
    await expect.poll(async () => haversineM((await atlas.camera()).center, place.location)).toBeLessThan(60);
    expect((await atlas.camera()).zoom).toBeGreaterThan(before.zoom);

    const article = atlas.placeArticle(place.name);
    await expect(article.getByRole('heading', { level: 3, name: place.name })).toBeVisible();
    await expect(article).toContainText(getCategory(place.categoryId).label);

    const source = article.getByRole('region', { name: 'Source' });
    await source.scrollIntoViewIfNeeded();
    await expect(source).toContainText('Imported');
    await expect(source).toContainText('OpenStreetMap');
    await expect(source.getByRole('link', { name: /View this record on OpenStreetMap/ })).toHaveAttribute(
      'href',
      `https://www.openstreetmap.org/${osmPath}`,
    );
    await atlas.screenshot('place details');

    await atlas.closePanel(atlas.panel(/place details/));
    await expect(article).toBeHidden();
    await expect.poll(() => atlas.selectedId()).toBeNull();
    await expect(page).not.toHaveURL(/[?&]place=/);
  });

  test('a shared place link restores the same place after a reload', async ({ atlas, page }) => {
    await atlas.open({ place: place.id });
    await expect.poll(() => atlas.selectedId()).toBe(place.id);
    await expect(atlas.placeArticle(place.name)).toBeVisible();
    await page.reload();
    await atlas.waitForMapReady();
    await expect.poll(() => atlas.selectedId()).toBe(place.id);
    await expect(atlas.placeArticle(place.name).getByRole('heading', { name: place.name })).toBeVisible();
  });

  test('an unknown place link shows a polite message and nothing is selected', async ({ atlas, page }) => {
    await atlas.open({ place: 'osm:way/0' });
    await expect(page.getByRole('region', { name: 'Notifications' })).toContainText(
      'The linked place is not in the current campus dataset.',
    );
    expect(await atlas.selectedId()).toBeNull();
    // Still usable: search opens.
    await atlas.openSearch();
  });
});
