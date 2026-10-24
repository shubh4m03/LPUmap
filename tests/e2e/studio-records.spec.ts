/**
 * Building Studio record operations end to end against the REAL server
 * (tests/e2e/backend: the production build + the real handlers over a fresh
 * local D1), on the desktop, laptop and tablet layouts:
 *
 *  - model an existing base building (same public id) → save → publish;
 *  - apply a template version with the server's preview diff;
 *  - choose the access point on the map (validated nodes only);
 *  - duplicate → archive → permanent delete with a typed confirmation;
 *  - a 409 conflict between two browser contexts, resolved both ways.
 *
 * The database is shared by every test of the run, so each project works on
 * its own spot / building.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { haversineM } from '../../src/distance/geodesic.ts';
import { adminPassword, CLIENT_HEADER } from './backend/config.ts';
import { expect, isPhone, test } from './backend/fixtures.ts';

type LngLat = [number, number];

const state = (page: Page) => page.getByTestId('studio-state-label');

/** One placement spot per project (on campus, near walkable paths). */
const SPOTS: Record<string, LngLat> = {
  desktop: [75.70305, 31.25345],
  laptop: [75.7037, 31.2537],
  tablet: [75.70345, 31.25325],
};
/** Each project models a different base building (index into the on-screen candidates). */
const BASE_PICK: Record<string, number> = { desktop: 0, laptop: 1, tablet: 2 };

/** Narrow layouts start with the side panels collapsed: open them when needed. */
async function showPanel(page: Page, which: 'library' | 'inspector'): Promise<void> {
  const id = which === 'library' ? 'studio-left-panel' : 'studio-inspector';
  // The toggle states whether its panel is open (aria-expanded); wait for the workspace first.
  const toggle = page.locator(`button[aria-controls="${id}"]`);
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(page.locator(`#${id}`)).toBeVisible();
}

/** Places a kiosk at `spot` from typed coordinates and saves it; returns the new record id. */
async function placeAndSave(page: Page, spot: LngLat, name?: string): Promise<string> {
  await showPanel(page, 'library');
  await page.getByRole('searchbox', { name: 'Search templates' }).fill('kiosk');
  await page.getByTestId('studio-template-canteen-kiosk').click();
  await page.getByTestId('studio-place-template').click();
  await expect(state(page)).toHaveText(/Placing/);
  await page.getByTestId('studio-place-lon').fill(String(spot[0]));
  await page.getByTestId('studio-place-lat').fill(String(spot[1]));
  await page.getByTestId('studio-place-lat').press('Tab');
  await page.getByTestId('studio-confirm-placement').click();
  await expect(state(page)).toHaveText('Unsaved local changes (not on the server yet)');
  if (name) {
    await showPanel(page, 'inspector');
    await page.getByTestId('studio-tool-info').click();
    await page.getByTestId('studio-name').fill(name);
  }
  await page.getByTestId('studio-save').click();
  await expect(state(page)).toHaveText('Saved draft (rev 1)');
  await expect(page).toHaveURL(/\/admin\/studio\/stu%3A[a-z2-7]+/);
  return recordId(page);
}

const recordId = (page: Page): string => decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!);

/**
 * GET an admin API path with the page's own signed-in session (no second login). Retried once
 * on a reset connection: Node closes idle keep-alive sockets, and a reused one can be reset.
 */
async function adminGet(page: Page, path: string): Promise<{ status: number; body: unknown }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await page.request.get(path);
      return {
        status: r.status(),
        body: r.headers()['content-type']?.includes('json') ? await r.json() : null,
      };
    } catch (e) {
      if (attempt > 0 || !/ECONNRESET|socket hang up/.test(String(e))) throw e;
    }
  }
}

/** A studio record as the server holds it (status and body). */
async function getRecord(page: Page, id: string): Promise<{ status: number; body: unknown }> {
  return adminGet(page, `/api/admin/studio/buildings/${encodeURIComponent(id)}`);
}

async function signedInContext(
  browser: Browser,
  client: string,
  path: string,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    extraHTTPHeaders: { [CLIENT_HEADER]: client },
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  await page.goto(path);
  await page.getByLabel('Owner password').fill(adminPassword());
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('studio-workspace')).toBeVisible();
  return { ctx, page };
}

async function acknowledgeAll(page: Page): Promise<void> {
  const fields = page.locator('[data-testid^="studio-ack-"]');
  const n = await fields.count();
  for (let i = 0; i < n; i++) await fields.nth(i).fill('E2E check: acknowledged for the automated test');
}

async function toViewport(page: Page, p: LngLat): Promise<{ x: number; y: number }> {
  const q = await page.evaluate((x) => window.__ATLAS_MAP__!.projectToViewport(x as [number, number]), p);
  if (!q) throw new Error(`not projectable: ${p.join(',')}`);
  return q;
}

/** Even–odd test of a screen point against a screen polygon. */
function insideRing(p: { x: number; y: number }, ring: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

async function mapReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__ATLAS_MAP__?.isStyleLoaded() === true, null, { timeout: 30_000 });
}

test.describe('Building Studio records (desktop, laptop, tablet)', () => {
  test.skip(({ page }) => isPhone(page), 'desktop and tablet layouts');
  test.setTimeout(240_000);

  test('model an existing base building: same public id, footprint authoritative, published', async ({
    page,
    admin,
    shot,
  }, testInfo) => {
    await admin.signIn('/admin/studio?e2e=1');
    await mapReady(page);
    // 2D: a click on a footprint's ground position hits that footprint (no taller neighbour in front).
    await page.getByRole('radio', { name: '2D' }).click();
    await page.waitForTimeout(800);
    await page.getByTestId('studio-tool-select').click();

    const fc = (await (await page.request.get('/data/buildings.geojson')).json()) as {
      features: {
        properties: { id: string; isBuildingPart?: boolean };
        geometry: { type: string; coordinates: LngLat[][] };
      }[];
    };
    const box = (await page.getByTestId('studio-map').boundingBox())!;
    const rendered: string[] = await page.evaluate(() => window.__ATLAS_MAP__!.queryRenderedBuildingIds());
    const usable: { id: string; at: { x: number; y: number } }[] = [];
    const shown = fc.features.filter(
      (f) =>
        rendered.includes(f.properties.id) &&
        f.geometry.type === 'Polygon' &&
        !f.properties.id.startsWith('stu:'),
    );
    // Outer rings in viewport pixels (one round trip).
    const rings = await page.evaluate(
      (rs) => rs.map((r) => r.map((p) => window.__ATLAS_MAP__!.projectToViewport(p as LngLat)!)),
      shown.map((f) => f.geometry.coordinates[0]!),
    );
    for (const [k, f] of shown.entries()) {
      // A click point INSIDE the drawn footprint (not just its vertex average: many are L- or U-shaped),
      // on a footprint big enough on screen to hit, away from the tool rail and the overlays.
      const ring = rings[k]!;
      const xs = ring.map((p) => p.x);
      const ys = ring.map((p) => p.y);
      if (Math.max(...xs) - Math.min(...xs) < 24 || Math.max(...ys) - Math.min(...ys) < 24) continue;
      const q = { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 };
      if (!insideRing(q, ring)) continue;
      if (
        q.x > box.x + 140 &&
        q.x < box.x + box.width - 60 &&
        q.y > box.y + 120 &&
        q.y < box.y + box.height - 150
      )
        usable.push({ id: f.properties.id, at: q });
    }
    expect(usable.length).toBeGreaterThan(3);
    // The first not-yet-modelled building (from this project's offset) whose click opens the picked
    // card: a footprint may lie under another one (building parts) or a label.
    const picked = page.getByTestId('studio-picked');
    let baseId: string | null = null;
    for (const u of usable.slice(BASE_PICK[testInfo.project.name] ?? 0).slice(0, 8)) {
      const existing = await adminGet(
        page,
        `/api/admin/studio/buildings?targetId=${encodeURIComponent(u.id)}`,
      );
      if (existing.status !== 200 || (existing.body as { items: unknown[] }).items.length > 0) continue;
      await page.mouse.click(u.at.x, u.at.y);
      const hit = await picked
        .filter({ hasText: u.id })
        .waitFor({ state: 'visible', timeout: 3_000 })
        .then(() => true)
        .catch(() => false);
      if (hit) {
        baseId = u.id;
        break;
      }
    }
    expect(baseId, 'a base building nobody has modelled yet, picked on the map').not.toBeNull();
    // The Select tool highlights the picked footprint (the Studio's own selection, same id).
    expect(await page.evaluate(() => window.__ATLAS_MAP__!.getSelectedId())).toBe(baseId);
    await shot('studio-records-1-picked-base');
    await picked.getByRole('button', { name: 'Model this building' }).click();
    await expect(state(page)).toHaveText(/Unsaved local changes/);
    // The mapped footprint stays authoritative: no move / rotate / resize.
    for (const tool of ['move', 'rotate', 'resize'])
      await expect(page.getByTestId(`studio-tool-${tool}`)).toBeDisabled();
    await showPanel(page, 'inspector');
    await page.getByTestId('studio-tool-info').click();
    await expect(page.locator('#studio-section-info')).toContainText(`Its public id stays ${baseId}`);
    await page.getByTestId('studio-tool-appearance').click();
    await page.getByRole('button', { name: /Red brick/ }).click();
    await page.getByTestId('studio-save').click();
    await expect(state(page)).toHaveText('Saved draft (rev 1)');
    const id = recordId(page);
    const rec = (await getRecord(page, id)).body as { head: { targetId: string | null } };
    expect(rec.head.targetId).toBe(baseId);
    await shot('studio-records-2-modelled-base');

    await expect(page.getByTestId('studio-publish')).toBeEnabled({ timeout: 20_000 });
    await page.getByTestId('studio-publish').click();
    const dialog = page.getByRole('dialog', { name: /Publish/ });
    await dialog.getByTestId('studio-change-summary').fill('E2E: model of an existing mapped building');
    await acknowledgeAll(page);
    await dialog.getByTestId('studio-confirm-publish').click();
    await expect(state(page)).toHaveText('Published (version 1)');

    // Public: the base id selects the modelled building in Realistic 3D (no second record).
    const pub = await page.context().newPage();
    await pub.goto(`/?place=${encodeURIComponent(baseId!)}&view=3d&e2e=1`);
    await expect
      .poll(() => pub.evaluate(() => window.__ATLAS_MAP__?.getSelectedId() ?? null), { timeout: 30_000 })
      .toBe(baseId);
    await expect
      .poll(() => pub.evaluate(() => window.__ATLAS_MAP__?.getRealistic3D()?.layer?.instances ?? 0))
      .toBeGreaterThan(0);
    await pub.close();
  });

  test('apply template with the preview diff → access point chosen on the map → duplicate → delete', async ({
    page,
    admin,
    shot,
    unique,
  }, testInfo) => {
    const spot = SPOTS[testInfo.project.name] ?? SPOTS.desktop!;
    await admin.signIn('/admin/studio?e2e=1');
    await mapReady(page);
    const id = await placeAndSave(page, spot, unique('E2E records kiosk'));

    // --- apply template: the server previews the change (dry run), then applies and saves it ---
    await showPanel(page, 'inspector');
    const inspector = page.locator('#studio-inspector');
    await inspector.locator('#studio-section-template summary').click();
    await inspector.getByLabel('Apply template').selectOption({ label: 'Canteen / kiosk' });
    await inspector
      .getByLabel('Variant')
      .selectOption({ label: 'Canteen with side canopy, mono-pitch roof' });
    await inspector.getByRole('button', { name: 'Preview changes' }).click();
    const diff = page.getByTestId('studio-template-diff');
    await expect(diff).toContainText('checked by the server, nothing saved yet');
    expect(await diff.locator('tbody tr').count()).toBeGreaterThan(0);
    await diff.scrollIntoViewIfNeeded();
    await shot('studio-records-3-template-diff');
    // Nothing was written by the preview.
    expect(((await getRecord(page, id)).body as { head: { draftRevision: number } }).head.draftRevision).toBe(
      1,
    );
    await diff.getByRole('button', { name: /^Apply template v\d+/ }).click();
    await expect(state(page)).toHaveText('Saved draft (rev 2)');
    const applied = (await getRecord(page, id)).body as {
      draft: { templateRef: { templateId: string; variantId: string } };
    };
    expect(applied.draft.templateRef).toMatchObject({
      templateId: 'canteen-kiosk',
      variantId: 'side-canopy-shed',
    });

    // --- access point: chosen on the map among the validated nodes ---
    const graph = (await (await page.request.get('/data/graph.json')).json()) as {
      nodes: LngLat[];
      edges: { from: number; to: number; foot: boolean }[];
    };
    const walkable = new Set<number>();
    for (const e of graph.edges) if (e.foot) walkable.add(e.from).add(e.to);
    let node = -1;
    let best = Infinity;
    for (const n of walkable) {
      const d = haversineM(spot, graph.nodes[n]!);
      if (d < best) {
        best = d;
        node = n;
      }
    }
    expect(best, 'a walkable node near the spot').toBeLessThan(45);
    await page.getByTestId('studio-tool-info').click();
    await page.getByTestId('studio-access-pick-start').click();
    const card = page.getByTestId('studio-access-pick');
    await expect(card).toContainText('Nothing is chosen until you pick one.');
    await page.waitForTimeout(500);
    const at = await toViewport(page, graph.nodes[node]!);
    await page.mouse.click(at.x, at.y);
    await expect(card.getByTestId(`studio-access-choose-${node}`)).toBeVisible();
    // Nothing chosen and nothing moved by the click.
    await expect(state(page)).toHaveText('Saved draft (rev 2)');
    await shot('studio-records-4-access-pick');
    await card.getByTestId(`studio-access-choose-${node}`).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByLabel('Path node id')).toHaveValue(String(node));
    await page.getByTestId('studio-save').click();
    await expect(state(page)).toHaveText('Saved draft (rev 3)');
    expect(((await getRecord(page, id)).body as { draft: { accessNodeId: number } }).draft.accessNodeId).toBe(
      node,
    );

    // --- duplicate: a new unpublished draft beside the original ---
    await page.getByTestId('studio-duplicate').click();
    await expect.poll(() => recordId(page)).not.toBe(id);
    await expect(state(page)).toHaveText('Saved draft (rev 1)');
    const dupId = recordId(page);
    expect(dupId).not.toBe(id);
    expect(dupId).toMatch(/^stu:/);
    await expect(page.getByTestId('studio-notice')).toContainText('Duplicated as a new unpublished draft');
    const dup = (await getRecord(page, dupId)).body as {
      head: { publishedVersion: number | null };
      draft: { accessNodeId: number | null; model: { anchor: LngLat } };
    };
    expect(dup.head.publishedVersion).toBeNull();
    expect(dup.draft.accessNodeId).toBeNull();
    // Beside the original (offset by the server), not on top of it.
    expect(haversineM(dup.draft.model.anchor, spot)).toBeGreaterThan(5);
    await shot('studio-records-5-duplicate');

    // --- archive, then permanent delete with the exact id typed ---
    await page.getByTestId('studio-archive').click();
    await page.getByTestId('studio-confirm-archive').click();
    await expect(state(page)).toHaveText('Archived');
    await page.getByTestId('studio-delete').click();
    const confirm = page.getByTestId('studio-confirm-delete');
    await expect(confirm).toBeDisabled();
    await page.getByTestId('studio-delete-confirm').fill(`${dupId}x`);
    await expect(page.getByText('The id does not match.')).toBeVisible();
    await expect(confirm).toBeDisabled();
    await shot('studio-records-6-delete-confirm');
    await page.getByTestId('studio-delete-confirm').fill(dupId);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(state(page)).toHaveText('Nothing open');
    await expect(page).toHaveURL(/\/admin\/studio$/);
    expect((await getRecord(page, dupId)).status).toBe(404);
    // The original is untouched.
    expect((await getRecord(page, id)).status).toBe(200);
  });

  test('409 conflict between two browsers: overwrite with mine, or load the server version', async ({
    page,
    admin,
    browser,
    client,
    shot,
  }, testInfo) => {
    const base = SPOTS[testInfo.project.name] ?? SPOTS.desktop!;
    const spot: LngLat = [base[0] + 0.0004, base[1] - 0.0003];
    await admin.signIn('/admin/studio');
    const id = await placeAndSave(page, spot);
    const other = await signedInContext(browser, client, `/admin/studio/${encodeURIComponent(id)}`);
    const b = other.page;
    await expect(state(b)).toHaveText('Saved draft (rev 1)');

    const preset = async (p: Page, label: RegExp) => {
      await showPanel(p, 'inspector');
      await p.getByTestId('studio-tool-appearance').click();
      await p.getByRole('button', { name: label }).click();
      return p.getByTestId('studio-wall-colour').inputValue();
    };

    // A saves first; B, still on revision 1, is refused with the server's current state.
    const brick = await preset(page, /Red brick/);
    await page.getByTestId('studio-save').click();
    await expect(state(page)).toHaveText('Saved draft (rev 2)');
    const sand = await preset(b, /Sandstone/);
    expect(sand).not.toBe(brick);
    await b.getByTestId('studio-save').click();
    const conflict = b.getByTestId('studio-conflict');
    await expect(conflict).toContainText('This building was changed elsewhere.');
    await expect(conflict).toContainText('Your changes are kept here and were not saved.');
    await expect(state(b)).toHaveText(/Unsaved local changes/);
    await shot('studio-records-7-conflict-a');
    await b.screenshot({ path: testInfo.outputPath('conflict-b.png') });
    await testInfo.attach('studio-records-7-conflict-b', { path: testInfo.outputPath('conflict-b.png') });

    // B keeps its changes: re-checked and saved over the new revision.
    await conflict.getByRole('button', { name: 'Re-check and save mine over it' }).click();
    await expect(conflict).toHaveCount(0);
    await expect(state(b)).toHaveText('Saved draft (rev 3)');
    await page.reload();
    await expect(state(page)).toHaveText('Saved draft (rev 3)');
    await showPanel(page, 'inspector');
    await page.getByTestId('studio-tool-appearance').click();
    await expect(page.getByTestId('studio-wall-colour')).toHaveValue(sand);

    // Now B saves again and A (on revision 3) drops its edit for the server version.
    await preset(b, /Red brick/);
    await b.getByTestId('studio-save').click();
    await expect(state(b)).toHaveText('Saved draft (rev 4)');
    await page.getByRole('button', { name: 'Move 1 m north' }).click();
    await page.getByTestId('studio-save').click();
    const conflictA = page.getByTestId('studio-conflict');
    await expect(conflictA).toBeVisible();
    await conflictA.getByRole('button', { name: 'Load the server version (drop my changes)' }).click();
    await expect(state(page)).toHaveText('Saved draft (rev 4)');
    await page.getByTestId('studio-tool-appearance').click();
    await expect(page.getByTestId('studio-wall-colour')).toHaveValue(brick);
    await other.ctx.close();
  });
});
