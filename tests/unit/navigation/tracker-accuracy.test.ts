/**
 * G-25: travelled-distance accuracy on seeded synthetic tracks.
 *
 * Every track is generated deterministically (gps-fixtures.ts), so these are
 * exact regression checks, not flaky statistics. Ten seeds per case. The
 * tolerances are the documented ones in docs/modules/geolocation-navigation.md
 * ("Tracker accuracy"); before the fix the tracker reported, on the same
 * tracks, a mean of 114 m for 50 stationary fixes at ±5 m and 688 m for two
 * minutes standing with honest 10 m Gaussian noise.
 */
import { describe, expect, it } from 'vitest';
import { createTrackingSession, type TrackingSnapshot } from '../../../src/navigation/index.ts';
import { generateTrack, stand, walk, type Leg, type NoiseModel } from './gps-fixtures.ts';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

interface Outcome {
  totals: number[];
  mean: number;
  max: number;
  trueDistanceM: number;
  last: TrackingSnapshot;
}

function run(legs: Leg[], noise: NoiseModel, accuracyM = 10): Outcome {
  const totals: number[] = [];
  let trueDistanceM = 0;
  let last: TrackingSnapshot | null = null;
  for (const seed of SEEDS) {
    const track = generateTrack({ seed, legs, noise, accuracyM });
    trueDistanceM = track.trueDistanceM;
    const session = createTrackingSession(track.samples[0]!.timestamp);
    for (const s of track.samples) last = session.addSample(s, s.timestamp);
    totals.push(last!.travelledM);
  }
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
  return { totals, mean, max: Math.max(...totals), trueDistanceM, last: last! };
}

const relErrors = (o: Outcome) => o.totals.map((t) => (t - o.trueDistanceM) / o.trueDistanceM);
const meanRelError = (o: Outcome) => (o.mean - o.trueDistanceM) / o.trueDistanceM;

const UNIFORM_5: NoiseModel = { kind: 'uniform', radiusM: 5 };
const GAUSS_10: NoiseModel = { kind: 'gauss', r95M: 10 };
const AR1_10: NoiseModel = { kind: 'ar1', r95M: 10, rho: 0.9 };

describe('tracker accuracy: standing still', () => {
  it('adds at most 10 m over 50 fixes at ±5 m with 10 m accuracy (the case that used to count ~88 m)', () => {
    const o = run([stand(49)], UNIFORM_5);
    expect(o.last.acceptedSamples).toBe(50);
    expect(o.max).toBeLessThanOrEqual(10);
    expect(o.mean).toBeLessThanOrEqual(3);
  });

  it('adds at most 40 m (mean ≤ 20 m) over 2 minutes of independent Gaussian noise at 10 m accuracy', () => {
    const o = run([stand(119)], GAUSS_10);
    expect(o.max).toBeLessThanOrEqual(40);
    expect(o.mean).toBeLessThanOrEqual(20);
  });

  it('scales with accuracy: 20 m Gaussian noise stays under a mean of 40 m in 2 minutes', () => {
    const o = run([stand(119)], { kind: 'gauss', r95M: 20 }, 20);
    expect(o.mean).toBeLessThanOrEqual(40);
  });

  it('bounds slowly wandering (correlated) noise, which no short window can tell from creeping', () => {
    const o = run([stand(119)], AR1_10);
    expect(o.mean).toBeLessThanOrEqual(40);
  });
});

describe('tracker accuracy: walking 200 m', () => {
  it('slow walk (0.5 m/s): each run within ±5 % under ±5 m noise', () => {
    const o = run([walk(30, 0.5, 400)], UNIFORM_5);
    for (const e of relErrors(o)) expect(Math.abs(e)).toBeLessThanOrEqual(0.05);
  });

  it('slow walk (0.5 m/s): mean within ±10 %, each run within ±25 % under 10 m Gaussian noise', () => {
    const o = run([walk(30, 0.5, 400)], GAUSS_10);
    expect(Math.abs(meanRelError(o))).toBeLessThanOrEqual(0.1);
    for (const e of relErrors(o)) expect(Math.abs(e)).toBeLessThanOrEqual(0.25);
  });

  it('normal walk (1.3 m/s): each run within ±6 % under ±5 m noise', () => {
    const o = run([walk(45, 1.3, 154)], UNIFORM_5);
    for (const e of relErrors(o)) expect(Math.abs(e)).toBeLessThanOrEqual(0.06);
    expect(o.last.movement).toBe('moving');
  });

  it('normal walk (1.3 m/s): mean within ±5 %, each run within ±15 % under 10 m Gaussian noise', () => {
    const o = run([walk(45, 1.3, 154)], GAUSS_10);
    expect(Math.abs(meanRelError(o))).toBeLessThanOrEqual(0.05);
    for (const e of relErrors(o)) expect(Math.abs(e)).toBeLessThanOrEqual(0.15);
  });

  it('an L-shaped walk with a stop in the middle: mean within ±10 % under 10 m Gaussian noise', () => {
    const o = run([walk(0, 1.3, 77), stand(60), walk(90, 1.3, 77)], GAUSS_10);
    expect(Math.abs(meanRelError(o))).toBeLessThanOrEqual(0.1);
    for (const e of relErrors(o)) expect(Math.abs(e)).toBeLessThanOrEqual(0.25);
  });

  it('the same walk with ±5 m noise: each run within ±6 %', () => {
    const o = run([walk(0, 1.3, 77), stand(60), walk(90, 1.3, 77)], UNIFORM_5);
    for (const e of relErrors(o)) expect(Math.abs(e)).toBeLessThanOrEqual(0.06);
  });
});

describe('tracker smoothing rules', () => {
  it('averages dense fixes, so a lone outlier inside the window moves the estimate only partly', () => {
    // Four fixes a second apart at HOME, then one 8 m north: dense, so the
    // estimate is the mean (1.6 m north) and nothing is counted (threshold 6 m).
    const legs = [stand(3)];
    const base = generateTrack({ seed: 1, legs, noise: { kind: 'none' }, accuracyM: 10 }).samples;
    const session = createTrackingSession(base[0]!.timestamp);
    for (const s of base) session.addSample(s, s.timestamp);
    const outlierTrack = generateTrack({
      seed: 1,
      legs: [walk(0, 8, 1)],
      noise: { kind: 'none' },
      accuracyM: 10,
      start: base[0]!.lngLat,
    });
    const outlier = { ...outlierTrack.samples[1]!, timestamp: base[3]!.timestamp + 1000 };
    const snap = session.addSample(outlier, outlier.timestamp);
    expect(snap.acceptedSamples).toBe(5);
    expect(snap.travelledM).toBe(0);
  });
});
