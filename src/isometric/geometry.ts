/**
 * Small 2D helpers for the isometric overview. Pure; all inputs are plain
 * number tuples (local metres or view units).
 */

export type Pt = readonly [number, number];

/** Twice the signed area (counter-clockwise positive, y up). */
export function signedArea2(ring: readonly Pt[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += (ring[j]![0] - ring[i]![0]) * (ring[j]![1] + ring[i]![1]);
  }
  return s;
}

/** Drops a repeated closing vertex and consecutive duplicates (open ring). */
export function openRing(ring: readonly Pt[], eps = 1e-9): Pt[] {
  const out: Pt[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) <= eps && Math.abs(last[1] - p[1]) <= eps) continue;
    out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (
    out.length > 1 &&
    first &&
    last &&
    Math.abs(first[0] - last[0]) <= eps &&
    Math.abs(first[1] - last[1]) <= eps
  )
    out.pop();
  return out;
}

/** Even-odd point-in-polygon over every ring (outer + holes). */
export function pointInRings(x: number, y: number, rings: readonly (readonly Pt[])[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i]![0];
      const yi = ring[i]![1];
      const xj = ring[j]![0];
      const yj = ring[j]![1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function emptyBox(): Box {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function extendBox(b: Box, x: number, y: number): void {
  if (x < b.minX) b.minX = x;
  if (x > b.maxX) b.maxX = x;
  if (y < b.minY) b.minY = y;
  if (y > b.maxY) b.maxY = y;
}

export function boxOf(points: readonly Pt[]): Box {
  const b = emptyBox();
  for (const p of points) extendBox(b, p[0], p[1]);
  return b;
}

export const boxesOverlap = (a: Box, b: Box, eps = 0): boolean =>
  a.minX < b.maxX - eps && b.minX < a.maxX - eps && a.minY < b.maxY - eps && b.minY < a.maxY - eps;

export const boxContains = (b: Box, x: number, y: number): boolean =>
  x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;

/** Intersection point of segments p1p2 and p3p4 (strictly inside both), or null. */
export function segmentIntersection(p1: Pt, p2: Pt, p3: Pt, p4: Pt): [number, number] | null {
  const d1x = p2[0] - p1[0];
  const d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0];
  const d2y = p4[1] - p3[1];
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / den;
  const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / den;
  const eps = 1e-9;
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;
  return [p1[0] + t * d1x, p1[1] + t * d1y];
}

/**
 * The b-values where the vertical line a = c crosses the rings (a = x, b = y of
 * the points), sorted ascending. Half-open edge rule, so a vertex is counted
 * once; callers sample strictly between vertex abscissas anyway.
 */
export function crossingsAt(c: number, rings: readonly (readonly Pt[])[]): number[] {
  const out: number[] = [];
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a0 = ring[j]![0];
      const a1 = ring[i]![0];
      if (a0 <= c !== a1 <= c) {
        const t = (c - a0) / (a1 - a0);
        out.push(ring[j]![1] + t * (ring[i]![1] - ring[j]![1]));
      }
    }
  }
  return out.sort((x, y) => x - y);
}
