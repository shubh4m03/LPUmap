/** Keyboard-only use: skip link, search trigger, palette navigation, Escape layering, focus return. */
import type { Locator, Page } from '@playwright/test';
import { CAMPUS_BUILDING } from './fixtures/data.ts';
import { expect, test } from './fixtures/test.ts';

const place = CAMPUS_BUILDING;

/** Presses Tab until `target` has focus (at most `max` presses). */
async function tabTo(page: Page, target: Locator, max = 25) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

test.describe('keyboard only @a11y', () => {
  test('Tab to search, choose a result with the arrows, Escape back to the trigger @a11y', async ({
    atlas,
    page,
  }) => {
    await atlas.open();
    await page.locator('body').focus();

    // The skip link is the first stop.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to the map and panels' })).toBeFocused();

    const trigger = page.getByRole('button', { name: /^Search places/ });
    await tabTo(page, trigger);
    await page.keyboard.press('Enter');
    const combobox = atlas.palette.getByRole('combobox');
    await expect(combobox).toBeFocused();

    await page.keyboard.type(place.name);
    const target = atlas.paletteOption(place.name);
    await expect(target).toHaveAttribute('aria-selected', 'true');
    const options = atlas.palette.getByRole('option');
    expect(await options.count()).toBeGreaterThan(1);
    // Arrow away and back: the active option follows, focus stays in the input.
    await page.keyboard.press('ArrowDown');
    await expect(target).toHaveAttribute('aria-selected', 'false');
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowUp');
    await expect(target).toHaveAttribute('aria-selected', 'true');
    await expect(combobox).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(atlas.palette).toBeHidden();
    await expect.poll(() => atlas.selectedId()).toBe(place.id);
    const article = atlas.placeArticle(place.name);
    await expect(article.getByRole('heading', { level: 3, name: place.name })).toBeVisible();
    // Closing the palette returns focus to the control that opened it.
    await expect(trigger).toBeFocused();

    // The details are reachable by Tab from there.
    const directions = article.getByRole('button', { name: 'Directions to here' });
    await tabTo(page, directions);

    // Escape closes the topmost layer (the details); focus is not dropped to <body> but
    // returns to the search trigger.
    await page.keyboard.press('Escape');
    await expect(article).toBeHidden();
    await expect.poll(() => atlas.selectedId()).toBeNull();
    await expect(trigger).toBeFocused();

    // The palette: first Escape clears the query, the second closes it; focus returns.
    await page.keyboard.press('Enter');
    await expect(combobox).toBeFocused();
    await page.keyboard.type(place.name);
    await page.keyboard.press('Escape');
    await expect(combobox).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(atlas.palette).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('Ctrl/⌘+K from the page: the chosen place’s name receives focus @a11y', async ({ atlas, page }) => {
    test.skip(atlas.isMobile, 'the keyboard shortcut is advertised on the desktop layout');
    await atlas.open();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(atlas.palette.getByRole('combobox')).toBeFocused();
    await page.keyboard.type(place.name);
    await expect(atlas.paletteOption(place.name)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(atlas.palette).toBeHidden();
    // Nothing on the page held focus before, so it moves to the new details' heading.
    await expect(
      atlas.placeArticle(place.name).getByRole('heading', { level: 3, name: place.name }),
    ).toBeFocused();
  });
});
