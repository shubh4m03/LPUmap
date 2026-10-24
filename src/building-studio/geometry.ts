/**
 * Placement geometry for the Building Studio (S5, S13): move, rotate and
 * resize in METRES (never screen pixels), the mobile step sizes, typed
 * coordinates, and OPTIONAL snapping helpers. Pure and deterministic; every
 * function returns a new model and never mutates its input.
 *
 * Snapping never applies itself (S6: nothing is auto-moved, auto-rotated or
 * auto-resized). Each helper returns a PROPOSAL — the proposed model, the
 * list of changed fields and a plain-language explanation — or the reason no
 * proposal exists. The editor shows it; the owner applies it as one undoable
 * command or ignores it.
 *
 * The local frame, its error bound and the footprint derivation live in
 * footprint.ts and are re-exported here so callers have one import.
 */
import { APP_CONFIG } from '../config/index.ts';
import type { LngLat } from '../data/schema.ts';
import { isValidLngLat } from '../distance/geodesic.ts';
import { pointOnSurface } from '../geo/boundary.ts';
import {
  createEnuFrame,
  deriveFootprint,
  lngLatToLocalPolygon,
  ringAreaM2,
  rotateToEnu,
  type EnuFrame,
} from './footprint.ts';
import type { Vec2 } from './mesh/types.ts';
import { STUDIO_LIMITS, type GeometryGuide, type ModelConfigV1 } from './schema.ts';

export {
  createEnuFrame,
  deriveFootprint,
  localPolygonAreaM2,
  localToLngLatPolygon,
  lngLatToLocalPolygon,
  normalizeLocalPolygon,
  ringAreaM2,
  rotateToEnu,
  type EnuFrame,
  type FootprintResult,
} from './footprint.ts';

/** Step sizes of the large touch buttons (S13). */
export const NUDGE_STEPS = {
  moveM: [0.5, 1, 5],
  rotateDeg: [1, 5, 15],
  resizeM: [0.5, 1, 5],
} as const;

export type Compass = 'north' | 'east' | 'south' | 'west';
const COMPASS: Readonly<Record<Compass, Vec2>> = {
  north: [0, 1],
  east: [1, 0],
  south: [0, -1],
  west: [-1, 0],
};

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Angle in [0, 360). */
export function normalizeRotation(deg: number): number {
  const r = ((deg % 360) + 360) % 360;
  return r >= 360 - 1e-9 ? 0 : r;
}

/** Moves the anchor `east`/`north` metres in the local frame (the shape and rotation are unchanged). */
export function moveByMetres(model: ModelConfigV1, east: number, north: number): ModelConfigV1 {
  return { ...model, anchor: createEnuFrame(model.anchor).toLngLat([east, north]) };
}

/** One step of a compass move button. */
export function nudgeMove(model: ModelConfigV1, direction: Compass, stepM: number): ModelConfigV1 {
  const [e, n] = COMPASS[direction];
  return moveByMetres(model, e * stepM, n * stepM);
}

/** Rotates about the anchor (the footprint centre) by `deltaDeg`, clockwise positive. */
export function rotateBy(model: ModelConfigV1, deltaDeg: number): ModelConfigV1 {
  return { ...model, rotationDeg: normalizeRotation(model.rotationDeg + deltaDeg) };
}

/** Sets the rotation (clockwise from north). */
export function setRotation(model: ModelConfigV1, deg: number): ModelConfigV1 {
  return { ...model, rotationDeg: normalizeRotation(deg) };
}

/** Rotates the whole model about another point (the anchor orbits `pivot`), clockwise positive. */
export function rotateAbout(model: ModelConfigV1, pivot: LngLat, deltaDeg: number): ModelConfigV1 {
  const frame = createEnuFrame(pivot);
  const p = rotateToEnu(frame.toLocal(model.anchor), deltaDeg);
  return {
    ...model,
    anchor: frame.toLngLat(p),
    rotationDeg: normalizeRotation(model.rotationDeg + deltaDeg),
  };
}

/** Distance in metres between two lon/lat points in the local frame of the first. */
export function localDistanceM(a: LngLat, b: LngLat): number {
  const [x, y] = createEnuFrame(a).toLocal(b);
  return Math.hypot(x, y);
}

export type CoordinateResult =
  { ok: true; anchor: LngLat; insideMapArea: boolean } | { ok: false; message: string };

/** Parses typed coordinates (decimal degrees). Outside the map area is allowed here and reported. */
export function anchorFromCoordinates(lon: number, lat: number): CoordinateResult {
  const p: LngLat = [lon, lat];
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !isValidLngLat(p))
    return {
      ok: false,
      message: 'Enter a longitude between −180 and 180 and a latitude between −90 and 90.',
    };
  const [w, s, e, n] = APP_CONFIG.map.maxBounds;
  return { ok: true, anchor: p, insideMapArea: lon >= w && lon <= e && lat >= s && lat <= n };
}

export type DimensionField = 'widthM' | 'lengthM' | 'heightM' | 'floors' | 'floorHeightM' | 'baseOffsetM';

export type ResizeResult =
  | {
      ok: true;
      model: ModelConfigV1;
      /** Fields now outside the PUBLISH range (validation reports them; nothing is clamped). */
      outsidePublishRange: DimensionField[];
    }
  | { ok: false; field: DimensionField; message: string };

/**
 * Sets dimensions. Values must be storable (positive, ≤ the storable
 * envelope; floors an integer); otherwise nothing changes and the reason is
 * returned. Values outside the publish range are accepted and listed, never
 * clamped. With `linkHeight`, changing floors or floor height sets the body
 * height to floors × floor height (an explicit editor option).
 */
export function resizeModel(
  model: ModelConfigV1,
  change: Partial<Record<DimensionField, number>>,
  opts: { linkHeight?: boolean } = {},
): ResizeResult {
  const next: ModelConfigV1 = { ...model };
  for (const [field, value] of Object.entries(change) as [DimensionField, number][]) {
    const storable =
      field === 'floors'
        ? Number.isInteger(value) && value >= 1 && value <= STUDIO_LIMITS.storable.maxFloors
        : field === 'baseOffsetM'
          ? Number.isFinite(value) && value >= 0 && value <= STUDIO_LIMITS.storable.maxMetres
          : Number.isFinite(value) && value > 0 && value <= STUDIO_LIMITS.storable.maxMetres;
    if (!storable)
      return {
        ok: false,
        field,
        message:
          field === 'floors'
            ? `Floors must be a whole number from 1 to ${STUDIO_LIMITS.storable.maxFloors}.`
            : `${field} must be a number ${field === 'baseOffsetM' ? '≥ 0' : '> 0'} and at most ${STUDIO_LIMITS.storable.maxMetres} m.`,
      };
    next[field] = value;
  }
  if (opts.linkHeight && (change.floors !== undefined || change.floorHeightM !== undefined))
    next.heightM = round(next.floors * next.floorHeightM, 3);
  const dims = STUDIO_LIMITS.dims;
  const outsidePublishRange = (Object.keys(dims) as (keyof typeof dims)[])
    .filter((k): k is DimensionField => k !== 'pitchDeg')
    .filter((k) => next[k] < dims[k].min || next[k] > dims[k].max);
  return { ok: true, model: next, outsidePublishRange };
}

/**
 * Placement values the server stores for a 'footprint-prism' model: the
 * anchor is the base footprint's point-on-surface, rotation 0, and width /
 * length the footprint's local bounding box (informational). Null for an
 * invalid footprint.
 */
export function footprintPrismPlacement(
  base: readonly (readonly LngLat[])[],
): { anchor: LngLat; rotationDeg: 0; widthM: number; lengthM: number } | null {
  const anchor = pointOnSurface({ type: 'Polygon', coordinates: base });
  if (!anchor) return null;
  const local = lngLatToLocalPolygon(base, createEnuFrame(anchor));
  const xs = local[0]!.map((p) => p[0]);
  const ys = local[0]!.map((p) => p[1]);
  return {
    anchor,
    rotationDeg: 0,
    widthM: Math.max(...xs) - Math.min(...xs),
    lengthM: Math.max(...ys) - Math.min(...ys),
  };
}

// ---------------------------------------------------------------------------
// Snapping proposals (never applied by these functions)
// ---------------------------------------------------------------------------

export interface FieldChange {
  field: string;
  from: number | string | null;
  to: number | string | null;
}

export type SnapProposal =
  | {
      ok: true;
      kind: 'angle' | 'edge' | 'guide';
      model: ModelConfigV1;
      changes: FieldChange[];
      explanation: string;
    }
  | { ok: false; explanation: string };

const PROPOSAL_NOTE =
  'This is a proposal: nothing changes until you apply it, and applying it can be undone.';

/** Rotation rounded to the nearest multiple of `incrementDeg` (e.g. 15° or 90°). */
export function proposeAngleSnap(model: ModelConfigV1, incrementDeg: number): SnapProposal {
  if (!(incrementDeg > 0 && incrementDeg <= 180))
    return { ok: false, explanation: 'The angle increment must be between 0 and 180°.' };
  const to = normalizeRotation(Math.round(model.rotationDeg / incrementDeg) * incrementDeg);
  if (Math.abs(to - model.rotationDeg) < 1e-9)
    return { ok: false, explanation: `The rotation is already a multiple of ${incrementDeg}°.` };
  return {
    ok: true,
    kind: 'angle',
    model: { ...model, rotationDeg: to },
    changes: [{ field: 'rotationDeg', from: model.rotationDeg, to }],
    explanation: `Rotate from ${round(model.rotationDeg)}° to ${round(to)}° (nearest multiple of ${incrementDeg}°). ${PROPOSAL_NOTE}`,
  };
}

/** Smallest signed difference a − b modulo `period`, in (−period/2, period/2]. */
function angleDiff(a: number, b: number, period: number): number {
  let d = (((a - b) % period) + period) % period;
  if (d > period / 2) d -= period;
  return d;
}

/** Direction angle of p→q in degrees, counter-clockwise from east. */
const edgeAngle = (p: Vec2, q: Vec2) => (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;

function pointSegDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Edge alignment to another footprint (a base building or an unverified
 * detected footprint used as a guide): rotate by at most `maxAngleDeg` so the
 * model's edges are parallel to the nearest suitable edge of `target`, then
 * move by at most `maxDistanceM` along that edge's normal so the closest
 * parallel model edge lies on the same line.
 */
export function proposeEdgeAlignment(
  model: ModelConfigV1,
  target: { label: string; coordinates: readonly (readonly LngLat[])[] },
  opts: { maxAngleDeg?: number; maxDistanceM?: number } = {},
): SnapProposal {
  const maxAngle = opts.maxAngleDeg ?? 10;
  const maxDist = opts.maxDistanceM ?? 5;
  if (model.generatorId === 'footprint-prism')
    return { ok: false, explanation: 'An existing footprint is never moved by snapping.' };
  const frame = createEnuFrame(model.anchor);
  const tgt = lngLatToLocalPolygon(target.coordinates, frame);
  const modelAngle = -model.rotationDeg; // model-local +x, counter-clockwise from east
  let best: { a: Vec2; b: Vec2; delta: number; dist: number; len: number; index: number } | null = null;
  tgt.forEach((ring) =>
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1) return;
      const delta = angleDiff(edgeAngle(a, b), modelAngle, 90);
      if (Math.abs(delta) > maxAngle + 1e-9) return;
      const dist = pointSegDist([0, 0], a, b);
      if (!best || dist < best.dist - 1e-9 || (Math.abs(dist - best.dist) <= 1e-9 && len > best.len))
        best = { a, b, delta, dist, len, index: i };
    }),
  );
  const chosen = best as { a: Vec2; b: Vec2; delta: number; dist: number; len: number; index: number } | null;
  if (!chosen)
    return {
      ok: false,
      explanation: `No edge of ${target.label} is within ${maxAngle}° of the model's orientation; nothing to align to.`,
    };
  const delta = Math.abs(chosen.delta) > 1e-6 ? chosen.delta : 0; // sub-micro-degree = already parallel
  const rotated =
    delta === 0 ? model : { ...model, rotationDeg: normalizeRotation(model.rotationDeg - delta) };
  const fp = deriveFootprint(rotated);
  if (!fp.ok) return { ok: false, explanation: `The model has no valid footprint: ${fp.message}` };
  // Unit normal of the target edge; signed offsets of parallel model edges from its line.
  const len = chosen.len;
  const nx = -(chosen.b[1] - chosen.a[1]) / len;
  const ny = (chosen.b[0] - chosen.a[0]) / len;
  const targetAngle = edgeAngle(chosen.a, chosen.b);
  let shift: number | null = null;
  for (const ring of fp.local)
    ring.forEach((p, i) => {
      const q = ring[(i + 1) % ring.length]!;
      if (Math.abs(angleDiff(edgeAngle(p, q), targetAngle, 180)) > 1e-6) return;
      const mid: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const off = (mid[0] - chosen.a[0]) * nx + (mid[1] - chosen.a[1]) * ny;
      if (Math.abs(off) <= maxDist + 1e-9 && (shift === null || Math.abs(off) < Math.abs(shift))) shift = off;
    });
  const found = shift as number | null; // assigned in the callback above
  const move = found !== null && Math.abs(found) > 1e-6 ? found : 0; // sub-micrometre = already flush
  const proposed = move !== 0 ? moveByMetres(rotated, -move * nx, -move * ny) : rotated;
  const changes: FieldChange[] = [];
  if (delta !== 0) changes.push({ field: 'rotationDeg', from: model.rotationDeg, to: proposed.rotationDeg });
  if (move !== 0)
    changes.push({ field: 'anchor', from: model.anchor.join(', '), to: proposed.anchor.join(', ') });
  if (changes.length === 0)
    return {
      ok: false,
      explanation:
        found === null
          ? `The model is already parallel to edge ${chosen.index + 1} of ${target.label}, and no parallel edge is within ${maxDist} m of it; nothing to propose.`
          : `The model is already aligned with edge ${chosen.index + 1} of ${target.label}.`,
    };
  const parts = [
    delta !== 0
      ? `rotate by ${round(-delta)}° to run parallel to edge ${chosen.index + 1} of ${target.label}`
      : null,
    move !== 0
      ? `move ${round(Math.abs(move))} m so the nearest parallel edge lies on that edge's line`
      : null,
    found === null ? `no parallel edge is within ${maxDist} m, so the position is unchanged` : null,
  ].filter((p): p is string => p !== null);
  const text = parts.join('; ');
  return {
    ok: true,
    kind: 'edge',
    model: proposed,
    changes,
    explanation: `${text.charAt(0).toUpperCase()}${text.slice(1)}. ${PROPOSAL_NOTE}`,
  };
}

/** Convex hull (monotone chain), counter-clockwise, no collinear points. */
function convexHull(points: readonly Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * Fits the model's width, length, rotation and anchor to the minimum-area
 * rectangle around an UNVERIFIED detected footprint (S6 legal placement
 * guide) and records `geometryGuide: { detectionId }`. The building stays
 * 'unverified' until the owner confirms it; the explanation says so and
 * reports how much of the rectangle the detection fills.
 */
export function proposeGuideFit(
  model: ModelConfigV1,
  detection: { id: GeometryGuide['detectionId']; coordinates: readonly (readonly LngLat[])[] },
): SnapProposal {
  if (model.generatorId === 'footprint-prism')
    return { ok: false, explanation: 'An existing footprint is never replaced by a detected footprint.' };
  const outer = detection.coordinates[0];
  if (!outer || outer.length < 4) return { ok: false, explanation: 'The detected footprint has no outline.' };
  const origin = outer[0]!;
  const frame: EnuFrame = createEnuFrame(origin);
  const local = lngLatToLocalPolygon(detection.coordinates, frame);
  const hull = convexHull(local[0]!);
  if (hull.length < 3) return { ok: false, explanation: 'The detected footprint has no area.' };
  let best: { area: number; angle: number; u0: number; u1: number; v0: number; v1: number } | null = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const p of hull) {
      const u = p[0] * c + p[1] * s;
      const v = -p[0] * s + p[1] * c;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area - 1e-9) best = { area, angle, u0, u1, v0, v1 };
  }
  const r = best!;
  const uc = (r.u0 + r.u1) / 2;
  const vc = (r.v0 + r.v1) / 2;
  const c = Math.cos(r.angle);
  const s = Math.sin(r.angle);
  const centre = frame.toLngLat([uc * c - vc * s, uc * s + vc * c]);
  const widthM = round(r.u1 - r.u0, 3);
  const lengthM = round(r.v1 - r.v0, 3);
  // Model-local +x runs along the rectangle's u axis: math angle α ⇒ rotationDeg = −α.
  const rotationDeg = normalizeRotation(round((-r.angle * 180) / Math.PI, 6));
  const fill =
    Math.abs(ringAreaM2(local[0]!)) - local.slice(1).reduce((n, h) => n + Math.abs(ringAreaM2(h)), 0);
  const proposed: ModelConfigV1 = {
    ...model,
    anchor: centre,
    rotationDeg,
    widthM,
    lengthM,
    geometryGuide: { detectionId: detection.id },
  };
  return {
    ok: true,
    kind: 'guide',
    model: proposed,
    changes: [
      { field: 'anchor', from: model.anchor.join(', '), to: centre.join(', ') },
      { field: 'rotationDeg', from: model.rotationDeg, to: rotationDeg },
      { field: 'widthM', from: model.widthM, to: widthM },
      { field: 'lengthM', from: model.lengthM, to: lengthM },
      { field: 'geometryGuide', from: model.geometryGuide?.detectionId ?? null, to: detection.id },
    ],
    explanation:
      `Fit a ${widthM} × ${lengthM} m rectangle to unverified detected footprint ${detection.id} ` +
      `(the detection fills ${round((100 * fill) / r.area, 1)} % of it). The detection is machine-generated, ` +
      `not verified: the building stays unverified until you confirm it. ${PROPOSAL_NOTE}`,
  };
}
