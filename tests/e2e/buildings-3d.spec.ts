/** Workflow B — 3D buildings: switch to the 3D map, rotate, pick an extruded building, back to 2D. */
import { LAYER_IDS } from '../../src/map/ids.ts';
import { CAMPUS_BUILDING, footprintCentre } from './fixtures/data.ts';
import { expect, test } from './fixtures/test.ts';

const target = CAMPUS_BUILDING;

test.describe('B · 3D buildings', () => {
  test('toggle 3D, rotate, select an extruded building by clicking it, return to 2D', async ({
    atlas,
    page,
  }) => {
    await atlas.open();
    const modes = page
      .getByRole('group', { name: 'Map controls' })
      .getByRole('radiogroup', { name: 'View mode' });
    const map3d = modes.getByRole('radio', { name: '3D map' });
    const map2d = modes.getByRole('radio', { name: '2D map' });

    // Start from 2D whatever the viewport default is, then switch 3D on.
    await map2d.click();
    await expect(map2d).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => (await atlas.camera()).pitch).toBe(0);

    await map3d.click();
    await expect(map3d).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => (await atlas.camera()).pitch).toBeGreaterThan(0);
    await expect.poll(() => atlas.layerVisibility(LAYER_IDS.buildingExtrusion)).toBe('visible');

    // Rotate with the keyboard (MapLibre: Shift + arrow rotates by 15°).
    const bearingBefore = (await atlas.camera()).bearing;
    await atlas.mapCanvas.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await expect
      .poll(async () => Math.abs((await atlas.camera()).bearing - bearingBefore))
      .toBeGreaterThan(5);

    // Bring the target into view, clear the selection, then pick it on the map.
    await atlas.searchAndChoose(target.name);
    await expect.poll(() => atlas.selectedId()).toBe(target.id);
    await atlas.closePanel(atlas.panel(/place details/));
    await expect.poll(() => atlas.selectedId()).toBeNull();
    await expect.poll(() => atlas.renderedBuildingIds()).toContain(target.id);
    await atlas.dismissToasts();

    const point = await atlas.project(footprintCentre(target.id));
    expect(point, 'footprint centre projects onto the screen').not.toBeNull();
    await atlas.screenshot('3D before picking');
    await page.mouse.click(point!.x, point!.y);
    await expect.poll(() => atlas.selectedId()).toBe(target.id);
    await expect(atlas.placeArticle(target.name)).toBeVisible();
    await atlas.screenshot('3D building selected');

    // Back to 2D: flat camera, and the app still searches.
    await map2d.click();
    await expect(map2d).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => (await atlas.camera()).pitch).toBe(0);
    expect((await atlas.camera()).bearing).toBe(0);
    await expect.poll(() => atlas.layerVisibility(LAYER_IDS.buildingExtrusion)).toBe('none');
    const palette = await atlas.openSearch();
    await palette.getByRole('combobox').fill(target.name);
    await expect(atlas.paletteOption(target.name)).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(atlas.palette).toBeHidden();
  });
});
