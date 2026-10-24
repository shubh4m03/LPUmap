/**
 * Building Studio on a phone against the REAL server (tests/e2e/backend):
 * centre-reticle placement, large step buttons, the bottom-sheet inspector
 * and large Save / Cancel — then the saved draft survives a reload.
 */
import { expect, isPhone, test } from './backend/fixtures.ts';

test.describe('Building Studio (phone)', () => {
  test.skip(({ page }) => !isPhone(page), 'phone layout');
  test.setTimeout(180_000);

  test('reticle placement → step buttons → properties sheet → Save → reload', async ({
    page,
    admin,
    shot,
    unique,
  }) => {
    const name = unique('E2E studio kiosk');
    const state = page.getByTestId('studio-state-label');
    await admin.signIn('/admin/studio');
    await expect(page.getByTestId('studio-workspace')).toHaveAttribute('data-layout', 'mobile');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );

    await page.getByRole('button', { name: 'Library' }).click();
    await page.getByTestId('studio-template-canteen-kiosk').click();
    await page.getByTestId('studio-place-template').click();
    // The centre pin: the building goes where the map centre is.
    await expect(page.getByTestId('edit-reticle')).toBeVisible();
    await expect(state).toContainText('Placing');
    await expect(page.getByTestId('studio-placement-check')).toContainText(
      /checked by the server|Warning|Error/,
    );
    await shot('studio-mobile-1-placement');
    await page.getByTestId('studio-confirm-placement').click();
    await expect(page.getByTestId('edit-reticle')).toHaveCount(0);
    await expect(state).toContainText('Unsaved local changes');

    // Large step buttons.
    await page.getByRole('button', { name: 'Move / rotate / size' }).click();
    for (const label of ['Move 1 m north', 'Rotate 15° clockwise', 'Increase width by 1 m'])
      await page.getByRole('button', { name: label }).click();
    await shot('studio-mobile-2-step-buttons');
    await page.getByRole('button', { name: 'Hide move buttons' }).click();

    // Bottom-sheet inspector.
    await page.getByTestId('studio-open-properties').click();
    const sheet = page
      .getByRole('region', { name: 'Properties' })
      .or(page.getByRole('dialog', { name: 'Properties' }));
    await expect(sheet).toBeVisible();
    await sheet.getByTestId('studio-name').fill(name);
    await shot('studio-mobile-3-property-editing');
    await sheet.getByRole('button', { name: 'Close' }).first().click();

    await page.getByTestId('studio-mobile-save').click();
    await expect(state).toContainText('Saved draft (rev 1)');
    await expect(page).toHaveURL(/\/admin\/studio\/stu%3A/);
    await page.reload();
    await expect(state).toContainText('Saved draft (rev 1)');
    await page.getByTestId('studio-open-properties').click();
    await expect(page.getByTestId('studio-name')).toHaveValue(name);
  });
});
