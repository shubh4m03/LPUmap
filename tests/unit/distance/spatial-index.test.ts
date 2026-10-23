import { describe, expect, it } from 'vitest';
import type { LngLat } from '../../../src/data/schema.ts';
import { createGridIndex, haversineM } from '../../../src/distance/index.ts';

/** mulberry32 — small seeded PRNG so failures are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Pt {
  id: number;
  at: LngLat | null;
}

function randomPoints(seed: number, n: number, nullEvery = 0): Pt[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, id) => ({
    id,
    at: nullEvery && id % nullEvery === 0 ? null : ([75.69 + r() * 0.03, 31.24 + r() * 0.025] as LngLat),
  }));
}

function brute(points: Pt[], p: LngLat) {
  return points
    .filter((x): x is { id: number; at: LngLat } => x.at !== null)
    .map((x) => ({ id: x.id, distanceM: haversineM(p, x.at) }))
    .sort((a, b) => a.distanceM - b.distanceM || a.id - b.id);
}

describe('createGridIndex', () => {
  it('nearest(k) matches brute force on seeded random points', () => {
    const points = randomPoints(42, 800, 13);
    const r = rng(7);
    for (const cell of [25, 100, 400]) {
      const index = createGridIndex(points, (x) => x.at, cell);
      for (let q = 0; q < 60; q++) {
        // Some queries fall well outside the point cloud.
        const p: LngLat = [75.68 + r() * 0.05, 31.23 + r() * 0.045];
        const k = 1 + Math.floor(r() * 8);
        const got = index.nearest(p, k);
        const expected = brute(points, p).slice(0, k);
        expect(got.map((h) => h.item.id)).toEqual(expected.map((h) => h.id));
        got.forEach((h, i) => expect(h.distanceM).toBe(expected[i]!.distanceM));
      }
    }
  });

  it('nearest respects maxDistanceM', () => {
    const points = randomPoints(3, 300);
    const index = createGridIndex(points, (x) => x.at, 50);
    const p: LngLat = [75.7, 31.25];
    const got = index.nearest(p, 50, 300);
    const expected = brute(points, p)
      .filter((h) => h.distanceM <= 300)
      .slice(0, 50);
    expect(got.map((h) => h.item.id)).toEqual(expected.map((h) => h.id));
    expect(got.every((h) => h.distanceM <= 300)).toBe(true);
    expect(index.nearest(p, 5, 0.001)).toEqual([]);
  });

  it('within(radius) matches brute force', () => {
    const points = randomPoints(99, 500, 7);
    const index = createGridIndex(points, (x) => x.at, 80);
    const r = rng(11);
    for (let q = 0; q < 40; q++) {
      const p: LngLat = [75.69 + r() * 0.03, 31.24 + r() * 0.025];
      const radius = r() * 600;
      const expected = brute(points, p).filter((h) => h.distanceM <= radius);
      const got = index.within(p, radius);
      expect(got.map((h) => h.item.id)).toEqual(expected.map((h) => h.id));
    }
  });

  it('skips items without a valid location and handles empty input', () => {
    const index = createGridIndex<Pt>(
      [
        { id: 1, at: null },
        { id: 2, at: [Number.NaN, 31] },
        { id: 3, at: [75.7, 31.25] },
      ],
      (x) => x.at,
    );
    expect(index.size).toBe(1);
    expect(index.nearest([75.7, 31.25], 5).map((h) => h.item.id)).toEqual([3]);

    const empty = createGridIndex<Pt>([], (x) => x.at);
    expect(empty.nearest([75.7, 31.25], 3)).toEqual([]);
    expect(empty.within([75.7, 31.25], 1000)).toEqual([]);
  });

  it('returns nothing for k < 1, invalid query points or negative radii', () => {
    const index = createGridIndex(randomPoints(1, 20), (x) => x.at);
    expect(index.nearest([75.7, 31.25], 0)).toEqual([]);
    expect(index.nearest([Number.NaN, 31.25], 3)).toEqual([]);
    expect(index.within([75.7, 31.25], -1)).toEqual([]);
    expect(() => createGridIndex([], () => null, 0)).toThrow(RangeError);
  });

  it('finds the nearest item for a query far outside the grid', () => {
    const points = randomPoints(5, 100);
    const index = createGridIndex(points, (x) => x.at, 50);
    const far: LngLat = [76.5, 31.25];
    expect(index.nearest(far, 1)[0]!.item.id).toBe(brute(points, far)[0]!.id);
  });

  it('stays exact when the data spans a wide latitude range or contains a far outlier', () => {
    // Equirectangular distortion grows with latitude distance from the projection origin;
    // the index must still agree with brute force (a fixed 1 % margin did not).
    const cases: Array<[number, number]> = [
      [31, 8],
      [55, 6],
      [0, 40],
    ];
    for (const [lat0, span] of cases) {
      const r = rng(lat0 + span);
      const points: Pt[] = Array.from({ length: 600 }, (_, id) => ({
        id,
        at: [75 + r() * span, lat0 + r() * span] as LngLat,
      }));
      const index = createGridIndex(points, (x) => x.at, 500);
      for (let q = 0; q < 80; q++) {
        const p: LngLat = [75 + r() * span, lat0 + r() * span];
        const all = brute(points, p);
        expect(index.nearest(p, 3).map((h) => h.item.id)).toEqual(all.slice(0, 3).map((h) => h.id));
        const radius = 20_000;
        expect(index.within(p, radius).map((h) => h.item.id)).toEqual(
          all.filter((h) => h.distanceM <= radius).map((h) => h.id),
        );
      }
    }

    // Campus points plus one bad coordinate far to the north.
    const campus = randomPoints(8, 200);
    const withOutlier: Pt[] = [{ id: 999, at: [75.7, 36.5] }, ...campus];
    const index = createGridIndex(withOutlier, (x) => x.at, 50);
    const r = rng(17);
    for (let q = 0; q < 40; q++) {
      const p: LngLat = [75.69 + r() * 0.03, 31.24 + r() * 0.025];
      expect(index.nearest(p, 4).map((h) => h.item.id)).toEqual(
        brute(withOutlier, p)
          .slice(0, 4)
          .map((h) => h.id),
      );
    }
  });
});
