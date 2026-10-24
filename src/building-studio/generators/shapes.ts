/**
 * Generator shapes in the MODEL-LOCAL frame (x right, y forward; metres,
 * centred on the anchor, before rotation). The single source of truth for
 * every generator's ground footprint and sub-volumes, shared by
 * deriveFootprint (footprint.ts) and the mesh generators (mesh/generate.ts)
 * so the published footprint and the drawn model can never disagree.
 *
 * Shape parameters (docs/BUILDING_STUDIO_DESIGN.md §3.1):
 *  - 'l-shape': a notch of (notchWidthFrac × width) × (notchLengthFrac ×
 *    length) is cut from `notchCorner`.
 *  - 'u-shape': the courtyard opens on `openSide`. Its WIDTH runs along the
 *    open side (a fraction of that side's length) and its DEPTH runs into the
 *    building (a fraction of the perpendicular dimension). 'none' = a closed
 *    courtyard centred in the block: width along x (× width), depth along y
 *    (× length); the footprint then has one hole.
 *  - 'tower-podium': the podium is the full rectangle with `podiumFloors`; the
 *    tower (towerWidthFrac × width) × (towerLengthFrac × length) is centred
 *    on it. The podium height is heightM × podiumFloors / floors.
 *  - 'kiosk-canopy': the footprint is the whole roofed extent; the canopy
 *    covers canopyDepthFrac of the dimension perpendicular to `canopySide`.
 *  - 'stepped': `tiers` rectangles, each inset by `setbackM` on every side
 *    from the one below; floors are split as evenly as possible (lower tiers
 *    take the remainder) and tier heights follow the floor shares.
 *
 * Nothing here clamps or repairs a value: impossible parameters (a podium
 * with as many floors as the building, setbacks wider than the footprint)
 * are reported with a reason, which the validator turns into
 * 'geometry-invalid'.
 */
import type { LocalPolygon, Vec2 } from '../mesh/types.ts';
import type { ModelDefaults, ShapeParams } from '../schema.ts';

/** Smallest side of a stepped building's top tier, metres. */
export const MIN_TIER_SIDE_M = 2;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Fields of a model that decide its ground shape. */
export type ShapeInput = Pick<ModelDefaults, 'generatorId' | 'widthM' | 'lengthM' | 'heightM' | 'floors'> & {
  shape: ShapeParams;
};

export type ShapeResult = { ok: true; polygon: LocalPolygon } | { ok: false; message: string };

/** Counter-clockwise rectangle ring. */
export function rectRing(r: Rect): Vec2[] {
  return [
    [r.x0, r.y0],
    [r.x1, r.y0],
    [r.x1, r.y1],
    [r.x0, r.y1],
  ];
}

const signedArea = (ring: readonly Vec2[]) => {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    s += (ring[j]![0] - ring[i]![0]) * (ring[j]![1] + ring[i]![1]);
  return s / 2;
};

/** Reflects a ring (x and/or y) and restores counter-clockwise order. */
function mirror(ring: readonly Vec2[], fx: boolean, fy: boolean): Vec2[] {
  const out = ring.map(([x, y]) => [fx ? -x : x, fy ? -y : y] as const);
  return signedArea(out) < 0 ? out.reverse() : out;
}

export const bodyRect = (m: Pick<ShapeInput, 'widthM' | 'lengthM'>): Rect => ({
  x0: -m.widthM / 2,
  y0: -m.lengthM / 2,
  x1: m.widthM / 2,
  y1: m.lengthM / 2,
});

function lShape(m: ShapeInput, s: Extract<ShapeParams, { kind: 'l-shape' }>): Vec2[] {
  const a = m.widthM / 2;
  const b = m.lengthM / 2;
  const nw = s.notchWidthFrac * m.widthM;
  const nl = s.notchLengthFrac * m.lengthM;
  // Canonical notch at the front-right corner (+x, +y).
  const ring: Vec2[] = [
    [-a, -b],
    [a, -b],
    [a, b - nl],
    [a - nw, b - nl],
    [a - nw, b],
    [-a, b],
  ];
  const [fy, fx] = s.notchCorner.split('-') as ['front' | 'back', 'left' | 'right'];
  return mirror(ring, fx === 'left', fy === 'back');
}

function uShape(m: ShapeInput, s: Extract<ShapeParams, { kind: 'u-shape' }>): LocalPolygon {
  const a = m.widthM / 2;
  const b = m.lengthM / 2;
  if (s.openSide === 'none') {
    const cw = (s.courtyardWidthFrac * m.widthM) / 2;
    const cd = (s.courtyardDepthFrac * m.lengthM) / 2;
    return [
      rectRing({ x0: -a, y0: -b, x1: a, y1: b }),
      rectRing({ x0: -cw, y0: -cd, x1: cw, y1: cd }).reverse(),
    ];
  }
  if (s.openSide === 'front' || s.openSide === 'back') {
    const cw = (s.courtyardWidthFrac * m.widthM) / 2;
    const cd = s.courtyardDepthFrac * m.lengthM;
    const ring: Vec2[] = [
      [-a, -b],
      [a, -b],
      [a, b],
      [cw, b],
      [cw, b - cd],
      [-cw, b - cd],
      [-cw, b],
      [-a, b],
    ];
    return [mirror(ring, false, s.openSide === 'back')];
  }
  const cw = (s.courtyardWidthFrac * m.lengthM) / 2;
  const cd = s.courtyardDepthFrac * m.widthM;
  const ring: Vec2[] = [
    [-a, -b],
    [a, -b],
    [a, -cw],
    [a - cd, -cw],
    [a - cd, cw],
    [a, cw],
    [a, b],
    [-a, b],
  ];
  return [mirror(ring, s.openSide === 'left', false)];
}

/** Why the parameters cannot form the shape, or null. */
export function shapeProblem(m: ShapeInput): string | null {
  const s = m.shape;
  if (s.kind !== m.generatorId) return `shape.kind '${s.kind}' does not match generator '${m.generatorId}'`;
  if (!(m.widthM > 0) || !(m.lengthM > 0) || !(m.heightM > 0))
    return 'width, length and height must be positive';
  if (s.kind === 'tower-podium' && s.podiumFloors >= m.floors)
    return `the podium has ${s.podiumFloors} floors but the building has only ${m.floors}; the tower needs at least one floor`;
  if (s.kind === 'stepped') {
    const inset = 2 * s.setbackM * (s.tiers - 1);
    const top = Math.min(m.widthM, m.lengthM) - inset;
    if (top < MIN_TIER_SIDE_M)
      return `${s.tiers} tiers with ${s.setbackM} m setbacks leave a top tier of ${Math.round(top * 100) / 100} m; at least ${MIN_TIER_SIDE_M} m is needed`;
    if (m.floors < s.tiers)
      return `${s.tiers} tiers need at least ${s.tiers} floors (one per tier); the model has ${m.floors}`;
  }
  return null;
}

/**
 * Ground footprint in the model-local frame: outer ring counter-clockwise,
 * holes clockwise, rings open. 'footprint-prism' has no generated shape (its
 * footprint is the base footprint) and is reported as not derivable here.
 */
export function modelLocalFootprint(m: ShapeInput): ShapeResult {
  const problem = shapeProblem(m);
  if (problem) return { ok: false, message: problem };
  const s = m.shape;
  switch (s.kind) {
    case 'box':
    case 'hall':
    case 'kiosk-canopy':
    case 'tower-podium':
    case 'stepped':
      return { ok: true, polygon: [rectRing(bodyRect(m))] };
    case 'l-shape':
      return { ok: true, polygon: [lShape(m, s)] };
    case 'u-shape':
      return { ok: true, polygon: uShape(m, s) };
    case 'footprint-prism':
      return { ok: false, message: "'footprint-prism' uses the base building's footprint" };
  }
}

/** Tower rectangle of a 'tower-podium' model (centred). */
export function towerRect(m: ShapeInput & { shape: Extract<ShapeParams, { kind: 'tower-podium' }> }): Rect {
  const tw = (m.shape.towerWidthFrac * m.widthM) / 2;
  const tl = (m.shape.towerLengthFrac * m.lengthM) / 2;
  return { x0: -tw, y0: -tl, x1: tw, y1: tl };
}

/** Podium height share of a 'tower-podium' model (body height × podiumFloors / floors). */
export const podiumHeightM = (m: ShapeInput & { shape: Extract<ShapeParams, { kind: 'tower-podium' }> }) =>
  (m.heightM * m.shape.podiumFloors) / m.floors;

export interface Tier {
  rect: Rect;
  floors: number;
  /** Bottom and top of the tier above the body base, metres. */
  z0: number;
  z1: number;
}

/** Tiers of a 'stepped' model, bottom first. */
export function steppedTiers(m: ShapeInput & { shape: Extract<ShapeParams, { kind: 'stepped' }> }): Tier[] {
  const { tiers, setbackM } = m.shape;
  const base = Math.floor(m.floors / tiers);
  const extra = m.floors % tiers;
  const out: Tier[] = [];
  let floorsBelow = 0;
  for (let i = 0; i < tiers; i++) {
    const floors = base + (i < extra ? 1 : 0);
    const inset = i * setbackM;
    const z0 = (m.heightM * floorsBelow) / m.floors;
    floorsBelow += floors;
    const z1 = i === tiers - 1 ? m.heightM : (m.heightM * floorsBelow) / m.floors;
    out.push({
      rect: {
        x0: -m.widthM / 2 + inset,
        y0: -m.lengthM / 2 + inset,
        x1: m.widthM / 2 - inset,
        y1: m.lengthM / 2 - inset,
      },
      floors,
      z0,
      z1,
    });
  }
  return out;
}

/** Body and canopy rectangles of a 'kiosk-canopy' model (together they are the footprint). */
export function kioskParts(m: ShapeInput & { shape: Extract<ShapeParams, { kind: 'kiosk-canopy' }> }): {
  body: Rect;
  canopy: Rect;
} {
  const r = bodyRect(m);
  const { canopyDepthFrac: f, canopySide } = m.shape;
  switch (canopySide) {
    case 'front': {
      const y = r.y1 - f * m.lengthM;
      return { body: { ...r, y1: y }, canopy: { ...r, y0: y } };
    }
    case 'back': {
      const y = r.y0 + f * m.lengthM;
      return { body: { ...r, y0: y }, canopy: { ...r, y1: y } };
    }
    case 'right': {
      const x = r.x1 - f * m.widthM;
      return { body: { ...r, x1: x }, canopy: { ...r, x0: x } };
    }
    case 'left': {
      const x = r.x0 + f * m.widthM;
      return { body: { ...r, x0: x }, canopy: { ...r, x1: x } };
    }
  }
}
