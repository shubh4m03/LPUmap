/**
 * Polyline measurement, projection and slicing.
 *
 * Lengths are sums of haversine segment lengths so they agree exactly with
 * `haversineM`. Point-to-segment projection runs in a local metric projection
 * centred on the query point (degrees would distort east–west by cos(lat)).
 * Interpolation along a segment is linear in lon/lat, which matches that
 * equirectangular projection over campus-scale segments.
 *
 * Shared with scripts/: erasable syntax and `.ts` import extensions only.
 */
import type { LngLat } from '../data/schema.ts';
import { createLocalProjection, haversineM, isValidLngLat } from './geodesic.ts';

export interface PolylineProjection {
  /** Index of the segment start vertex (coords[segmentIndex] → coords[segmentIndex + 1]). */
  segmentIndex: number;
  /** Fraction along that segment in [0, 1]. */
  t: number;
  point: LngLat;
  distanceFromLineM: number;
  distanceAlongM: number;
}

export function polylineLengthM(coords: readonly LngLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversineM(coords[i - 1]!, coords[i]!);
  return total;
}

/** cumulative[i] = length of coords[0..i]; cumulative[0] = 0. Empty input → []. */
export function cumulativeLengthsM(coords: readonly LngLat[]): number[] {
  const out: number[] = [];
  let total = 0;
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) total += haversineM(coords[i - 1]!, coords[i]!);
    out.push(total);
  }
  return out;
}

function lerp(a: LngLat, b: LngLat, t: number): LngLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function resolveCumulative(coords: readonly LngLat[], cumulative?: readonly number[]): readonly number[] {
  return cumulative && cumulative.length === coords.length ? cumulative : cumulativeLengthsM(coords);
}

/**
 * Closest point on the polyline to `p`, optionally restricted to the stretch
 * between `fromM` and `toM` along the line. Each segment contributes its
 * closest point; the winner is the one with the lowest `cost` (default: the
 * distance from the line). Ties keep the earliest segment so results are
 * deterministic. Returns null for an empty polyline, an empty range or an
 * invalid query point.
 */
export function projectOntoPolylineRange(
  p: LngLat,
  coords: readonly LngLat[],
  fromM: number,
  toM: number,
  cumulative?: readonly number[],
  cost: (candidate: PolylineProjection) => number = (c) => c.distanceFromLineM,
): PolylineProjection | null {
  if (coords.length === 0 || !(toM >= fromM) || !isValidLngLat(p)) return null;
  const cum = resolveCumulative(coords, cumulative);
  const total = cum[cum.length - 1]!;
  if (coords.length === 1 || total === 0) {
    const point = coords[0]!;
    return { segmentIndex: 0, t: 0, point, distanceFromLineM: haversineM(p, point), distanceAlongM: 0 };
  }
  const lo = Math.max(0, fromM);
  const hi = Math.min(total, toM);
  if (lo > hi) return null;

  const proj = createLocalProjection(p);
  let best: PolylineProjection | null = null;
  let bestCost = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const segStart = cum[i]!;
    const segLen = cum[i + 1]! - segStart;
    if (segStart + segLen < lo || segStart > hi) continue;
    const a = coords[i]!;
    const b = coords[i + 1]!;
    // Allowed t interval on this segment given the along-line range.
    const tMin = segLen > 0 ? Math.max(0, (lo - segStart) / segLen) : 0;
    const tMax = segLen > 0 ? Math.min(1, (hi - segStart) / segLen) : 0;
    let t = 0;
    if (segLen > 0) {
      const [ax, ay] = proj.toXY(a);
      const [bx, by] = proj.toXY(b);
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      // p is the projection origin, so its local coordinates are (0, 0).
      t = len2 > 0 ? (-ax * dx - ay * dy) / len2 : 0;
    }
    t = Math.min(tMax, Math.max(tMin, t));
    const point = t === 0 ? a : t === 1 ? b : lerp(a, b, t);
    const candidate = {
      segmentIndex: i,
      t,
      point,
      distanceFromLineM: haversineM(p, point),
      distanceAlongM: segStart + segLen * t,
    };
    const c = cost(candidate);
    if (!best || c < bestCost) {
      best = candidate;
      bestCost = c;
    }
  }
  return best;
}

/** Closest point on the whole polyline to `p`; null for an empty polyline or invalid `p`. */
export function projectOntoPolyline(
  p: LngLat,
  coords: readonly LngLat[],
  cumulative?: readonly number[],
): PolylineProjection | null {
  return projectOntoPolylineRange(p, coords, 0, Number.POSITIVE_INFINITY, cumulative);
}

/** Point at `distanceM` along the polyline (clamped to its ends); null if empty. */
export function pointAtDistance(
  coords: readonly LngLat[],
  distanceM: number,
  cumulative?: readonly number[],
): LngLat | null {
  if (coords.length === 0) return null;
  const cum = resolveCumulative(coords, cumulative);
  const total = cum[cum.length - 1]!;
  if (!(distanceM > 0)) return coords[0]!;
  if (distanceM >= total) return coords[coords.length - 1]!;
  // Binary search for the segment containing distanceM.
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid]! <= distanceM) lo = mid;
    else hi = mid;
  }
  const segLen = cum[hi]! - cum[lo]!;
  const t = segLen > 0 ? (distanceM - cum[lo]!) / segLen : 0;
  return lerp(coords[lo]!, coords[hi]!, t);
}

/**
 * The part of the polyline between `fromM` and `toM` (clamped to its length),
 * with interpolated end points. Returns [] when the polyline is empty or
 * fromM > toM; a zero-length range yields a single point.
 */
export function slicePolyline(
  coords: readonly LngLat[],
  fromM: number,
  toM: number,
  cumulative?: readonly number[],
): LngLat[] {
  if (coords.length === 0 || Number.isNaN(fromM) || Number.isNaN(toM) || fromM > toM) return [];
  const cum = resolveCumulative(coords, cumulative);
  const total = cum[cum.length - 1]!;
  const lo = Math.min(total, Math.max(0, fromM));
  const hi = Math.min(total, Math.max(0, toM));
  const start = pointAtDistance(coords, lo, cum)!;
  const end = pointAtDistance(coords, hi, cum)!;
  if (hi === lo) return [start];
  const out: LngLat[] = [start];
  for (let i = 0; i < coords.length; i++) {
    const d = cum[i]!;
    if (d > lo && d < hi) out.push(coords[i]!);
  }
  out.push(end);
  return out;
}
