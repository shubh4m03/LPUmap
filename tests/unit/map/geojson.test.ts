import type { Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import type { LngLat, Relation } from '../../../src/data/schema.ts';
import { haversineM } from '../../../src/distance/geodesic.ts';
import {
  accuracyCircle,
  anchoredOrganizations,
  poiCollection,
  routeCollection,
  routeCoordinateCount,
  userLocationCollection,
} from '../../../src/map/index.ts';
import { syntheticCampusData } from './synthetic-campus-data.ts';

const CENTER: LngLat = [75.7032, 31.2533];

describe('poiCollection', () => {
  const data = syntheticCampusData();
  const footprints = new Set(data.buildings.features.map((f) => f.properties.id));
  const pois = poiCollection(data.places, footprints);
  const byId = new Map(pois.features.map((f) => [f.properties.id, f]));

  it('includes located campus places, skipping footprint buildings and places without a position', () => {
    expect([...byId.keys()].sort()).toEqual(['osm:node/30', 'osm:node/31', 'osm:node/33']);
    expect(byId.has('osm:way/10')).toBe(false);
    expect(byId.has('cur:test-office')).toBe(false);
  });

  it('never draws an off-campus place unless the "Nearby, outside campus" layer is on (owner decision 2)', () => {
    // Regression: off-campus places (e.g. merged owner locations outside the boundary) were drawn always.
    expect(byId.has('osm:node/32')).toBe(false);
    expect(
      poiCollection(data.places, footprints, new Set(), { includeOffCampus: false }).features,
    ).toHaveLength(3);
    const withLayer = poiCollection(data.places, footprints, new Set(), { includeOffCampus: true });
    const lodge = withLayer.features.find((f) => f.properties.id === 'osm:node/32');
    expect(lodge?.properties).toMatchObject({ offCampus: true, badge: 'Outside campus' });
    expect(withLayer.features.filter((f) => f.properties.badge !== undefined)).toHaveLength(1);
  });

  it('labels only source names — unnamed places get no invented label', () => {
    expect(byId.get('osm:node/30')?.properties.name).toBe('Test Cafe');
    expect(byId.get('osm:node/31')?.properties).not.toHaveProperty('name');
  });

  it('maps category to layer group and colour, falling back to "other" for unknown categories', () => {
    expect(byId.get('osm:node/30')?.properties).toMatchObject({ group: 'food', color: '#dc2626' });
    expect(byId.get('osm:node/31')?.properties.group).toBe('finance');
    expect(byId.get('osm:node/33')?.properties).toMatchObject({ group: 'services', color: '#64748b' });
  });

  it('flags campus places as on campus and uses the place id as the feature id', () => {
    expect(byId.get('osm:node/30')?.properties.offCampus).toBe(false);
    expect(byId.get('osm:node/30')?.properties).not.toHaveProperty('badge');
    expect(byId.get('osm:node/30')?.id).toBe('osm:node/30');
  });

  it('gives an organisation located in another place no marker or label of its own', () => {
    const host = { ...data.places.find((p) => p.id === 'osm:node/30')! };
    const org = {
      ...host,
      id: 'cur:school-of-design',
      kind: 'organization' as const,
      name: host.name,
      displayName: host.displayName,
    };
    const loose = { ...org, id: 'cur:unanchored' };
    const rel = (id: string, from: string, to: string): Relation => ({
      id,
      type: 'located_in',
      from,
      to,
      inferred: false,
      method: 'curated',
      provenance: host.provenance,
    });
    const relations = [
      rel('r1', org.id, host.id),
      // Not an organisation: a facility in a building keeps its marker.
      rel('r2', host.id, 'osm:way/10'),
      // Host missing from the dataset: the organisation is not hidden.
      rel('r3', loose.id, 'osm:way/404'),
    ];
    const places = [host, org, loose];
    const anchored = anchoredOrganizations(places, relations);
    expect([...anchored]).toEqual([[org.id, host.id]]);
    const ids = poiCollection(places, new Set(), anchored).features.map((f) => f.properties.id);
    expect(ids).toEqual([host.id, loose.id]);
    // Exactly one label with that name is drawn at the shared position.
    const labelled = poiCollection(places, new Set(), anchored).features.filter(
      (f) => f.properties.name === host.name && f.properties.id !== loose.id,
    );
    expect(labelled).toHaveLength(1);
  });

  it('drops places whose coordinates are out of range', () => {
    const bad = { ...data.places[1]!, id: 'bad', location: [200, 95] as LngLat };
    expect(poiCollection([bad], new Set()).features).toHaveLength(0);
  });
});

describe('routeCollection', () => {
  const main: LngLat[] = [
    [75.7, 31.25],
    [75.701, 31.25],
    [75.702, 31.251],
  ];

  it('is empty for no route', () => {
    expect(routeCollection(null).features).toEqual([]);
    expect(routeCoordinateCount(null)).toBe(0);
  });

  it('orders alternatives, completed and remaining so the remaining route draws on top', () => {
    const fc = routeCollection({
      coordinates: main,
      completed: [main[0]!, main[1]!],
      alternatives: [
        [
          [75.7, 31.25],
          [75.7, 31.252],
        ],
      ],
    });
    expect(fc.features.map((f) => f.properties.role)).toEqual(['alternative', 'completed', 'remaining']);
    expect(fc.features[2]?.geometry.coordinates).toEqual(main);
    expect(routeCoordinateCount({ coordinates: main })).toBe(3);
  });

  it('drops invalid vertices and lines too short to draw', () => {
    const fc = routeCollection({
      coordinates: [[75.7, 31.25], [NaN, 31.25] as LngLat, [75.701, 31.25]],
      completed: [[75.7, 31.25]],
      alternatives: [[]],
    });
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]?.geometry.coordinates).toHaveLength(2);
  });
});

describe('accuracyCircle', () => {
  it.each([5, 20, 75, 400])('every vertex lies %d m from the centre within 1 %%', (radius) => {
    const ring = accuracyCircle(CENTER, radius).coordinates[0]!;
    expect(ring.length).toBe(65);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const v of ring) {
      const d = haversineM(CENTER, v as LngLat);
      expect(Math.abs(d - radius) / radius).toBeLessThan(0.01);
    }
  });

  it('is a true-to-scale circle, not a pixel radius: east-west degrees are wider than north-south', () => {
    const ring = accuracyCircle(CENTER, 100, 4).coordinates[0]!;
    const north = ring[0]!;
    const east = ring[1]!;
    const dLat = north[1]! - CENTER[1];
    const dLon = east[0]! - CENTER[0];
    expect(dLon / dLat).toBeCloseTo(1 / Math.cos((CENTER[1] * Math.PI) / 180), 2);
  });
});

describe('userLocationCollection', () => {
  it('is empty without a valid location', () => {
    expect(userLocationCollection(null).features).toEqual([]);
    expect(
      userLocationCollection({ lngLat: [999, 0] as LngLat, accuracyM: 5, stale: false }).features,
    ).toEqual([]);
  });

  it('emits an accuracy polygon in metres plus the position point, carrying staleness', () => {
    const fc = userLocationCollection({ lngLat: CENTER, accuracyM: 30, stale: true });
    expect(fc.features.map((f) => f.properties.role)).toEqual(['accuracy', 'position']);
    expect(fc.features.every((f) => f.properties.stale)).toBe(true);
    const ring = (fc.features[0]!.geometry as Polygon).coordinates[0]!;
    expect(haversineM(CENTER, ring[7] as LngLat)).toBeCloseTo(30, 0);
  });

  it('omits the accuracy circle when accuracy is unknown or non-positive', () => {
    for (const accuracyM of [0, -3, NaN, Infinity]) {
      const fc = userLocationCollection({ lngLat: CENTER, accuracyM, stale: false });
      expect(fc.features.map((f) => f.properties.role)).toEqual(['position']);
    }
  });
});
