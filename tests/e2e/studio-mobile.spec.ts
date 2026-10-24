/**
 * Building Studio on a phone against the REAL server (tests/e2e/backend):
 * centre-reticle placement, large step buttons, the bottom-sheet inspector
 * and large Save / Cancel — then the saved draft survives a reload.
 *
 * Layout on a phone: the admin header and section tabs stay compact (the
 * Studio map gets most of the height) and the state chip is never cut off.
 */
import type { Page } from '@playwright/test';
import { haversineM } from '../../src/distance/geodesic.ts';
import { expect, isPhone, test } from './backend/fixtures.ts';

/** Admin header + section tabs, at most this tall on a phone. */
const MAX_ADMIN_CHROME_PX = 120;

/** The state chip's text fits its box (not truncated) and the chip lies inside the viewport. */
async function expectChipFullyVisible(page: Page): Promise<void> {
  const chip = page.getByTestId('studio-state-label');
  await expect(chip).toBeVisible();
  const m = await chip.evaluate((el) => {
    // The badge's text span (truncated with an ellipsis when it does not fit).
    const text = el.querySelector('span.truncate') ?? el;
    const r = el.getBoundingClientRect();
    return {
      clipped: text.scrollWidth > text.clientWidth + 1 || text.scrollHeight > text.clientHeight + 1,
      left: r.left,
      right: r.right,
      vw: window.innerWidth,
    };
  });
  expect(m.clipped, 'state chip text is cut off').toBe(false);
  expect(m.left).toBeGreaterThanOrEqual(0);
  expect(m.right).toBeLessThanOrEqual(m.vw);
}

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
    // Compact admin chrome: header + section tabs leave the Studio most of the height.
    const header = (await page.getByRole('banner').boundingBox())!;
    const tabs = (await page.getByRole('navigation', { name: 'Admin sections' }).boundingBox())!;
    expect(tabs.y + tabs.height - header.y).toBeLessThanOrEqual(MAX_ADMIN_CHROME_PX);
    const map = (await page.getByTestId('studio-map').boundingBox())!;
    expect(map.height).toBeGreaterThan(page.viewportSize()!.height / 2);

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
    // The long "unsaved" label wraps instead of being cut off.
    await expectChipFullyVisible(page);
    await shot('studio-mobile-1b-unsaved-chip');

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
    await expectChipFullyVisible(page);
  });

  test('leaving for another section with unsaved changes asks first; the edits stay recoverable', async ({
    page,
    admin,
    shot,
  }) => {
    const state = page.getByTestId('studio-state-label');
    await admin.signIn('/admin/studio');
    await page.getByRole('button', { name: 'Library' }).click();
    await page.getByTestId('studio-template-canteen-kiosk').click();
    await page.getByTestId('studio-place-template').click();
    await page.getByTestId('studio-confirm-placement').click();
    await expect(state).toContainText('Unsaved local changes');
    await page.waitForTimeout(600); // crash recovery is written after a short pause

    const nav = admin.nav();
    await nav.getByRole('link', { name: 'Moderation queue' }).click();
    const dialog = page.getByRole('dialog', { name: 'Leave the Building Studio?' });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/studio$/);
    await shot('studio-mobile-4-leave-guard');
    await dialog.getByTestId('studio-leave-keep').click();
    await expect(dialog).toBeHidden();
    await expect(state).toContainText('Unsaved local changes');

    await nav.getByRole('link', { name: 'Moderation queue' }).click();
    await page
      .getByRole('dialog', { name: 'Leave the Building Studio?' })
      .getByTestId('studio-leave-confirm')
      .click();
    await expect(page).toHaveURL(/\/admin\/queue/);
    await expect(page.getByRole('heading', { name: 'Moderation queue', level: 1 })).toBeVisible();

    // Back in the Studio: the never-saved building is offered for recovery.
    await nav.getByRole('link', { name: 'Building Studio' }).click();
    await expect(page.getByTestId('studio-recovery')).toBeVisible();
    await page.getByTestId('studio-recovery').getByRole('button', { name: 'Restore them' }).click();
    await expect(state).toContainText('Unsaved local changes');
  });

  test('access point: chosen on the map with a tap, from the validated nodes near it', async ({
    page,
    admin,
    shot,
  }) => {
    const state = page.getByTestId('studio-state-label');
    await admin.signIn('/admin/studio?e2e=1');
    // The read-only map hook is installed when the map loads with e2e=1 in the URL (saving changes the URL).
    await page.waitForFunction(() => window.__ATLAS_MAP__?.isStyleLoaded() === true, null, {
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Library' }).click();
    await page.getByTestId('studio-template-canteen-kiosk').click();
    await page.getByTestId('studio-place-template').click();
    await page.getByTestId('studio-confirm-placement').click();
    await page.getByTestId('studio-mobile-save').click();
    await expect(state).toContainText('Saved draft (rev 1)');
    const id = decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!);
    const record = async () => {
      const get = () => page.request.get(`/api/admin/studio/buildings/${encodeURIComponent(id)}`);
      // Retried once if an idle keep-alive socket was reset.
      const r = await get().catch((e: unknown) => {
        if (/ECONNRESET|socket hang up/.test(String(e))) return get();
        throw e;
      });
      return r.json() as Promise<unknown>;
    };
    const rec = (await record()) as {
      draft: { model: { anchor: [number, number] } };
    };
    const anchor = rec.draft.model.anchor;
    const graph = (await (await page.request.get('/data/graph.json')).json()) as {
      nodes: [number, number][];
      edges: { from: number; to: number; foot: boolean }[];
    };
    let node = -1;
    let best = Infinity;
    for (const e of graph.edges)
      for (const n of e.foot ? [e.from, e.to] : []) {
        const d = haversineM(anchor, graph.nodes[n]!);
        if (d < best) [best, node] = [d, n];
      }
    expect(best, 'a walkable node near the placed kiosk').toBeLessThan(45);

    await page.getByTestId('studio-open-properties').click();
    await page.getByTestId('studio-access-pick-start').click();
    // The sheet makes room for the map; the picking card explains what a tap does.
    const card = page.getByTestId('studio-access-pick');
    await expect(card).toContainText('Nothing is chosen until you pick one.');
    await expect(page.getByRole('region', { name: 'Properties' })).toHaveCount(0);
    await page.waitForTimeout(500);
    const at = await page.evaluate((p) => window.__ATLAS_MAP__!.projectToViewport(p), graph.nodes[node]!);
    await page.touchscreen.tap(at!.x, at!.y);
    await expect(card.getByTestId(`studio-access-choose-${node}`)).toBeVisible();
    await expect(state).toContainText('Saved draft (rev 1)');
    await shot('studio-mobile-5-access-pick');
    await card.getByTestId(`studio-access-choose-${node}`).click();
    await expect(card).toHaveCount(0);
    // The properties sheet comes back, showing the chosen node.
    const sheet = page.getByRole('region', { name: 'Properties' });
    await expect(sheet.getByLabel('Path node id')).toHaveValue(String(node));
    await sheet.getByRole('button', { name: 'Close' }).first().click();
    await page.getByTestId('studio-mobile-save').click();
    await expect(state).toContainText('Saved draft (rev 2)');
    const saved = (await record()) as {
      draft: { accessNodeId: number | null };
    };
    expect(saved.draft.accessNodeId).toBe(node);
  });
});
