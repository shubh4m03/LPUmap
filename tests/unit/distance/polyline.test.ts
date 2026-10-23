import { describe, expect, it } from 'vitest';
import type { LngLat } from '../../../src/data/schema.ts';
import {
  cumulativeLengthsM,
  destinationPoint,
  haversineM,
  pointAtDistance,
  polylineLengthM,
  projectOntoPolyline,
  projectOntoPolylineRange,
  slicePolyline,
} from '../../../src/distance/index.ts';

const O: LngLat = [75.7032, 31.2533];
// Synthetic L: 200 m north, then 100 m east.
const A = O;
const B = destinationPoint(A, 0, 200);
const C = destinationPoint(B, 90, 100);
const L: LngLat[] = [A, B, C];

describe('polylineLengthM / cumulativeLengthsM', () => {
  it('sums haversine segment lengths', () => {
    expect(polylineLengthM(L)).toBeCloseTo(300, 6);
    const cum = cumulativeLengthsM(L);
    expect(cum).toHaveLength(3);
    expect(cum[0]).toBe(0);
    expect(cum[1]).toBeCloseTo(200, 6);
    expect(cum[2]).toBeCloseTo(300, 6);
  });

  it('handles empty, single-point and repeated-vertex lines', () => {
    expect(polylineLengthM([])).toBe(0);
    expect(cumulativeLengthsM([])).toEqual([]);
    expect(polylineLengthM([A])).toBe(0);
    expect(cumulativeLengthsM([A, A, B])[1]).toBe(0);
  });
});

describe('projectOntoPolyline', () => {
  it('projects a point beside the first leg perpendicularly', () => {
    const beside = destinationPoint(destinationPoint(A, 0, 50), 270, 12);
    const r = projectOntoPolyline(beside, L)!;
    expect(r.segmentIndex).toBe(0);
    expect(r.t).toBeCloseTo(0.25, 3);
    expect(r.distanceFromLineM).toBeCloseTo(12, 1);
    expect(r.distanceAlongM).toBeCloseTo(50, 1);
  });

  it('projects onto the second leg after the corner', () => {
    const p = destinationPoint(destinationPoint(B, 90, 40), 0, 8);
    const r = projectOntoPolyline(p, L)!;
    expect(r.segmentIndex).toBe(1);
    expect(r.distanceAlongM).toBeCloseTo(240, 1);
    expect(r.distanceFromLineM).toBeCloseTo(8, 1);
  });

  it('clamps to endpoints for points beyond either end', () => {
    const before = destinationPoint(A, 180, 30);
    const r0 = projectOntoPolyline(before, L)!;
    expect(r0.t).toBe(0);
    expect(r0.point).toEqual(A);
    expect(r0.distanceAlongM).toBe(0);
    expect(r0.distanceFromLineM).toBeCloseTo(30, 3);

    const after = destinationPoint(C, 90, 25);
    const r1 = projectOntoPolyline(after, L)!;
    expect(r1.segmentIndex).toBe(1);
    expect(r1.t).toBe(1);
    expect(r1.point).toEqual(C);
    expect(r1.distanceAlongM).toBeCloseTo(300, 6);
  });

  it('survives degenerate (zero-length) segments and single points', () => {
    const r = projectOntoPolyline(destinationPoint(A, 0, 100), [A, A, B])!;
    expect(r.segmentIndex).toBe(1);
    expect(r.distanceAlongM).toBeCloseTo(100, 1);
    expect(r.distanceFromLineM).toBeLessThan(0.01);

    const single = projectOntoPolyline(B, [A])!;
    expect(single.point).toEqual(A);
    expect(single.distanceFromLineM).toBeCloseTo(200, 6);
    expect(projectOntoPolyline(A, [A, A])!.distanceFromLineM).toBe(0);
    expect(projectOntoPolyline(A, [])).toBeNull();
  });

  it('returns null rather than a NaN distance for an invalid query point', () => {
    expect(projectOntoPolyline([Number.NaN, 31.25], L)).toBeNull();
    expect(projectOntoPolyline([200, 31.25], L)).toBeNull();
    expect(projectOntoPolylineRange([Number.NaN, 31.25], L, 0, 100)).toBeNull();
  });

  it('accepts a precomputed cumulative array and ignores a mismatched one', () => {
    const p = destinationPoint(A, 0, 120);
    const cum = cumulativeLengthsM(L);
    expect(projectOntoPolyline(p, L, cum)!.distanceAlongM).toBeCloseTo(120, 1);
    expect(projectOntoPolyline(p, L, [0])!.distanceAlongM).toBeCloseTo(120, 1);
  });
});

describe('projectOntoPolylineRange', () => {
  // Out 100 m north and back along the same line.
  const top = destinationPoint(A, 0, 100);
  const outAndBack: LngLat[] = [A, top, A];

  it('restricts the search to the given stretch on a route that doubles back', () => {
    const p = destinationPoint(A, 0, 20);
    expect(projectOntoPolylineRange(p, outAndBack, 0, 60)!.distanceAlongM).toBeCloseTo(20, 1);
    expect(projectOntoPolylineRange(p, outAndBack, 120, 200)!.distanceAlongM).toBeCloseTo(180, 1);
  });

  it('clamps to the range ends and returns null for an empty range', () => {
    const p = destinationPoint(A, 0, 90);
    const r = projectOntoPolylineRange(p, outAndBack, 0, 40)!;
    expect(r.distanceAlongM).toBeCloseTo(40, 3);
    expect(r.distanceFromLineM).toBeCloseTo(50, 1);
    expect(projectOntoPolylineRange(p, outAndBack, 50, 10)).toBeNull();
    expect(projectOntoPolylineRange(p, outAndBack, 500, 600)).toBeNull();
  });
});

describe('pointAtDistance / slicePolyline', () => {
  it('interpolates points along the line', () => {
    expect(haversineM(pointAtDistance(L, 250)!, destinationPoint(B, 90, 50))).toBeLessThan(0.05);
    expect(pointAtDistance(L, -5)).toEqual(A);
    expect(pointAtDistance(L, 1e6)).toEqual(C);
    expect(pointAtDistance([], 10)).toBeNull();
  });

  it('slices with interpolated ends and keeps interior vertices', () => {
    const s = slicePolyline(L, 150, 250);
    expect(s).toHaveLength(3);
    expect(s[1]).toEqual(B);
    expect(polylineLengthM(s)).toBeCloseTo(100, 1);
  });

  it('completed + remaining slices add up to the whole', () => {
    const cum = cumulativeLengthsM(L);
    for (const at of [0, 37.5, 200, 299.9, 300]) {
      const total =
        polylineLengthM(slicePolyline(L, 0, at, cum)) + polylineLengthM(slicePolyline(L, at, 300, cum));
      expect(total).toBeCloseTo(300, 3);
    }
  });

  it('handles degenerate ranges', () => {
    expect(slicePolyline(L, 50, 50)).toHaveLength(1);
    expect(slicePolyline(L, 60, 50)).toEqual([]);
    expect(slicePolyline([], 0, 10)).toEqual([]);
    expect(slicePolyline(L, -100, 1e6)).toEqual(L);
  });
});
