/**
 * Placement math for the studio custom layer: local east/north/up metres at a
 * mesh origin → MapLibre's spherical-mercator world (0..1 units) → clip space.
 * Pure (no WebGL, no MapLibre runtime), so it is unit-tested directly.
 *
 * Precision: vertex positions stay in small local metres (float32-safe); the
 * large mercator translation is folded into the per-instance matrix in
 * float64 and only the final product is cast to float32. A model 300 m from
 * its origin therefore keeps sub-centimetre precision at every zoom, which a
 * float32 mercator vertex (~2 m steps near x ≈ 0.7) could not.
 *
 * Frame agreement: MercatorCoordinate.fromLngLat uses the same formulas
 * (x = (180 + lon) / 360, y = (180 − 180/π · ln tan(π/4 + lat·π/360)) / 360,
 * one metre = 1 / (2πR·cos lat) mercator units, R = 6,371,008.8 m). The
 * linear scale at the origin differs from the ENU frame of
 * src/building-studio/footprint.ts by the Mercator scale change across the
 * model, ≈ |n|·tan(lat)/R relative: 300 m north at 31.25° N moves a point by
 * < 1 cm (asserted in tests/unit/studio-render/placement.test.ts).
 */
import type { LngLat } from '../../../data/schema.ts';

/** Mean Earth radius used by MapLibre (and src/distance/geodesic.ts). */
export const EARTH_RADIUS_M = 6371008.8;
const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * EARTH_RADIUS_M;

export interface MercatorPoint {
  x: number;
  y: number;
  z: number;
}

/** Spherical-mercator world coordinates (0..1) of a ground point, z from metres. */
export function mercatorFromLngLat(lngLat: LngLat, altitudeM = 0): MercatorPoint {
  const [lon, lat] = lngLat;
  const x = (180 + lon) / 360;
  const y = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
  return { x, y, z: altitudeM * metreInMercatorUnits(lat) };
}

/** Inverse of mercatorFromLngLat for x and y. */
export function lngLatFromMercator(p: Pick<MercatorPoint, 'x' | 'y'>): LngLat {
  const lon = p.x * 360 - 180;
  const y2 = 180 - p.y * 360;
  const lat = (360 / Math.PI) * Math.atan(Math.exp((y2 * Math.PI) / 180)) - 90;
  return [lon, lat];
}

/** Length of one metre in mercator units at a latitude (MapLibre's meterInMercatorCoordinateUnits). */
export function metreInMercatorUnits(latDeg: number): number {
  return 1 / (EARTH_CIRCUMFERENCE_M * Math.cos((latDeg * Math.PI) / 180));
}

/** Column-major 4×4 matrix (WebGL / gl-matrix layout). */
export type Mat4 = Float64Array;

/**
 * Model matrix: local ENU metres at `origin` → mercator world. East maps to
 * +x, north to −y (mercator y grows southwards) and up to +z, all scaled by
 * the metre length at the origin's latitude.
 */
export function modelMatrix(origin: LngLat): Mat4 {
  const o = mercatorFromLngLat(origin);
  const s = metreInMercatorUnits(origin[1]);
  const m = new Float64Array(16);
  m[0] = s;
  m[5] = -s;
  m[10] = s;
  m[12] = o.x;
  m[13] = o.y;
  m[14] = 0;
  m[15] = 1;
  return m;
}

/** a × b (column-major), float64. */
export function multiplyMat4(a: ArrayLike<number>, b: ArrayLike<number>): Mat4 {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + row]! * b[col * 4 + k]!;
      out[col * 4 + row] = s;
    }
  return out;
}

/** m × [x, y, z, 1] → [x, y, z, w]. */
export function transformPoint(m: ArrayLike<number>, p: readonly [number, number, number]): number[] {
  const out = [0, 0, 0, 0];
  for (let row = 0; row < 4; row++)
    out[row] = m[row]! * p[0] + m[4 + row]! * p[1] + m[8 + row]! * p[2] + m[12 + row]!;
  return out;
}

/**
 * The matrix uploaded per instance: MapLibre's mercator projection matrix
 * (`defaultProjectionData.mainMatrix`, 0..1 world → clip) × the model matrix,
 * multiplied in float64 and returned as float32.
 */
export function instanceMatrix(mainMatrix: ArrayLike<number>, origin: LngLat): Float32Array {
  return Float32Array.from(multiplyMat4(mainMatrix, modelMatrix(origin)));
}

/** Determinant of a 4×4 matrix. */
export function determinant4(m: ArrayLike<number>): number {
  const a = (r: number, c: number) => m[c * 4 + r]!;
  const s0 = a(0, 0) * a(1, 1) - a(1, 0) * a(0, 1);
  const s1 = a(0, 0) * a(1, 2) - a(1, 0) * a(0, 2);
  const s2 = a(0, 0) * a(1, 3) - a(1, 0) * a(0, 3);
  const s3 = a(0, 1) * a(1, 2) - a(1, 1) * a(0, 2);
  const s4 = a(0, 1) * a(1, 3) - a(1, 1) * a(0, 3);
  const s5 = a(0, 2) * a(1, 3) - a(1, 2) * a(0, 3);
  const c5 = a(2, 2) * a(3, 3) - a(3, 2) * a(2, 3);
  const c4 = a(2, 1) * a(3, 3) - a(3, 1) * a(2, 3);
  const c3 = a(2, 1) * a(3, 2) - a(3, 1) * a(2, 2);
  const c2 = a(2, 0) * a(3, 3) - a(3, 0) * a(2, 3);
  const c1 = a(2, 0) * a(3, 2) - a(3, 0) * a(2, 2);
  const c0 = a(2, 0) * a(3, 1) - a(3, 0) * a(2, 1);
  return s0 * c5 - s1 * c4 + s2 * c3 + s3 * c2 - s4 * c1 + s5 * c0;
}

/**
 * Winding that marks a FRONT face on screen for a model→clip matrix.
 *
 * Mesh faces are counter-clockwise seen from outside, in right-handed ENU.
 * GL's normalised device space is left-handed (x right, y up, z into the
 * screen), so the sign of the full matrix's determinant decides, for points
 * in front of the camera (w > 0): negative — the usual case, because a GL
 * perspective flips z — keeps them counter-clockwise on screen; positive
 * (one extra mirror, e.g. a y flip) turns them clockwise. MapLibre's
 * mercator matrix and our ENU→mercator y flip are both mirrors, so the sign
 * is read from the live matrix rather than assumed (tests check both cases
 * against an explicit camera).
 */
export function frontFaceWinding(m: ArrayLike<number>): 'cw' | 'ccw' {
  return determinant4(m) < 0 ? 'ccw' : 'cw';
}

/** Where a local ENU point (metres at `origin`) lands on the ground, as [lon, lat]. */
export function localToLngLat(origin: LngLat, local: readonly [number, number]): LngLat {
  const w = transformPoint(modelMatrix(origin), [local[0], local[1], 0]);
  return lngLatFromMercator({ x: w[0]!, y: w[1]! });
}

/**
 * The lighting vector of MapLibre's fill-extrusion shader for a map-anchored
 * light at position [r, azimuth°, polar°], in local ENU (x east, y north,
 * z up), so studio faces are shaded like the extrusions beside them.
 *
 * Measured, not assumed (docs/research/renderer-bakeoff, lightcheck): with
 * the app's light (azimuth 210°) MapLibre lights faces whose outward normal
 * points towards the azimuth (south and west), and the radial distance r
 * scales the vector (a roof gets clamp(r · cos polar)). Hence
 * r · (sin a · sin p, cos a · sin p, cos p).
 */
export function lightDirectionEnu(position: readonly [number, number, number]): [number, number, number] {
  const [r, azimuthDeg, polarDeg] = position;
  const a = (azimuthDeg * Math.PI) / 180;
  const p = (polarDeg * Math.PI) / 180;
  return [r * Math.sin(a) * Math.sin(p), r * Math.cos(a) * Math.sin(p), r * Math.cos(p)];
}
