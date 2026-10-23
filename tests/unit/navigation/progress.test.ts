import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';
import type { LngLat } from '../../../src/data/schema.ts';
import { destinationPoint, haversineM, polylineLengthM } from '../../../src/distance/index.ts';
import type { GeoSample } from '../../../src/geolocation/index.ts';
import { createRouteProgress } from '../../../src/navigation/index.ts';

const T0 = 1_800_000_000_000;
const A: LngLat = [75.7032, 31.2533];

/** Synthetic L route: 200 m north, then 100 m east. */
const B = destinationPoint(A, 0, 200);
const C = destinationPoint(B, 90, 100);
const L_ROUTE = { coordinates: [A, B, C], distanceM: polylineLengthM([A, B, C]), durationS: 300 / 1.3 };

/** Walks a scripted list of positions, one fix every `stepS` seconds. */
function feeder(progress: ReturnType<typeof createRouteProgress>, stepS = 10) {
  let t = T0;
  return (lngLat: LngLat, accuracyM = 8) => {
    t += stepS * 1000;
    const sample: GeoSample = { lngLat, accuracyM, timestamp: t, speedMps: null, headingDeg: null };
    return progress.update(sample, t);
  };
}

const along = (d: number, sideM = 0): LngLat => {
  const onRoute = d <= 200 ? destinationPoint(A, 0, d) : destinationPoint(B, 90, d - 200);
  const sideBearing = d <= 200 ? 270 : 0;
  return sideM ? destinationPoint(onRoute, sideBearing, sideM) : onRoute;
};

describe('createRouteProgress — L-shaped route', () => {
  it('has no state before the first update and rejects empty routes', () => {
    expect(createRouteProgress(L_ROUTE).state).toBeNull();
    expect(() => createRouteProgress({ coordinates: [], distanceM: 0, durationS: 0 })).toThrow(RangeError);
  });

  it('advances, decreasing remaining distance and time along the geometry', () => {
    const progress = createRouteProgress(L_ROUTE);
    const feed = feeder(progress);
    let lastRemaining = Infinity;
    for (const d of [0, 40, 90, 150, 210, 260]) {
      const s = feed(along(d, 5));
      expect(s.lastSampleAccepted).toBe(true);
      expect(s.distanceAlongM).toBeCloseTo(d, 0);
      expect(s.remainingM).toBeLessThan(lastRemaining);
      expect(s.remainingM).toBeCloseTo(300 - d, 0);
      expect(s.remainingS).toBeCloseTo(s.remainingM * (L_ROUTE.durationS / L_ROUTE.distanceM), 6);
      expect(s.distanceFromRouteM).toBeCloseTo(5, 0);
      expect(s.offRoute).toBe(false);
      expect(polylineLengthM(s.completedCoords) + polylineLengthM(s.remainingCoords)).toBeCloseTo(300, 3);
      lastRemaining = s.remainingM;
    }
  });

  it('labels the straight-line distance separately from the route distance', () => {
    const feed = feeder(createRouteProgress(L_ROUTE));
    const s = feed(along(150));
    expect(s.straightLineToDestinationM).toBeCloseTo(haversineM(along(150), C), 6);
    expect(s.straightLineToDestinationM).toBeLessThan(s.remainingM);
    expect(s.plannedDistanceM).toBeCloseTo(300, 6);
  });

  it('splits completed and remaining geometry at the snapped point', () => {
    const feed = feeder(createRouteProgress(L_ROUTE));
    const s = feed(along(230, 4));
    expect(s.completedCoords[0]).toEqual(A);
    expect(s.completedCoords).toContainEqual(B);
    expect(s.completedCoords.at(-1)).toEqual(s.snappedPoint);
    expect(s.remainingCoords[0]).toEqual(s.snappedPoint);
    expect(s.remainingCoords.at(-1)).toEqual(C);
  });

  it('does not let a single inaccurate fix flag off-route, but three consecutive far fixes do', () => {
    const feed = feeder(createRouteProgress(L_ROUTE));
    feed(along(50));
    const once = feed(along(60, 70));
    expect(once.offRoute).toBe(false);
    expect(once.distanceFromRouteM).toBeCloseTo(70, 0);
    expect(once.distanceAlongM).toBeCloseTo(50, 0); // far fixes never advance progress
    expect(feed(along(70)).offRoute).toBe(false);

    // A rejected (low-accuracy) fix neither counts as far nor resets the counter.
    const n = APP_CONFIG.tracking.offRouteConsecutive;
    const states = [];
    for (let i = 0; i < n; i++) {
      states.push(feed(along(70, 60 + i * 5)));
      if (i === 0) {
        const rejected = feed(along(70, 500), 400);
        expect(rejected.lastSampleAccepted).toBe(false);
        expect(rejected.rejection).toBe('low-accuracy');
      }
    }
    expect(states.slice(0, -1).every((s) => !s.offRoute)).toBe(true);
    expect(states.at(-1)!.offRoute).toBe(true);
    // Returning to the route clears it.
    expect(feed(along(80)).offRoute).toBe(false);
  });

  it('uses the larger of offRouteBaseM and the fix accuracy as the off-route threshold', () => {
    const feed = feeder(createRouteProgress(L_ROUTE));
    feed(along(50));
    for (let i = 0; i < 4; i++) {
      const s = feed(along(50, 40), 45);
      expect(s.offRoute).toBe(false);
    }
  });

  it('requires consecutive fixes near the destination to arrive', () => {
    const feed = feeder(createRouteProgress(L_ROUTE));
    feed(along(200));
    expect(feed(along(290)).arrived).toBe(false);
    expect(feed(along(240)).arrived).toBe(false); // streak broken (no backward progress either)
    const first = feed(along(295));
    expect(first.arrived).toBe(false);
    const second = feed(destinationPoint(C, 0, 6));
    expect(second.arrived).toBe(true);
    expect(second.remainingM).toBeLessThan(APP_CONFIG.tracking.arrivalRadiusM);
  });

  it('keeps state unchanged on rejected samples', () => {
    const progress = createRouteProgress(L_ROUTE);
    const feed = feeder(progress);
    const before = feed(along(100));
    const stale = progress.update(
      { lngLat: along(180), accuracyM: 5, timestamp: T0, speedMps: null, headingDeg: null },
      T0 + 10 * 60_000,
    );
    expect(stale.lastSampleAccepted).toBe(false);
    expect(stale.rejection).toBe('stale');
    expect(stale.distanceAlongM).toBe(before.distanceAlongM);
    expect(progress.state).toBe(stale);
  });

  it('reports unknown snapped point and straight-line distance before any accepted fix', () => {
    const progress = createRouteProgress(L_ROUTE);
    const s = progress.update(
      { lngLat: A, accuracyM: 200, timestamp: T0, speedMps: null, headingDeg: null },
      T0,
    );
    expect(s.snappedPoint).toBeNull();
    expect(s.distanceFromRouteM).toBeNull();
    expect(Number.isNaN(s.straightLineToDestinationM)).toBe(true);
    expect(s.completedCoords).toEqual([]);
    expect(s.remainingM).toBeCloseTo(300, 6);
  });
});

describe('createRouteProgress — route that doubles back', () => {
  // 100 m north and back to a point 5 m east of the start.
  const top = destinationPoint(A, 0, 100);
  const end = destinationPoint(A, 90, 5);
  const coords = [A, top, end];
  const route = { coordinates: coords, distanceM: polylineLengthM(coords), durationS: 160 };

  it('snaps to the outbound leg at the start and does not arrive there', () => {
    const feed = feeder(createRouteProgress(route), 5);
    const s1 = feed(destinationPoint(A, 0, 10));
    expect(s1.distanceAlongM).toBeCloseTo(10, 0);
    const s2 = feed(destinationPoint(A, 0, 3));
    expect(s2.arrived).toBe(false);
    const s3 = feed(destinationPoint(A, 0, 4));
    expect(s3.arrived).toBe(false);
  });

  it('does not jump to the return leg when a fix lands slightly behind on the outbound leg', () => {
    const feed = feeder(createRouteProgress(route), 5);
    for (const d of [5, 20, 35, 50]) feed(destinationPoint(A, 0, d));
    const noisy = feed(destinationPoint(A, 0, 47));
    expect(noisy.distanceAlongM).toBeCloseTo(50, 0);
    expect(feed(destinationPoint(A, 0, 58)).distanceAlongM).toBeCloseTo(58, 0);
  });

  it('keeps progress monotonic through GPS noise and the turn-around', () => {
    const feed = feeder(createRouteProgress(route), 5);
    let last = -1;
    const outbound = [5, 20, 35, 50, 45, 65, 80, 95, 100];
    for (const d of outbound) {
      const s = feed(destinationPoint(A, 0, d));
      expect(s.distanceAlongM).toBeGreaterThanOrEqual(last);
      last = s.distanceAlongM;
    }
    expect(last).toBeCloseTo(100, 0);
    // Walking back south: each point lies on both legs; progress must follow the return leg.
    for (const d of [85, 70, 55, 40, 25]) {
      const s = feed(destinationPoint(A, 0, d));
      expect(s.distanceAlongM).toBeGreaterThan(last);
      expect(s.distanceAlongM).toBeCloseTo(200 - d, -1);
      last = s.distanceAlongM;
    }
    const near1 = feed(destinationPoint(end, 0, 3));
    const near2 = feed(destinationPoint(end, 0, 2));
    expect(near1.arrived).toBe(false);
    expect(near2.arrived).toBe(true);
  });
});

describe('createRouteProgress — re-acquiring the route ahead', () => {
  // U-shape: 300 m north, 60 m east, 300 m south.
  const p1 = destinationPoint(A, 0, 300);
  const p2 = destinationPoint(p1, 90, 60);
  const p3 = destinationPoint(p2, 180, 300);
  const coords = [A, p1, p2, p3];
  const route = { coordinates: coords, distanceM: polylineLengthM(coords), durationS: 500 };

  it('jumps ahead after consecutive confirmations instead of flagging off-route', () => {
    const feed = feeder(createRouteProgress(route), 15);
    feed(destinationPoint(A, 0, 20));
    // Cut straight across to the far leg (a shortcut the planner did not take).
    const states = [40, 35, 30].map((up) => feed(destinationPoint(p3, 0, up)));
    expect(states.every((s) => !s.offRoute)).toBe(true);
    expect(states[0]!.distanceAlongM).toBeCloseTo(20, 0);
    expect(states[2]!.distanceAlongM).toBeGreaterThan(600);
    expect(states[2]!.remainingM).toBeCloseTo(30, 0);
  });
});
