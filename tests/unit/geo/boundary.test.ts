/**
 * Boundary service tests on SYNTHETIC geometry (invented; not LPU data).
 * Shapes are built in local metres around a fixed origin and converted to
 * lon/lat with the boundary's own projection, so analytic areas are exact.
 *
 * Boundary (metres, origin at the bbox centre):
 *   part 1: a concave "U": square [-300,300]² minus the notch x∈[-100,100], y∈[-100,300],
 *           with a hole x∈[150,250], y∈[-250,-150];
 *   part 2: an island x∈[-50,50], y∈[200,280] inside the notch (MultiPolygon).
 */
import { describe, expect, it } from 'vitest';
import type { BoundaryReviewSection, CuratedMembershipDecision, LngLat } from '../../../src/data/schema.ts';
import { createLocalProjection } from '../../../src/distance/geodesic.ts';
import {
  boundaryFromFeatureCollection,
  classifyFootprint,
  createBoundary,
  geometryProblems,
  InvalidGeometryError,
  pointOnSurface,
  polygonAreaM2,
  validatePointLocation,
  vertexMeanAnchor,
  type PolygonalGeometry,
} from '../../../src/geo/index.ts';

const ORIGIN: LngLat = [75.7032, 31.2533];
const proj = createLocalProjection(ORIGIN);
type XY = [number, number];
const ll = (p: XY): LngLat => proj.toLngLat(p);
const closed = (pts: XY[]): LngLat[] => [...pts, pts[0]!].map(ll);
const rect = (x0: number, y0: number, x1: number, y1: number): XY[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const poly = (...rings: XY[][]): PolygonalGeometry => ({ type: 'Polygon', coordinates: rings.map(closed) });

const U_OUTER: XY[] = [
  [-300, -300],
  [300, -300],
  [300, 300],
  [100, 300],
  [100, -100],
  [-100, -100],
  [-100, 300],
  [-300, 300],
];
const HOLE = rect(150, -250, 250, -150);
const ISLAND = rect(-50, 200, 50, 280);
const BOUNDARY_GEOM: PolygonalGeometry = {
  type: 'MultiPolygon',
  coordinates: [[closed(U_OUTER), closed(HOLE)], [closed(ISLAND)]],
};
const boundary = createBoundary(BOUNDARY_GEOM);
// U area = 600² − 200·400 = 280,000; hole 10,000; island 8,000.
const BOUNDARY_AREA = 280_000 - 10_000 + 8_000;

/** Grid-sampled inside fraction (cell centres, step in metres). */
function sampledFraction(geom: PolygonalGeometry, step: number): number {
  const fp = createBoundary(geom); // reuse containsPoint for the footprint itself
  const [w, s, e, n] = fp.bbox;
  const [x0, y0] = proj.toXY([w, s]);
  const [x1, y1] = proj.toXY([e, n]);
  let inFp = 0;
  let inBoth = 0;
  for (let x = x0 + step / 2; x < x1; x += step)
    for (let y = y0 + step / 2; y < y1; y += step) {
      const p = ll([x, y]);
      if (!fp.containsPoint(p)) continue;
      inFp++;
      if (boundary.containsPoint(p)) inBoth++;
    }
  return inBoth / inFp;
}

describe('createBoundary', () => {
  it('measures area in local metres, with holes subtracted and parts added', () => {
    expect(boundary.areaM2).toBeCloseTo(BOUNDARY_AREA, 1);
    expect(polygonAreaM2(poly(rect(0, 0, 30, 40)))).toBeCloseTo(1200, 1);
    expect(polygonAreaM2(poly(rect(-10, -10, 10, 10), rect(-5, -5, 5, 5)))).toBeCloseTo(300, 1);
  });

  it('contains points of the concave body, not the notch, the hole or outside; contains the island', () => {
    expect(boundary.containsPoint(ll([-200, 0]))).toBe(true);
    expect(boundary.containsPoint(ll([0, 0]))).toBe(false); // notch (concavity)
    expect(boundary.containsPoint(ll([200, -200]))).toBe(false); // hole
    expect(boundary.containsPoint(ll([0, 240]))).toBe(true); // island
    expect(boundary.containsPoint(ll([400, 0]))).toBe(false);
    expect(boundary.containsPoint([Number.NaN, 31] as unknown as LngLat)).toBe(false);
  });

  it('gives the distance to the nearest boundary edge, inside or outside', () => {
    expect(boundary.distanceToBoundaryM(ll([-200, 0]))).toBeCloseTo(100, 3);
    expect(boundary.distanceToBoundaryM(ll([0, 0]))).toBeCloseTo(100, 3); // notch floor at y = −100
    expect(boundary.distanceToBoundaryM(ll([200, -200]))).toBeCloseTo(50, 3); // hole edge
    expect(boundary.distanceToBoundaryM(ll([310, 0]))).toBeCloseTo(10, 3);
  });

  it('loads from a boundary FeatureCollection and rejects an invalid boundary', () => {
    const fc = { features: [{ geometry: BOUNDARY_GEOM as { type: string; coordinates: unknown } }] };
    expect(boundaryFromFeatureCollection(fc).areaM2).toBeCloseTo(BOUNDARY_AREA, 1);
    const bowTie = {
      type: 'Polygon',
      coordinates: [
        closed([
          [0, 0],
          [10, 10],
          [10, 0],
          [0, 10],
        ]),
      ],
    };
    expect(() => createBoundary(bowTie as PolygonalGeometry)).toThrow(InvalidGeometryError);
    expect(() => createBoundary([])).toThrow(InvalidGeometryError);
  });
});

describe('insideFraction (exact clipping)', () => {
  it('handles the concave notch exactly where a convex-hull clip would not', () => {
    // 40×20 m straddling the notch's west wall x = −100: west half inside, east half in the notch.
    expect(boundary.insideFraction(poly(rect(-120, 0, -80, 20)))).toBeCloseTo(0.5, 9);
    // Wholly inside the notch: inside the convex hull, but outside the boundary.
    expect(boundary.insideFraction(poly(rect(-20, 0, 20, 20)))).toBe(0);
  });

  it('subtracts the boundary hole and adds the island part', () => {
    // 20×20 straddling the hole's west edge x = 150.
    expect(boundary.insideFraction(poly(rect(140, -210, 160, -190)))).toBeCloseTo(0.5, 9);
    // Straddling the island's south edge y = 200 inside the notch.
    expect(boundary.insideFraction(poly(rect(-10, 190, 10, 210)))).toBeCloseTo(0.5, 9);
  });

  it('handles a footprint with its own hole and edges shared with the boundary', () => {
    // Courtyard building: 40×40 with a 20×20 courtyard, half across the outer east edge x = 300.
    const courtyard = poly(rect(280, 0, 320, 40), rect(290, 10, 310, 30));
    expect(boundary.insideFraction(courtyard)).toBeCloseTo(0.5, 9);
    // Shares the notch floor edge y = −100 from inside (same side) and from outside (touching only).
    expect(boundary.insideFraction(poly(rect(-50, -120, 50, -100)))).toBeCloseTo(1, 9);
    expect(boundary.insideFraction(poly(rect(-50, -100, 50, -80)))).toBeCloseTo(0, 9);
  });

  it('matches fine grid sampling within 0.5 % on assorted concave footprints', () => {
    const shapes: PolygonalGeometry[] = [
      poly(rect(-115, -130, -60, -70)), // corner of the notch (re-entrant vertex)
      poly([
        [85, -20],
        [130, -20],
        [130, 30],
        [110, 30],
        [110, 0],
        [85, 0],
      ]), // L-shape across the notch's east wall
      poly([
        [-20, 185],
        [25, 195],
        [40, 230],
        [5, 215],
        [-30, 225],
      ]), // irregular across the island edge
      poly(rect(135, -265, 175, -235), rect(145, -255, 155, -245)), // courtyard over the hole corner
      poly([
        [270, 280],
        [320, 270],
        [330, 320],
        [290, 335],
      ]), // across the outer north-east corner
      {
        type: 'MultiPolygon',
        coordinates: [[closed(rect(-110, 50, -90, 70))], [closed(rect(-5, 205, 5, 215))]],
      },
    ];
    for (const s of shapes) {
      const exact = boundary.insideFraction(s);
      const sampled = sampledFraction(s, 0.25);
      expect(Math.abs(exact - sampled)).toBeLessThanOrEqual(0.005);
      expect(exact).toBeGreaterThan(0);
      expect(exact).toBeLessThan(1);
    }
  });

  it('throws InvalidGeometryError for an invalid footprint instead of guessing', () => {
    const bowTie = poly([
      [0, -200],
      [10, -190],
      [10, -200],
      [0, -190],
    ]);
    expect(() => boundary.insideFraction(bowTie)).toThrow(InvalidGeometryError);
  });
});

describe('unionIntersectionAreaM2 (target ∩ union of overlapping parts)', () => {
  const target = createBoundary(poly(rect(0, 0, 100, 100)));
  // Shapes go through the target's own projection, so analytic areas hold to ~1e-5 (checked to 0.5 m²).
  const area = (...parts: XY[][]) => target.unionIntersectionAreaM2(parts.map((p) => poly(p)));

  it('counts duplicate, overlapping, wall-sharing and contained parts once', () => {
    expect(area(rect(0, 0, 50, 100), rect(0, 0, 50, 100))).toBeCloseTo(5_000, 0); // exact duplicates
    expect(area(rect(0, 0, 60, 100), rect(40, 0, 100, 100))).toBeCloseTo(10_000, 0); // overlap
    expect(area(rect(0, 0, 50, 50), rect(50, 0, 100, 50))).toBeCloseTo(5_000, 0); // shared wall
    expect(area(rect(10, 10, 90, 90), rect(20, 20, 30, 30))).toBeCloseTo(6_400, 0); // contained part
    expect(area(rect(0, 0, 100, 40))).toBeCloseTo(4_000, 0); // edges shared with the target
    expect(area(rect(-50, -50, 50, 50))).toBeCloseTo(2_500, 0); // partly outside
    expect(area(rect(200, 200, 300, 300))).toBe(0);
    expect(area()).toBe(0);
  });

  it('respects holes in the target', () => {
    const holed = createBoundary(poly(rect(0, 0, 100, 100), rect(40, 40, 60, 60).reverse()));
    expect(holed.unionIntersectionAreaM2([poly(rect(0, 0, 100, 100))])).toBeCloseTo(9_600, 0);
    expect(holed.unionIntersectionAreaM2([poly(rect(40, 40, 60, 60))])).toBeCloseTo(0, 0);
  });

  it('matches grid sampling of the union within 0.5 % for a tangle of overlapping parts', () => {
    const parts: XY[][] = [
      rect(-20, 10, 45, 70),
      rect(30, -10, 80, 40),
      rect(30, -10, 80, 40), // duplicate
      [
        [20, 50],
        [110, 30],
        [90, 95],
        [40, 85],
      ],
      rect(35, 20, 50, 60),
    ];
    const geoms = parts.map((p) => createBoundary(poly(p)));
    let hits = 0;
    const step = 0.5;
    for (let x = step / 2; x < 100; x += step)
      for (let y = step / 2; y < 100; y += step) if (geoms.some((g) => g.containsPoint(ll([x, y])))) hits++;
    const sampled = hits * step * step;
    expect(Math.abs(area(...parts) - sampled) / sampled).toBeLessThan(0.005);
  });
});

describe('geometryProblems / pointOnSurface', () => {
  it('flags bow-ties, unclosed rings, bad coordinates, degenerate rings and holes outside', () => {
    expect(geometryProblems(poly(rect(0, 0, 10, 10)))).toEqual([]);
    expect(
      geometryProblems(
        poly([
          [0, 0],
          [10, 10],
          [10, 0],
          [0, 10],
        ]),
      )[0],
    ).toMatch(/self-intersection/);
    const open = { type: 'Polygon', coordinates: [rect(0, 0, 10, 10).map(ll)] };
    expect(geometryProblems(open)[0]).toMatch(/not closed/);
    expect(
      geometryProblems({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [Number.NaN, 1],
            [1, 1],
            [0, 0],
          ],
        ],
      })[0],
    ).toMatch(/invalid coordinates/);
    expect(
      geometryProblems(
        poly([
          [0, 0],
          [10, 0],
          [20, 0],
        ]),
      )[0],
    ).toMatch(/zero area|spike/);
    expect(geometryProblems(poly(rect(0, 0, 10, 10), rect(20, 20, 25, 25)))[0]).toMatch(/hole 1 outside/);
    expect(geometryProblems({ type: 'Point', coordinates: [0, 0] })[0]).toMatch(/not a Polygon/);
  });

  it('returns a point inside a concave footprint even when its centroid is outside it', () => {
    const c: PolygonalGeometry = poly([
      [0, 0],
      [30, 0],
      [30, 5],
      [5, 5],
      [5, 25],
      [30, 25],
      [30, 30],
      [0, 30],
    ]);
    const p = pointOnSurface(c)!;
    expect(createBoundary(c).containsPoint(p)).toBe(true);
    expect(pointOnSurface({ type: 'Polygon', coordinates: [] })).toBeNull();
    expect(vertexMeanAnchor(poly(rect(0, 0, 10, 10)))![0]).toBeCloseTo(ll([5, 5])[0], 9);
  });
});

describe('classifyFootprint — the six owner acceptance cases', () => {
  const at = (geometry: PolygonalGeometry, id = 'osm:way/1', conflicts?: string[]) =>
    conflicts ? { id, geometry, conflicts } : { id, geometry };

  it('1. valid interior footprint → inside, in the inventory', () => {
    const r = classifyFootprint(at(poly(rect(-250, -50, -230, -30))), boundary);
    expect(r).toMatchObject({
      status: 'inside',
      inCampusInventory: true,
      insideFraction: 1,
      method: 'polygon-clip',
      reasonCode: 'interior',
      decision: 'auto',
      pointAreaDisagreement: false,
    });
    expect(r.areaM2).toBeCloseTo(400, 2);
    expect(r.distanceToBoundaryM).toBeCloseTo(50, 2);
    expect(r.anchor).not.toBeNull();
  });

  it('2. confirmed exterior → outside (measured, and by curated decision over a crossing footprint)', () => {
    const far = classifyFootprint(at(poly(rect(400, 0, 420, 20))), boundary);
    expect(far).toMatchObject({
      status: 'outside',
      inCampusInventory: false,
      insideFraction: 0,
      reasonCode: 'exterior',
    });
    expect(far.distanceToBoundaryM).toBeCloseTo(100, 2);

    const decision: CuratedMembershipDecision = {
      featureId: 'osm:way/2',
      status: 'outside',
      decidedAt: '2026-10-24',
      source: { kind: 'owner-confirmation', ref: 'synthetic test decision' },
    };
    const crossing = classifyFootprint(
      at(poly(rect(-120, 0, -80, 20)), 'osm:way/2'),
      boundary,
      [],
      [decision],
    );
    expect(crossing).toMatchObject({
      status: 'outside',
      inCampusInventory: false,
      method: 'curated-decision',
      reasonCode: 'curated-decision',
      decision: 'curated',
      decisionSource: 'owner-confirmation: synthetic test decision (2026-10-24)',
      insideFraction: 0.5, // still measured and reported
    });
  });

  it('3. crossing footprints: majority joins the inventory; minority and conflicting evidence are uncertain', () => {
    const majority = classifyFootprint(at(poly(rect(-130, 0, -90, 20))), boundary); // 30 of 40 m inside
    expect(majority).toMatchObject({
      status: 'crossing',
      inCampusInventory: true,
      insideFraction: 0.75,
      reasonCode: 'crossing-majority',
    });
    const minority = classifyFootprint(at(poly(rect(-110, 0, -70, 20))), boundary); // 10 of 40 m inside
    expect(minority).toMatchObject({
      status: 'uncertain',
      inCampusInventory: false,
      insideFraction: 0.25,
      reasonCode: 'crossing-minority',
    });
    const conflict = classifyFootprint(
      at(poly(rect(-130, 0, -90, 20)), 'osm:way/3', ['operator=Synthetic Private Hostel']),
      boundary,
    );
    expect(conflict).toMatchObject({
      status: 'uncertain',
      inCampusInventory: false,
      reasonCode: 'crossing-conflict',
    });
    expect(conflict.reason).toContain('operator=Synthetic Private Hostel');
    // thresholds: 0.995 ≤ f is inside, f ≤ 0.005 is outside (rounded to 4 decimals first)
    const sliver = classifyFootprint(at(poly(rect(-100.1, 0, -80.1, 20))), boundary); // 0.1/20 = 0.005
    expect(sliver).toMatchObject({ status: 'outside', insideFraction: 0.005 });
  });

  it('4. invalid polygon → uncertain with invalid-geometry, never thrown or dropped', () => {
    const bowTie = poly([
      [-250, -50],
      [-230, -30],
      [-230, -50],
      [-250, -30],
    ]);
    const decision: CuratedMembershipDecision = {
      featureId: 'osm:way/4',
      status: 'inside',
      decidedAt: '2026-10-24',
      source: { kind: 'physical-survey', ref: 'synthetic' },
    };
    const r = classifyFootprint(at(bowTie, 'osm:way/4'), boundary, [], [decision]);
    expect(r).toMatchObject({
      status: 'uncertain',
      inCampusInventory: false,
      insideFraction: null,
      areaM2: null,
      method: 'none',
      reasonCode: 'invalid-geometry',
      decision: 'auto',
    });
    expect(r.problems[0]).toMatch(/self-intersection/);
    expect(r.reason).toMatch(/not dropped/);
    expect(r.reason).toMatch(/curated decision exists/);
    expect(classifyFootprint({ id: 'x', geometry: null }, boundary).reasonCode).toBe('invalid-geometry');
  });

  it('5. uncertain boundary section → uncertain even when fully inside; resolved sections and curated decisions win', () => {
    const section: BoundaryReviewSection = {
      id: 'synthetic-west-edge',
      title: 'Synthetic west edge',
      status: 'open',
      reason: 'Test section',
      evidence: ['synthetic'],
      bufferM: 30,
      geometry: { type: 'LineString', coordinates: [ll([-300, -300]), ll([-300, 300])] },
    };
    const near = poly(rect(-290, 0, -270, 20)); // fully inside, 10 m from the section
    const r = classifyFootprint(at(near), boundary, [section]);
    expect(r).toMatchObject({
      status: 'uncertain',
      inCampusInventory: false,
      insideFraction: 1,
      reasonCode: 'review-section',
      reviewSectionId: 'synthetic-west-edge',
    });
    // Outside the boundary, 5 m beyond the section line: still a review item, not 'outside'.
    expect(classifyFootprint(at(poly(rect(-325, 0, -305, 20))), boundary, [section]).status).toBe(
      'uncertain',
    );
    // Beyond the buffer → normal rules.
    expect(classifyFootprint(at(poly(rect(-250, 0, -230, 20))), boundary, [section]).status).toBe('inside');
    // A polygon section counts when the footprint overlaps it.
    const zone: BoundaryReviewSection = {
      ...section,
      id: 'synthetic-zone',
      bufferM: 0,
      geometry: { type: 'Polygon', coordinates: [closed(rect(-280, 100, -200, 180))] },
    };
    expect(classifyFootprint(at(poly(rect(-250, 120, -230, 140))), boundary, [zone]).reviewSectionId).toBe(
      'synthetic-zone',
    );
    expect(classifyFootprint(at(near), boundary, [{ ...section, status: 'resolved' }]).status).toBe('inside');
    const decision: CuratedMembershipDecision = {
      featureId: 'osm:way/1',
      status: 'inside',
      decidedAt: '2026-10-24',
      source: { kind: 'official-publication', ref: 'synthetic' },
    };
    expect(classifyFootprint(at(near), boundary, [section], [decision])).toMatchObject({
      status: 'inside',
      decision: 'curated',
      reviewSectionId: null,
    });
  });

  it('6. centroid / point-on-surface disagreeing with the area fraction is recorded, status from area', () => {
    // Inverted L under the notch floor (y = −100): a 20×1 m bar inside (below the floor) and a
    // 1×18 m stem rising into the notch (outside). f = 20/38 ≥ 0.5, but the centroid is in the notch.
    const l = poly([
      [-50, -101],
      [-30, -101],
      [-30, -100],
      [-49, -100],
      [-49, -82],
      [-50, -82],
    ]);
    const r = classifyFootprint(at(l), boundary);
    expect(r.insideFraction).toBeCloseTo(20 / 38, 4);
    expect(r.status).toBe('crossing');
    expect(r.centroidInside).toBe(false);
    expect(r.pointAreaDisagreement).toBe(true);
    expect(r.reason).toMatch(/disagreeing with the area fraction/);
    // A plain straddler agrees.
    expect(classifyFootprint(at(poly(rect(-130, 0, -90, 20))), boundary).pointAreaDisagreement).toBe(false);
  });
});

describe('validatePointLocation', () => {
  it('distinguishes inside, outside in the context area, and outside the area', () => {
    const bbox = {
      kind: 'bbox' as const,
      bbox: [ll([-500, -500])[0], ll([-500, -500])[1], ll([500, 500])[0], ll([500, 500])[1]] as const,
    };
    expect(validatePointLocation(ll([-200, 0]), boundary, bbox)).toBe('inside');
    expect(validatePointLocation(ll([0, 0]), boundary, bbox)).toBe('outside-in-context-area');
    expect(validatePointLocation(ll([600, 0]), boundary, bbox)).toBe('outside-area');
    const buffer = { kind: 'buffer' as const, bufferM: 50 };
    expect(validatePointLocation(ll([340, 0]), boundary, buffer)).toBe('outside-in-context-area');
    expect(validatePointLocation(ll([360, 0]), boundary, buffer)).toBe('outside-area');
    expect(validatePointLocation([200, 100] as LngLat, boundary, buffer)).toBe('outside-area');
  });
});
