/**
 * Camera facts shared by the MapLibre modes (docs/MAP_PROVIDER_CONFIGURATION.md §Camera).
 *
 * maxPitch: 60°, MapLibre 6.15's default. Values above 60 are documented by
 * MapLibre as experimental ("may result in rendering issues"), and with no
 * terrain or photorealistic scene there is nothing a near-horizon view would
 * add; Campus 3D opens at APP_CONFIG.map.pitch3d (55°).
 */
import type { LngLat } from '../../data/schema.ts';

export const MAX_PITCH = 60;

/** [west, south, east, north] */
export type Bounds = readonly [number, number, number, number];

/** Bounding box of a GeoJSON polygon collection (the campus boundary), or null when empty. */
export function boundsOfPolygons(fc: {
  features: ReadonlyArray<{ geometry: { type: string; coordinates: unknown } | null }>;
}): Bounds | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  const visit = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number' && typeof c[1] === 'number') {
      const [x, y] = c as [number, number];
      w = Math.min(w, x);
      e = Math.max(e, x);
      s = Math.min(s, y);
      n = Math.max(n, y);
      return;
    }
    for (const child of c) visit(child);
  };
  for (const f of fc.features) if (f.geometry) visit(f.geometry.coordinates);
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/** What the map reports after each camera move (for the return-to-campus control and the imagery date line). */
export interface CameraView {
  center: LngLat;
  zoom: number;
  bounds: Bounds;
}

/** A polygon as rings of [lon, lat] (outer ring first, then holes). */
export type PolygonRings = ReadonlyArray<ReadonlyArray<readonly [number, number]>>;

/** The polygons of a GeoJSON Polygon/MultiPolygon collection (the campus boundary). */
export function polygonsOf(fc: {
  features: ReadonlyArray<{ geometry: { type: string; coordinates: unknown } | null }>;
}): PolygonRings[] {
  const out: PolygonRings[] = [];
  for (const f of fc.features) {
    if (f.geometry?.type === 'Polygon') out.push(f.geometry.coordinates as PolygonRings);
    else if (f.geometry?.type === 'MultiPolygon') out.push(...(f.geometry.coordinates as PolygonRings[]));
  }
  return out;
}

const inBounds = ([x, y]: readonly [number, number], b: Bounds) =>
  x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

/** Does segment p–q touch the axis-aligned rectangle b? (Liang–Barsky clipping.) */
function segmentTouchesBounds(
  p: readonly [number, number],
  q: readonly [number, number],
  b: Bounds,
): boolean {
  if (inBounds(p, b) || inBounds(q, b)) return true;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  let t0 = 0;
  let t1 = 1;
  const clip = (den: number, num: number): boolean => {
    if (den === 0) return num >= 0;
    const t = num / den;
    if (den < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return (
    clip(-dx, p[0] - b[0]) &&
    clip(dx, b[2] - p[0]) &&
    clip(-dy, p[1] - b[1]) &&
    clip(dy, b[3] - p[1]) &&
    t0 <= t1
  );
}

function pointInRing(
  [x, y]: readonly [number, number],
  ring: ReadonlyArray<readonly [number, number]>,
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True when any part of the polygons (outline or area) lies inside the rectangle. */
export function polygonsTouchBounds(polygons: readonly PolygonRings[], b: Bounds): boolean {
  const centre: [number, number] = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  for (const rings of polygons) {
    for (const ring of rings)
      for (let i = 1; i < ring.length; i++) if (segmentTouchesBounds(ring[i - 1]!, ring[i]!, b)) return true;
    // No edge crosses the screen: it is either wholly inside the campus or wholly outside it.
    const [outer, ...holes] = rings;
    if (outer && pointInRing(centre, outer) && !holes.some((h) => pointInRing(centre, h))) return true;
  }
  return false;
}

/**
 * True when no part of the campus is on screen (the "Back to campus" control is then offered).
 * The bounding box is a quick reject; with `polygons` the actual outline decides, because the
 * campus is concave: a view west of the boundary can still lie inside its bounding box.
 */
export function campusOutOfView(
  view: CameraView | null,
  campus: Bounds | null,
  polygons?: readonly PolygonRings[],
): boolean {
  if (!view || !campus) return false;
  if (!boundsIntersect(view.bounds, campus)) return true;
  return polygons !== undefined && polygons.length > 0 && !polygonsTouchBounds(polygons, view.bounds);
}
