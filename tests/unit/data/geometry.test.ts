// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { LngLat } from '../../../src/data/schema.ts';
import {
  assembleRings,
  distanceToMultiPolygonM,
  pointInPolygon,
  pointInRing,
  pointOnSurface,
  polygonAreaM2,
  ringProblems,
  ringSelfIntersects,
  ringSignedAreaM2,
  roundCoord,
  withWinding,
} from '../../../scripts/lib/geometry.ts';

const square: LngLat[] = [
  [75.7, 31.25],
  [75.701, 31.25],
  [75.701, 31.251],
  [75.7, 31.251],
  [75.7, 31.25],
];
const hole: LngLat[] = [
  [75.7004, 31.2504],
  [75.7006, 31.2504],
  [75.7006, 31.2506],
  [75.7004, 31.2506],
  [75.7004, 31.2504],
];

describe('assembleRings', () => {
  it('joins split outer ways, reversing where needed', () => {
    const { rings, unclosed } = assembleRings([
      [1, 2, 3],
      [5, 4, 3], // reversed relative to the chain
      [5, 6, 1],
    ]);
    expect(unclosed).toEqual([]);
    expect(rings).toEqual([[1, 2, 3, 4, 5, 6, 1]]);
  });

  it('keeps already-closed ways and reports gaps instead of force-closing', () => {
    const { rings, unclosed } = assembleRings([
      [10, 11, 12, 10],
      [1, 2, 3],
      [3, 4],
    ]);
    expect(rings).toEqual([[10, 11, 12, 10]]);
    expect(unclosed).toEqual([[1, 2, 3, 4]]);
  });

  it('assembles two separate rings from interleaved input', () => {
    const { rings } = assembleRings([
      [1, 2],
      [7, 8, 9],
      [2, 3, 1],
      [9, 7],
    ]);
    expect(rings).toHaveLength(2);
  });
});

describe('point in polygon', () => {
  it('handles inside, outside and holes', () => {
    expect(pointInRing([75.7005, 31.2502], square)).toBe(true);
    expect(pointInRing([75.702, 31.2502], square)).toBe(false);
    expect(pointInPolygon([75.7005, 31.2505], [square, hole])).toBe(false);
    expect(pointInPolygon([75.7002, 31.2502], [square, hole])).toBe(true);
  });

  it('works for concave (U-shaped) rings', () => {
    const u: LngLat[] = [
      [0, 0],
      [3, 0],
      [3, 3],
      [2, 3],
      [2, 1],
      [1, 1],
      [1, 3],
      [0, 3],
      [0, 0],
    ];
    expect(pointInRing([1.5, 2], u)).toBe(false);
    expect(pointInRing([0.5, 2], u)).toBe(true);
    const p = pointOnSurface([u])!;
    expect(pointInRing(p, u)).toBe(true);
  });
});

describe('area and validity', () => {
  it('computes area in m² with sign from winding, and subtracts holes', () => {
    const a = ringSignedAreaM2(square);
    // 0.001° lon × 0.001° lat at 31.25°N ≈ 95.1 m × 111.2 m.
    expect(a).toBeGreaterThan(10_500);
    expect(a).toBeLessThan(10_700);
    expect(ringSignedAreaM2([...square].reverse())).toBeCloseTo(-a, 6);
    expect(polygonAreaM2([square, hole])).toBeCloseTo(a - Math.abs(ringSignedAreaM2(hole)), 6);
  });

  it('normalises winding', () => {
    expect(ringSignedAreaM2(withWinding([...square].reverse(), true))).toBeGreaterThan(0);
    expect(ringSignedAreaM2(withWinding(square, false))).toBeLessThan(0);
  });

  it('detects self-intersection, open rings, too few points and zero area', () => {
    const bowtie: LngLat[] = [
      [0, 0],
      [1, 1],
      [1, 0],
      [0, 1],
      [0, 0],
    ];
    expect(ringSelfIntersects(bowtie)).toBe(true);
    expect(ringSelfIntersects(square)).toBe(false);
    expect(ringProblems(bowtie)).toEqual(['zero-area', 'self-intersection']);
    const lopsided: LngLat[] = [
      [0, 0],
      [2, 2],
      [2, 0],
      [0, 1],
      [0, 0],
    ];
    expect(ringProblems(lopsided)).toEqual(['self-intersection']);
    expect(ringProblems(square.slice(0, 4))).toEqual(['not-closed']);
    expect(ringProblems([square[0]!, square[1]!, square[0]!])).toEqual(['too-few-points']);
    expect(
      ringProblems([
        [0, 0],
        [1, 0],
        [2, 0],
        [0, 0],
      ]),
    ).toEqual(['zero-area']);
    expect(ringProblems(square)).toEqual([]);
  });
});

describe('distances and rounding', () => {
  it('measures from the outline, 0 inside', () => {
    expect(distanceToMultiPolygonM([75.7005, 31.2505], [[square]])).toBe(0);
    const d = distanceToMultiPolygonM([75.7005, 31.2511], [[square]]); // 0.0001° north of the top edge
    expect(d).toBeGreaterThan(10.5);
    expect(d).toBeLessThan(11.5);
  });

  it('rounds to 7 decimals without negative zero', () => {
    expect(roundCoord([75.123456789, -0.00000001])).toEqual([75.1234568, 0]);
    expect(Object.is(roundCoord([-0.00000001, 0])[0], -0)).toBe(false);
  });
});
