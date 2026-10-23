// @vitest-environment node
/**
 * Owner acceptance cases for campus membership at pipeline level
 * (scripts/lib/membership.ts over src/geo/boundary.ts): valid interior,
 * confirmed exterior, crossing, invalid polygon, uncertain boundary section,
 * centroid-vs-area disagreement, conflicting evidence and curated decisions —
 * plus duplicate/overlap reporting. Synthetic geometry only.
 */
import { describe, expect, it } from 'vitest';
import type { BoundaryReviewSection, CuratedMembershipDecision, LngLat } from '../../../src/data/schema.ts';
import { createBoundary } from '../../../src/geo/boundary.ts';
import { collectBuildings } from '../../../scripts/lib/build-buildings.ts';
import type { BuildingRecord } from '../../../scripts/lib/build-buildings.ts';
import {
  buildingConflicts,
  buildingFlags,
  classifyBuildings,
  footprintPairs,
  resolveDuplicates,
} from '../../../scripts/lib/membership.ts';
import type { Tags } from '../../../scripts/lib/osm-parse.ts';
import { syntheticOsm } from './osm-builder.ts';

/** Normalised [0, 1] → lon/lat over a ~950 m × 1.1 km box. */
const P = (x: number, y: number): LngLat => [75.7 + 0.01 * x, 31.25 + 0.01 * y];
const ring = (pts: Array<[number, number]>) => [...pts.map(([x, y]) => P(x, y)), P(pts[0]![0], pts[0]![1])];

/** Boundary with a notch cut into its east side (concave). */
const boundary = createBoundary({
  type: 'Polygon',
  coordinates: [
    ring([
      [0, 0],
      [1, 0],
      [1, 0.38],
      [0.58, 0.38],
      [0.58, 0.62],
      [1, 0.62],
      [1, 1],
      [0, 1],
    ]),
  ],
});

/** Builds BuildingRecords through the real collector from (id, normalised ring, tags). */
function records(specs: Array<[number, Array<[number, number]>, Tags?]>): BuildingRecord[] {
  const nodes: Record<number, [number, number]> = {};
  const ways: Array<[number, number[], Tags]> = [];
  let n = 1;
  for (const [id, pts, tags] of specs) {
    const ids = pts.map(([x, y]) => {
      nodes[n] = P(x, y);
      return n++;
    });
    ways.push([id, [...ids, ids[0]!], { building: 'yes', ...tags }]);
  }
  return collectBuildings(syntheticOsm({ nodes, ways })).buildings;
}

const square = (x: number, y: number, d: number): Array<[number, number]> => [
  [x, y],
  [x + d, y],
  [x + d, y + d],
  [x, y + d],
];

const byId = (list: ReturnType<typeof classifyBuildings>) =>
  new Map(list.map((c) => [c.record.id, c.membership]));

describe('campus membership (owner acceptance cases)', () => {
  const recs = records([
    [1, square(0.1, 0.1, 0.05)], // valid interior
    [2, square(1.2, 0.1, 0.05)], // confirmed exterior
    [3, square(0.97, 0.8, 0.05)], // crossing the east edge, 60 % inside
    [4, square(0.97, 0.8, 0.05), { operator: 'Private Owner Pvt Ltd' }], // crossing with conflicting evidence
    [5, square(0.98, 0.8, 0.05)], // crossing with only 40 % inside
    [
      6, // U shape around the notch: fully inside, but its area centroid lies in the notch (outside)
      [
        [0.5, 0.3],
        [0.9, 0.3],
        [0.9, 0.37],
        [0.57, 0.37],
        [0.57, 0.63],
        [0.9, 0.63],
        [0.9, 0.7],
        [0.5, 0.7],
      ],
    ],
    [7, square(0.2, 0.9, 0.05)], // inside, next to a review section
    [
      8, // bow-tie: invalid polygon
      [
        [0.3, 0.3],
        [0.35, 0.35],
        [0.35, 0.3],
        [0.3, 0.35],
      ],
    ],
  ]);
  const section: BoundaryReviewSection = {
    id: 'synthetic-north',
    title: 'Synthetic north edge',
    status: 'open',
    reason: 'test',
    evidence: ['synthetic'],
    bufferM: 15,
    geometry: { type: 'LineString', coordinates: [P(0, 0.96), P(0.4, 0.96)] },
  };

  it('classifies interior, exterior and crossing footprints by exact area fraction', () => {
    const m = byId(classifyBuildings(recs, boundary, [], []));
    expect(m.get('osm:way/1')).toMatchObject({
      status: 'inside',
      reasonCode: 'interior',
      inCampusInventory: true,
    });
    expect(m.get('osm:way/2')).toMatchObject({
      status: 'outside',
      reasonCode: 'exterior',
      inCampusInventory: false,
    });
    expect(m.get('osm:way/3')).toMatchObject({
      status: 'crossing',
      reasonCode: 'crossing-majority',
      inCampusInventory: true,
    });
    expect(m.get('osm:way/3')!.insideFraction).toBeCloseTo(0.6, 2);
    expect(m.get('osm:way/5')).toMatchObject({
      status: 'uncertain',
      reasonCode: 'crossing-minority',
      inCampusInventory: false,
    });
  });

  it('treats area fraction as evidence: conflicting tags hold a majority-inside crossing for review', () => {
    expect(buildingConflicts({ operator: 'Private Owner Pvt Ltd' })).toEqual([
      'operator=Private Owner Pvt Ltd',
    ]);
    expect(buildingConflicts({ operator: 'Lovely Group' })).toEqual([]);
    expect(buildingConflicts({ tourism: 'apartment' })).toEqual([
      'tourism=apartment (private accommodation)',
    ]);
    const m = byId(classifyBuildings(recs, boundary, [], []));
    expect(m.get('osm:way/4')).toMatchObject({ status: 'uncertain', reasonCode: 'crossing-conflict' });
    expect(m.get('osm:way/4')!.reason).toMatch(/operator=Private Owner Pvt Ltd/);
  });

  it('keeps an invalid polygon as an uncertain review item, never dropped', () => {
    const bowtie = recs.find((r) => r.id === 'osm:way/8')!;
    expect(bowtie.problems.length).toBeGreaterThan(0);
    const m = byId(classifyBuildings(recs, boundary, [], []));
    expect(m.get('osm:way/8')).toMatchObject({
      status: 'uncertain',
      reasonCode: 'invalid-geometry',
      insideFraction: null,
      method: 'none',
    });
  });

  it('holds footprints near an open boundary-review section out of the inventory; a resolved section does not', () => {
    const open = byId(classifyBuildings(recs, boundary, [section], []));
    expect(open.get('osm:way/7')).toMatchObject({
      status: 'uncertain',
      reasonCode: 'review-section',
      reviewSectionId: 'synthetic-north',
      inCampusInventory: false,
    });
    expect(open.get('osm:way/1')!.status).toBe('inside'); // far from the section
    const resolved = byId(
      classifyBuildings(recs, boundary, [{ ...section, status: 'resolved', resolution: 'OSM fixed' }], []),
    );
    expect(resolved.get('osm:way/7')!.status).toBe('inside');
  });

  it('records a centroid-vs-area disagreement without changing the area-based status', () => {
    const m = byId(classifyBuildings(recs, boundary, [], []));
    const u = m.get('osm:way/6')!;
    expect(u.insideFraction).toBe(1);
    expect(u.status).toBe('inside');
    expect(u.centroidInside).toBe(false);
    expect(u.pointOnSurfaceInside).toBe(true);
    expect(u.pointAreaDisagreement).toBe(true);
    expect(u.reason).toMatch(/area centroid test says outside/);
  });

  it('applies a dated curated decision over the automatic rules', () => {
    const decision: CuratedMembershipDecision = {
      featureId: 'osm:way/2',
      status: 'inside',
      decidedAt: '2026-10-24',
      source: { kind: 'owner-confirmation', ref: 'synthetic test' },
    };
    const m = byId(classifyBuildings(recs, boundary, [section], [decision]));
    expect(m.get('osm:way/2')).toMatchObject({
      status: 'inside',
      method: 'curated-decision',
      decision: 'curated',
      inCampusInventory: true,
    });
    expect(m.get('osm:way/2')!.decisionSource).toMatch(/owner-confirmation: synthetic test \(2026-10-24\)/);
  });
});

describe('duplicates, overlaps and flags', () => {
  const recs = records([
    [10, square(0.1, 0.1, 0.02)],
    [9, square(0.1, 0.1, 0.02), { education: 'educational_institution' }], // exact duplicate with the lower id
    [11, square(0.3, 0.3, 0.04), { 'building:levels': '0.2' }],
    [12, square(0.31, 0.31, 0.01), { 'building:levels': '3', layer: '3' }], // contained in 11
    [13, square(0.33, 0.3, 0.04), { 'building:levels': '4', 'building:min_level': '3.75' }], // overlaps 11
  ]);

  it('resolves exact duplicates deterministically (lower OSM id kept) and never merges tags', () => {
    const pairs = footprintPairs(recs);
    const dup = pairs.filter((p) => p.kind === 'duplicate');
    expect(dup).toHaveLength(1);
    expect(resolveDuplicates(pairs)).toEqual([
      expect.objectContaining({ kept: 'osm:way/9', dropped: 'osm:way/10', iou: 1 }),
    ]);
    expect(resolveDuplicates([...pairs].reverse())).toEqual(resolveDuplicates(pairs));
  });

  it('reports contained parts and overlaps without changing geometry', () => {
    const pairs = footprintPairs(recs);
    expect(pairs.find((p) => p.a === 'osm:way/11' && p.b === 'osm:way/12')).toMatchObject({
      kind: 'contained',
    });
    expect(pairs.find((p) => p.a === 'osm:way/11' && p.b === 'osm:way/13')).toMatchObject({
      kind: 'overlap',
    });
  });

  it('flags suspicious levels and elevated structures, rendering the suspicious one with the placeholder', () => {
    const flags = buildingFlags(recs);
    expect(flags.find((f) => f.id === 'osm:way/11')).toMatchObject({ code: 'suspicious-levels' });
    expect(flags.find((f) => f.id === 'osm:way/13' && f.code === 'elevated-structure')!.message).toMatch(
      /building:min_level=3.75/,
    );
    const r11 = recs.find((r) => r.id === 'osm:way/11')!;
    expect(r11.height).toMatchObject({
      levels: 0.2,
      levelsSuspicious: true,
      heightSource: 'fallback',
      heightM: 6,
    });
    expect(r11.displayName).toBe('Unnamed building');
  });
});
