/**
 * Planar helpers in local METRES (rings open; outer ring first, then holes).
 * Pure; shared by the validator and the studio merge so the public bundle
 * does not need the validator to measure access-node distances.
 */
import type { LocalPolygon, Vec2 } from './mesh/types.ts';

export function pointSegDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

const orient = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Closed-segment intersection test (touching counts). */
export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  return d1 * d2 <= 0 && d3 * d4 <= 0;
}

/** Even–odd ray casting. */
export function inRing(p: Vec2, ring: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside;
  }
  return inside;
}

export const inPolygon = (p: Vec2, poly: LocalPolygon): boolean =>
  poly.length > 0 && inRing(p, poly[0]!) && !poly.slice(1).some((h) => inRing(p, h));

export const polygonEdges = (poly: LocalPolygon): [Vec2, Vec2][] =>
  poly.flatMap((ring) => ring.map((p, i) => [p, ring[(i + 1) % ring.length]!] as [Vec2, Vec2]));

/** Distance from a point to a polygon: 0 inside, else to the nearest edge. */
export function pointToPolygonM(p: Vec2, poly: LocalPolygon): number {
  if (inPolygon(p, poly)) return 0;
  return polygonEdges(poly).reduce((m, [a, b]) => Math.min(m, pointSegDist(p, a, b)), Infinity);
}

/** Distance from a segment to a polygon: 0 when it touches it or lies inside. */
export function segmentToPolygonM(a: Vec2, b: Vec2, poly: LocalPolygon): number {
  if (inPolygon(a, poly) || inPolygon(b, poly)) return 0;
  let best = Infinity;
  for (const [c, d] of polygonEdges(poly)) {
    if (segmentsIntersect(a, b, c, d)) return 0;
    best = Math.min(
      best,
      pointSegDist(a, c, d),
      pointSegDist(b, c, d),
      pointSegDist(c, a, b),
      pointSegDist(d, a, b),
    );
  }
  return best;
}
