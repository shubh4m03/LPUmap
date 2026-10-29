/**
 * Isometric overview projection (docs/ISOMETRIC_AND_3D_DESIGN.md §6.3, normative).
 *
 *  - Local metres: equirectangular at the origin O, e = (lon − O.lon)·kx,
 *    n = (lat − O.lat)·ky with kx = cos(O.lat)·π/180·R, ky = π/180·R,
 *    R = 6,371,008.8 m (the same formula as scripts/lib/geometry.ts).
 *  - View rotation θ = 45° + 90°·r (r ∈ {0,1,2,3}); θ is the compass direction
 *    shown at the top of the screen.
 *  - View frame: a = e·cosθ − n·sinθ (screen-right), b = e·sinθ + n·cosθ (depth;
 *    larger is farther).
 *  - Parallel 2:1 dimetric with elevation α = 30°: x = a, y = −(b·sinα + z·cosα)
 *    in "view units" (1 unit = 1 px at 1 px/m). Screen px = k·(x, y) + (tx, ty).
 *  - The ground inverse (z = 0) is exact.
 *
 * Pure: no DOM, no MapLibre.
 */
import { APP_CONFIG } from '../config/index.ts';
import type { LngLat } from '../data/index.ts';
import { EARTH_RADIUS_M } from '../distance/index.ts';

export type IsoRotation = 0 | 1 | 2 | 3;
export const ISO_ROTATIONS: readonly IsoRotation[] = [0, 1, 2, 3];

/** Re-exported from the one shared definition (src/distance/geodesic.ts). */
export { EARTH_RADIUS_M };
const DEG = Math.PI / 180;

/** A 3D point in local metres: east, north, up. */
export type Enu = readonly [e: number, n: number, z: number];
/** A point in view units (k = 1): x right, y down. */
export type ViewPoint = readonly [x: number, y: number];

export interface LocalFrame {
  readonly origin: LngLat;
  /** Metres per degree of longitude at the origin latitude. */
  readonly kx: number;
  /** Metres per degree of latitude. */
  readonly ky: number;
  toLocal(lngLat: LngLat): [e: number, n: number];
  toLngLat(e: number, n: number): LngLat;
}

export function createLocalFrame(origin: LngLat = APP_CONFIG.map.center): LocalFrame {
  const ky = DEG * EARTH_RADIUS_M;
  const kx = Math.cos(origin[1] * DEG) * ky;
  return {
    origin: [origin[0], origin[1]],
    kx,
    ky,
    toLocal: (p) => [(p[0] - origin[0]) * kx, (p[1] - origin[1]) * ky],
    toLngLat: (e, n) => [origin[0] + e / kx, origin[1] + n / ky],
  };
}

export interface IsoProjection {
  readonly rotation: IsoRotation;
  /** View rotation θ in degrees (the compass direction at the top of the screen). */
  readonly thetaDeg: number;
  readonly cosT: number;
  readonly sinT: number;
  readonly cosA: number;
  readonly sinA: number;
  /** View frame [a, b] of a ground point (b: larger = farther). */
  viewFrame(e: number, n: number): [a: number, b: number];
  /** Inverse of viewFrame. */
  fromViewFrame(a: number, b: number): [e: number, n: number];
  /** Projects local metres to view units (k = 1). */
  project(e: number, n: number, z: number): [x: number, y: number];
  /** Exact inverse onto the ground plane (z = 0). */
  groundAt(x: number, y: number): [e: number, n: number];
  /**
   * Depth of a point along the viewing ray (larger = farther from the viewer).
   * Two points on the same screen pixel compare by this value.
   */
  depth(e: number, n: number, z: number): number;
  /** A direction (in ENU) pointing from the scene toward the viewer. */
  readonly towardViewer: Enu;
}

/** θ for rotation r: 45° + 90°·r. */
export const rotationThetaDeg = (r: IsoRotation): number => 45 + 90 * r;

export function createIsoProjection(
  rotation: IsoRotation,
  elevationDeg: number = APP_CONFIG.isometric.elevationDeg,
): IsoProjection {
  const thetaDeg = rotationThetaDeg(rotation);
  const cosT = Math.cos(thetaDeg * DEG);
  const sinT = Math.sin(thetaDeg * DEG);
  const cosA = Math.cos(elevationDeg * DEG);
  const sinA = Math.sin(elevationDeg * DEG);
  const viewFrame = (e: number, n: number): [number, number] => [e * cosT - n * sinT, e * sinT + n * cosT];
  const fromViewFrame = (a: number, b: number): [number, number] => [
    a * cosT + b * sinT,
    -a * sinT + b * cosT,
  ];
  // Unit vector toward the viewer in the view frame is (0, −cosα, sinα); rotate (a, b) back to (e, n).
  const [te, tn] = fromViewFrame(0, -cosA);
  return {
    rotation,
    thetaDeg,
    cosT,
    sinT,
    cosA,
    sinA,
    viewFrame,
    fromViewFrame,
    project(e, n, z) {
      const a = e * cosT - n * sinT;
      const b = e * sinT + n * cosT;
      return [a, -(b * sinA + z * cosA)];
    },
    groundAt(x, y) {
      return fromViewFrame(x, -y / sinA);
    },
    depth(e, n, z) {
      const b = e * sinT + n * cosT;
      return b * cosA - z * sinA;
    },
    towardViewer: [te, tn, sinA],
  };
}

// ---------------------------------------------------------------------------
// Screen transform: CSS px = k · view + t
// ---------------------------------------------------------------------------

export interface ScreenTransform {
  /** CSS px per metre (= per view unit). */
  k: number;
  tx: number;
  ty: number;
}

export const toScreen = (t: ScreenTransform, p: ViewPoint): [number, number] => [
  t.k * p[0] + t.tx,
  t.k * p[1] + t.ty,
];
export const fromScreen = (t: ScreenTransform, px: number, py: number): [number, number] => [
  (px - t.tx) / t.k,
  (py - t.ty) / t.k,
];

// ---------------------------------------------------------------------------
// MapLibre zoom ⇄ px per metre (mode switches keep an equivalent scale, §8.1)
// ---------------------------------------------------------------------------

/** Web-Mercator metres per CSS px at zoom 0 on the equator (512 px tiles, as MapLibre). */
const MERCATOR_M_PER_PX_Z0 = (2 * Math.PI * 6_378_137) / 512;

export function pxPerMetreForZoom(zoom: number, lat: number): number {
  return 2 ** zoom / (MERCATOR_M_PER_PX_Z0 * Math.cos(lat * DEG));
}

export function zoomForPxPerMetre(pxPerMetre: number, lat: number): number {
  return Math.log2(pxPerMetre * MERCATOR_M_PER_PX_Z0 * Math.cos(lat * DEG));
}

// ---------------------------------------------------------------------------
// Default rotation (§6.3): the r whose projected extent best matches the viewport aspect
// ---------------------------------------------------------------------------

export interface ViewBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** View-unit bounds of ground points (local metres) under a projection. */
export function groundBounds(
  points: readonly (readonly [number, number])[],
  proj: IsoProjection,
): ViewBounds {
  const b: ViewBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [e, n] of points) {
    const [x, y] = proj.project(e, n, 0);
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y;
    if (y > b.maxY) b.maxY = y;
  }
  return b;
}

/**
 * Picks the rotation whose projected extent of `points` best matches the
 * viewport aspect ratio (log-ratio distance). Rotations r and r + 2 give the
 * same extent; the lower r wins, so the result is deterministic.
 */
export function defaultRotation(
  points: readonly (readonly [number, number])[],
  viewportAspect: number,
  elevationDeg: number = APP_CONFIG.isometric.elevationDeg,
): IsoRotation {
  if (points.length === 0 || !(viewportAspect > 0)) return 0;
  let best: IsoRotation = 0;
  let bestScore = Infinity;
  for (const r of ISO_ROTATIONS) {
    const b = groundBounds(points, createIsoProjection(r, elevationDeg));
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    if (!(w > 0 && h > 0)) continue;
    const score = Math.abs(Math.log(w / h / viewportAspect));
    if (score < bestScore - 1e-9) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}
