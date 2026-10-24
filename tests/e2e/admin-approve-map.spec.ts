/**
 * The approve dialog against the REAL server (tests/e2e/backend), on every
 * viewport:
 *  - a suggestion outside the campus boundary shows, BEFORE it is published,
 *    that it will appear only in the opt-in "Nearby, outside campus" layer and
 *    is not routable;
 *  - the access point is chosen on the map: a click lists the validated path
 *    nodes near it and the owner picks one (nothing is chosen automatically);
 *    the server stores exactly that node.
 */
import type { Page } from '@playwright/test';
import { expect, isPhone, NEAR_PATHS, submitViaApi, test } from './backend/fixtures.ts';

/** Just outside the campus boundary (beside the "Green valley main gate" context place). */
const OUTSIDE: readonly [number, number] = [75.69762, 31.25178];

type LngLat = [number, number];

/** The approve map's projection of a ground point (the approve map is the last one loaded). */
async function onApproveMap(page: Page, p: LngLat): Promise<{ x: number; y: number }> {
  const region = page.getByRole('region', { name: 'Map: position of the place to approve' });
  await region.scrollIntoViewIfNeeded();
  const box = (await region.boundingBox())!;
  let at: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        at = await page.evaluate(
          (q) =>
            window.__ATLAS_MAP__?.isStyleLoaded()
              ? window.__ATLAS_MAP__.projectToViewport(q as LngLat)
              : null,
          p,
        );
        return (
          at !== null && at.x > box.x && at.x < box.x + box.width && at.y > box.y && at.y < box.y + box.height
        );
      },
      { timeout: 30_000, message: 'the point is drawn inside the approve map' },
    )
    .toBe(true);
  return at!;
}

async function tapOrClick(page: Page, at: { x: number; y: number }): Promise<void> {
  if (isPhone(page)) await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
}

test.describe('Approve dialog', () => {
  test.setTimeout(150_000);

  test('a suggestion outside the campus boundary is flagged before publishing', async ({
    page,
    api,
    admin,
    shot,
    unique,
  }) => {
    const name = unique('E2E outside water');
    const ref = await submitViaApi(api, { name, categoryId: 'water', location: OUTSIDE });
    await admin.signIn(`/admin/queue/${ref}`);
    await page.getByRole('button', { name: 'Approve…' }).click();
    const notice = page.getByTestId('outside-campus-notice');
    await expect(notice).toContainText('Outside the campus boundary');
    await expect(notice).toContainText('only in the opt-in “Nearby, outside campus” map layer');
    await expect(notice).toContainText('not routable');
    await notice.scrollIntoViewIfNeeded();
    await shot('approve-1-outside-campus-notice');
    // Moving it onto the campus removes the notice.
    await page.getByLabel('Latitude').fill(String(NEAR_PATHS[1]));
    await page.getByLabel('Longitude').fill(String(NEAR_PATHS[0]));
    await page.getByLabel('Longitude').press('Enter');
    await expect(notice).toHaveCount(0);
  });

  test('the access point is chosen on the map from the validated nodes near the click', async ({
    page,
    api,
    admin,
    shot,
    unique,
  }) => {
    const name = unique('E2E map-picked water');
    const ref = await submitViaApi(api, { name, categoryId: 'water', location: NEAR_PATHS });
    await admin.signIn(`/admin/queue/${ref}?e2e=1`);
    await page.getByRole('button', { name: 'Approve…' }).click();
    await expect(page.getByTestId('outside-campus-notice')).toHaveCount(0);

    // The validated candidates (radio list); pick the second one on the map, not the nearest.
    const radios = page.getByRole('radio', { name: /^Path node \d+/ });
    await expect(radios.first()).toBeVisible();
    const labels = await radios.evaluateAll((els) =>
      els.map((el) => document.querySelector(`label[for="${el.id}"]`)?.textContent ?? ''),
    );
    const ids = labels.map((l) => Number(/Path node (\d+)/.exec(l)?.[1])).filter(Number.isInteger);
    expect(ids.length).toBeGreaterThan(1);
    const node = ids[1]!;
    const graph = (await (await page.request.get('/data/graph.json')).json()) as { nodes: LngLat[] };

    await page.getByTestId('access-pick-start').click();
    const pick = page.getByTestId('access-pick');
    await expect(pick).toContainText('nothing is chosen until you pick one');
    const at = await onApproveMap(page, graph.nodes[node]!);
    await tapOrClick(page, at);
    const choose = pick.getByRole('button', { name: `Use path node ${node}` });
    await expect(choose).toBeVisible();
    // A click never chooses by itself, and never moves the place.
    await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
    await expect(page.getByLabel('Longitude')).toHaveValue(String(NEAR_PATHS[0]));
    await pick.scrollIntoViewIfNeeded();
    await shot('approve-2-access-pick');
    await choose.click();
    await expect(pick).toHaveCount(0);
    await expect(page.getByRole('radio', { name: new RegExp(`^Path node ${node}\\b`) })).toBeChecked();

    await page.getByRole('button', { name: 'Approve and publish' }).click();
    await expect(page.getByText(/^Approved and published as/).first()).toBeVisible();
    const locationId = (await page.getByRole('link', { name: /^com:/ }).first().textContent())!.trim();
    // Read back with the page's own session (retried once if an idle keep-alive socket was reset).
    const read = () => page.request.get('/api/admin/locations');
    const r = await read().catch((e: unknown) => {
      if (/ECONNRESET|socket hang up/.test(String(e))) return read();
      throw e;
    });
    expect(r.status()).toBe(200);
    const stored = ((await r.json()) as { items: { id: string; accessNodeId: number | null }[] }).items.find(
      (l) => l.id === locationId,
    );
    expect(stored?.accessNodeId).toBe(node);
  });
});
