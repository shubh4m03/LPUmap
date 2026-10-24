/**
 * Moderation and owner locations end to end against the REAL server and a
 * persistent (per run) local D1: nothing is mocked, every state change is
 * written by the server and read back through a new page load.
 */
import type { Page } from '@playwright/test';
import { expect, isPhone, NEAR_PATHS, submitViaApi, test } from './backend/fixtures.ts';
import type { Atlas } from './fixtures/atlas.ts';

test.describe.configure({ timeout: 150_000 });

/** Public app, fresh load: does search offer `name`? (The publication is merged before the app is ready.) */
async function publicHas(page: Page, atlas: Atlas, name: string): Promise<boolean> {
  await atlas.open({ view: '2d' });
  const palette = await atlas.openSearch();
  await palette.getByRole('combobox').fill(name);
  const option = atlas.paletteOption(name);
  const found = await option
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  await page.keyboard.press('Escape');
  return found;
}

/** Sets the position fields of a point editor (works for desktop and the phone layout). */
async function typePosition(page: Page, at: readonly [number, number]) {
  await page.getByLabel('Latitude').fill(String(at[1]));
  await page.getByLabel('Longitude').fill(String(at[0]));
  await page.getByLabel('Longitude').press('Enter');
}

test.describe('Moderation', () => {
  test('public suggestion → queue → approve with an access point → public → hide → gone → restore', async ({
    page,
    atlas,
    admin,
    shot,
    unique,
  }) => {
    const name = unique('E2E cafe');

    // 1. A visitor suggests the place on the public map.
    await atlas.open({ view: '2d' });
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: 'Suggest a missing place' }).click();
    if (isPhone(page)) {
      await page.getByRole('button', { name: 'Use this position' }).click();
    } else {
      const at = await atlas.project([NEAR_PATHS[0], NEAR_PATHS[1]]);
      await page.mouse.click(at!.x, at!.y);
      await page.getByRole('button', { name: 'Continue' }).click();
    }
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Kind of place').selectOption({ label: 'Drinking water' });
    await page.getByRole('button', { name: 'Send for review' }).click();
    await expect(page.getByRole('heading', { name: 'Submitted for review' })).toBeVisible();
    expect(await publicHas(page, atlas, name)).toBe(false);

    // 2. The owner finds it in the pending queue.
    await admin.signIn(`/admin/queue?q=${encodeURIComponent(name)}`);
    const list = page.getByRole('list', { name: 'Suggestions' });
    await expect(list.getByRole('link', { name: new RegExp(name) })).toBeVisible();
    await shot('moderation-1-queue');
    await list.getByRole('link', { name: new RegExp(name) }).click();
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(page.getByText('Pending', { exact: true }).first()).toBeVisible();
    await shot('moderation-2-detail');

    // 3. Approve with an access point chosen from the validated path nodes (none is preselected).
    await page.getByRole('button', { name: 'Approve…' }).click();
    if (isPhone(page)) await typePosition(page, NEAR_PATHS);
    const nearest = page.getByRole('radio', { name: /^Path node \d+ \(nearest\)/ });
    await expect(nearest).toBeVisible();
    await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Approve and publish' }).click();
    await expect(page.getByText('Choose an access point, or “No access point”.')).toBeVisible();
    await nearest.check();
    await shot('moderation-3-approve');
    await page.getByRole('button', { name: 'Approve and publish' }).click();
    const published = page.getByText(/^Approved and published as/).first();
    await expect(published).toBeVisible();
    const locationId = (await page.getByRole('link', { name: /^com:/ }).first().textContent())!.trim();
    await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();

    // 4. It is public now (new page load).
    expect(await publicHas(page, atlas, name)).toBe(true);

    // 5. Hide → gone from the public map.
    await admin.goto(`/admin/locations/${encodeURIComponent(locationId)}`);
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(page.getByText('Not routable')).toHaveCount(0);
    await page.getByRole('button', { name: 'Hide from the public map' }).click();
    await expect(page.getByText('Hidden', { exact: true }).first()).toBeVisible();
    await shot('moderation-4-hidden');
    expect(await publicHas(page, atlas, name)).toBe(false);

    // 6. Restore → public again.
    await admin.goto(`/admin/locations?status=hidden`);
    await page
      .getByRole('list', { name: 'Locations' })
      .getByRole('link', { name: new RegExp(name) })
      .click();
    await page.getByRole('button', { name: 'Restore to the public map' }).click();
    await expect(page.getByText('Published', { exact: true }).first()).toBeVisible();
    expect(await publicHas(page, atlas, name)).toBe(true);

    // 7. The history shows every step.
    await admin.goto(`/admin/audit?entity=location&entityId=${encodeURIComponent(locationId)}`);
    const events = page.getByRole('list', { name: 'History events' });
    for (const label of ['Location created', 'Location hidden', 'Location restored'])
      await expect(events.getByText(label, { exact: true })).toBeVisible();
    await shot('moderation-5-history');
  });

  test('reject with a private reason, mark a duplicate, reopen', async ({
    page,
    api,
    admin,
    shot,
    unique,
  }) => {
    const a = unique('E2E reject');
    const b = unique('E2E dup');
    const refA = await submitViaApi(api, { name: a, categoryId: 'water', location: NEAR_PATHS });
    const refB = await submitViaApi(api, { name: b, categoryId: 'water', location: NEAR_PATHS });

    await admin.signIn(`/admin/queue/${refA}`);
    await expect(page.getByRole('heading', { name: a, level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Reject…' }).click();
    const reject = page.getByRole('dialog', { name: 'Reject this suggestion' });
    await reject.getByLabel('Reason (optional, private)').fill('Could not be confirmed on site.');
    await reject.getByRole('button', { name: 'Reject' }).click();
    await expect(reject).toBeHidden();
    await expect(page.getByText('Rejected', { exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Review' }).getByText('Could not be confirmed on site.'),
    ).toBeVisible();

    await admin.goto(`/admin/queue/${refB}`);
    await page.getByRole('button', { name: 'Mark as duplicate…' }).click();
    const dup = page.getByRole('dialog', { name: 'Mark as a duplicate' });
    await dup.getByLabel('Duplicate of (record id)').fill(refA);
    await dup.getByRole('button', { name: 'Mark as duplicate' }).click();
    await expect(dup).toBeHidden();
    await expect(page.getByText('Duplicate', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(refA).first()).toBeVisible();
    await shot('moderation-6-duplicate');

    // The status filters list them under their new states (read back from the server).
    await admin.goto(`/admin/queue?status=rejected&q=${encodeURIComponent(a)}`);
    await expect(
      page.getByRole('list', { name: 'Suggestions' }).getByRole('link', { name: new RegExp(a) }),
    ).toBeVisible();
    await admin.goto(`/admin/queue?status=duplicate&q=${encodeURIComponent(b)}`);
    await expect(
      page.getByRole('list', { name: 'Suggestions' }).getByRole('link', { name: new RegExp(b) }),
    ).toBeVisible();

    // Reopen the rejected one.
    await admin.goto(`/admin/queue/${refA}`);
    await page.getByRole('button', { name: 'Reopen' }).click();
    await page
      .getByRole('dialog', { name: 'Reopen this suggestion' })
      .getByRole('button', { name: 'Reopen' })
      .click();
    await expect(page.getByText('Pending', { exact: true }).first()).toBeVisible();

    // History of the suggestion records each decision.
    for (const label of ['Suggestion rejected', 'Suggestion reopened'])
      await expect(
        page.getByRole('list', { name: 'History events' }).getByText(label, { exact: true }),
      ).toBeVisible();
  });

  test('owner location: add, edit, revert from history, hide, delete with typed confirmation', async ({
    page,
    admin,
    atlas,
    shot,
    unique,
  }) => {
    const name = unique('E2E owner place');
    const renamed = `${name} renamed`;
    await admin.signIn('/admin/locations');
    await page.getByRole('button', { name: 'Add location' }).click();
    await expect(page.getByRole('heading', { name: 'New location', level: 1 })).toBeVisible();
    if (isPhone(page)) {
      // Phones place with the centre pin; the typed position below then refines it.
      await expect(page.getByTestId('edit-reticle')).toBeVisible();
      await page.getByRole('button', { name: 'Place at the centre pin' }).click();
      await expect(page.getByLabel('Latitude')).not.toHaveValue('');
    }
    await typePosition(page, NEAR_PATHS);
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Category').selectOption({ label: 'Drinking water' });
    await page.getByRole('radio', { name: 'No access point' }).check();
    await shot('locations-1-new');
    await page.getByRole('button', { name: 'Create and publish' }).click();
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(page.getByText('Not routable')).toBeVisible();
    const id = decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!);
    expect(id).toMatch(/^own:/);

    // Edit the name.
    await page.getByLabel('Name').fill(renamed);
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { name: renamed, level: 1 })).toBeVisible();

    // Revert the edit from the history.
    await admin.goto(`/admin/audit?entity=location&entityId=${encodeURIComponent(id)}`);
    const edited = page.getByRole('listitem').filter({ hasText: 'Location edited' });
    await edited.getByRole('button', { name: 'Revert…' }).click();
    await page
      .getByRole('dialog', { name: 'Revert this change?' })
      .getByRole('button', { name: 'Revert' })
      .click();
    await expect(
      page.getByRole('list', { name: 'History events' }).getByText('Location reverted'),
    ).toBeVisible();
    await admin.goto(`/admin/locations/${encodeURIComponent(id)}`);
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();

    // Hide, then delete permanently (typed confirmation must match exactly).
    await page.getByRole('button', { name: 'Hide from the public map' }).click();
    await page.getByRole('button', { name: 'Delete permanently…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete this location permanently?' });
    const confirm = dialog.getByRole('button', { name: 'Delete permanently' });
    await dialog.getByRole('textbox').fill(name.toLowerCase());
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('textbox').fill(name);
    await shot('locations-2-delete');
    await confirm.click();
    await expect(page.getByRole('heading', { name: 'Locations', level: 1 })).toBeVisible();
    await admin.goto(`/admin/locations/${encodeURIComponent(id)}`);
    await expect(page.getByText('This location does not exist')).toBeVisible();
    expect(await publicHas(page, atlas, name)).toBe(false);
  });
});
