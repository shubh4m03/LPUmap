/** Workflow C — routing between two real, connected places; profiles; clearing the route. */
import { formatDistance, formatDuration } from '../../src/distance/format.ts';
import type { RouteProfileId } from '../../src/routing/index.ts';
import { computeRoute, ROUTE_PAIR } from './fixtures/data.ts';
import { planRoute } from './fixtures/flows.ts';
import { expect, test } from './fixtures/test.ts';

const { from, to } = ROUTE_PAIR;
/** Any "<distance> · <duration>" route summary. */
const SUMMARY_PATTERN = /(< 10 m|\d+(\.\d)? k?m) · (under 1 min|\d+ (min|h))/;
const PROFILE_LABEL: Record<RouteProfileId, string> = {
  walk: 'Walk',
  cycle: 'Cycle',
  'step-free': 'Step-free',
};

test.describe('C · routing', () => {
  test('walk, cycle and step-free routes between two connected places, then clear', async ({
    atlas,
    page,
  }) => {
    await planRoute(atlas, from, to);
    const directions = atlas.panel('Directions');
    const summary = directions.getByTestId('route-summary');

    for (const profile of ['walk', 'cycle', 'step-free'] as const) {
      await directions.getByRole('radio', { name: PROFILE_LABEL[profile] }).check();
      const expected = computeRoute(from, to, profile);
      if (expected.ok) {
        // Distance and time exactly as the app's own router computes them for this profile.
        await expect(summary).toHaveText(
          `${formatDistance(expected.distanceM)} · ${formatDuration(expected.durationS)}`,
        );
        await expect.poll(() => atlas.routeCoordinateCount()).toBe(expected.coordinates.length);
        expect(expected.coordinates.length).toBeGreaterThan(1);
        // Every caveat the router attaches is shown (step-free: "accessibility not verified").
        for (const caveat of expected.caveats) await expect(directions).toContainText(caveat.message);
        if (profile === 'step-free')
          expect(expected.caveats.map((c) => c.code)).toContain('accessibility-unverified');
      } else {
        // An honest failure: the explanation is shown and nothing is drawn.
        await expect(directions.getByRole('alert')).toContainText(expected.message);
        await expect.poll(() => atlas.routeCoordinateCount()).toBe(0);
      }
      await atlas.screenshot(`route ${profile}`);
    }

    await directions.getByRole('button', { name: 'Clear route' }).click();
    await expect.poll(() => atlas.routeCoordinateCount()).toBe(0);
    await expect(directions.getByTestId('route-summary')).toHaveCount(0);
    await expect(page.getByText(SUMMARY_PATTERN)).toHaveCount(0);
  });
});
