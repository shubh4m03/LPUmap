/**
 * G-24 — live-navigation arrival and the walk summary, end to end, with
 * deterministic fixes (fixtures/fake-geolocation.ts): every fix carries a
 * timestamp the test chose, so the app's own progress and tracker modules,
 * run here in Node on the same samples, predict the exact numbers on screen.
 */
import type { LngLat } from '../../src/data/schema.ts';
import { destinationPoint } from '../../src/distance/geodesic.ts';
import { formatDistance, formatDuration, formatSpeed } from '../../src/distance/format.ts';
import type { GeoSample } from '../../src/geolocation/types.ts';
import { createRouteProgress, createTrackingSession } from '../../src/navigation/index.ts';
import type { RouteOk } from '../../src/routing/index.ts';
import { seeded } from '../unit/navigation/gps-fixtures.ts';
import { computeRoute, PLACES, resample, ROUTE_PAIR, type LocatedPlace } from './fixtures/data.ts';
import { fakeWatchCount, installFakeGeolocation, pushFix } from './fixtures/fake-geolocation.ts';
import { planRoute } from './fixtures/flows.ts';
import { expect, test } from './fixtures/test.ts';

const ACCURACY_M = 10;

/** Named on-campus buildings with a unique name, a position and a path node (as fixtures/data.ts picks them). */
function campusBuildings(): LocatedPlace[] {
  const counts = new Map<string, number>();
  for (const p of PLACES)
    if (p.name) counts.set(p.name.toLowerCase(), (counts.get(p.name.toLowerCase()) ?? 0) + 1);
  return PLACES.filter(
    (p): p is LocatedPlace =>
      typeof p.name === 'string' &&
      counts.get(p.name.toLowerCase()) === 1 &&
      p.location !== null &&
      typeof p.graphNodeId === 'number' &&
      p.kind === 'building' &&
      p.campusZone === 'on-campus',
  ).sort((a, b) => a.name.localeCompare(b.name));
}

/** The first pair (by name) whose walking route is 150–400 m: short enough to walk in a test. */
function shortPair(): { from: LocatedPlace; to: LocatedPlace; route: RouteOk } {
  const buildings = campusBuildings();
  for (const from of buildings) {
    for (const to of buildings) {
      if (from === to) continue;
      const r = computeRoute(from, to);
      if (r.ok && r.distanceM >= 150 && r.distanceM <= 400 && r.coordinates.length > 2)
        return { from, to, route: r };
    }
  }
  throw new Error('The dataset has no pair of named campus buildings 150–400 m apart by path.');
}

const sample = (p: LngLat, t: number, accuracyM = ACCURACY_M): GeoSample => ({
  lngLat: p,
  accuracyM,
  timestamp: t,
  speedMps: null,
  headingDeg: null,
});

/** A clock start a little ahead of real time, on a whole second, so the page clock only moves forward. */
const clockStart = () => Math.ceil((Date.now() + 10_000) / 1000) * 1000;

test.describe('G-24 · arrival and walk summary', () => {
  test('walking a route to its end shows the arrival card with the predicted numbers', async ({
    atlas,
    page,
  }) => {
    test.slow();
    const { from, to, route } = shortPair();
    await installFakeGeolocation(page);
    await planRoute(atlas, from, to);
    const directions = atlas.panel('Directions');
    await expect(directions.getByTestId('route-summary')).toHaveText(
      `${formatDistance(route.distanceM)} · ${formatDuration(route.durationS)}`,
    );

    // Predict, with the app's own modules, when arrival fires and what the card shows.
    const t0 = clockStart();
    const path = [...resample(route.coordinates, 12), route.coordinates.at(-1)!, route.coordinates.at(-1)!];
    const progress = createRouteProgress(route);
    const trip = createTrackingSession(t0);
    let arrivedAt = -1;
    let tripSnap = trip.snapshot(t0);
    let planned = route.distanceM;
    for (let i = 0; i < path.length && arrivedAt < 0; i++) {
      const t = t0 + (i + 1) * 1000;
      const state = progress.update(sample(path[i]!, t), t);
      tripSnap = trip.addSample(sample(path[i]!, t), t);
      planned = state.plannedDistanceM;
      if (state.arrived) arrivedAt = i;
    }
    expect(arrivedAt, 'the walk reaches the destination').toBeGreaterThan(0);

    await page.clock.setFixedTime(t0);
    await page.getByRole('button', { name: 'Start navigation' }).click();
    await expect(page.getByText(/ left · /).first()).toBeVisible();
    await expect.poll(() => fakeWatchCount(page)).toBe(1);

    for (let i = 0; i <= arrivedAt; i++) await pushFix(page, t0 + (i + 1) * 1000, path[i]!);

    const arrived = page.getByText('You have arrived', { exact: true });
    await expect(arrived).toBeVisible();
    await expect(page.getByText(`You are at ${to.displayName}.`)).toBeVisible();
    const card = page.locator('dl').filter({ hasText: 'Covered (GPS, approximate)' });
    await expect(card.locator('dt + dd').nth(0)).toHaveText(formatDistance(planned));
    await expect(card.locator('dt + dd').nth(1)).toHaveText(formatDistance(tripSnap.travelledM));
    await expect(card.locator('dt + dd').nth(2)).toHaveText(formatDuration(tripSnap.elapsedS));
    await atlas.screenshot('arrived');

    // Ending navigation releases the location watch.
    await page.getByRole('button', { name: 'End navigation' }).first().click();
    await expect(arrived).toBeHidden();
    await expect.poll(() => fakeWatchCount(page)).toBe(0);
  });

  test('tracking a walk and stopping it shows the walk summary, and nothing is stored', async ({
    atlas,
    page,
  }) => {
    test.slow();
    await installFakeGeolocation(page);
    const start = ROUTE_PAIR.from;
    await atlas.open({ place: start.id });
    await atlas.placeArticle(start.name).getByRole('button', { name: 'Directions to here' }).click();
    const directions = atlas.panel('Directions');
    await expect(directions.getByRole('button', { name: 'Track my walk' })).toBeEnabled();

    // 40 s north at 1.3 m/s, then 15 s standing, one fix a second with ±3 m seeded noise.
    const r = seeded(24);
    const fixes: LngLat[] = [];
    for (let i = 0; i <= 55; i++) {
      const truth = destinationPoint(start.location, 0, 1.3 * Math.min(i, 40));
      fixes.push(destinationPoint(truth, r() * 360, Math.sqrt(r()) * 3));
    }
    const t0 = clockStart();
    const session = createTrackingSession(t0);
    let live = session.snapshot(t0);
    fixes.forEach((p, i) => {
      const t = t0 + (i + 1) * 1000;
      live = session.addSample(sample(p, t), t);
    });
    const tEnd = t0 + (fixes.length + 2) * 1000;
    const summary = session.stop(tEnd);
    expect(summary.travelledM, 'the fixture walks a measurable distance').toBeGreaterThan(30);
    expect(summary.averageSpeedMps).not.toBeNull();

    await page.clock.setFixedTime(t0);
    await directions.getByRole('button', { name: 'Track my walk' }).click();
    const card = page.getByRole('heading', { name: 'Tracking your walk' });
    await expect(card).toBeVisible();
    await expect.poll(() => fakeWatchCount(page)).toBe(1);
    for (let i = 0; i < fixes.length; i++) await pushFix(page, t0 + (i + 1) * 1000, fixes[i]!);
    const lastT = t0 + fixes.length * 1000;
    await expect(
      page.getByText(`${formatDistance(live.travelledM)} · ${formatDuration((lastT - t0) / 1000)}`),
    ).toBeVisible();

    await page.clock.setFixedTime(tEnd);
    await page.getByRole('button', { name: 'Stop tracking' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Walk summary' });
    await expect(dialog).toBeVisible();
    const values = dialog.locator('dd');
    await expect(values.nth(0)).toHaveText(formatDistance(summary.travelledM));
    await expect(values.nth(1)).toHaveText(formatDuration(summary.elapsedS));
    await expect(values.nth(2)).toHaveText(formatSpeed(summary.averageSpeedMps!));
    // Tracking without navigation has no planned route row.
    await expect(values).toHaveCount(3);
    await expect(dialog).toContainText('Nothing was saved');
    await atlas.screenshot('walk summary');
    await expect.poll(() => fakeWatchCount(page)).toBe(0);

    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
    // No fix, path or summary is written to browser storage.
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    for (const p of [fixes[0]!, fixes.at(-1)!]) {
      expect(stored).not.toContain(p[0].toFixed(5));
      expect(stored).not.toContain(p[1].toFixed(5));
    }
  });
});
