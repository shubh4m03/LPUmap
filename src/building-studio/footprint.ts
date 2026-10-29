/**
 * Local frame and footprint derivation (S5). Pure; shared by the client and
 * the server, which recomputes every footprint itself (a client-sent
 * footprint is never trusted).
 *
 * Frame: equirectangular projection at the model anchor (the same formula as
 * src/distance/geodesic.ts createLocalProjection and §6.3 of
 * docs/ISOMETRIC_AND_3D_DESIGN.md). Error bound: the east scale uses cos(lat)
 * of the anchor, so a point (x, y) metres away is off by about
 * |x| · tan(lat) · |y| / R (+ O((d/R)²) terms). At the campus latitude
 * (31.25°, tan ≈ 0.61) that is ≤ 0.9 cm anywhere within 300 m of the anchor;
 * tests assert < 1 cm at 300 m against the haversine distance.
 *
 * Rotation: `rotationDeg` is clockwise from north. Model-local (x right,
 * y forward) maps to east/north as e = x·cosθ + y·sinθ, n = −x·sinθ + y·cosθ,
 * which preserves orientation (counter-clockwise stays counter-clockwise).
 */
import type { LngLat } from '../data/index.ts';
import { createLocalProjection, isValidLngLat } from '../distance/index.ts';
import { modelLocalFootprint } from './generators/shapes.ts';
import type { LocalPolygon, Vec2 } from './mesh/types.ts';
import type { ModelConfigV1, StudioFootprint } from './schema.ts';

export interface EnuFrame {
  origin: LngLat;
  toLocal(p: LngLat): Vec2;
  toLngLat(xy: Vec2): LngLat;
}

export function createEnuFrame(origin: LngLat): EnuFrame {
  const proj = createLocalProjection(origin);
  return { origin, toLocal: (p) => proj.toXY(p), toLngLat: (xy) => proj.toLngLat(xy) };
}

/** Model-local (x right, y forward) → east/north, rotating clockwise by `rotationDeg`. */
export function rotateToEnu(p: Vec2, rotationDeg: number): Vec2 {
  const t = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [p[0] * c + p[1] * s, -p[0] * s + p[1] * c];
}

/** Signed area of an open ring in metres² (positive = counter-clockwise). */
export function ringAreaM2(ring: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    s += (ring[j]![0] - ring[i]![0]) * (ring[j]![1] + ring[i]![1]);
  return s / 2;
}

/** Outer ring counter-clockwise, holes clockwise; rings open (closing vertex dropped). */
export function normalizeLocalPolygon(poly: LocalPolygon): LocalPolygon {
  return poly.map((ring, i) => {
    const open =
      ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1]
        ? ring.slice(0, -1)
        : [...ring];
    const ccw = ringAreaM2(open) > 0;
    return ccw === (i === 0) ? open : open.reverse();
  });
}

/** Area of a local polygon (outer minus holes), m². */
export function localPolygonAreaM2(poly: LocalPolygon): number {
  return poly.reduce((sum, ring, i) => sum + (i === 0 ? 1 : -1) * Math.abs(ringAreaM2(ring)), 0);
}

/** Local polygon → GeoJSON Polygon coordinates (closed rings, RFC 7946 orientation). */
export function localToLngLatPolygon(poly: LocalPolygon, frame: EnuFrame): LngLat[][] {
  return normalizeLocalPolygon(poly).map((ring) => {
    const out = ring.map((p) => frame.toLngLat(p));
    out.push(out[0]!);
    return out;
  });
}

/** GeoJSON Polygon coordinates → normalized local polygon in `frame`. */
export function lngLatToLocalPolygon(coords: readonly (readonly LngLat[])[], frame: EnuFrame): LocalPolygon {
  return normalizeLocalPolygon(coords.map((ring) => ring.map((p) => frame.toLocal(p))));
}

/** Vertex mean of a polygon's outer ring (closing vertex excluded), or null. */
export function outerVertexMean(coords: readonly (readonly LngLat[])[]): LngLat | null {
  const ring = coords[0];
  if (!ring || ring.length < 4) return null;
  const open = ring.slice(0, -1).filter((p) => isValidLngLat(p));
  if (open.length === 0) return null;
  const lon = open.reduce((s, p) => s + p[0], 0) / open.length;
  const lat = open.reduce((s, p) => s + p[1], 0) / open.length;
  return [lon, lat];
}

export type FootprintResult =
  | { ok: true; local: LocalPolygon; footprint: StudioFootprint; areaM2: number }
  | {
      ok: false;
      /** 'generator-not-implemented' was the contract-stage stub; it is kept in the type but never returned. */
      reason: 'missing-base-footprint' | 'generator-not-implemented' | 'invalid-geometry';
      message: string;
    };

/** Footprint of the 'box' generator in model-local metres (counter-clockwise rectangle centred on the anchor). */
export function boxLocalFootprint(widthM: number, lengthM: number): Vec2[] {
  const a = widthM / 2;
  const b = lengthM / 2;
  return [
    [-a, -b],
    [a, -b],
    [a, b],
    [-a, b],
  ];
}

/**
 * Derives the ground footprint from generator + parameters + transform: the
 * model-local shape (generators/shapes.ts) rotated clockwise by `rotationDeg`
 * about the anchor, then projected to lon/lat. 'footprint-prism' returns the
 * base footprint unchanged (it is authoritative). Parameters that cannot form
 * a shape are reported as 'invalid-geometry' with the reason; nothing is
 * clamped or repaired.
 */
export function deriveFootprint(
  config: ModelConfigV1,
  opts: { baseFootprint?: readonly (readonly LngLat[])[] } = {},
): FootprintResult {
  const frame = createEnuFrame(config.anchor);
  let local: LocalPolygon;
  if (config.generatorId === 'footprint-prism') {
    if (!opts.baseFootprint)
      return {
        ok: false,
        reason: 'missing-base-footprint',
        message: 'The base footprint of the target building is required.',
      };
    local = lngLatToLocalPolygon(opts.baseFootprint, frame);
  } else {
    const shape = modelLocalFootprint(config);
    if (!shape.ok) return { ok: false, reason: 'invalid-geometry', message: shape.message };
    local = shape.polygon.map((ring) => ring.map((p) => rotateToEnu(p, config.rotationDeg)));
  }
  local = normalizeLocalPolygon(local);
  const areaM2 = localPolygonAreaM2(local);
  if (!(areaM2 > 0) || local.some((r) => r.length < 3))
    return { ok: false, reason: 'invalid-geometry', message: 'The footprint has no area.' };
  return {
    ok: true,
    local,
    footprint: { type: 'Polygon', coordinates: localToLngLatPolygon(local, frame) },
    areaM2,
  };
}
