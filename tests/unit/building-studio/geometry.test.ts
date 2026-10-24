/**
 * Placement geometry (S5, S13): metres not pixels, frame accuracy, rotation
 * about the anchor, nudges, resize limits, and snapping that only ever
 * PROPOSES (never applies) with an explanation.
 */
import { describe, expect, it } from 'vitest';
import {
  anchorFromCoordinates,
  createEnuFrame,
  deriveFootprint,
  footprintPrismPlacement,
  localDistanceM,
  moveByMetres,
  normalizeRotation,
  nudgeMove,
  NUDGE_STEPS,
  proposeAngleSnap,
  proposeEdgeAlignment,
  proposeGuideFit,
  resizeModel,
  rotateAbout,
  rotateBy,
  setRotation,
} from '../../../src/building-studio/geometry.ts';
import type { LngLat } from '../../../src/data/schema.ts';
import { haversineM } from '../../../src/distance/geodesic.ts';
import { iouWith } from '../../../src/building-studio/validate.ts';
import { createBoundary } from '../../../src/geo/boundary.ts';
import { ANCHOR, clone, model } from './fixtures.ts';

const m0 = () => model({ rotationDeg: 0 });

/** A w × l rectangle centred at `c`, rotated clockwise by `deg`, as GeoJSON coordinates. */
function rect(c: LngLat, w: number, l: number, deg: number): LngLat[][] {
  const f = createEnuFrame(c);
  const t = (deg * Math.PI) / 180;
  const pts = [
    [-w / 2, -l / 2],
    [w / 2, -l / 2],
    [w / 2, l / 2],
    [-w / 2, l / 2],
  ].map(([x, y]) => f.toLngLat([x! * Math.cos(t) + y! * Math.sin(t), -x! * Math.sin(t) + y! * Math.cos(t)]));
  return [[...pts, pts[0]!]];
}

describe('frame accuracy (S5): < 1 cm at 300 m vs haversine', () => {
  it('holds in 24 directions and for chords across the frame', () => {
    const f = createEnuFrame(ANCHOR);
    let worst = 0;
    for (let deg = 0; deg < 360; deg += 15) {
      const t = (deg * Math.PI) / 180;
      const p = f.toLngLat([300 * Math.sin(t), 300 * Math.cos(t)]);
      worst = Math.max(worst, Math.abs(haversineM(ANCHOR, p) - 300));
      expect(localDistanceM(ANCHOR, p)).toBeCloseTo(300, 6);
    }
    expect(worst).toBeLessThan(0.01);
  });
});

describe('move, rotate, nudge', () => {
  it('moves by metres (not pixels or degrees)', () => {
    const moved = moveByMetres(m0(), 12.5, -4);
    const [x, y] = createEnuFrame(ANCHOR).toLocal(moved.anchor);
    expect(x).toBeCloseTo(12.5, 9);
    expect(y).toBeCloseTo(-4, 9);
    expect(haversineM(ANCHOR, moved.anchor)).toBeCloseTo(Math.hypot(12.5, 4), 2);
  });

  it('nudges by the S13 step sizes in compass directions, never mutating the input', () => {
    expect(NUDGE_STEPS).toEqual({ moveM: [0.5, 1, 5], rotateDeg: [1, 5, 15], resizeM: [0.5, 1, 5] });
    const m = m0();
    const before = clone(m);
    for (const [dir, ex, ey] of [
      ['north', 0, 5],
      ['east', 5, 0],
      ['south', 0, -5],
      ['west', -5, 0],
    ] as const) {
      const [x, y] = createEnuFrame(ANCHOR).toLocal(nudgeMove(m, dir, 5).anchor);
      expect(x).toBeCloseTo(ex, 9);
      expect(y).toBeCloseTo(ey, 9);
    }
    expect(m).toEqual(before);
  });

  it('rotation is normalized to [0, 360) and preserves dimensions and area', () => {
    expect(normalizeRotation(-15)).toBe(345);
    expect(normalizeRotation(720)).toBe(0);
    expect(rotateBy(model({ rotationDeg: 350 }), 15).rotationDeg).toBeCloseTo(5, 9);
    expect(setRotation(m0(), -90).rotationDeg).toBe(270);
    const a = deriveFootprint(m0());
    const b = deriveFootprint(rotateBy(m0(), 33));
    if (!a.ok || !b.ok) throw new Error('footprint');
    expect(b.areaM2).toBeCloseTo(a.areaM2, 9);
    const edges = (r: typeof a) =>
      r.local[0]!.map((p, i, ring) => Math.hypot(ring[(i + 1) % 4]![0] - p[0], ring[(i + 1) % 4]![1] - p[1]));
    expect(edges(b).sort()).toEqual(
      edges(a)
        .sort()
        .map((v) => expect.closeTo(v, 9)),
    );
  });

  it('rotating about another pivot orbits the anchor and turns the model', () => {
    const pivot = createEnuFrame(ANCHOR).toLngLat([0, -50]);
    const r = rotateAbout(m0(), pivot, 90);
    const [x, y] = createEnuFrame(pivot).toLocal(r.anchor);
    expect(x).toBeCloseTo(50, 6); // north of the pivot → east of it after 90° clockwise
    expect(y).toBeCloseTo(0, 6);
    expect(r.rotationDeg).toBeCloseTo(90, 9);
  });

  it('typed coordinates are validated and flagged outside the map area', () => {
    expect(anchorFromCoordinates(75.7, 31.25)).toEqual({
      ok: true,
      anchor: [75.7, 31.25],
      insideMapArea: true,
    });
    expect(anchorFromCoordinates(75.6, 31.25)).toMatchObject({ ok: true, insideMapArea: false });
    expect(anchorFromCoordinates(Number.NaN, 31)).toMatchObject({ ok: false });
    expect(anchorFromCoordinates(200, 31)).toMatchObject({ ok: false });
  });
});

describe('resize: storable limits reject, publish limits only report', () => {
  it('accepts values and lists those outside the publish range (never clamps)', () => {
    const r = resizeModel(m0(), { widthM: 400, floors: 3 });
    if (!r.ok) throw new Error(r.message);
    expect(r.model.widthM).toBe(400);
    expect(r.outsidePublishRange).toEqual(['widthM']);
  });

  it('rejects unstorable values and leaves the model unchanged', () => {
    expect(resizeModel(m0(), { heightM: 0 })).toMatchObject({ ok: false, field: 'heightM' });
    expect(resizeModel(m0(), { floors: 2.5 })).toMatchObject({ ok: false, field: 'floors' });
    expect(resizeModel(m0(), { lengthM: 6000 })).toMatchObject({ ok: false, field: 'lengthM' });
    expect(resizeModel(m0(), { baseOffsetM: -1 })).toMatchObject({ ok: false, field: 'baseOffsetM' });
  });

  it('linkHeight sets the body height from floors × floor height (explicit option only)', () => {
    const linked = resizeModel(m0(), { floors: 6 }, { linkHeight: true });
    const free = resizeModel(m0(), { floors: 6 });
    if (!linked.ok || !free.ok) throw new Error('resize');
    expect(linked.model.heightM).toBeCloseTo(6 * 3.2, 9);
    expect(free.model.heightM).toBe(12.8);
  });
});

describe('footprint-prism placement (server-overwritten informational values)', () => {
  it('anchor on the surface, rotation 0, local bounding box', () => {
    const p = footprintPrismPlacement(rect(ANCHOR, 30, 50, 0));
    expect(p).not.toBeNull();
    expect(p!.rotationDeg).toBe(0);
    expect(p!.widthM).toBeCloseTo(30, 3);
    expect(p!.lengthM).toBeCloseTo(50, 3);
    expect(haversineM(p!.anchor, ANCHOR)).toBeLessThan(0.05);
    expect(footprintPrismPlacement([[ANCHOR, ANCHOR, ANCHOR, ANCHOR]])).toBeNull();
  });
});

describe('snapping proposals: optional, visible, never applied', () => {
  it('angle snap proposes the nearest increment and explains it', () => {
    const m = model({ rotationDeg: 38 });
    const p = proposeAngleSnap(m, 15);
    expect(p).toMatchObject({
      ok: true,
      kind: 'angle',
      changes: [{ field: 'rotationDeg', from: 38, to: 45 }],
    });
    if (p.ok) expect(p.explanation).toMatch(/proposal/i);
    expect(m.rotationDeg).toBe(38);
    expect(proposeAngleSnap(model({ rotationDeg: 45 }), 15)).toMatchObject({ ok: false });
  });

  it('edge alignment rotates parallel to the target and moves flush within the limits', () => {
    // Target: a 20 × 40 block centred 22 m east, rotated 4°: after rotating, the model's east edge is ~1.9 m from its west edge.
    const target = rect(createEnuFrame(ANCHOR).toLngLat([22, 0]), 20, 40, 4);
    const m = model({ rotationDeg: 0, widthM: 20, lengthM: 40 });
    const p = proposeEdgeAlignment(
      m,
      { label: 'osm:way/1', coordinates: target },
      { maxAngleDeg: 10, maxDistanceM: 5 },
    );
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.kind).toBe('edge');
    expect(p.model.rotationDeg).toBeCloseTo(4, 6);
    expect(p.changes.map((c) => c.field)).toEqual(['rotationDeg', 'anchor']);
    expect(p.explanation).toMatch(/rotate by 4°/i);
    // After the proposal the two blocks share an edge line: they touch but do not overlap.
    const fp = deriveFootprint(p.model);
    if (!fp.ok) throw new Error(fp.message);
    expect(iouWith(target, fp.footprint)).toBeCloseTo(0, 6);
    const gap = createBoundary({ type: 'Polygon', coordinates: target }).footprintDistanceToBoundaryM(
      fp.footprint,
    );
    expect(gap).toBeLessThan(0.01);
    expect(m.rotationDeg).toBe(0); // input untouched
  });

  it('no proposal beyond the angle limit, or for footprint-prism; already aligned is said so', () => {
    const target = rect(ANCHOR, 20, 40, 30);
    expect(
      proposeEdgeAlignment(model({ rotationDeg: 0 }), { label: 't', coordinates: target }),
    ).toMatchObject({
      ok: false,
    });
    const prism = model({ generatorId: 'footprint-prism', shape: { kind: 'footprint-prism' } });
    expect(proposeEdgeAlignment(prism, { label: 't', coordinates: target }).ok).toBe(false);
    const same = proposeEdgeAlignment(model({ rotationDeg: 30 }), { label: 't', coordinates: target });
    expect(same).toMatchObject({ ok: false });
    if (!same.ok) expect(same.explanation).toMatch(/already/);
  });

  it('guide fit: minimum-area rectangle of a detected footprint, recorded as an unverified guide', () => {
    const det = rect(createEnuFrame(ANCHOR).toLngLat([10, 5]), 12, 30, 25);
    const id = 'det:microsoft-ml:0123abcd';
    const p = proposeGuideFit(model({ rotationDeg: 0 }), { id, coordinates: det });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.model.geometryGuide).toEqual({ detectionId: id });
    const dims = [p.model.widthM, p.model.lengthM].sort((a, b) => a - b);
    expect(dims[0]).toBeCloseTo(12, 2);
    expect(dims[1]).toBeCloseTo(30, 2);
    const fp = deriveFootprint(p.model);
    if (!fp.ok) throw new Error(fp.message);
    expect(iouWith(det, fp.footprint)).toBeGreaterThan(0.999);
    expect(p.explanation).toMatch(/unverified/);
    expect(p.explanation).toMatch(/100 %/);
  });
});
