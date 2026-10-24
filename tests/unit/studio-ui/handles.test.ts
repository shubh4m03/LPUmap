import { describe, expect, it } from 'vitest';
import { createEnuFrame, deriveFootprint, localDistanceM } from '../../../src/building-studio/geometry.ts';
import {
  applyHandleDrag,
  compassAxis,
  editHandles,
  MIN_DRAG_SIZE_M,
  ROTATE_HANDLE_GAP_M,
} from '../../../src/building-studio/ui/handles.ts';
import type { LngLat } from '../../../src/data/schema.ts';
import { ANCHOR, model } from '../building-studio/fixtures.ts';

const at = (origin: LngLat, e: number, n: number): LngLat => createEnuFrame(origin).toLngLat([e, n]);
const local = (origin: LngLat, p: LngLat) => createEnuFrame(origin).toLocal(p);

describe('editHandles', () => {
  it('places move at the anchor, rotate ahead of the front edge and resize at side midpoints (metres)', () => {
    const m = model({ rotationDeg: 0, widthM: 20, lengthM: 40 });
    const hs = editHandles(m, 'all');
    expect(hs.map((h) => h.id)).toEqual([
      'move',
      'rotate',
      'resize:front',
      'resize:back',
      'resize:left',
      'resize:right',
    ]);
    const pos = Object.fromEntries(hs.map((h) => [h.id, local(ANCHOR, h.position)]));
    expect(pos.move![0]).toBeCloseTo(0, 6);
    expect(pos.rotate![1]).toBeCloseTo(20 + ROTATE_HANDLE_GAP_M, 3);
    expect(pos['resize:front']![1]).toBeCloseTo(20, 3);
    expect(pos['resize:right']![0]).toBeCloseTo(10, 3);
    expect(hs.every((h) => h.label.length > 10)).toBe(true);
  });

  it('rotates the handles with the model (clockwise from north) and picks the cursor axis', () => {
    const hs = editHandles(model({ rotationDeg: 90 }), 'resize');
    const front = hs.find((h) => h.id === 'resize:front')!;
    const p = local(ANCHOR, front.position);
    // Front (+y) turned 90° clockwise points east.
    expect(p[0]).toBeGreaterThan(19);
    expect(Math.abs(p[1])).toBeLessThan(0.01);
    expect(front.axis).toBe('e');
    expect(compassAxis([1, 1])).toBe('ne');
    expect(compassAxis([0, -1])).toBe('s');
  });

  it('gives the tool only its handles, and none for a mapped footprint or set "none"', () => {
    expect(editHandles(model(), 'move').map((h) => h.kind)).toEqual(['move']);
    expect(editHandles(model(), 'rotate').map((h) => h.kind)).toEqual(['rotate']);
    expect(editHandles(model(), 'none')).toEqual([]);
    const prism = model({ generatorId: 'footprint-prism', shape: { kind: 'footprint-prism' } });
    expect(editHandles(prism, 'all')).toEqual([]);
  });
});

describe('applyHandleDrag', () => {
  const base = model({ rotationDeg: 0, widthM: 20, lengthM: 40 });

  it('move: the anchor follows the drag in metres', () => {
    const start = at(ANCHOR, 3, 3);
    const out = applyHandleDrag(base, { handleId: 'move', kind: 'move', start, current: at(ANCHOR, 13, -2) });
    const d = local(ANCHOR, out.anchor);
    expect(d[0]).toBeCloseTo(10, 2);
    expect(d[1]).toBeCloseTo(-5, 2);
    expect(out.rotationDeg).toBe(0);
    expect(base.anchor).toEqual(ANCHOR); // input untouched
  });

  it('rotate: the angle swept about the anchor, clockwise positive', () => {
    const out = applyHandleDrag(base, {
      handleId: 'rotate',
      kind: 'rotate',
      start: at(ANCHOR, 0, 30),
      current: at(ANCHOR, 30, 0),
    });
    expect(out.rotationDeg).toBeCloseTo(90, 1);
    const back = applyHandleDrag(base, {
      handleId: 'rotate',
      kind: 'rotate',
      start: at(ANCHOR, 0, 30),
      current: at(ANCHOR, -30, 0),
    });
    expect(back.rotationDeg).toBeCloseTo(270, 1);
  });

  it('resize: the dragged side moves and the opposite side stays where it was', () => {
    const out = applyHandleDrag(base, {
      handleId: 'resize:right',
      kind: 'resize',
      start: at(ANCHOR, 10, 0),
      current: at(ANCHOR, 16, 7), // 6 m outwards; the sideways part is ignored
    });
    expect(out.widthM).toBeCloseTo(26, 1);
    expect(out.lengthM).toBe(40);
    const before = deriveFootprint(base);
    const after = deriveFootprint(out);
    if (!before.ok || !after.ok) throw new Error('footprint');
    const minX = (fp: typeof before) =>
      Math.min(...(fp.ok ? fp.footprint.coordinates[0]!.map((p) => local(ANCHOR, p)[0]) : []));
    expect(minX(after)).toBeCloseTo(minX(before), 2);
  });

  it('resize never goes below the drag minimum, and ignores unknown handles', () => {
    const out = applyHandleDrag(base, {
      handleId: 'resize:front',
      kind: 'resize',
      start: at(ANCHOR, 0, 20),
      current: at(ANCHOR, 0, -200),
    });
    expect(out.lengthM).toBe(MIN_DRAG_SIZE_M);
    expect(
      applyHandleDrag(base, {
        handleId: 'resize:up',
        kind: 'resize',
        start: ANCHOR,
        current: at(ANCHOR, 5, 5),
      }),
    ).toBe(base);
  });

  it('a mapped footprint model is never changed by a drag', () => {
    const prism = model({ generatorId: 'footprint-prism', shape: { kind: 'footprint-prism' } });
    expect(
      applyHandleDrag(prism, { handleId: 'move', kind: 'move', start: ANCHOR, current: at(ANCHOR, 50, 0) }),
    ).toBe(prism);
  });

  it('every move event recomputes from the drag start (no accumulation)', () => {
    let m = base;
    for (const e of [5, 10, 15])
      m = applyHandleDrag(base, { handleId: 'move', kind: 'move', start: ANCHOR, current: at(ANCHOR, e, 0) });
    expect(localDistanceM(ANCHOR, m.anchor)).toBeCloseTo(15, 2);
  });
});
