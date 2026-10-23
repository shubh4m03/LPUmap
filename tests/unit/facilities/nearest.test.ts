import { describe, expect, it, vi } from 'vitest';
import type { LngLat } from '../../../src/data/schema.ts';
import { haversineM } from '../../../src/distance/geodesic.ts';
import {
  NEAREST_ROUTE_CANDIDATES,
  createFacilityDirectory,
  findNearest,
} from '../../../src/facilities/index.ts';
import type { RouteRequest, RouteResult, Router } from '../../../src/routing/types.ts';
import { ORIGIN, east, place } from './synthetic-places.ts';

/** Fake router: route distance per destination place id; missing id → no-path; 'throw' → throws. */
function fakeRouter(table: Record<string, number | 'throw'>): Router & { calls: RouteRequest[] } {
  const calls: RouteRequest[] = [];
  return {
    calls,
    route(req): RouteResult {
      calls.push(req);
      const id = req.to.kind === 'place' ? req.to.placeId : '';
      const d = table[id];
      if (d === 'throw') throw new Error('router exploded');
      if (d === undefined) return { ok: false, reason: 'no-path', message: 'No connected path' };
      return {
        ok: true,
        profile: req.profile,
        preference: 'shortest',
        coordinates: [req.from.location, req.to.location],
        distanceM: d,
        durationS: d / 1.3,
        edgeIds: [],
        steps: [],
        caveats: [],
        snap: { fromM: 0, toM: 0 },
      };
    },
    alternatives: () => [],
    snap: () => null,
    nodeCount: 0,
    edgeCount: 0,
  };
}

const food = [
  place({ id: 'a', categoryId: 'food', location: east(100), graphNodeId: 1, displayName: 'A' }),
  place({ id: 'b', categoryId: 'food', location: east(200), graphNodeId: 2 }),
  place({ id: 'c', categoryId: 'food', location: east(300) }),
  place({ id: 'org', kind: 'organization', categoryId: 'food', location: null }),
  place({ id: 'w', categoryId: 'water', location: east(5) }),
];
const directory = createFacilityDirectory(food, []);

describe('findNearest without a router', () => {
  it('returns straight-line results ordered by distance, labelled straight-line', () => {
    const r = findNearest({ origin: ORIGIN, categoryId: 'food', directory });
    expect(r.map((x) => x.place.id)).toEqual(['a', 'b', 'c']);
    for (const x of r) {
      expect(x.distanceKind).toBe('straight-line');
      expect(x.durationS).toBeUndefined();
    }
    expect(r[0]!.distanceM).toBeCloseTo(haversineM(ORIGIN, east(100)), 6);
    expect(r[0]!.distanceM).toBeCloseTo(100, 0);
  });

  it('excludes places without a location and other categories', () => {
    const ids = findNearest({ origin: ORIGIN, categoryId: 'food', directory }).map((x) => x.place.id);
    expect(ids).not.toContain('org');
    expect(ids).not.toContain('w');
  });

  it('respects the limit and handles empty categories and bad input', () => {
    expect(findNearest({ origin: ORIGIN, categoryId: 'food', directory, limit: 2 })).toHaveLength(2);
    expect(findNearest({ origin: ORIGIN, categoryId: 'food', directory, limit: 0 })).toEqual([]);
    expect(findNearest({ origin: ORIGIN, categoryId: 'washroom', directory })).toEqual([]);
    expect(findNearest({ origin: [Number.NaN, 31] as LngLat, categoryId: 'food', directory })).toEqual([]);
    expect(findNearest({ origin: [200, 31] as LngLat, categoryId: 'food', directory })).toEqual([]);
  });

  it('breaks distance ties deterministically by id', () => {
    const d = createFacilityDirectory(
      [
        place({ id: 'z', categoryId: 'food', location: east(50) }),
        place({ id: 'y', categoryId: 'food', location: east(50) }),
      ],
      [],
    );
    expect(findNearest({ origin: ORIGIN, categoryId: 'food', directory: d }).map((x) => x.place.id)).toEqual([
      'y',
      'z',
    ]);
  });
});

describe('findNearest with a router', () => {
  it('orders by route distance, which may differ from straight-line order', () => {
    const router = fakeRouter({ a: 900, b: 250, c: 400 });
    const r = findNearest({ origin: ORIGIN, categoryId: 'food', directory, router });
    expect(r.map((x) => [x.place.id, x.distanceM, x.distanceKind])).toEqual([
      ['b', 250, 'route'],
      ['c', 400, 'route'],
      ['a', 900, 'route'],
    ]);
    expect(r[0]!.durationS).toBeCloseTo(250 / 1.3);
  });

  it('sends a point origin and a place destination carrying the graph node id', () => {
    const router = fakeRouter({ a: 100 });
    findNearest({ origin: ORIGIN, categoryId: 'food', directory, router, profile: 'cycle' });
    const req = router.calls.find((c) => c.to.kind === 'place' && c.to.placeId === 'a');
    expect(req?.from).toMatchObject({ kind: 'point', location: ORIGIN });
    expect(req?.to).toMatchObject({
      kind: 'place',
      placeId: 'a',
      label: 'A',
      nodeId: 1,
      location: east(100),
    });
    expect(req?.profile).toBe('cycle');
    expect(router.calls.every((c) => c.profile === 'cycle')).toBe(true);
  });

  it('defaults to the walk profile', () => {
    const router = fakeRouter({});
    findNearest({ origin: ORIGIN, categoryId: 'food', directory, router });
    expect(router.calls.every((c) => c.profile === 'walk')).toBe(true);
  });

  it('falls back to straight-line on failure and lists those after route results', () => {
    const router = fakeRouter({ c: 5000, b: 'throw' });
    const r = findNearest({ origin: ORIGIN, categoryId: 'food', directory, router });
    expect(r.map((x) => [x.place.id, x.distanceKind])).toEqual([
      ['c', 'route'],
      ['a', 'straight-line'],
      ['b', 'straight-line'],
    ]);
    const a = r.find((x) => x.place.id === 'a')!;
    expect(a.distanceM).toBeCloseTo(haversineM(ORIGIN, east(100)), 6);
    expect(a.durationS).toBeUndefined();
  });

  it('only routes the closest candidates by straight line, then applies the limit', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      place({ id: `p${String(i).padStart(2, '0')}`, categoryId: 'food', location: east(100 * (i + 1)) }),
    );
    const d = createFacilityDirectory(many, []);
    // Route distances reverse the straight-line order among the routed candidates.
    const table = Object.fromEntries(many.map((p, i) => [p.id, 10_000 - i * 100]));
    const router = fakeRouter(table);
    const spy = vi.spyOn(router, 'route');
    const r = findNearest({ origin: ORIGIN, categoryId: 'food', directory: d, router, limit: 3 });
    expect(spy).toHaveBeenCalledTimes(NEAREST_ROUTE_CANDIDATES);
    const routedIds = router.calls.map((c) => (c.to.kind === 'place' ? c.to.placeId : ''));
    expect(routedIds).toEqual(many.slice(0, NEAREST_ROUTE_CANDIDATES).map((p) => p.id));
    expect(r.map((x) => x.place.id)).toEqual(['p07', 'p06', 'p05']);
    expect(r.every((x) => x.distanceKind === 'route')).toBe(true);
  });

  it('treats a non-finite route distance as a failure, not a route result', () => {
    const base = fakeRouter({ a: 50, b: 60, c: 70 });
    const router: Router = {
      ...base,
      route: (req) => {
        const res = base.route(req);
        return req.to.kind === 'place' && req.to.placeId === 'a' && res.ok
          ? { ...res, distanceM: Number.NaN }
          : res;
      },
    };
    const r = findNearest({ origin: ORIGIN, categoryId: 'food', directory, router });
    expect(r.map((x) => [x.place.id, x.distanceKind])).toEqual([
      ['b', 'route'],
      ['c', 'route'],
      ['a', 'straight-line'],
    ]);
    expect(r.every((x) => Number.isFinite(x.distanceM))).toBe(true);
  });

  it('never claims a facility is open or available', () => {
    const r = findNearest({ origin: ORIGIN, categoryId: 'food', directory, router: fakeRouter({ a: 1 }) });
    expect(Object.keys(r[0]!).sort()).toEqual(['distanceKind', 'distanceM', 'durationS', 'place']);
    for (const x of r.slice(1)) expect(Object.keys(x).sort()).toEqual(['distanceKind', 'distanceM', 'place']);
  });
});
