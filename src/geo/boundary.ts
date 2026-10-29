/**
 * Campus boundary service — the single implementation of campus membership,
 * shared by the data pipeline (scripts/), the app, the server/admin and tests.
 * Pure: no DOM, Node or MapLibre APIs. Erasable syntax and `.ts` imports only.
 *
 * Geometry is measured in a local equirectangular projection in METRES
 * (src/distance createLocalProjection) centred on the boundary's bbox. Over
 * the ~1.7 km campus the scale error is far below footprint accuracy.
 *
 * Area of footprint ∩ boundary is EXACT for simple polygons (concave, with
 * holes, multipart): by Green's theorem the boundary of A∩B is (∂A inside B)
 * ∪ (∂B inside A), so every edge of each polygon is split at its crossings
 * with the other, each piece is kept when its midpoint is inside the other
 * polygon, and the kept pieces' shoelace terms are summed. Pieces lying on the
 * other polygon's edge are counted once, and only when both polygons have
 * their interior on the same side (same orientation). No convex-hull or
 * Sutherland–Hodgman shortcut is used, so a concave boundary is handled
 * correctly. Tests cross-check it against fine grid sampling.
 *
 * Membership rules (classifyFootprint), applied in this order — documented
 * in docs/MODULE_CONTRACTS.md "v2 geographic contract":
 *   R1 invalid polygon                    → 'uncertain' (invalid-geometry); never dropped.
 *   R2 curated decision for the id        → its status (curated-decision, with source).
 *   R3 touches/within bufferM of an OPEN review section → 'uncertain' (review-section).
 *   R4 insideFraction ≥ 0.995             → 'inside' (interior).
 *   R5 insideFraction ≤ 0.005             → 'outside' (exterior).
 *   R6 otherwise (crossing): f ≥ 0.5 and no conflicting evidence → 'crossing'
 *      (crossing-majority, in the inventory); f ≥ 0.5 with conflicting evidence →
 *      'uncertain' (crossing-conflict); f < 0.5 → 'uncertain' (crossing-minority).
 *   R7 point-on-surface or area centroid inside/outside disagrees with
 *      f ≥ 0.5 → pointAreaDisagreement = true and the reason says so. The
 *      status is NOT changed by R7: area fraction is the measurement, the
 *      points are corroborating evidence and the disagreement is recorded.
 * The fraction is rounded to 4 decimals BEFORE thresholds are applied, so the
 * stored value and the status always agree.
 */
import { APP_CONFIG } from '../config/index.ts';
import type {
  BoundaryReviewSection,
  CampusStatus,
  CuratedMembershipDecision,
  LngLat,
  MembershipDecision,
  MembershipMethod,
  MembershipReasonCode,
  ReviewGeometry,
} from '../data/index.ts';
import { createLocalProjection, isValidLngLat, type LocalProjection } from '../distance/index.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Rings in [lon, lat]; first = outer, rest = holes. GeoJSON closed rings. */
export type PolygonCoords = ReadonlyArray<ReadonlyArray<LngLat>>;
export type MultiPolygonCoords = ReadonlyArray<PolygonCoords>;
export type PolygonalGeometry =
  { type: 'Polygon'; coordinates: PolygonCoords } | { type: 'MultiPolygon'; coordinates: MultiPolygonCoords };

type XY = readonly [number, number];
/** Projected polygon: open rings, outer counter-clockwise, holes clockwise. */
type PlanarPolygon = XY[][];
interface Seg {
  a: XY;
  b: XY;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface Region {
  polygons: PlanarPolygon[];
  segs: Seg[];
  bbox: readonly [number, number, number, number];
}

export interface MembershipThresholds {
  insideMinFraction: number;
  outsideMaxFraction: number;
  crossingInventoryMinFraction: number;
}

export const DEFAULT_MEMBERSHIP_THRESHOLDS: MembershipThresholds = APP_CONFIG.geo.membership;

/** Geometry tolerance in metres (well below any survey precision). */
const EPS = 1e-6;

// ---------------------------------------------------------------------------
// Planar primitives
// ---------------------------------------------------------------------------

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

function ringSignedArea(ring: readonly XY[]): number {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % n]!;
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

function segOf(a: XY, b: XY): Seg {
  return {
    a,
    b,
    x0: Math.min(a[0], b[0]),
    y0: Math.min(a[1], b[1]),
    x1: Math.max(a[0], b[0]),
    y1: Math.max(a[1], b[1]),
  };
}

function ringSegs(ring: readonly XY[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 0, n = ring.length; i < n; i++) out.push(segOf(ring[i]!, ring[(i + 1) % n]!));
  return out;
}

function pointSegDist(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  let t = L > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Parameters (t on ab, u on cd) of a non-parallel intersection, or null. */
function segParams(a: XY, b: XY, c: XY, d: XY): [number, number] | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const den = cross(rx, ry, sx, sy);
  const scale = Math.hypot(rx, ry) * Math.hypot(sx, sy);
  if (scale === 0 || Math.abs(den) <= 1e-12 * scale) return null;
  const qx = c[0] - a[0];
  const qy = c[1] - a[1];
  const t = cross(qx, qy, sx, sy) / den;
  const u = cross(qx, qy, rx, ry) / den;
  const tolT = EPS / Math.hypot(rx, ry);
  const tolU = EPS / Math.hypot(sx, sy);
  if (t < -tolT || t > 1 + tolT || u < -tolU || u > 1 + tolU) return null;
  return [t, u];
}

/** Do segments ab and cd share at least one point (including collinear overlap and touching)? */
function segmentsTouch(a: XY, b: XY, c: XY, d: XY): boolean {
  if (segParams(a, b, c, d)) return true;
  return (
    pointSegDist(a, c, d) < EPS ||
    pointSegDist(b, c, d) < EPS ||
    pointSegDist(c, a, b) < EPS ||
    pointSegDist(d, a, b) < EPS
  );
}

function segSegDist(a: XY, b: XY, c: XY, d: XY): number {
  if (segParams(a, b, c, d)) return 0;
  return Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b));
}

/** Even–odd ray casting. */
function inRing(p: XY, ring: readonly XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside;
  }
  return inside;
}

function inPlanarPolygon(p: XY, poly: PlanarPolygon): boolean {
  const [outer, ...holes] = poly;
  return !!outer && inRing(p, outer) && !holes.some((h) => inRing(p, h));
}

function regionContains(p: XY, region: Region): boolean {
  const [x0, y0, x1, y1] = region.bbox;
  if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1) return false;
  return region.polygons.some((poly) => inPlanarPolygon(p, poly));
}

function bboxOfPolys(polys: readonly PlanarPolygon[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const poly of polys)
    for (const ring of poly)
      for (const [x, y] of ring) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
  return [x0, y0, x1, y1];
}

function makeRegion(polygons: PlanarPolygon[]): Region {
  const segs: Seg[] = [];
  for (const poly of polygons) for (const ring of poly) segs.push(...ringSegs(ring));
  return { polygons, segs, bbox: bboxOfPolys(polygons) };
}

const regionArea = (r: Region) =>
  r.polygons.reduce((s, poly) => s + poly.reduce((t, ring) => t + ringSignedArea(ring), 0), 0);

const bboxesOverlap = (
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
  pad = EPS,
) => a[0] <= b[2] + pad && b[0] <= a[2] + pad && a[1] <= b[3] + pad && b[1] <= a[3] + pad;

// ---------------------------------------------------------------------------
// Exact intersection area (Green's theorem edge classification)
// ---------------------------------------------------------------------------

/** Sum of shoelace terms of the pieces of `self`'s edges that bound self ∩ other. */
function boundaryContribution(self: Region, other: Region, takeSharedSameDirection: boolean): number {
  let s = 0;
  for (const e of self.segs) {
    const { a, b } = e;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) continue;
    const near = other.segs.filter(
      (o) => o.x0 <= e.x1 + EPS && e.x0 <= o.x1 + EPS && o.y0 <= e.y1 + EPS && e.y0 <= o.y1 + EPS,
    );
    // Split parameters: crossings and other's vertices lying on this edge.
    const ts = [0, 1];
    for (const o of near) {
      const p = segParams(a, b, o.a, o.b);
      if (p) ts.push(Math.min(1, Math.max(0, p[0])));
      for (const v of [o.a, o.b]) {
        if (pointSegDist(v, a, b) < EPS) {
          const t = ((v[0] - a[0]) * (b[0] - a[0]) + (v[1] - a[1]) * (b[1] - a[1])) / (len * len);
          ts.push(Math.min(1, Math.max(0, t)));
        }
      }
    }
    ts.sort((x, y) => x - y);
    for (let i = 0; i + 1 < ts.length; i++) {
      const t0 = ts[i]!;
      const t1 = ts[i + 1]!;
      if ((t1 - t0) * len < EPS) continue;
      const p: XY = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
      const q: XY = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
      const m: XY = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      // Is this piece on one of other's edges?
      let on = 0;
      for (const o of near) {
        if (pointSegDist(m, o.a, o.b) >= EPS) continue;
        const ox = o.b[0] - o.a[0];
        const oy = o.b[1] - o.a[1];
        const px = q[0] - p[0];
        const py = q[1] - p[1];
        if (Math.abs(cross(px, py, ox, oy)) > 1e-9 * Math.hypot(px, py) * Math.hypot(ox, oy)) continue;
        on = px * ox + py * oy > 0 ? 1 : -1;
        break;
      }
      const keep = on === 0 ? regionContains(m, other) : takeSharedSameDirection && on === 1;
      if (keep) s += p[0] * q[1] - q[0] * p[1];
    }
  }
  return s;
}

/** Exact area of a ∩ b in m² (both regions valid, consistently oriented). */
function intersectionArea(a: Region, b: Region): number {
  if (!bboxesOverlap(a.bbox, b.bbox)) return 0;
  const s = boundaryContribution(a, b, true) + boundaryContribution(b, a, false);
  return Math.max(0, s / 2);
}

/** Pieces of edge `e` split at crossings with, and vertices of, `near` (zero-length pieces dropped). */
function edgePieces(e: Seg, near: readonly Seg[]): [XY, XY][] {
  const { a, b } = e;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len === 0) return [];
  const ts = [0, 1];
  for (const o of near) {
    const p = segParams(a, b, o.a, o.b);
    if (p) ts.push(Math.min(1, Math.max(0, p[0])));
    for (const v of [o.a, o.b])
      if (pointSegDist(v, a, b) < EPS)
        ts.push(
          Math.min(
            1,
            Math.max(0, ((v[0] - a[0]) * (b[0] - a[0]) + (v[1] - a[1]) * (b[1] - a[1])) / (len * len)),
          ),
        );
  }
  ts.sort((x, y) => x - y);
  const out: [XY, XY][] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i]!;
    const t1 = ts[i + 1]!;
    if ((t1 - t0) * len < EPS) continue;
    out.push([
      [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0],
      [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1],
    ]);
  }
  return out;
}

const segsNear = (e: Seg, segs: readonly Seg[]) =>
  segs.filter((o) => o.x0 <= e.x1 + EPS && e.x0 <= o.x1 + EPS && o.y0 <= e.y1 + EPS && e.y0 <= o.y1 + EPS);

/** Offset used to probe either side of an edge piece (far below survey precision, far above EPS). */
const SIDE = 1e-4;

/**
 * Exact area of target ∩ (part₁ ∪ … ∪ partₙ) in m², where the parts may
 * overlap, duplicate or share walls. Green's theorem over the outline of the
 * intersection: a target edge piece counts when the target's inner side lies
 * in the union; a part edge piece counts when it lies inside the target and
 * the union ends on its outer side. A piece shared by several parts in the
 * same direction is counted once (lowest index).
 */
function unionIntersectionArea(target: Region, parts: readonly Region[]): number {
  const live = parts.filter((p) => bboxesOverlap(p.bbox, target.bbox));
  if (live.length === 0) return 0;
  const inUnion = (p: XY) => live.some((r) => regionContains(p, r));
  const sides = (p: XY, q: XY): [XY, XY] => {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const nx = (-(q[1] - p[1]) / len) * SIDE;
    const ny = ((q[0] - p[0]) / len) * SIDE;
    const mx = (p[0] + q[0]) / 2;
    const my = (p[1] + q[1]) / 2;
    return [
      [mx + nx, my + ny],
      [mx - nx, my - ny],
    ];
  };
  const term = (p: XY, q: XY) => p[0] * q[1] - q[0] * p[1];
  let s = 0;
  const partSegs = live.flatMap((r) => r.segs);
  for (const e of target.segs)
    for (const [p, q] of edgePieces(e, segsNear(e, partSegs))) if (inUnion(sides(p, q)[0])) s += term(p, q);
  live.forEach((part, i) => {
    const otherSegs = [...target.segs, ...live.filter((_, j) => j !== i).flatMap((r) => r.segs)];
    const earlierSegs = live.slice(0, i).flatMap((r) => r.segs);
    for (const e of part.segs)
      for (const [p, q] of edgePieces(e, segsNear(e, otherSegs))) {
        const [left, right] = sides(p, q);
        if (!regionContains(left, target) || !regionContains(right, target) || inUnion(right)) continue;
        const m: XY = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        const dup = segsNear(e, earlierSegs).some(
          (o) =>
            pointSegDist(m, o.a, o.b) < EPS &&
            (q[0] - p[0]) * (o.b[0] - o.a[0]) + (q[1] - p[1]) * (o.b[1] - o.a[1]) > 0,
        );
        if (!dup) s += term(p, q);
      }
  });
  return Math.max(0, s / 2);
}

// ---------------------------------------------------------------------------
// Validation and normalisation
// ---------------------------------------------------------------------------

function polygonsOf(geom: unknown): unknown[] | null {
  if (!geom || typeof geom !== 'object') return null;
  const g = geom as { type?: unknown; coordinates?: unknown };
  if (!Array.isArray(g.coordinates)) return null;
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates as unknown[];
  return null;
}

function dedupeRing(ring: readonly LngLat[]): LngLat[] {
  const out: LngLat[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
}

function ringSelfProblems(ring: readonly XY[]): string | null {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    const c = ring[(i + 2) % n]!;
    // spike: the next edge doubles back along this one
    const c1 = cross(b[0] - a[0], b[1] - a[1], c[0] - b[0], c[1] - b[1]);
    const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
    if (
      Math.abs(c1) <= 1e-12 * Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]) &&
      dot < 0
    )
      return 'spike (edge doubles back)';
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the closing vertex
      if (segmentsTouch(a, b, ring[j]!, ring[(j + 1) % n]!)) return 'self-intersection';
    }
  }
  return null;
}

/**
 * Problems that make a Polygon/MultiPolygon unusable for membership:
 * wrong type, non-finite or out-of-range coordinates, unclosed or degenerate
 * rings, zero area, self-intersections/spikes, holes crossing or outside the
 * outer ring, overlapping parts. Empty = valid.
 */
export function geometryProblems(geom: unknown): string[] {
  const polys = polygonsOf(geom);
  if (!polys) return ['not a Polygon or MultiPolygon'];
  if (polys.length === 0) return ['no polygons'];
  const proj = createLocalProjection(firstVertex(polys) ?? [0, 0]);
  const planar: PlanarPolygon[] = [];
  for (const [pi, poly] of polys.entries()) {
    if (!Array.isArray(poly) || poly.length === 0) return [`part ${pi}: no rings`];
    const rings: XY[][] = [];
    for (const [ri, ring] of (poly as unknown[]).entries()) {
      const where = `part ${pi} ring ${ri}`;
      if (!Array.isArray(ring) || !ring.every(isValidLngLat)) return [`${where}: invalid coordinates`];
      const r = ring as LngLat[];
      const f = r[0];
      const l = r[r.length - 1];
      if (r.length < 4 || !f || !l || f[0] !== l[0] || f[1] !== l[1]) return [`${where}: ring not closed`];
      const open = dedupeRing(r);
      if (open.length < 3) return [`${where}: fewer than 3 distinct vertices`];
      const xy = open.map((p) => proj.toXY(p) as XY);
      const self = ringSelfProblems(xy);
      if (self) return [`${where}: ${self}`];
      if (Math.abs(ringSignedArea(xy)) < 1e-6) return [`${where}: zero area`];
      rings.push(xy);
    }
    // rings of one polygon must not touch each other; holes lie inside the outer ring
    for (let i = 0; i < rings.length; i++)
      for (let j = i + 1; j < rings.length; j++)
        for (const s of ringSegs(rings[i]!))
          for (const t of ringSegs(rings[j]!))
            if (segmentsTouch(s.a, s.b, t.a, t.b)) return [`part ${pi}: rings ${i} and ${j} intersect`];
    const [outer, ...holes] = rings;
    for (const [hi, h] of holes.entries())
      if (!inRing(h[0]!, outer!)) return [`part ${pi}: hole ${hi + 1} outside the outer ring`];
    planar.push(orient(rings));
  }
  for (let i = 0; i < planar.length; i++)
    for (let j = i + 1; j < planar.length; j++)
      if (intersectionArea(makeRegion([planar[i]!]), makeRegion([planar[j]!])) > 1e-6)
        return [`parts ${i} and ${j} overlap`];
  return [];
}

function firstVertex(polys: unknown[]): LngLat | null {
  const p = (polys[0] as unknown[] | undefined)?.[0] as unknown[] | undefined;
  const v = p?.[0];
  return isValidLngLat(v) ? v : null;
}

/** Outer ring CCW, holes CW. */
function orient(rings: XY[][]): PlanarPolygon {
  return rings.map((r, i) => {
    const a = ringSignedArea(r);
    return (i === 0 && a < 0) || (i > 0 && a > 0) ? [...r].reverse() : r;
  });
}

function toPlanar(geom: PolygonalGeometry, proj: LocalProjection): PlanarPolygon[] {
  const polys: PolygonCoords[] = geom.type === 'Polygon' ? [geom.coordinates] : [...geom.coordinates];
  return polys.map((poly) => orient(poly.map((ring) => dedupeRing(ring).map((p) => proj.toXY(p) as XY))));
}

export class InvalidGeometryError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid polygon geometry: ${problems.join('; ')}`);
    this.name = 'InvalidGeometryError';
    this.problems = problems;
  }
}

function assertValid(geom: unknown): asserts geom is PolygonalGeometry {
  const problems = geometryProblems(geom);
  if (problems.length > 0) throw new InvalidGeometryError(problems);
}

// ---------------------------------------------------------------------------
// Stand-alone measurements
// ---------------------------------------------------------------------------

function geomBBoxLngLat(geom: PolygonalGeometry): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys)
    for (const ring of poly)
      for (const [x, y] of ring) {
        if (x < w) w = x;
        if (y < s) s = y;
        if (x > e) e = x;
        if (y > n) n = y;
      }
  return [w, s, e, n];
}

const bboxCentre = (b: readonly [number, number, number, number]): LngLat => [
  (b[0] + b[2]) / 2,
  (b[1] + b[3]) / 2,
];

/** Area in m² in a local metre projection centred on the geometry. Throws InvalidGeometryError. */
export function polygonAreaM2(geom: PolygonalGeometry): number {
  assertValid(geom);
  const proj = createLocalProjection(bboxCentre(geomBBoxLngLat(geom)));
  return regionArea(makeRegion(toPlanar(geom, proj)));
}

function planarCentroid(polys: readonly PlanarPolygon[]): XY | null {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (const poly of polys)
    for (const ring of poly)
      for (let i = 0, n = ring.length; i < n; i++) {
        const p = ring[i]!;
        const q = ring[(i + 1) % n]!;
        const f = p[0] * q[1] - q[0] * p[1];
        a += f;
        cx += (p[0] + q[0]) * f;
        cy += (p[1] + q[1]) * f;
      }
  if (Math.abs(a) < 1e-12) return null;
  return [cx / (3 * a), cy / (3 * a)];
}

/** Widest interior interval of a horizontal scanline at y, as [midpoint, width]. */
function scanline(polys: readonly PlanarPolygon[], y: number): [XY, number] | null {
  let best: [XY, number] | null = null;
  for (const poly of polys) {
    const xs: number[] = [];
    for (const ring of poly)
      for (let i = 0, n = ring.length; i < n; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % n]!;
        if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = xs[i + 1]! - xs[i]!;
      if (!best || w > best[1]) best = [[(xs[i]! + xs[i + 1]!) / 2, y], w];
    }
  }
  return best;
}

function planarPointOnSurface(polys: readonly PlanarPolygon[]): XY | null {
  const c = planarCentroid(polys);
  if (c && polys.some((p) => inPlanarPolygon(c, p))) return c;
  const [, y0, , y1] = bboxOfPolys(polys);
  const candidates = [c?.[1], (y0 + y1) / 2, y0 + (y1 - y0) / 3, y0 + ((y1 - y0) * 2) / 3].filter(
    (v): v is number => v !== undefined,
  );
  let best: [XY, number] | null = null;
  for (const raw of candidates) {
    // nudge off vertex heights so the scanline never passes exactly through a vertex
    const y = raw + (y1 - y0) * 1e-7;
    const hit = scanline(polys, y);
    if (hit && (!best || hit[1] > best[1])) best = hit;
  }
  return best ? best[0] : null;
}

/**
 * A point guaranteed inside the polygon (area centroid when it is inside,
 * else the middle of the widest horizontal interior interval). Null for an
 * invalid geometry.
 */
export function pointOnSurface(geom: PolygonalGeometry): LngLat | null {
  if (geometryProblems(geom).length > 0) return null;
  const proj = createLocalProjection(bboxCentre(geomBBoxLngLat(geom)));
  const p = planarPointOnSurface(toPlanar(geom, proj));
  return p ? proj.toLngLat(p) : null;
}

// ---------------------------------------------------------------------------
// The boundary
// ---------------------------------------------------------------------------

export interface CampusBoundary {
  /** Polygons as given (lon/lat rings). */
  readonly polygons: readonly PolygonCoords[];
  /** [west, south, east, north]. */
  readonly bbox: readonly [number, number, number, number];
  /** Projection origin (bbox centre). */
  readonly origin: LngLat;
  readonly projection: LocalProjection;
  /** Boundary area in m² (holes subtracted). */
  readonly areaM2: number;
  containsPoint(p: LngLat): boolean;
  /** Distance from p to the nearest boundary edge in metres (0 on the edge), inside or outside. */
  distanceToBoundaryM(p: LngLat): number;
  /** Shortest distance between a footprint and the boundary line in metres (0 when they touch or cross). */
  footprintDistanceToBoundaryM(geom: PolygonalGeometry): number;
  /** Footprint area in m². Throws InvalidGeometryError. */
  areaOf(geom: PolygonalGeometry): number;
  /** Exact area of footprint ∩ boundary in m². Throws InvalidGeometryError. */
  intersectionAreaM2(geom: PolygonalGeometry): number;
  /**
   * Exact area of boundary ∩ (union of geoms) in m²; the geoms may overlap,
   * duplicate each other or share edges. Throws InvalidGeometryError.
   */
  unionIntersectionAreaM2(geoms: readonly PolygonalGeometry[]): number;
  /** intersectionArea / area, 0–1 (unrounded). Throws InvalidGeometryError. */
  insideFraction(geom: PolygonalGeometry): number;
}

/**
 * Builds the boundary from Polygon/MultiPolygon geometries (several are
 * combined; they must not overlap). Throws InvalidGeometryError for an
 * invalid boundary — the pipeline must fail rather than guess.
 */
export function createBoundary(geometries: PolygonalGeometry | readonly PolygonalGeometry[]): CampusBoundary {
  const list = (Array.isArray(geometries) ? geometries : [geometries]) as readonly PolygonalGeometry[];
  if (list.length === 0) throw new InvalidGeometryError(['no boundary polygons']);
  const polygons: PolygonCoords[] = [];
  for (const g of list) {
    assertValid(g);
    if (g.type === 'Polygon') polygons.push(g.coordinates);
    else polygons.push(...g.coordinates);
  }
  const combined: PolygonalGeometry = { type: 'MultiPolygon', coordinates: polygons };
  assertValid(combined); // parts must not overlap
  const bbox = geomBBoxLngLat(combined);
  const origin = bboxCentre(bbox);
  const projection = createLocalProjection(origin);
  const region = makeRegion(toPlanar(combined, projection));
  const areaM2 = regionArea(region);

  const footprintRegion = (geom: PolygonalGeometry): Region => {
    assertValid(geom);
    return makeRegion(toPlanar(geom, projection));
  };
  const xy = (p: LngLat) => projection.toXY(p) as XY;
  const distToEdges = (p: XY) =>
    region.segs.reduce((m, s) => Math.min(m, pointSegDist(p, s.a, s.b)), Infinity);

  return {
    polygons,
    bbox,
    origin,
    projection,
    areaM2,
    containsPoint: (p) => isValidLngLat(p) && regionContains(xy(p), region),
    distanceToBoundaryM: (p) => distToEdges(xy(p)),
    footprintDistanceToBoundaryM(geom) {
      return regionDistance(footprintRegion(geom), region.segs);
    },
    areaOf: (geom) => regionArea(footprintRegion(geom)),
    intersectionAreaM2: (geom) => intersectionArea(footprintRegion(geom), region),
    unionIntersectionAreaM2: (geoms) => unionIntersectionArea(region, geoms.map(footprintRegion)),
    insideFraction(geom) {
      const fr = footprintRegion(geom);
      const area = regionArea(fr);
      if (!(area > 0)) throw new InvalidGeometryError(['zero area']);
      return Math.min(1, Math.max(0, intersectionArea(fr, region) / area));
    },
  };
}

/** Shortest distance between a region's outline and a set of segments (0 when they touch). */
function regionDistance(r: Region, segs: readonly Seg[]): number {
  let best = Infinity;
  for (const s of r.segs)
    for (const t of segs) {
      const d = segSegDist(s.a, s.b, t.a, t.b);
      if (d < best) best = d;
      if (best === 0) return 0;
    }
  return best;
}

/** Boundary from a boundary.geojson-shaped FeatureCollection (Polygon/MultiPolygon features). */
export function boundaryFromFeatureCollection(fc: {
  features: ReadonlyArray<{ geometry: { type: string; coordinates: unknown } }>;
}): CampusBoundary {
  const geoms = fc.features
    .map((f) => f.geometry)
    .filter((g) => g.type === 'Polygon' || g.type === 'MultiPolygon') as unknown as PolygonalGeometry[];
  return createBoundary(geoms);
}

// ---------------------------------------------------------------------------
// Review sections
// ---------------------------------------------------------------------------

/** Distance in metres from a footprint to a review-section geometry (0 when they touch/overlap). */
export function distanceToReviewGeometryM(
  geom: PolygonalGeometry,
  section: ReviewGeometry,
  projection: LocalProjection,
): number {
  assertValid(geom);
  const fr = makeRegion(toPlanar(geom, projection));
  if (section.type === 'LineString') {
    const pts = section.coordinates.map((p) => projection.toXY(p) as XY);
    const segs: Seg[] = [];
    for (let i = 0; i + 1 < pts.length; i++) segs.push(segOf(pts[i]!, pts[i + 1]!));
    // a line wholly inside the footprint is at distance 0
    if (pts.some((p) => regionContains(p, fr))) return 0;
    return regionDistance(fr, segs);
  }
  const sr = makeRegion(toPlanar({ type: 'Polygon', coordinates: section.coordinates }, projection));
  const anyInside =
    fr.polygons.some((poly) => poly.some((ring) => ring.some((p) => regionContains(p, sr)))) ||
    sr.polygons.some((poly) => poly.some((ring) => ring.some((p) => regionContains(p, fr))));
  if (anyInside) return 0;
  return regionDistance(fr, sr.segs);
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export interface FootprintInput {
  /** Stable feature id (`osm:way/…`, `det:…`); curated decisions are matched on it. */
  id: string;
  geometry: unknown;
  /**
   * Evidence that contradicts campus membership, e.g. 'operator=<non-LPU operator>'
   * derived from source tags. Only consulted for crossing footprints (R6).
   */
  conflicts?: readonly string[];
}

export interface MembershipResult {
  status: CampusStatus;
  inCampusInventory: boolean;
  /** Rounded to 4 decimals; null when the geometry is invalid. */
  insideFraction: number | null;
  areaM2: number | null;
  insideAreaM2: number | null;
  distanceToBoundaryM: number | null;
  method: MembershipMethod;
  reasonCode: MembershipReasonCode;
  reason: string;
  decision: MembershipDecision;
  decisionSource: string | null;
  reviewSectionId: string | null;
  /** Point-on-surface (valid geometry) — use as the feature's anchor. */
  anchor: LngLat | null;
  pointOnSurfaceInside: boolean | null;
  centroidInside: boolean | null;
  pointAreaDisagreement: boolean;
  /** Validation problems when reasonCode is 'invalid-geometry'. */
  problems: string[];
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;
const round2 = (v: number) => Math.round(v * 100) / 100;
const pct = (f: number) => `${round2(f * 100)} %`;

export function decisionSourceLabel(d: CuratedMembershipDecision): string {
  return `${d.source.kind}: ${d.source.ref} (${d.decidedAt})`;
}

/**
 * Classifies one footprint against the boundary. See the module comment for
 * rules R1–R7. Never throws for a bad footprint: invalid geometry is an
 * 'uncertain' result. `reviewSections` with status 'resolved' are ignored.
 */
export function classifyFootprint(
  footprint: FootprintInput,
  boundary: CampusBoundary,
  reviewSections: readonly BoundaryReviewSection[] = [],
  curatedDecisions: readonly CuratedMembershipDecision[] = [],
  thresholds: MembershipThresholds = DEFAULT_MEMBERSHIP_THRESHOLDS,
): MembershipResult {
  const base = {
    decision: 'auto' as MembershipDecision,
    decisionSource: null as string | null,
    reviewSectionId: null as string | null,
  };
  const decision = curatedDecisions.find((d) => d.featureId === footprint.id);

  // R1 invalid geometry
  const problems = geometryProblems(footprint.geometry);
  if (problems.length > 0) {
    return {
      ...base,
      status: 'uncertain',
      inCampusInventory: false,
      insideFraction: null,
      areaM2: null,
      insideAreaM2: null,
      distanceToBoundaryM: null,
      method: 'none',
      reasonCode: 'invalid-geometry',
      reason:
        `Invalid footprint geometry (${problems.join('; ')}); held for review, not dropped.` +
        (decision ? ' A curated decision exists but cannot apply until the geometry is fixed.' : ''),
      anchor: null,
      pointOnSurfaceInside: null,
      centroidInside: null,
      pointAreaDisagreement: false,
      problems,
    };
  }
  const geom = footprint.geometry as PolygonalGeometry;
  const areaM2 = boundary.areaOf(geom);
  const insideAreaM2 = boundary.intersectionAreaM2(geom);
  const f = round4(Math.min(1, Math.max(0, insideAreaM2 / areaM2)));
  const distanceToBoundaryM = round2(boundary.footprintDistanceToBoundaryM(geom));
  const planar = toPlanar(geom, boundary.projection);
  const pos = planarPointOnSurface(planar);
  const anchor = pos ? boundary.projection.toLngLat(pos) : null;
  const c = planarCentroid(planar);
  const pointOnSurfaceInside = anchor ? boundary.containsPoint(anchor) : null;
  const centroidInside = c ? boundary.containsPoint(boundary.projection.toLngLat(c)) : null;
  const majority = f >= thresholds.crossingInventoryMinFraction;
  const disagreeing = [
    pointOnSurfaceInside !== null && pointOnSurfaceInside !== majority ? 'point-on-surface' : null,
    centroidInside !== null && centroidInside !== majority ? 'area centroid' : null,
  ].filter((v): v is string => v !== null);
  const pointAreaDisagreement = disagreeing.length > 0;
  const disagreementNote = pointAreaDisagreement
    ? ` Note: the ${disagreeing.join(' and ')} test says ${majority ? 'outside' : 'inside'}, disagreeing with the area fraction (${pct(f)}).`
    : '';
  const measured = {
    insideFraction: f,
    areaM2: round2(areaM2),
    insideAreaM2: round2(insideAreaM2),
    distanceToBoundaryM,
    anchor,
    pointOnSurfaceInside,
    centroidInside,
    pointAreaDisagreement,
    problems: [] as string[],
  };
  const result = (
    status: CampusStatus,
    method: MembershipMethod,
    reasonCode: MembershipReasonCode,
    reason: string,
    extra: Partial<typeof base> = {},
  ): MembershipResult => ({
    ...base,
    ...measured,
    ...extra,
    status,
    inCampusInventory: status === 'inside' || status === 'crossing',
    method,
    reasonCode,
    reason: reason + disagreementNote,
  });

  // R2 curated decision
  if (decision) {
    const src = decisionSourceLabel(decision);
    return result(
      decision.status,
      'curated-decision',
      'curated-decision',
      `Curated decision: ${decision.status} (${src}); measured ${pct(f)} inside.`,
      { decision: 'curated', decisionSource: src },
    );
  }

  // R3 open review section
  for (const s of reviewSections) {
    if (s.status !== 'open') continue;
    const d = distanceToReviewGeometryM(geom, s.geometry, boundary.projection);
    if (d <= s.bufferM) {
      return result(
        'uncertain',
        'polygon-clip',
        'review-section',
        `Within ${round2(d)} m of open boundary-review section '${s.id}' (buffer ${s.bufferM} m); ` +
          `${pct(f)} inside. Excluded from the campus inventory until the boundary is confirmed.`,
        { reviewSectionId: s.id },
      );
    }
  }

  // R4 / R5
  if (f >= thresholds.insideMinFraction)
    return result(
      'inside',
      'polygon-clip',
      'interior',
      `${pct(f)} of the footprint area is inside the boundary.`,
    );
  if (f <= thresholds.outsideMaxFraction)
    return result(
      'outside',
      'polygon-clip',
      'exterior',
      `${pct(f)} of the footprint area is inside the boundary (${distanceToBoundaryM} m from it).`,
    );

  // R6 crossing
  const conflicts = footprint.conflicts ?? [];
  if (!majority)
    return result(
      'uncertain',
      'polygon-clip',
      'crossing-minority',
      `Crosses the boundary with only ${pct(f)} inside (below ${pct(thresholds.crossingInventoryMinFraction)}); held for review.`,
    );
  if (conflicts.length > 0)
    return result(
      'uncertain',
      'polygon-clip',
      'crossing-conflict',
      `Crosses the boundary with ${pct(f)} inside, but conflicting evidence: ${conflicts.join(', ')}; held for review.`,
    );
  return result(
    'crossing',
    'polygon-clip',
    'crossing-majority',
    `Crosses the boundary with ${pct(f)} inside and no conflicting evidence; included in the campus inventory.`,
  );
}

// ---------------------------------------------------------------------------
// Points (contributions, admin locations)
// ---------------------------------------------------------------------------

export type PointValidation = 'inside' | 'outside-in-context-area' | 'outside-area';
export type ContextArea =
  { kind: 'bbox'; bbox: readonly [number, number, number, number] } | { kind: 'buffer'; bufferM: number };

/** Default context area: the existing map extent (APP_CONFIG.map.maxBounds). */
export const DEFAULT_CONTEXT_AREA: ContextArea = { kind: 'bbox', bbox: APP_CONFIG.map.maxBounds };

/**
 * 'inside' the campus boundary; 'outside-in-context-area' (e.g. Law Gate —
 * eligible only for the opt-in "Nearby, outside campus" layer);
 * 'outside-area' (invalid or too far — reject).
 */
export function validatePointLocation(
  p: LngLat,
  boundary: CampusBoundary,
  contextArea: ContextArea = DEFAULT_CONTEXT_AREA,
): PointValidation {
  if (!isValidLngLat(p)) return 'outside-area';
  if (boundary.containsPoint(p)) return 'inside';
  if (contextArea.kind === 'bbox') {
    const [w, s, e, n] = contextArea.bbox;
    return p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n ? 'outside-in-context-area' : 'outside-area';
  }
  return boundary.distanceToBoundaryM(p) <= contextArea.bufferM ? 'outside-in-context-area' : 'outside-area';
}

/**
 * Mean of the distinct vertices of a (possibly invalid) polygon — the
 * documented anchor for footprints whose geometry is invalid, so they can
 * still be listed for review. Null when no valid coordinate exists.
 */
export function vertexMeanAnchor(geom: unknown): LngLat | null {
  const polys = polygonsOf(geom);
  if (!polys) return null;
  const seen = new Set<string>();
  let x = 0;
  let y = 0;
  for (const poly of polys) {
    if (!Array.isArray(poly)) continue;
    for (const ring of poly as unknown[]) {
      if (!Array.isArray(ring)) continue;
      for (const v of ring as unknown[]) {
        if (!isValidLngLat(v)) continue;
        const k = `${v[0]},${v[1]}`;
        if (seen.has(k)) continue;
        seen.add(k);
        x += v[0];
        y += v[1];
      }
    }
  }
  return seen.size === 0 ? null : [x / seen.size, y / seen.size];
}
