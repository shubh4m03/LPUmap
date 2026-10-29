/**
 * Faces of one building in the overview: extruded footprint prisms for base
 * buildings, and the shared StudioMesh faces for owner-authored models (S1).
 * Back faces are culled, the visible faces are painter-sorted within the
 * building (Newell plane tests, with an exact depth sample as fallback), and
 * each face gets a flat tone from a light fixed relative to north (§6.5).
 *
 * Pure: no DOM.
 */
import type { MaterialSlot, StudioFace, StudioMesh, WindowGrid } from '../building-studio/index.ts';
import type { LngLat } from '../data/index.ts';
import {
  boxOf,
  boxesOverlap,
  openRing,
  pointInRings,
  segmentIntersection,
  signedArea2,
  type Box,
  type Pt,
} from './geometry.ts';
import { EARTH_RADIUS_M, type Enu, type IsoProjection, type LocalFrame } from './projection.ts';

/** Light direction: from azimuth 200° (south-south-west), 35° up. Fixed to north, like the 3D mode's map-anchored light. */
export const LIGHT_AZIMUTH_DEG = 200;
export const LIGHT_ELEVATION_DEG = 35;
const DEG = Math.PI / 180;
const LIGHT: Enu = [
  Math.cos(LIGHT_ELEVATION_DEG * DEG) * Math.sin(LIGHT_AZIMUTH_DEG * DEG),
  Math.cos(LIGHT_ELEVATION_DEG * DEG) * Math.cos(LIGHT_AZIMUTH_DEG * DEG),
  Math.sin(LIGHT_ELEVATION_DEG * DEG),
];
const LIGHT_H = Math.hypot(LIGHT[0], LIGHT[1]);

export type FaceTone = 'roof' | 'roofShade' | 'wallLit' | 'wallMid' | 'wallShade';

/** Relative brightness used to shade an owner-chosen appearance colour. */
export const TONE_FACTOR: Readonly<Record<FaceTone, number>> = {
  roof: 1,
  roofShade: 0.82,
  wallLit: 1,
  wallMid: 0.84,
  wallShade: 0.68,
};

export interface IsoWindow {
  /** Quad in view units (k = 1). */
  quad: Pt[];
}

export interface IsoFace {
  /** Outer ring in view units (k = 1). */
  ring: Pt[];
  holes: Pt[][];
  material: MaterialSlot;
  tone: FaceTone;
  /** Appearance colour, already shaded (studio models only); null → theme tone. */
  fill: string | null;
  /** Synthetic window quads (studio models only; appearance, never a claim). */
  windows: IsoWindow[];
  box: Box;
  /** The face's plane in local metres (outward normal + a point), for depth queries. */
  plane: { normal: Enu; origin: Enu };
}

const dot = (a: Enu, b: Enu): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Flat tone of a face from its outward normal and material (3 wall steps, 2 roof steps). */
export function toneFor(normal: Enu, material: MaterialSlot): FaceTone {
  if (normal[2] >= 0.999) return 'roof';
  if (material === 'roof' || normal[2] > 0.25) return dot(normal, LIGHT) >= 0.45 ? 'roof' : 'roofShade';
  const h = Math.hypot(normal[0], normal[1]);
  const i = h > 0 ? (normal[0] * LIGHT[0] + normal[1] * LIGHT[1]) / (h * LIGHT_H) : 0;
  return i >= 0.6 ? 'wallLit' : i >= -0.5 ? 'wallMid' : 'wallShade';
}

/** `#rrggbb` scaled toward black by `factor` (0–1). Invalid input is returned unchanged. */
export function shadeHex(hex: string, factor: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1]!, 16);
  const ch = (s: number) =>
    Math.max(0, Math.min(255, Math.round(((v >> s) & 255) * factor)))
      .toString(16)
      .padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

// ---------------------------------------------------------------------------
// 3D faces (local ENU metres in the overview frame)
// ---------------------------------------------------------------------------

export interface Face3 {
  ring: Enu[];
  holes: Enu[][];
  normal: Enu;
  material: MaterialSlot;
  windows?: WindowGrid;
}

/** Normalises a footprint polygon (local metres): open rings, outer CCW, holes CW; degenerate rings dropped. */
export function normalizePolygon(rings: readonly (readonly Pt[])[]): Pt[][] {
  const out: Pt[][] = [];
  rings.forEach((r, i) => {
    const ring = openRing(r);
    if (ring.length < 3) return;
    const area2 = signedArea2(ring);
    if (Math.abs(area2) < 1e-9) return;
    if (i === 0 && out.length > 0) return;
    const wantCcw = out.length === 0;
    out.push(area2 > 0 === wantCcw ? ring : [...ring].reverse());
  });
  return out;
}

/** Walls and flat roof of a vertical prism over [z0, z1]. Bottom faces are omitted (never visible from above). */
export function prismFaces3(polygon: readonly (readonly Pt[])[], z0: number, z1: number): Face3[] {
  const faces: Face3[] = [];
  for (const ring of polygon) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]!;
      const q = ring[(i + 1) % ring.length]!;
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      // Outer CCW / holes CW: outward is to the right of travel.
      faces.push({
        ring: [
          [p[0], p[1], z0],
          [q[0], q[1], z0],
          [q[0], q[1], z1],
          [p[0], p[1], z1],
        ],
        holes: [],
        normal: [dy / len + 0, -dx / len + 0, 0], // `+ 0` normalises -0
        material: 'wall',
      });
    }
  }
  const [outer, ...holes] = polygon;
  if (outer)
    faces.push({
      ring: outer.map((p) => [p[0], p[1], z1] as const),
      holes: holes.map((h) => h.map((p) => [p[0], p[1], z1] as const)),
      normal: [0, 0, 1],
      material: 'roof',
    });
  return faces;
}

/** Studio mesh faces moved from the mesh's own ENU frame into the overview frame (exact equirectangular composition). */
export function studioFaces3(mesh: StudioMesh, frame: LocalFrame): Face3[] {
  const [e0, n0] = frame.toLocal(mesh.origin);
  const kxMesh = Math.cos(mesh.origin[1] * DEG) * DEG * EARTH_RADIUS_M;
  const sx = frame.kx / kxMesh;
  const sy = frame.ky / (DEG * EARTH_RADIUS_M);
  const move = (v: readonly [number, number, number]): Enu => [e0 + v[0] * sx, n0 + v[1] * sy, v[2]];
  return mesh.faces.map((f: StudioFace) => ({
    ring: f.ring.map(move),
    holes: (f.holes ?? []).map((h) => h.map(move)),
    normal: f.normal,
    material: f.material,
    ...(f.windows ? { windows: f.windows } : {}),
  }));
}

/** Footprint (outer ring first) of a studio mesh in the overview frame. */
export function studioFootprintLocal(mesh: StudioMesh, frame: LocalFrame): Pt[][] {
  const [e0, n0] = frame.toLocal(mesh.origin);
  const kxMesh = Math.cos(mesh.origin[1] * DEG) * DEG * EARTH_RADIUS_M;
  const sx = frame.kx / kxMesh;
  return mesh.footprint.map((r) => r.map((p) => [e0 + p[0] * sx, n0 + p[1]] as const));
}

// ---------------------------------------------------------------------------
// Culling + painter order within a building
// ---------------------------------------------------------------------------

export const isFrontFacing = (f: Pick<Face3, 'normal'>, proj: IsoProjection): boolean =>
  dot(f.normal, proj.towardViewer) > 1e-9;

const PLANE_EPS = 1e-4;

/** -1: p before q, 1: q before p, 0: no decision from plane tests. */
function planeOrder(p: Face3, q: Face3): -1 | 0 | 1 {
  const side = (pts: readonly Enu[], f: Face3) => {
    const o = f.ring[0]!;
    let front = false;
    let back = false;
    for (const v of pts) {
      const s = (v[0] - o[0]) * f.normal[0] + (v[1] - o[1]) * f.normal[1] + (v[2] - o[2]) * f.normal[2];
      if (s > PLANE_EPS) front = true;
      else if (s < -PLANE_EPS) back = true;
    }
    return { front, back };
  };
  const pq = side(p.ring, q); // p relative to q's plane
  const qp = side(q.ring, p);
  const pBeforeQ = !pq.front || !qp.back; // p wholly behind q's plane, or q wholly in front of p's
  const qBeforeP = !qp.front || !pq.back;
  if (pBeforeQ && !qBeforeP) return -1;
  if (qBeforeP && !pBeforeQ) return 1;
  return 0;
}

interface Projected<F extends Face3 = Face3> {
  f: F;
  ring: Pt[];
  holes: Pt[][];
  box: Box;
  /** Centroid depth (larger = farther). */
  depth: number;
}

/** A screen point strictly inside both projected faces, or null. */
function sharedPoint(a: Projected, b: Projected): Pt | null {
  const ra = [a.ring, ...a.holes];
  const rb = [b.ring, ...b.holes];
  // Vertices nudged toward their face's centroid, so points on a shared edge do not count.
  for (const [own, other] of [
    [a, rb],
    [b, ra],
  ] as const) {
    const c = centroid(own.ring);
    for (const p of own.ring) {
      const t: Pt = [p[0] + (c[0] - p[0]) * 1e-3, p[1] + (c[1] - p[1]) * 1e-3];
      if (pointInRings(t[0], t[1], other) && pointInRings(t[0], t[1], [own.ring, ...own.holes])) return t;
    }
  }
  for (let i = 0; i < a.ring.length; i++) {
    const p1 = a.ring[i]!;
    const p2 = a.ring[(i + 1) % a.ring.length]!;
    for (let j = 0; j < b.ring.length; j++) {
      const x = segmentIntersection(p1, p2, b.ring[j]!, b.ring[(j + 1) % b.ring.length]!);
      if (!x) continue;
      // Probe around the crossing for a point inside both.
      for (const [dx, dy] of [
        [1e-3, 1e-3],
        [-1e-3, 1e-3],
        [1e-3, -1e-3],
        [-1e-3, -1e-3],
      ] as const) {
        const t: Pt = [x[0] + dx, x[1] + dy];
        if (pointInRings(t[0], t[1], ra) && pointInRings(t[0], t[1], rb)) return t;
      }
    }
  }
  return null;
}

function centroid(ring: readonly Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

/**
 * Distance toward the viewer at which the ray through view point s meets a
 * plane (larger = nearer). Exact; used for painter decisions and tests.
 */
export function nearnessAt(plane: { normal: Enu; origin: Enu }, s: Pt, proj: IsoProjection): number {
  const [ge, gn] = proj.groundAt(s[0], s[1]);
  const v = proj.towardViewer;
  const { normal: nrm, origin: o } = plane;
  const den = dot(nrm, v);
  if (Math.abs(den) < 1e-12) return 0;
  return (nrm[0] * (o[0] - ge) + nrm[1] * (o[1] - gn) + nrm[2] * o[2]) / den;
}

export interface SortStats {
  cycles: number;
}

/**
 * Visible faces of one building, back to front. Faces whose projections can
 * overlap are ordered by Newell plane tests, else by an exact depth sample at a
 * shared screen point; unrelated faces keep centroid-depth order.
 */
export function sortVisibleFaces<F extends Face3>(
  faces: readonly F[],
  proj: IsoProjection,
  stats?: SortStats,
  /** Fixed order for some face pairs (-1: a first, 1: b first, 0: decide geometrically). */
  forced?: (a: F, b: F) => -1 | 0 | 1,
): F[] {
  const vis: Projected<F>[] = [];
  for (const f of faces) {
    if (!isFrontFacing(f, proj)) continue;
    const ring = f.ring.map((v) => proj.project(v[0], v[1], v[2]) as Pt);
    const holes = f.holes.map((h) => h.map((v) => proj.project(v[0], v[1], v[2]) as Pt));
    let d = 0;
    for (const v of f.ring) d += proj.depth(v[0], v[1], v[2]);
    vis.push({ f, ring, holes, box: boxOf(ring), depth: d / f.ring.length });
  }
  const n = vis.length;
  const succ: number[][] = vis.map(() => []);
  const indeg = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const a = vis[i]!;
      const b = vis[j]!;
      if (!boxesOverlap(a.box, b.box, 1e-6)) continue;
      let ord = forced ? forced(a.f, b.f) : 0;
      if (ord === 0) ord = planeOrder(a.f, b.f);
      if (ord === 0) {
        const s = sharedPoint(a, b);
        if (!s) continue;
        const na = nearnessAt({ normal: a.f.normal, origin: a.f.ring[0]! }, s, proj);
        const nb = nearnessAt({ normal: b.f.normal, origin: b.f.ring[0]! }, s, proj);
        if (Math.abs(na - nb) < 1e-6) continue;
        ord = na < nb ? -1 : 1;
      }
      const [from, to] = ord === -1 ? [i, j] : [j, i];
      succ[from]!.push(to);
      indeg[to]!++;
    }
  const order: number[] = [];
  const done = new Array<boolean>(n).fill(false);
  // Small n: each step picks a ready face; unconstrained ties draw upward-facing faces (roofs)
  // last (§6.4), then the farthest first.
  const before = (i: number, j: number) => {
    const zi = vis[i]!.f.normal[2];
    const zj = vis[j]!.f.normal[2];
    if (zi !== zj) return zi < zj;
    return vis[i]!.depth > vis[j]!.depth;
  };
  while (order.length < n) {
    let pick = -1;
    for (let i = 0; i < n; i++) if (!done[i] && indeg[i] === 0 && (pick < 0 || before(i, pick))) pick = i;
    if (pick < 0) {
      if (stats) stats.cycles++;
      for (let i = 0; i < n; i++) if (!done[i] && (pick < 0 || vis[i]!.depth > vis[pick]!.depth)) pick = i;
    }
    done[pick] = true;
    order.push(pick);
    for (const to of succ[pick]!) indeg[to]!--;
  }
  return order.map((i) => vis[i]!.f);
}

// ---------------------------------------------------------------------------
// Windows (synthetic appearance pattern on studio wall faces)
// ---------------------------------------------------------------------------

/** Window rectangles of a wall face in ENU, clipped to the face (windows not wholly inside are skipped). */
export function windowQuads3(face: Face3, maxWindows = 400): Enu[][] {
  const g = face.windows;
  if (!g || face.ring.length < 3) return [];
  const p0 = face.ring[0]!;
  const p1 = face.ring[1]!;
  const ux = p1[0] - p0[0];
  const uy = p1[1] - p0[1];
  const width = Math.hypot(ux, uy);
  if (width < 2) return [];
  const u: Enu = [ux / width, uy / width, 0];
  const zMin = Math.min(...face.ring.map((v) => v[2]));
  // Face outline in (u, v) for the containment test.
  const uv: Pt[] = face.ring.map((v) => [(v[0] - p0[0]) * u[0] + (v[1] - p0[1]) * u[1], v[2] - zMin]);
  const at = (s: number, h: number): Enu => [p0[0] + u[0] * s, p0[1] + u[1] * s, zMin + h];
  const out: Enu[][] = [];
  const density = Math.max(0, Math.min(1, g.density));
  const cols = Math.max(1, g.columns);
  const bay = width / cols;
  const fh = g.floorHeightM;
  const side = Math.sqrt(density);
  for (let fl = 0; fl < g.floors && out.length < maxWindows; fl++) {
    const v0 = g.bottomM + fl * fh;
    const rects: [number, number, number, number][] = [];
    if (g.pattern === 'ribbon') {
      const hh = fh * density;
      rects.push([width * 0.04, v0 + (fh - hh) / 2, width * 0.96, v0 + (fh + hh) / 2]);
    } else if (g.pattern === 'curtain') {
      rects.push([width * 0.02, v0 + fh * 0.04, width * 0.98, v0 + fh * 0.96]);
    } else {
      for (let c = 0; c < cols; c++) {
        const w = bay * side;
        const h = fh * side;
        const s0 = c * bay + (bay - w) / 2;
        const t0 = v0 + (fh - h) / 2;
        rects.push([s0, t0, s0 + w, t0 + h]);
      }
    }
    for (const [s0, t0, s1, t1] of rects) {
      const corners: Pt[] = [
        [s0, t0],
        [s1, t0],
        [s1, t1],
        [s0, t1],
      ];
      if (!corners.every((c) => pointInRings(c[0], c[1], [uv]))) continue;
      out.push(corners.map((c) => at(c[0], c[1])));
      if (out.length >= maxWindows) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface AppearanceColours {
  wall?: string;
  roof?: string;
  trim?: string;
  glass?: string;
  base?: string;
}

/** Projects one face to view units with its tone and (for studio faces) a shaded appearance colour. */
export function projectFace(
  f: Face3,
  proj: IsoProjection,
  colours: AppearanceColours | null,
  windowBudget: { left: number },
): IsoFace {
  const ring = f.ring.map((v) => proj.project(v[0], v[1], v[2]) as Pt);
  const tone = toneFor(f.normal, f.material);
  const base = colours ? colours[f.material] : undefined;
  const windows: IsoWindow[] = [];
  if (f.windows && windowBudget.left > 0) {
    for (const q of windowQuads3(f, Math.min(400, windowBudget.left))) {
      windows.push({ quad: q.map((v) => proj.project(v[0], v[1], v[2]) as Pt) });
    }
    windowBudget.left -= windows.length;
  }
  return {
    ring,
    holes: f.holes.map((h) => h.map((v) => proj.project(v[0], v[1], v[2]) as Pt)),
    material: f.material,
    tone,
    fill: base ? shadeHex(base, TONE_FACTOR[tone]) : null,
    windows,
    box: boxOf(ring),
    plane: { normal: f.normal, origin: f.ring[0]! },
  };
}

/** Parses GeoJSON Polygon / MultiPolygon coordinates defensively into polygons of [lon, lat] rings. */
export function polygonsOfGeometry(geometry: { type: string; coordinates: unknown }): LngLat[][][] {
  const isPos = (p: unknown): p is LngLat =>
    Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
  const ringOf = (r: unknown): LngLat[] | null =>
    Array.isArray(r) && r.every(isPos) ? r.map((p: LngLat) => [p[0], p[1]] as LngLat) : null;
  const polyOf = (p: unknown): LngLat[][] | null => {
    if (!Array.isArray(p)) return null;
    const rings = p.map(ringOf);
    return rings.every((r): r is LngLat[] => r !== null) && rings.length > 0 ? rings : null;
  };
  if (geometry.type === 'Polygon') {
    const p = polyOf(geometry.coordinates);
    return p ? [p] : [];
  }
  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.map(polyOf).filter((p): p is LngLat[][] => p !== null);
  }
  return [];
}
