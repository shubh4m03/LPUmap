/**
 * The single shared distance implementation. Map labels, route estimates,
 * GPS tracking and the data pipeline all call these functions so they can
 * never disagree.
 *
 * Haversine on a sphere of the IUGG mean Earth radius. Over campus-scale
 * distances (< 5 km) at LPU's latitude the error versus the WGS-84 ellipsoid
 * is well under 0.5 %, far below consumer GPS noise; see docs/ARCHITECTURE.md.
 *
 * Shared with scripts/: erasable syntax and `.ts` import extensions only.
 */
import type { LngLat } from '../data/index.ts';

export const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export function isValidLngLat(p: unknown): p is LngLat {
  return (
    Array.isArray(p) &&
    p.length === 2 &&
    typeof p[0] === 'number' &&
    typeof p[1] === 'number' &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1]) &&
    p[0] >= -180 &&
    p[0] <= 180 &&
    p[1] >= -90 &&
    p[1] <= 90
  );
}

/** Great-circle distance in metres. */
export function haversineM(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing from a to b, degrees clockwise from north in [0, 360). */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const φ1 = toRad(a[1]);
  const φ2 = toRad(b[1]);
  const Δλ = toRad(b[0] - a[0]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point reached travelling `distanceM` from `origin` along `bearing` degrees. */
export function destinationPoint(origin: LngLat, bearing: number, distanceM: number): LngLat {
  const δ = distanceM / EARTH_RADIUS_M;
  const θ = toRad(bearing);
  const φ1 = toRad(origin[1]);
  const λ1 = toRad(origin[0]);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [((toDeg(λ2) + 540) % 360) - 180, toDeg(φ2)];
}

/**
 * Local equirectangular projection to metres around `origin`. Accurate to a
 * few centimetres across the campus; used for point-to-segment projection
 * where working in degrees would distort east–west distances by cos(lat).
 */
export interface LocalProjection {
  toXY(p: LngLat): [number, number];
  toLngLat(xy: readonly [number, number]): LngLat;
}

export function createLocalProjection(origin: LngLat): LocalProjection {
  const kx = toRad(1) * EARTH_RADIUS_M * Math.cos(toRad(origin[1]));
  const ky = toRad(1) * EARTH_RADIUS_M;
  return {
    toXY: (p) => [(p[0] - origin[0]) * kx, (p[1] - origin[1]) * ky],
    toLngLat: ([x, y]) => [origin[0] + x / kx, origin[1] + y / ky],
  };
}
