/**
 * Workflow D — live navigation with emulated GPS fixes along the real route:
 * progress, weak-GPS handling, off-route detection, and releasing the watch.
 */
import type { BrowserContext, Page } from '@playwright/test';
import type { LngLat } from '../../src/data/schema.ts';
import { distanceToRouteM, offsetPerpendicular, resample, ROUTE_PAIR } from './fixtures/data.ts';
import { planRoute } from './fixtures/flows.ts';
import { expect, test } from './fixtures/test.ts';

const { from, to, route } = ROUTE_PAIR;

declare global {
  interface Window {
    __GEO_WATCH__?: { started: number; cleared: number; active: number[] };
  }
}

/** Counts browser geolocation watches so the test can prove they are released. */
async function instrumentGeolocation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const geo = navigator.geolocation;
    const stats = { started: 0, cleared: 0, active: [] as number[] };
    window.__GEO_WATCH__ = stats;
    const watch = geo.watchPosition.bind(geo);
    const clear = geo.clearWatch.bind(geo);
    geo.watchPosition = (ok, err, opts) => {
      const id = watch(ok, err, opts);
      stats.started++;
      stats.active.push(id);
      return id;
    };
    geo.clearWatch = (id) => {
      stats.cleared++;
      stats.active = stats.active.filter((x) => x !== id);
      clear(id);
    };
  });
}

const geoStats = (page: Page) => page.evaluate(() => window.__GEO_WATCH__!);

/** Parses "250 m left · 4 min" into metres. */
function metresLeft(text: string): number {
  const m = /(\d+(?:\.\d+)?)\s*(km|m) left/.exec(text);
  if (!m) throw new Error(`No remaining distance in "${text}"`);
  return Number(m[1]) * (m[2] === 'km' ? 1000 : 1);
}

test.describe('D · live navigation', () => {
  test('progress follows fixes; weak GPS pauses it; leaving the route warns; ending releases GPS', async ({
    atlas,
    context,
    page,
  }) => {
    test.slow();
    await instrumentGeolocation(page);
    await context.grantPermissions(['geolocation']);
    const path = resample(route.coordinates, 15);
    // Walk only the first part of the route, so arrival never triggers.
    const walk = path.slice(0, Math.max(4, Math.floor(path.length * 0.6)));
    expect(walk.length, 'route long enough for several fixes').toBeGreaterThanOrEqual(4);

    let accuracy = 10;
    /** Sends one fix and waits until the HUD shows it (each fix has a different accuracy). */
    const fix = async (ctx: BrowserContext, p: LngLat, acc?: number) => {
      accuracy = acc ?? (accuracy >= 24 ? 10 : accuracy + 1);
      await ctx.setGeolocation({ longitude: p[0], latitude: p[1], accuracy });
    };
    await fix(context, walk[0]!);

    await planRoute(atlas, from, to);
    expect((await geoStats(page)).started, 'no location watch before navigation').toBe(0);
    await page.getByRole('button', { name: 'Start navigation' }).click();

    const hud = page.getByText(/ left · /).first();
    await expect(hud).toBeVisible();
    const gps = page.getByText(/^GPS ±\d+ m$|^Weak GPS signal/).first();
    await expect(gps).toHaveText(`GPS ±${accuracy} m`);
    await expect.poll(() => atlas.userLocationShown()).toBe(true);
    expect((await geoStats(page)).active.length).toBe(1);

    // 1. Walk along the route: the remaining distance never grows and ends lower.
    const remaining: number[] = [metresLeft(await hud.innerText())];
    for (const p of walk.slice(1)) {
      await fix(context, p);
      await expect(gps).toHaveText(`GPS ±${accuracy} m`);
      remaining.push(metresLeft(await hud.innerText()));
    }
    for (let i = 1; i < remaining.length; i++) expect(remaining[i]!).toBeLessThanOrEqual(remaining[i - 1]!);
    expect(remaining.at(-1)!).toBeLessThan(remaining[0]!);
    await expect(page.getByRole('progressbar', { name: 'Route progress' })).not.toHaveAttribute(
      'aria-valuenow',
      '0',
    );
    await atlas.screenshot('navigating');

    // 2. An inaccurate fix further along: weak-GPS state, progress does not jump.
    const before = await hud.innerText();
    const ahead = path[Math.min(path.length - 1, walk.length + 3)]!;
    await fix(context, ahead, 200);
    await expect(gps).toHaveText('Weak GPS signal — progress paused');
    await expect(hud).toHaveText(before);

    // 3. Walk away from the route at right angles until well off it.
    const here = walk.at(-1)!;
    const next = path[walk.length] ?? to.location;
    const side = [1, -1].find(
      (s) => distanceToRouteM(offsetPerpendicular(here, next, 100 * s), route.coordinates) > 80,
    );
    expect(side, 'a direction that leads away from the whole route').toBeDefined();
    for (const d of [20, 40, 60, 80, 100, 101, 102, 103]) {
      await fix(context, offsetPerpendicular(here, next, d * side!));
      await expect(gps).toHaveText(`GPS ±${accuracy} m`);
    }
    await expect(page.getByText('You seem to be off the route', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Recalculate from here' })).toBeVisible();
    await atlas.screenshot('off route');

    // 4. End navigation: location was never switched on by the user, so it is released.
    await page.getByRole('button', { name: 'End navigation' }).first().click();
    await expect(hud).toBeHidden();
    await expect.poll(() => atlas.userLocationShown()).toBe(false);
    const stats = await geoStats(page);
    expect(stats.started).toBeGreaterThanOrEqual(1);
    expect(stats.active, 'every browser watch was cleared').toEqual([]);
    expect(stats.cleared).toBe(stats.started);
  });

  test('with location permission denied, navigation explains why and holds no watch', async ({
    atlas,
    context,
    page,
  }) => {
    await instrumentGeolocation(page);
    await context.clearPermissions();
    await planRoute(atlas, from, to);
    await page.getByRole('button', { name: 'Start navigation' }).click();
    await expect(page.getByText(/Location access is blocked/).first()).toBeVisible();
    await expect.poll(() => atlas.userLocationShown()).toBe(false);
    await expect.poll(async () => (await geoStats(page)).active).toEqual([]);
  });
});
