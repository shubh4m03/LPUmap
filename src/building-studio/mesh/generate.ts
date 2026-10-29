/**
 * Procedural mesh generation: ModelConfigV1 → StudioMesh (S1). Pure and
 * deterministic (same config → identical faces), so the server, the
 * realistic-3D layer, the isometric renderer and thumbnails agree.
 *
 * Generators (docs/BUILDING_STUDIO_DESIGN.md §3.1; shapes in
 * ../generators/shapes.ts): box, l-shape, u-shape (open U or closed
 * courtyard), hall, tower-podium, kiosk-canopy, stepped and the internal
 * footprint-prism. Each produces ONE closed surface per solid, so
 * meshVolumeM3 equals the modelled volume.
 *
 * Roof conventions (box, hall, kiosk body): gable and hip ridges run along
 * the longer side; a shed roof rises towards the model's right (+x). The
 * rise is (half the span) × tan(pitch) for gable/hip and span × tan(pitch)
 * for shed. Every other generator has a flat top ('stepped' = the flat tops
 * of its tiers).
 *
 * Detail levels, cumulative (S14):
 *  - 'massing': the body with flat tops (tiers, tower and canopy slab are
 *    part of the body), no windows;
 *  - 'roof': adds the pitched roof shape;
 *  - 'facade': adds window grids (appearance only, drawn by the renderer);
 *  - 'details': adds a parapet on flat top roofs, balcony slabs (one
 *    continuous slab per upper floor on walls ≥ 6 m, only when
 *    facade.balconies), the entrance marker (a door slab and a small canopy
 *    on the wall facing `entranceSide`; a visual marker, never a routing
 *    connection, S7) and posts under a kiosk canopy.
 * The details are deliberately sparse: no railings, ornaments or other
 * filler that would suggest knowledge of the real building.
 *
 * Triangle budget (TRIANGLE_BUDGET per requested level): when a model would
 * exceed it (e.g. balconies on a 40-floor block with many walls) the next
 * lower level is generated instead and generateStudioMeshDetailed reports
 * both the requested and the rendered level, so the UI can say so.
 */
import type { LngLat } from '../../data/index.ts';
import { isValidLngLat } from '../../distance/index.ts';
import {
  createEnuFrame,
  lngLatToLocalPolygon,
  normalizeLocalPolygon,
  outerVertexMean,
  ringAreaM2,
  rotateToEnu,
} from '../footprint.ts';
import {
  bodyRect,
  kioskParts,
  modelLocalFootprint,
  podiumHeightM,
  rectRing,
  steppedTiers,
  towerRect,
  type Rect,
} from '../generators/shapes.ts';
import {
  DETAIL_LEVELS,
  modelSupport,
  type DetailLevel,
  type ModelConfigV1,
  type ModelEnvelope,
  type StudioFootprint,
} from '../schema.ts';
import {
  faceNormal,
  meshBBox,
  type LocalPolygon,
  type MaterialSlot,
  type MeshFailureReason,
  type MeshResult,
  type StudioFace,
  type StudioMesh,
  type Vec2,
  type Vec3,
  type WindowGrid,
} from './types.ts';

/** Approximate window bay width used to derive grid columns, metres. */
export const WINDOW_BAY_M = 3.5;

/** Most triangles a model may need at each requested detail level (see the module comment). */
export const TRIANGLE_BUDGET: Readonly<Record<DetailLevel, number>> = {
  massing: 1500,
  roof: 1500,
  facade: 1500,
  details: 6000,
};

/** Fixed sizes of the 'details' level, metres (generic, never a claim about a real building). */
export const DETAIL_SIZES = {
  parapetHeightM: 0.9,
  parapetThicknessM: 0.25,
  balconyDepthM: 1.2,
  balconySlabM: 0.15,
  balconyEndMarginM: 1.5,
  balconyMinWallM: 6,
  doorWidthM: 2,
  doorHeightM: 2.4,
  doorDepthM: 0.1,
  entranceCanopyDepthM: 1.4,
  entranceCanopySlabM: 0.2,
  /** Thickness of a kiosk canopy slab (all levels: the canopy is part of the roofed footprint). */
  kioskCanopySlabM: 0.25,
  postM: 0.2,
} as const;

export interface GenerateOptions {
  /** Base footprint (GeoJSON Polygon coordinates) — required by 'footprint-prism'. */
  baseFootprint?: readonly (readonly LngLat[])[];
}

export interface WallStyle {
  windows: Omit<WindowGrid, 'columns'> | null;
}

const LEVEL_RANK: Readonly<Record<DetailLevel, number>> = { massing: 0, roof: 1, facade: 2, details: 3 };
const atLeast = (level: DetailLevel, min: DetailLevel) => LEVEL_RANK[level] >= LEVEL_RANK[min];

const dedupe = (ring: Vec3[]): Vec3[] =>
  ring.filter((v, i) => {
    const w = ring[(i + ring.length - 1) % ring.length]!;
    return !(Math.abs(v[0] - w[0]) < 1e-9 && Math.abs(v[1] - w[1]) < 1e-9 && Math.abs(v[2] - w[2]) < 1e-9);
  });

function face(ring: Vec3[], material: MaterialSlot, holes?: Vec3[][], windows?: WindowGrid): StudioFace {
  const r = dedupe(ring);
  const f: StudioFace = { ring: r, normal: faceNormal(r), material };
  if (holes && holes.length > 0) f.holes = holes.map(dedupe);
  if (windows) f.windows = windows;
  return f;
}

const NO_WINDOWS: WallStyle = { windows: null };

/**
 * A vertical wall from p to q (open ring, outward = right of p→q seen from
 * above), bottom at z0, top following `top` and an optional apex between.
 */
function wall(
  p: Vec2,
  q: Vec2,
  z0: number,
  top: (v: Vec2) => number,
  style: WallStyle,
  apex?: Vec3,
  material: MaterialSlot = 'wall',
): StudioFace {
  const ring: Vec3[] = [
    [p[0], p[1], z0],
    [q[0], q[1], z0],
    [q[0], q[1], top(q)],
    ...(apex ? [apex] : []),
    [p[0], p[1], top(p)],
  ];
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const windows =
    style.windows && len >= 2 && material === 'wall'
      ? { ...style.windows, columns: Math.max(1, Math.round(len / WINDOW_BAY_M)) }
      : undefined;
  return face(ring, material, undefined, windows);
}

const lift = (ring: readonly Vec2[], z: number): Vec3[] => ring.map((p) => [p[0], p[1], z]);

interface ExtrudeOptions {
  style?: WallStyle;
  top?: MaterialSlot;
  sides?: MaterialSlot;
  base?: MaterialSlot;
  /** Extra clockwise holes in the top face (where a narrower volume continues upwards). */
  topHoles?: readonly (readonly Vec2[])[];
  /** Omit the base face (the volume sits on a lower volume whose top has a matching hole). */
  open?: boolean;
}

/** Straight prism over a local polygon (outer CCW, holes CW): top, walls, base. */
function extrude(poly: LocalPolygon, z0: number, z1: number, o: ExtrudeOptions = {}): StudioFace[] {
  const rings = normalizeLocalPolygon(poly);
  const style = o.style ?? NO_WINDOWS;
  const faces: StudioFace[] = [
    face(lift(rings[0]!, z1), o.top ?? 'roof', [
      ...rings.slice(1).map((h) => lift(h, z1)),
      ...(o.topHoles ?? []).map((h) => lift(h, z1)),
    ]),
  ];
  for (const ring of rings)
    for (let i = 0; i < ring.length; i++)
      faces.push(wall(ring[i]!, ring[(i + 1) % ring.length]!, z0, () => z1, style, undefined, o.sides));
  if (!o.open)
    faces.push(
      face(
        lift([...rings[0]!].reverse(), z0),
        o.base ?? 'base',
        rings.slice(1).map((h) => lift([...h].reverse(), z0)),
      ),
    );
  return faces;
}

/**
 * A straight prism over a local polygon (outer CCW, holes CW): walls, roof
 * at z1, base at z0. Used by 'footprint-prism' and as the S2 fallback.
 */
export function prismFaces(
  poly: LocalPolygon,
  z0: number,
  z1: number,
  style: WallStyle = NO_WINDOWS,
): StudioFace[] {
  return extrude(poly, z0, z1, { style });
}

type BoxRoof = 'flat' | 'shed' | 'gable' | 'hip';

/** A rectangular body with a flat, shed, gable or hip roof (walls carry `style`). */
function boxSolid(
  r: Rect,
  z0: number,
  z1: number,
  roof: BoxRoof,
  pitchDeg: number,
  style: WallStyle,
): StudioFace[] {
  const pitch = (pitchDeg * Math.PI) / 180;
  const cx = (r.x0 + r.x1) / 2;
  const cy = (r.y0 + r.y1) / 2;
  const width = r.x1 - r.x0;
  const length = r.y1 - r.y0;
  const faces: StudioFace[] = [];

  // Ridge frame (u across the ridge, v along it), centred on the rectangle.
  // Gable/hip ridges follow the longer side; (u, v) → (x, y) is a rotation,
  // so windings survive.
  const alongY = roof === 'shed' || length >= width;
  const A = (alongY ? width : length) / 2;
  const B = (alongY ? length : width) / 2;
  const toXY = (u: number, v: number): Vec2 => (alongY ? [cx + u, cy + v] : [cx + v, cy - u]);
  const toUV = (xy: Vec2): Vec2 => (alongY ? [xy[0] - cx, xy[1] - cy] : [cy - xy[1], xy[0] - cx]);
  const P = (u: number, v: number, z: number): Vec3 => {
    const [x, y] = toXY(u, v);
    return [x, y, z];
  };
  const corners: Vec2[] = [
    [-A, -B],
    [A, -B],
    [A, B],
    [-A, B],
  ];

  let top: (uv: Vec2) => number = () => z1;
  const apexFor: (Vec3 | undefined)[] = [undefined, undefined, undefined, undefined];
  if (roof === 'shed') {
    const rise = 2 * A * Math.tan(pitch);
    top = (uv) => z1 + ((uv[0] + A) / (2 * A)) * rise;
    faces.push(
      face(
        corners.map((c) => P(c[0], c[1], top(c))),
        'roof',
      ),
    );
  } else if (roof === 'gable') {
    const zr = z1 + A * Math.tan(pitch);
    apexFor[0] = P(0, -B, zr);
    apexFor[2] = P(0, B, zr);
    faces.push(face([P(A, -B, z1), P(A, B, z1), P(0, B, zr), P(0, -B, zr)], 'roof'));
    faces.push(face([P(-A, B, z1), P(-A, -B, z1), P(0, -B, zr), P(0, B, zr)], 'roof'));
  } else if (roof === 'hip') {
    const zr = z1 + A * Math.tan(pitch);
    const half = B - A; // half ridge length (0 → pyramid)
    faces.push(face([P(A, -B, z1), P(A, B, z1), P(0, half, zr), P(0, -half, zr)], 'roof'));
    faces.push(face([P(-A, B, z1), P(-A, -B, z1), P(0, -half, zr), P(0, half, zr)], 'roof'));
    faces.push(face([P(-A, -B, z1), P(A, -B, z1), P(0, -half, zr)], 'roof'));
    faces.push(face([P(A, B, z1), P(-A, B, z1), P(0, half, zr)], 'roof'));
  } else {
    faces.push(
      face(
        corners.map((c) => P(c[0], c[1], z1)),
        'roof',
      ),
    );
  }

  for (let i = 0; i < 4; i++) {
    const p = corners[i]!;
    const q = corners[(i + 1) % 4]!;
    faces.push(wall(toXY(p[0], p[1]), toXY(q[0], q[1]), z0, (xy) => top(toUV(xy)), style, apexFor[i]));
  }
  faces.push(
    face(
      [...corners].reverse().map((c) => P(c[0], c[1], z0)),
      'base',
    ),
  );
  return faces;
}

/** Closed box over a quadrilateral (any winding) between z0 and z1, one material. */
const slab = (quad: readonly Vec2[], z0: number, z1: number, material: MaterialSlot): StudioFace[] =>
  extrude([[...quad]], z0, z1, { top: material, sides: material, base: material });

// ---------------------------------------------------------------------------
// Details helpers
// ---------------------------------------------------------------------------

/** A wall run used for balconies and the entrance (model-local, outward = right of p→q). */
interface WallRun {
  p: Vec2;
  q: Vec2;
  /** Bottom and eave height of the wall, metres. */
  zb: number;
  zt: number;
  floors: number;
  ground: boolean;
}

const runsOf = (ring: readonly Vec2[], zb: number, zt: number, floors: number, ground: boolean): WallRun[] =>
  ring.map((p, i) => ({ p, q: ring[(i + 1) % ring.length]!, zb, zt, floors, ground }));

/** Point at distance t along p→q and s outwards (right of p→q). */
function along(run: Pick<WallRun, 'p' | 'q'>, t: number, s: number): Vec2 {
  const dx = run.q[0] - run.p[0];
  const dy = run.q[1] - run.p[1];
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  return [run.p[0] + ux * t + uy * s, run.p[1] + uy * t - ux * s];
}

const runQuad = (run: WallRun, t0: number, t1: number, s0: number, s1: number): Vec2[] => [
  along(run, t0, s0),
  along(run, t1, s0),
  along(run, t1, s1),
  along(run, t0, s1),
];

const runLength = (r: Pick<WallRun, 'p' | 'q'>) => Math.hypot(r.q[0] - r.p[0], r.q[1] - r.p[1]);

function cross2(o: Vec2, a: Vec2, b: Vec2): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross2(c, d, a);
  const d2 = cross2(c, d, b);
  const d3 = cross2(a, b, c);
  const d4 = cross2(a, b, d);
  return d1 * d2 <= 0 && d3 * d4 <= 0 && !(d1 === 0 && d2 === 0 && d3 === 0 && d4 === 0);
}

/** True when two different rings share no point, and each ring is simple. */
function ringsDisjointAndSimple(rings: readonly (readonly Vec2[])[]): boolean {
  const edges: [Vec2, Vec2, number, number][] = [];
  rings.forEach((r, ri) => r.forEach((p, i) => edges.push([p, r[(i + 1) % r.length]!, ri, i])));
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const [a, b, ra, ia] = edges[i]!;
      const [c, d, rb, ib] = edges[j]!;
      if (ra === rb) {
        const n = rings[ra]!.length;
        if (ib === ia + 1 || (ia === 0 && ib === n - 1)) continue; // adjacent edges share a vertex
      }
      if (segmentsIntersect(a, b, c, d)) return false;
    }
  return true;
}

/** Offsets a ring to the LEFT of its direction by d (miter joins), or null at a too-sharp corner. */
function offsetLeft(ring: readonly Vec2[], d: number): Vec2[] | null {
  const n = ring.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = ring[(i + n - 1) % n]!;
    const cur = ring[i]!;
    const next = ring[(i + 1) % n]!;
    const l1 = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    const l2 = Math.hypot(next[0] - cur[0], next[1] - cur[1]);
    if (l1 < 1e-9 || l2 < 1e-9) return null;
    const n1: Vec2 = [-(cur[1] - prev[1]) / l1, (cur[0] - prev[0]) / l1];
    const n2: Vec2 = [-(next[1] - cur[1]) / l2, (next[0] - cur[0]) / l2];
    const denom = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    if (denom < 0.2) return null;
    out.push([cur[0] + ((n1[0] + n2[0]) * d) / denom, cur[1] + ((n1[1] + n2[1]) * d) / denom]);
  }
  return out;
}

/**
 * Parapet on the top polygon `poly` (outer CCW, holes CW) at height z: an
 * annular wall along every ring, on the roof side. Skipped (empty) when the
 * roof is too narrow for it, so it never overlaps itself.
 */
function parapet(poly: LocalPolygon, z: number): StudioFace[] {
  const { parapetThicknessM: t, parapetHeightM: h } = DETAIL_SIZES;
  const rings = normalizeLocalPolygon(poly);
  const offsets: Vec2[][] = [];
  for (const ring of rings) {
    const o = offsetLeft(ring, t);
    if (!o || Math.sign(ringAreaM2(o)) !== Math.sign(ringAreaM2(ring))) return [];
    offsets.push(o);
  }
  if (!ringsDisjointAndSimple([...rings, ...offsets])) return [];
  return rings.flatMap((ring, i) =>
    extrude(i === 0 ? [ring, offsets[i]!] : [offsets[i]!, ring], z, z + h, {
      top: 'trim',
      sides: 'trim',
      base: 'trim',
    }),
  );
}

/** One continuous balcony slab per upper floor on every run ≥ balconyMinWallM. */
function balconies(runs: readonly WallRun[], floorHeightM: number): StudioFace[] {
  const s = DETAIL_SIZES;
  const out: StudioFace[] = [];
  for (const run of runs) {
    const len = runLength(run);
    if (len < s.balconyMinWallM) continue;
    for (let k = 1; k < run.floors; k++) {
      const z = run.zb + k * floorHeightM;
      if (z + 1 > run.zt) break;
      out.push(
        ...slab(
          runQuad(run, s.balconyEndMarginM, len - s.balconyEndMarginM, 0, s.balconyDepthM),
          z - s.balconySlabM,
          z,
          'trim',
        ),
      );
    }
  }
  return out;
}

const SIDE_DIRECTION: Readonly<Record<'front' | 'back' | 'left' | 'right', Vec2>> = {
  front: [0, 1],
  back: [0, -1],
  left: [-1, 0],
  right: [1, 0],
};

/**
 * The ground-level wall facing `side` (outward normal within ~25° of it);
 * among those the outermost, then the longest, then the first.
 */
function entranceRun(runs: readonly WallRun[], side: keyof typeof SIDE_DIRECTION): WallRun | null {
  const d = SIDE_DIRECTION[side];
  let best: { run: WallRun; reach: number; len: number } | null = null;
  for (const run of runs) {
    if (!run.ground) continue;
    const len = runLength(run);
    if (len < 3) continue;
    const nx = (run.q[1] - run.p[1]) / len;
    const ny = -(run.q[0] - run.p[0]) / len;
    if (nx * d[0] + ny * d[1] < 0.9) continue;
    const reach = ((run.p[0] + run.q[0]) / 2) * d[0] + ((run.p[1] + run.q[1]) / 2) * d[1];
    if (!best || reach > best.reach + 1e-6 || (Math.abs(reach - best.reach) <= 1e-6 && len > best.len + 1e-6))
      best = { run, reach, len };
  }
  return best?.run ?? null;
}

/** Door slab (glass) and, when there is room, a small canopy (trim) centred on the wall. */
function entrance(run: WallRun, withCanopy: boolean): StudioFace[] {
  const s = DETAIL_SIZES;
  const len = runLength(run);
  const wallH = run.zt - run.zb;
  const w = Math.min(s.doorWidthM, 0.4 * len);
  const h = Math.min(s.doorHeightM, 0.8 * wallH);
  if (w < 0.5 || h < 1) return [];
  const mid = len / 2;
  const out = slab(runQuad(run, mid - w / 2, mid + w / 2, 0, s.doorDepthM), run.zb, run.zb + h, 'glass');
  const cz = run.zb + h + 0.3;
  if (withCanopy && cz + s.entranceCanopySlabM < run.zt) {
    const cw = Math.min(w + 1.5, len);
    out.push(
      ...slab(
        runQuad(run, mid - cw / 2, mid + cw / 2, 0, s.entranceCanopyDepthM),
        cz,
        cz + s.entranceCanopySlabM,
        'trim',
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

interface Built {
  faces: StudioFace[];
  runs: WallRun[];
  /** Flat top roof polygons that get a parapet at 'details', with their height. */
  parapets: { poly: LocalPolygon; z: number }[];
  /** Side already covered by a kiosk canopy (the entrance canopy is then omitted). */
  canopySide: keyof typeof SIDE_DIRECTION | null;
}

function windowsFor(c: ModelConfigV1, level: DetailLevel, floors: number): WallStyle {
  const f = c.facade;
  if (f.windowPattern === 'none' || !atLeast(level, 'facade')) return NO_WINDOWS;
  return {
    windows: {
      pattern: f.windowPattern,
      floorHeightM: c.floorHeightM,
      floors,
      bottomM: 0,
      density: f.windowDensity,
    },
  };
}

const boxRoofFor = (c: ModelConfigV1, level: DetailLevel): BoxRoof =>
  !atLeast(level, 'roof') || c.roof.shape === 'stepped' ? 'flat' : c.roof.shape;

function buildModel(c: ModelConfigV1, level: DetailLevel, local: LocalPolygon): Built {
  const z0 = c.baseOffsetM;
  const z1 = z0 + c.heightM;
  const pitch = c.roof.pitchDeg ?? 0;
  const flatTop = c.roof.shape === 'flat' || c.roof.shape === 'stepped';
  const out: Built = { faces: [], runs: [], parapets: [], canopySide: null };
  const s = c.shape;
  switch (s.kind) {
    case 'box':
    case 'hall': {
      const r = bodyRect(c);
      // A hall shows one high band of windows (clerestory); a box one row per floor.
      const style =
        s.kind === 'hall'
          ? (() => {
              const w = windowsFor(c, level, 1).windows;
              return w
                ? { windows: { ...w, floors: 1, floorHeightM: c.heightM * 0.3, bottomM: c.heightM * 0.55 } }
                : NO_WINDOWS;
            })()
          : windowsFor(c, level, c.floors);
      out.faces.push(...boxSolid(r, z0, z1, boxRoofFor(c, level), pitch, style));
      out.runs.push(...runsOf(rectRing(r), z0, z1, c.floors, true));
      out.parapets.push({ poly: [rectRing(r)], z: z1 });
      break;
    }
    case 'l-shape':
    case 'u-shape':
    case 'footprint-prism': {
      out.faces.push(...extrude(local, z0, z1, { style: windowsFor(c, level, c.floors) }));
      out.runs.push(...runsOf(local[0]!, z0, z1, c.floors, true));
      out.parapets.push({ poly: local, z: z1 });
      break;
    }
    case 'tower-podium': {
      const shape = { ...c, shape: s };
      const zp = z0 + podiumHeightM(shape);
      const podium = rectRing(bodyRect(c));
      const tower = rectRing(towerRect(shape));
      const towerFloors = c.floors - s.podiumFloors;
      out.faces.push(
        ...extrude([podium], z0, zp, {
          style: windowsFor(c, level, s.podiumFloors),
          topHoles: [[...tower].reverse()],
        }),
        ...extrude([tower], zp, z1, { style: windowsFor(c, level, towerFloors), open: true }),
      );
      out.runs.push(
        ...runsOf(podium, z0, zp, s.podiumFloors, true),
        ...runsOf(tower, zp, z1, towerFloors, false),
      );
      out.parapets.push({ poly: [tower], z: z1 });
      break;
    }
    case 'stepped': {
      const tiers = steppedTiers({ ...c, shape: s });
      tiers.forEach((t, i) => {
        const ring = rectRing(t.rect);
        const above = tiers[i + 1];
        out.faces.push(
          ...extrude([ring], z0 + t.z0, z0 + t.z1, {
            style: windowsFor(c, level, t.floors),
            topHoles: above ? [[...rectRing(above.rect)].reverse()] : [],
            open: i > 0,
          }),
        );
        out.runs.push(...runsOf(ring, z0 + t.z0, z0 + t.z1, t.floors, i === 0));
        if (!above) out.parapets.push({ poly: [ring], z: z0 + t.z1 });
      });
      break;
    }
    case 'kiosk-canopy': {
      const { body, canopy } = kioskParts({ ...c, shape: s });
      const slabTop = z1;
      const slabBottom = Math.max(z0, z1 - DETAIL_SIZES.kioskCanopySlabM);
      out.faces.push(...boxSolid(body, z0, z1, boxRoofFor(c, level), pitch, windowsFor(c, level, c.floors)));
      out.faces.push(
        ...extrude([rectRing(canopy)], slabBottom, slabTop, { top: 'roof', sides: 'trim', base: 'trim' }),
      );
      const canopyDir = SIDE_DIRECTION[s.canopySide];
      for (const run of runsOf(rectRing(body), z0, z1, c.floors, true)) {
        const len = runLength(run);
        const nx = (run.q[1] - run.p[1]) / len;
        const ny = -(run.q[0] - run.p[0]) / len;
        if (nx * canopyDir[0] + ny * canopyDir[1] < 0.9) out.runs.push(run);
      }
      out.canopySide = s.canopySide;
      if (atLeast(level, 'details') && slabBottom - z0 > 0.5) {
        // Two posts under the outer canopy corners.
        const p = DETAIL_SIZES.postM;
        const cx = (canopy.x0 + canopy.x1) / 2;
        const cy = (canopy.y0 + canopy.y1) / 2;
        const outer = rectRing(canopy).filter(
          ([x, y]) => (x - cx) * canopyDir[0] + (y - cy) * canopyDir[1] > 0,
        );
        for (const [x, y] of outer) {
          const px = x > cx ? x - p : x;
          const py = y > cy ? y - p : y;
          out.faces.push(
            ...slab(rectRing({ x0: px, y0: py, x1: px + p, y1: py + p }), z0, slabBottom, 'trim'),
          );
        }
      }
      break;
    }
  }
  if (atLeast(level, 'details')) {
    if (flatTop) for (const { poly, z } of out.parapets) out.faces.push(...parapet(poly, z));
    if (c.facade.balconies) out.faces.push(...balconies(out.runs, c.floorHeightM));
    if (c.facade.entranceSide !== 'none') {
      const run = entranceRun(out.runs, c.facade.entranceSide);
      if (run) out.faces.push(...entrance(run, out.canopySide !== c.facade.entranceSide));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Triangles a face needs (ear clipping with hole bridges): n + 2h − 2. */
export function faceTriangleCount(f: Pick<StudioFace, 'ring' | 'holes'>): number {
  const holes = f.holes ?? [];
  return f.ring.length + holes.reduce((n, h) => n + h.length, 0) + 2 * holes.length - 2;
}

export function meshTriangleCount(m: Pick<StudioMesh, 'faces'>): number {
  return m.faces.reduce((n, f) => n + faceTriangleCount(f), 0);
}

function mesh(origin: LngLat, faces: StudioFace[], footprint: LocalPolygon): StudioMesh {
  return { origin, faces, bbox: meshBBox(faces), footprint, closed: true };
}

const rotateFace = (f: StudioFace, deg: number): StudioFace => {
  const rot = (v: Vec3): Vec3 => {
    const [e, n] = rotateToEnu([v[0], v[1]], deg);
    return [e, n, v[2]];
  };
  return face(
    f.ring.map(rot),
    f.material,
    f.holes?.map((h) => h.map(rot)),
    f.windows,
  );
};

export type DetailedMeshResult =
  | {
      ok: true;
      mesh: StudioMesh;
      /** Level the config asks for. */
      requestedDetailLevel: DetailLevel;
      /** Level actually generated (lower when the budget was exceeded). */
      renderedDetailLevel: DetailLevel;
      triangles: number;
      budget: number;
    }
  | { ok: false; reason: MeshFailureReason; message: string };

/**
 * Generates the mesh of a supported model and reports the detail level that
 * fits TRIANGLE_BUDGET. Never throws for a schema-valid config.
 */
export function generateStudioMeshDetailed(
  config: ModelConfigV1,
  opts: GenerateOptions = {},
): DetailedMeshResult {
  const support = modelSupport(config);
  if (!support.ok) return { ok: false, reason: 'unsupported-model', message: support.message };
  let local: LocalPolygon;
  let rotate = true;
  if (config.generatorId === 'footprint-prism') {
    if (!opts.baseFootprint)
      return {
        ok: false,
        reason: 'missing-base-footprint',
        message: 'The base footprint of the target building is required.',
      };
    local = lngLatToLocalPolygon(opts.baseFootprint, createEnuFrame(config.anchor));
    if (local.length === 0 || local[0]!.length < 3)
      return { ok: false, reason: 'invalid-geometry', message: 'The base footprint is empty.' };
    rotate = false; // already east/north at the anchor
  } else {
    const shape = modelLocalFootprint(config);
    if (!shape.ok) return { ok: false, reason: 'invalid-geometry', message: shape.message };
    local = normalizeLocalPolygon(shape.polygon);
  }
  const footprint = rotate
    ? normalizeLocalPolygon(local.map((r) => r.map((p) => rotateToEnu(p, config.rotationDeg))))
    : local;
  const requested = config.detailLevel;
  const budget = TRIANGLE_BUDGET[requested];
  let rank = LEVEL_RANK[requested];
  for (;;) {
    const level = DETAIL_LEVELS[rank]!;
    const built = buildModel(config, level, local);
    const faces = rotate ? built.faces.map((f) => rotateFace(f, config.rotationDeg)) : built.faces;
    const m = mesh(config.anchor, faces, footprint);
    const triangles = meshTriangleCount(m);
    if (triangles <= budget || rank === 0)
      return {
        ok: true,
        mesh: m,
        requestedDetailLevel: requested,
        renderedDetailLevel: level,
        triangles,
        budget,
      };
    rank--;
  }
}

/** Generates the mesh of a supported model. Never throws for a schema-valid config. */
export function generateStudioMesh(config: ModelConfigV1, opts: GenerateOptions = {}): MeshResult {
  const r = generateStudioMeshDetailed(config, opts);
  return r.ok ? { ok: true, mesh: r.mesh } : r;
}

/**
 * S2 fallback for a published record whose model cannot be generated
 * (unknown modelConfigVersion / generator / version, or a generator failure):
 * its stored footprint × [baseOffsetM, baseOffsetM + heightM] as a plain
 * prism, no windows. The origin is the model anchor when present, else the
 * footprint's vertex mean.
 */
export function fallbackPrismMesh(b: { footprint: StudioFootprint; model: ModelEnvelope }): StudioMesh {
  const anchor = (b.model as { anchor?: unknown }).anchor;
  const origin: LngLat = isValidLngLat(anchor)
    ? [anchor[0], anchor[1]]
    : (outerVertexMean(b.footprint.coordinates) ?? b.footprint.coordinates[0]![0]!);
  const local = lngLatToLocalPolygon(b.footprint.coordinates, createEnuFrame(origin));
  const z0 = b.model.baseOffsetM;
  return mesh(origin, prismFaces(local, z0, z0 + b.model.heightM), local);
}

/** Signed volume of a closed mesh (divergence theorem); equals the body volume for a valid mesh. */
export function meshVolumeM3(m: Pick<StudioMesh, 'faces'>): number {
  let v = 0;
  for (const f of m.faces) {
    for (const ring of [f.ring, ...(f.holes ?? [])]) {
      // Σ over the fan of each ring: (a · (b × c)) / 6 relative to the ring's first vertex sums per face.
      const a = ring[0]!;
      for (let i = 1; i + 1 < ring.length; i++) {
        const b = ring[i]!;
        const c = ring[i + 1]!;
        v +=
          (a[0] * (b[1] * c[2] - b[2] * c[1]) -
            a[1] * (b[0] * c[2] - b[2] * c[0]) +
            a[2] * (b[0] * c[1] - b[1] * c[0])) /
          6;
      }
    }
  }
  return v;
}
