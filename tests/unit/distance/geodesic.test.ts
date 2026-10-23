import { describe, expect, it } from 'vitest';
import type { LngLat } from '../../../src/data/schema.ts';
import {
  EARTH_RADIUS_M,
  bearingDeg,
  createLocalProjection,
  destinationPoint,
  haversineM,
  isValidLngLat,
} from '../../../src/distance/index.ts';

/** Independent WGS-84 Vincenty inverse solution, used only as a cross-check. */
function vincentyM(p1: LngLat, p2: LngLat): number {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const b = (1 - f) * a;
  const rad = Math.PI / 180;
  const L = (p2[0] - p1[0]) * rad;
  const U1 = Math.atan((1 - f) * Math.tan(p1[1] * rad));
  const U2 = Math.atan((1 - f) * Math.tan(p2[1] * rad));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);
  let lambda = L;
  let sinSigma = 0;
  let cosSigma = 0;
  let sigma = 0;
  let cos2Alpha = 0;
  let cos2SigmaM = 0;
  for (let iter = 0; iter < 200; iter++) {
    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);
    sinSigma = Math.hypot(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda);
    if (sinSigma === 0) return 0;
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cos2Alpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cos2Alpha !== 0 ? cosSigma - (2 * sinU1 * sinU2) / cos2Alpha : 0;
    const C = (f / 16) * cos2Alpha * (4 + f * (4 - 3 * cos2Alpha));
    const prev = lambda;
    lambda =
      L +
      (1 - C) *
        f *
        sinAlpha *
        (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    if (Math.abs(lambda - prev) < 1e-12) break;
  }
  const u2 = (cos2Alpha * (a * a - b * b)) / (b * b);
  const A = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const B = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const deltaSigma =
    B *
    sinSigma *
    (cos2SigmaM +
      (B / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
          (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
  return b * A * (sigma - deltaSigma);
}

describe('haversineM', () => {
  it('measures one degree of latitude as R·π/180 ≈ 111,195 m', () => {
    const d = haversineM([75.7, 31], [75.7, 32]);
    expect(d).toBeCloseTo((EARTH_RADIUS_M * Math.PI) / 180, 6);
    expect(Math.abs(d - 111_195)).toBeLessThan(1);
  });

  it('is zero for identical points and symmetric', () => {
    const a: LngLat = [75.7032, 31.2533];
    const b: LngLat = [75.7091, 31.2608];
    expect(haversineM(a, a)).toBe(0);
    expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 9);
  });

  it('agrees with an independent Vincenty solution within 0.5 % for a ~1 km LPU-area pair', () => {
    const a: LngLat = [75.6995, 31.2475];
    const b: LngLat = [75.7055, 31.2545];
    const h = haversineM(a, b);
    const v = vincentyM(a, b);
    expect(v).toBeGreaterThan(900);
    expect(v).toBeLessThan(1100);
    expect(Math.abs(h - v) / v).toBeLessThan(0.005);
  });

  it('validates the Vincenty cross-check on a known meridian arc', () => {
    // WGS-84 meridian arc 31°→32° N is ≈ 110,887 m (published tables: 110.88 km).
    expect(vincentyM([0, 31], [0, 32])).toBeGreaterThan(110_850);
    expect(vincentyM([0, 31], [0, 32])).toBeLessThan(110_920);
  });
});

describe('bearingDeg / destinationPoint', () => {
  it('returns cardinal bearings', () => {
    const o: LngLat = [75.7, 31.25];
    expect(bearingDeg(o, [75.7, 31.26])).toBeCloseTo(0, 6);
    expect(bearingDeg(o, [75.71, 31.25])).toBeCloseTo(90, 1);
    expect(bearingDeg(o, [75.7, 31.24])).toBeCloseTo(180, 6);
  });

  it('round-trips with haversine', () => {
    const o: LngLat = [75.7032, 31.2533];
    for (const bearing of [0, 37, 90, 181, 300]) {
      const p = destinationPoint(o, bearing, 750);
      expect(haversineM(o, p)).toBeCloseTo(750, 6);
    }
  });
});

describe('isValidLngLat and local projection', () => {
  it('rejects malformed coordinates', () => {
    expect(isValidLngLat([75.7, 31.2])).toBe(true);
    expect(isValidLngLat([181, 0])).toBe(false);
    expect(isValidLngLat([0, 91])).toBe(false);
    expect(isValidLngLat([Number.NaN, 0])).toBe(false);
    expect(isValidLngLat([0])).toBe(false);
    expect(isValidLngLat(null)).toBe(false);
  });

  it('local projection distances match haversine within centimetres on campus', () => {
    const origin: LngLat = [75.7032, 31.2533];
    const proj = createLocalProjection(origin);
    const p: LngLat = [75.7081, 31.2571];
    const [x, y] = proj.toXY(p);
    expect(Math.abs(Math.hypot(x, y) - haversineM(origin, p))).toBeLessThan(0.5);
    const back = proj.toLngLat([x, y]);
    expect(back[0]).toBeCloseTo(p[0], 10);
    expect(back[1]).toBeCloseTo(p[1], 10);
  });
});
