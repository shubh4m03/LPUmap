/**
 * Planar geometry helpers for campus-scale features. Areas and distances are
 * computed in a local equirectangular projection (metres) from
 * src/distance/geodesic.ts; containment tests work directly in lon/lat, which
 * is exact for straight-edged polygons at this scale.
 */
import type { LngLat } from '../../src/data/schema.ts';
import { createLocalProjection } from '../../src/distance/geodesic.ts';

/** A polygon is [outer, ...holes]; each ring is closed (first === last). */
export type Ring = LngLat[];
export type Polygon = Ring[];
export type MultiPolygon = Polygon[];
export type BBox = [number, number, number, number];

export const COORD_DECIMALS = 7;

export function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

export function roundCoord(p: LngLat): LngLat {
  return [round(p[0], COORD_DECIMALS), round(p[1], COORD_DECIMALS)];
}

export function samePoint(a: LngLat, b: LngLat): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

export function isRingClosed(ring: readonly LngLat[]): boolean {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return ring.length >= 2 && first !== undefined && last !== undefined && samePoint(first, last);
}

/** Removes consecutive duplicate vertices (keeps closure). */
export function dedupeConsecutive(ring: readonly LngLat[]): LngLat[] {
  const out: LngLat[] = [];
  for (const p of ring) {
    const prev = out[out.length - 1];
    if (!prev || !samePoint(prev, p)) out.push(p);
  }
  return out;
}

/**
 * Joins way node-id sequences end to end into closed rings (multipolygon
 * assembly). Ways may be reversed to match. Sequences that cannot be closed
 * are reported, never force-closed — a guessed edge would invent geometry.
 */
export function assembleRings(sequences: readonly (readonly number[])[]): {
  rings: number[][];
  unclosed: number[][];
} {
  const pending = sequences.filter((s) => s.length >= 2).map((s) => [...s]);
  const rings: number[][] = [];
  const unclosed: number[][] = [];
  while (pending.length > 0) {
    const current = pending.shift()!;
    let progressed = true;
    while (current[0] !== current[current.length - 1] && progressed) {
      progressed = false;
      const end = current[current.length - 1];
      for (let i = 0; i < pending.length; i++) {
        const cand = pending[i]!;
        if (cand[0] === end) current.push(...cand.slice(1));
        else if (cand[cand.length - 1] === end) current.push(...[...cand].reverse().slice(1));
        else continue;
        pending.splice(i, 1);
        progressed = true;
        break;
      }
    }
    if (current.length >= 4 && current[0] === current[current.length - 1]) rings.push(current);
    else unclosed.push(current);
  }
  return { rings, unclosed };
}

/** Even–odd ray casting. Points exactly on an edge may fall either way. */
export function pointInRing(p: LngLat, ring: readonly LngLat[]): boolean {
  let inside = false;
  const [x, y] = p;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(p: LngLat, polygon: Polygon): boolean {
  const [outer, ...holes] = polygon;
  if (!outer || !pointInRing(p, outer)) return false;
  return !holes.some((h) => pointInRing(p, h));
}

export function pointInMultiPolygon(p: LngLat, mp: MultiPolygon): boolean {
  return mp.some((poly) => pointInPolygon(p, poly));
}

/** Signed area in m² (positive = counter-clockwise). */
export function ringSignedAreaM2(ring: readonly LngLat[]): number {
  const origin = ring[0];
  if (!origin || ring.length < 4) return 0;
  const proj = createLocalProjection(origin);
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = proj.toXY(ring[i]!);
    const [x2, y2] = proj.toXY(ring[i + 1]!);
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

export function polygonAreaM2(polygon: Polygon): number {
  const [outer, ...holes] = polygon;
  if (!outer) return 0;
  return Math.abs(ringSignedAreaM2(outer)) - holes.reduce((s, h) => s + Math.abs(ringSignedAreaM2(h)), 0);
}

function orient(a: LngLat, b: LngLat, c: LngLat): number {
  const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

function onSegment(a: LngLat, b: LngLat, p: LngLat): boolean {
  return (
    Math.min(a[0], b[0]) <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= p[1] &&
    p[1] <= Math.max(a[1], b[1])
  );
}

export function segmentsIntersect(a: LngLat, b: LngLat, c: LngLat, d: LngLat): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (
    (o1 === 0 && onSegment(a, b, c)) ||
    (o2 === 0 && onSegment(a, b, d)) ||
    (o3 === 0 && onSegment(c, d, a)) ||
    (o4 === 0 && onSegment(c, d, b))
  );
}

/** True if any two non-adjacent edges of a closed ring touch or cross. */
export function ringSelfIntersects(ring: readonly LngLat[]): boolean {
  const n = ring.length - 1; // number of edges
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsIntersect(ring[i]!, ring[i + 1]!, ring[j]!, ring[j + 1]!)) return true;
    }
  }
  return false;
}

export type RingProblem = 'not-closed' | 'too-few-points' | 'zero-area' | 'self-intersection';

export function ringProblems(ring: readonly LngLat[]): RingProblem[] {
  const problems: RingProblem[] = [];
  if (!isRingClosed(ring)) problems.push('not-closed');
  if (ring.length < 4) problems.push('too-few-points');
  if (problems.length === 0 && Math.abs(ringSignedAreaM2(ring)) < 1e-6) problems.push('zero-area');
  if (isRingClosed(ring) && ring.length >= 4 && ringSelfIntersects(ring)) problems.push('self-intersection');
  return problems;
}

/** Returns the ring with the requested winding (RFC 7946: outer CCW, holes CW). */
export function withWinding(ring: Ring, ccw: boolean): Ring {
  return ringSignedAreaM2(ring) > 0 === ccw ? ring : [...ring].reverse();
}

function ringCentroid(ring: readonly LngLat[]): LngLat | null {
  let a = 0;
  let cx = 0;
  let cy = 0;
  const o = ring[0];
  if (!o) return null;
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = ring[i]![0] - o[0];
    const y1 = ring[i]![1] - o[1];
    const x2 = ring[i + 1]![0] - o[0];
    const y2 = ring[i + 1]![1] - o[1];
    const f = x1 * y2 - x2 * y1;
    a += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  if (a === 0) return null;
  return [o[0] + cx / (3 * a), o[1] + cy / (3 * a)];
}

/**
 * A representative point guaranteed to lie inside the polygon: the centroid
 * when it does, otherwise the midpoint of the widest interior span on the
 * horizontal line through the centroid (handles L/U-shaped buildings).
 */
export function pointOnSurface(polygon: Polygon): LngLat | null {
  const outer = polygon[0];
  if (!outer || outer.length < 4) return null;
  const c = ringCentroid(outer);
  if (c && pointInPolygon(c, polygon)) return c;
  const ys = outer.map((p) => p[1]);
  const y = c ? c[1] : (Math.min(...ys) + Math.max(...ys)) / 2;
  const xs: number[] = [];
  for (const ring of polygon) {
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i]!;
      const b = ring[i + 1]!;
      if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
  }
  xs.sort((p, q) => p - q);
  let best: LngLat | null = null;
  let bestWidth = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const w = xs[i + 1]! - xs[i]!;
    if (w > bestWidth) {
      bestWidth = w;
      best = [(xs[i]! + xs[i + 1]!) / 2, y];
    }
  }
  return best ?? outer[0] ?? null;
}

/** Representative point of the largest polygon of a multipolygon. */
export function multiPolygonPointOnSurface(mp: MultiPolygon): LngLat | null {
  let best: Polygon | null = null;
  let bestArea = -1;
  for (const poly of mp) {
    const a = polygonAreaM2(poly);
    if (a > bestArea) {
      bestArea = a;
      best = poly;
    }
  }
  return best ? pointOnSurface(best) : null;
}

/** Distance in metres from p to segment ab (local projection around p). */
export function pointToSegmentM(p: LngLat, a: LngLat, b: LngLat): number {
  const proj = createLocalProjection(p);
  const [ax, ay] = proj.toXY(a);
  const [bx, by] = proj.toXY(b);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Distance from p to the nearest ring edge of any polygon; 0 when inside. */
export function distanceToMultiPolygonM(p: LngLat, mp: MultiPolygon): number {
  if (pointInMultiPolygon(p, mp)) return 0;
  let best = Infinity;
  for (const poly of mp) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length - 1; i++)
        best = Math.min(best, pointToSegmentM(p, ring[i]!, ring[i + 1]!));
    }
  }
  return best;
}

export function bboxOfCoords(coords: Iterable<LngLat>): BBox | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [x, y] of coords) {
    w = Math.min(w, x);
    s = Math.min(s, y);
    e = Math.max(e, x);
    n = Math.max(n, y);
  }
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

export function bboxIntersects(a: BBox, b: readonly [number, number, number, number]): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function inBBox(p: LngLat, b: readonly [number, number, number, number]): boolean {
  return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
}

export function multiPolygonCoords(mp: MultiPolygon): LngLat[] {
  return mp.flat(2);
}
