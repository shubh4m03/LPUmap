import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';
import type { LngLat } from '../../../src/data/schema.ts';
import { destinationPoint, haversineM } from '../../../src/distance/index.ts';
import type { GeoSample } from '../../../src/geolocation/index.ts';
import { createTrackingSession } from '../../../src/navigation/index.ts';

const T0 = 1_800_000_000_000;
const HOME: LngLat = [75.7032, 31.2533];

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A point displaced uniformly within a disk of `radiusM`. */
function jitter(p: LngLat, radiusM: number, r: () => number): LngLat {
  return destinationPoint(p, r() * 360, Math.sqrt(r()) * radiusM);
}

function sample(lngLat: LngLat, timestamp: number, accuracyM = 10): GeoSample {
  return { lngLat, accuracyM, timestamp, speedMps: null, headingDeg: null };
}

describe('createTrackingSession', () => {
  it('adds ~0 m for 50 stationary samples jittering within half the jitter threshold', () => {
    // accuracy 10 m → threshold max(4, 10 × 0.6) = 6 m; any two fixes within 3 m of a point are ≤ 6 m apart.
    const r = rng(2024);
    const session = createTrackingSession(T0);
    let naive = 0;
    let prev: LngLat | null = null;
    let snap = session.snapshot(T0);
    for (let i = 1; i <= 50; i++) {
      const p = jitter(HOME, 3, r);
      if (prev) naive += haversineM(prev, p);
      prev = p;
      snap = session.addSample(sample(p, T0 + i * 1000), T0 + i * 1000);
    }
    expect(snap.acceptedSamples).toBe(50);
    expect(snap.travelledM).toBeLessThan(1);
    expect(naive).toBeGreaterThan(100); // what raw sample-to-sample summing would have reported
    expect(snap.movement).toBe('stationary');
    expect(snap.path).toHaveLength(1);
  });

  it('counts a step only beyond max(minStepM, accuracy × accuracyFactor) from the anchor', () => {
    const { minStepM, accuracyFactor } = APP_CONFIG.tracking;
    const accuracy = 20;
    const thresholdM = Math.max(minStepM, accuracy * accuracyFactor);
    const session = createTrackingSession(T0);
    session.addSample(sample(HOME, T0 + 1000, accuracy), T0 + 1000);
    // Creeping in small steps: each is measured from the anchor, not the previous fix.
    const below = session.addSample(
      sample(destinationPoint(HOME, 0, thresholdM - 0.5), T0 + 5000, accuracy),
      T0 + 5000,
    );
    expect(below.travelledM).toBe(0);
    const above = session.addSample(
      sample(destinationPoint(HOME, 0, thresholdM + 0.5), T0 + 9000, accuracy),
      T0 + 9000,
    );
    expect(above.travelledM).toBeCloseTo(thresholdM + 0.5, 6);
    expect(above.path).toHaveLength(2);
    // With a sharper fix the minimum step applies.
    const sharp = createTrackingSession(T0);
    sharp.addSample(sample(HOME, T0 + 1000, 2), T0 + 1000);
    expect(
      sharp.addSample(sample(destinationPoint(HOME, 0, minStepM + 0.1), T0 + 4000, 2), T0 + 4000).travelledM,
    ).toBeGreaterThan(0);
  });

  it('measures a straight 200 m walk within 5 %', () => {
    const r = rng(99);
    const session = createTrackingSession(T0);
    let snap = session.snapshot(T0);
    // 1.3 m/s for 154 s ≈ 200 m, fixes every second with ≤ 1.5 m noise.
    const n = Math.round(200 / 1.3);
    for (let i = 0; i <= n; i++) {
      const truth = destinationPoint(HOME, 45, (200 * i) / n);
      const t = T0 + 1000 + i * 1000;
      snap = session.addSample(sample(jitter(truth, 1.5, r), t, 8), t);
    }
    expect(snap.rejectedSamples).toBe(0);
    expect(Math.abs(snap.travelledM - 200) / 200).toBeLessThan(0.05);
    expect(snap.movement).toBe('moving');
    expect(snap.averageSpeedMps).toBeGreaterThan(1.1);
    expect(snap.averageSpeedMps).toBeLessThan(1.4);
    expect(snap.path.length).toBeGreaterThan(10);
  });

  it('rejects a 500 m teleport and keeps counting from the last good fix', () => {
    const session = createTrackingSession(T0);
    session.addSample(sample(HOME, T0 + 1000), T0 + 1000);
    const walked = destinationPoint(HOME, 0, 10);
    session.addSample(sample(walked, T0 + 6000), T0 + 6000);
    const teleport = session.addSample(sample(destinationPoint(HOME, 90, 500), T0 + 7000), T0 + 7000);
    expect(teleport.rejectedSamples).toBe(1);
    expect(teleport.acceptedSamples).toBe(2);
    expect(teleport.travelledM).toBeCloseTo(10, 6);
    expect(teleport.path).toHaveLength(2);
  });

  it('counts rejected samples of every kind without moving', () => {
    const session = createTrackingSession(T0);
    session.addSample(sample(HOME, T0 + 1000), T0 + 1000);
    const lowAcc = session.addSample(sample(destinationPoint(HOME, 0, 30), T0 + 2000, 300), T0 + 2000);
    const outOfOrder = session.addSample(sample(destinationPoint(HOME, 0, 30), T0 + 500), T0 + 2000);
    const invalid = session.addSample(sample([Number.NaN, 31], T0 + 3000), T0 + 3000);
    expect(invalid.rejectedSamples).toBe(3);
    expect(lowAcc.travelledM).toBe(0);
    expect(outOfOrder.travelledM).toBe(0);
  });

  it('reports no average speed until 3 accepted samples and 10 s have elapsed', () => {
    const session = createTrackingSession(T0);
    const step = (i: number) => destinationPoint(HOME, 0, i * 6);
    expect(session.snapshot(T0).averageSpeedMps).toBeNull();
    expect(session.addSample(sample(step(0), T0 + 2000), T0 + 2000).averageSpeedMps).toBeNull();
    expect(session.addSample(sample(step(1), T0 + 6000), T0 + 6000).averageSpeedMps).toBeNull();
    // Three samples but only 9 s elapsed.
    expect(session.addSample(sample(step(2), T0 + 9000), T0 + 9000).averageSpeedMps).toBeNull();
    const snap = session.snapshot(T0 + 12_000);
    expect(snap.elapsedS).toBe(12);
    expect(snap.averageSpeedMps).toBeCloseTo(12 / 12, 6);
  });

  it('reports movement as unknown without a recent window', () => {
    const session = createTrackingSession(T0);
    expect(session.snapshot(T0).movement).toBe('unknown');
    session.addSample(sample(HOME, T0 + 1000), T0 + 1000);
    expect(session.snapshot(T0 + 1000).movement).toBe('unknown');
    session.addSample(sample(HOME, T0 + 8000), T0 + 8000);
    expect(session.snapshot(T0 + 8000).movement).toBe('stationary');
    // No fix for longer than staleAfterMs → we no longer know.
    expect(session.snapshot(T0 + 8000 + 60_000).movement).toBe('unknown');
  });

  it('stop() freezes the session and returns the summary', () => {
    const session = createTrackingSession(T0);
    session.addSample(sample(HOME, T0 + 1000), T0 + 1000);
    session.addSample(sample(destinationPoint(HOME, 0, 20), T0 + 15_000), T0 + 15_000);
    const summary = session.stop(T0 + 20_000);
    expect(summary.endedAt).toBe(T0 + 20_000);
    expect(summary.elapsedS).toBe(20);
    expect(summary.travelledM).toBeCloseTo(20, 6);

    const after = session.addSample(sample(destinationPoint(HOME, 0, 40), T0 + 25_000), T0 + 25_000);
    expect(after.travelledM).toBeCloseTo(20, 6);
    expect(after.acceptedSamples).toBe(2);
    expect(session.snapshot(T0 + 99_000).elapsedS).toBe(20);
    expect(session.stop(T0 + 99_000).endedAt).toBe(T0 + 20_000);

    // Returned paths are copies; callers cannot mutate session state.
    summary.path.push([0, 0]);
    expect(session.snapshot().path).toHaveLength(2);
  });
});
