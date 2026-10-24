/**
 * Public "Suggest a missing place" against the REAL server (tests/e2e/backend):
 * map placement (desktop click, phone centre pin), client validation, the
 * truthful "submitted for review" state, the honeypot, rate-limit feedback,
 * and that a submission never appears on the public map by itself.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { apiLogin, expect, isPhone, NEAR_PATHS, submitViaApi, test } from './backend/fixtures.ts';
import type { Atlas } from './fixtures/atlas.ts';

async function openSuggest(page: Page, atlas: Atlas) {
  await atlas.open({ view: '2d' });
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Suggest a missing place' }).click();
  await expect(page.getByRole('heading', { name: /Where is it\?/ })).toBeVisible();
}

/** Places the point: a click at NEAR_PATHS on desktop, the centre pin on phones. */
async function placePoint(page: Page, atlas: Atlas) {
  if (isPhone(page)) {
    await expect(page.getByTestId('edit-reticle')).toBeVisible();
    await page.getByRole('button', { name: 'Use this position' }).click();
  } else {
    const at = await atlas.project([NEAR_PATHS[0], NEAR_PATHS[1]]);
    expect(at).not.toBeNull();
    await page.mouse.click(at!.x, at!.y);
    await expect(page.getByText(/^Marker at 31\.25/)).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await expect(page.getByRole('heading', { name: /About the place/ })).toBeVisible();
}

test.describe('Suggest a missing place', () => {
  test('placement, validation, and a truthful submitted-for-review state', async ({
    page,
    atlas,
    api,
    shot,
    unique,
  }) => {
    const name = unique('E2E suggestion');
    await openSuggest(page, atlas);
    // While placing, a map click never selects a place.
    await shot('suggest-1-place');
    await placePoint(page, atlas);

    // Client validation mirrors the server: name and category are required.
    await page.getByRole('button', { name: 'Send for review' }).click();
    await expect(page.getByText("Enter the place's name (2–120 characters).")).toBeVisible();
    await expect(page.getByText('Choose what kind of place it is.')).toBeVisible();
    await expect(page.getByLabel('Name')).toBeFocused();
    await page.getByLabel('Evidence link (optional)').fill('not a link');
    await page.getByRole('button', { name: 'Send for review' }).click();
    await expect(page.getByText(/Enter a full web address/)).toBeVisible();
    await shot('suggest-2-errors');

    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Kind of place').selectOption({ label: 'Drinking water' });
    await page.getByLabel('Description (optional)').fill('Seen during the e2e run.');
    await page.getByLabel('Evidence link (optional)').fill('');
    await page.getByRole('button', { name: 'Send for review' }).click();

    const done = page.getByRole('heading', { name: 'Submitted for review' });
    await expect(done).toBeVisible();
    await expect(page.getByText(/will not appear on the public map until it is approved/)).toBeVisible();
    const reference = (await page.locator('code').filter({ hasText: /^sug_/ }).textContent())!.trim();
    await shot('suggest-3-submitted');

    // The server stored it as pending — and it is not in the public layer.
    await apiLogin(api);
    const stored = await api.get(`/api/admin/suggestions/${reference}`);
    expect(stored.status()).toBe(200);
    expect(
      ((await stored.json()) as { suggestion: { status: string; name: string } }).suggestion,
    ).toMatchObject({
      status: 'pending',
      name,
    });
    const pub = (await (await api.get('/api/locations')).json()) as { locations: Array<{ name: string }> };
    expect(pub.locations.map((l) => l.name)).not.toContain(name);

    // "Suggest another" starts over; closing returns the map to normal selection.
    await page.getByRole('button', { name: 'Suggest another place' }).click();
    await expect(page.getByRole('heading', { name: /Where is it\?/ })).toBeVisible();
  });

  test('a filled honeypot is accepted as a decoy and nothing is stored', async ({
    page,
    atlas,
    api,
    unique,
  }) => {
    const name = unique('E2E honeypot');
    await openSuggest(page, atlas);
    await placePoint(page, atlas);
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Kind of place').selectOption({ label: 'Drinking water' });
    // Only a bot would fill the hidden field (it is inert and outside the viewport).
    await page.locator('input[name="website"]').evaluate((el: HTMLInputElement) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(el, 'http://spam.example');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.getByRole('button', { name: 'Send for review' }).click();
    await expect(page.getByRole('heading', { name: 'Submitted for review' })).toBeVisible();
    const reference = (await page.locator('code').filter({ hasText: /^sug_/ }).textContent())!.trim();
    await apiLogin(api);
    expect((await api.get(`/api/admin/suggestions/${reference}`)).status()).toBe(404);
    const list = (await (
      await api.get(`/api/admin/suggestions?q=${encodeURIComponent(name)}&status=pending`)
    ).json()) as {
      items: unknown[];
    };
    expect(list.items).toHaveLength(0);
  });

  test('rate limiting is explained and nothing is claimed', async ({ page, atlas, api, shot, unique }) => {
    // Use up this client's window (5 per 10 minutes) through the real endpoint.
    for (let i = 0; i < 5; i++)
      await submitViaApi(api, { name: unique(`E2E burst ${i}`), categoryId: 'water', location: NEAR_PATHS });
    await openSuggest(page, atlas);
    await placePoint(page, atlas);
    await page.getByLabel('Name').fill(unique('E2E limited'));
    await page.getByLabel('Kind of place').selectOption({ label: 'Drinking water' });
    await page.getByRole('button', { name: 'Send for review' }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'Too many suggestions from this connection' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Nothing was saved');
    await expect(alert).toContainText(/try again in about \d+ (seconds|minutes)/);
    await expect(page.getByRole('heading', { name: 'Submitted for review' })).toHaveCount(0);
    await shot('suggest-4-rate-limited');
  });

  test('keyboard only: place at the map centre and send', async ({ page, atlas, unique }) => {
    test.skip(isPhone(page), 'Phones place with the centre pin.');
    await openSuggest(page, atlas);
    const centre = page.getByRole('button', { name: 'Use the map centre' });
    await centre.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/^Marker at 31\.\d{6}, 75\.\d{6}\.$/)).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: /About the place/ })).toBeFocused();
    await page.getByLabel('Name').focus();
    await page.keyboard.type(unique('E2E keyboard'));
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Kind of place')).toBeFocused();
    await page.getByLabel('Kind of place').selectOption({ label: 'Drinking water' });
    await page.getByRole('button', { name: 'Send for review' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Submitted for review' })).toBeVisible();
  });

  test('the suggestion panel passes axe', async ({ page, atlas }) => {
    await openSuggest(page, atlas);
    await placePoint(page, atlas);
    await page.getByRole('button', { name: 'Send for review' }).click();
    const results = await new AxeBuilder({ page })
      .include(isPhone(page) ? '[role="region"], [role="dialog"]' : 'aside')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
  });
});
