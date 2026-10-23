// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';
import { haversineM } from '../../../src/distance/geodesic.ts';
import { buildBoundary, BuildError } from '../../../scripts/lib/build-boundary.ts';
import { collectBuildings, toGeometry } from '../../../scripts/lib/build-buildings.ts';
import { buildGraph } from '../../../scripts/lib/build-graph.ts';
import { collectPlaces } from '../../../scripts/lib/build-places.ts';
import type { PlaceRecord } from '../../../scripts/lib/build-places.ts';
import { buildRelations, NEARBY_LIMIT, NEARBY_RADIUS_M } from '../../../scripts/lib/build-relations.ts';
import { attachConnectors } from '../../../scripts/lib/connectors.ts';
import { classifyBuildings } from '../../../scripts/lib/membership.ts';
import { parseOsm } from '../../../scripts/lib/osm-parse.ts';
import { createBoundary } from '../../../src/geo/boundary.ts';
import type { LngLat } from '../../../src/data/schema.ts';
import { ring, squareNodes, syntheticOsm } from './osm-builder.ts';

const FIXTURE = new URL('../../fixtures/osm/synthetic-campus/synthetic-campus.osm', import.meta.url);
const RELATION = 900001;
const maxBounds = APP_CONFIG.map.maxBounds;
const retrievedAt = '2026-01-01T00:00:00Z';

/** Mirrors scripts/lib/pipeline.ts: v2 membership decides which footprints are campus buildings. */
function pipeline() {
  const osm = parseOsm(readFileSync(FIXTURE, 'utf8'));
  const boundary = buildBoundary(osm, RELATION);
  const geo = createBoundary(toGeometry(boundary.multiPolygon));
  const b = collectBuildings(osm);
  const classified = classifyBuildings(b.buildings, geo, [], []);
  const status = new Map(classified.map((c) => [c.record.id, c.membership]));
  const inventory = classified.filter((c) => c.membership.inCampusInventory).map((c) => c.record);
  const outside = classified.filter((c) => c.membership.status === 'outside').map((c) => c.record);
  const graph = buildGraph(osm, maxBounds);
  const records = collectPlaces(osm, {
    boundary,
    buildings: inventory,
    outsideBuildings: outside,
    maxBounds,
    retrievedAt,
  });
  const unconnected = attachConnectors(records, graph.graph, APP_CONFIG.routing.maxPlaceConnectorM);
  const rel = buildRelations(
    records.filter((r) => r.place.campusZone === 'on-campus'),
    { campusPlaceId: `osm:relation/${RELATION}`, buildings: inventory, retrievedAt },
  );
  const byId = new Map(records.map((r) => [r.place.id, r.place]));
  return { osm, boundary, b, status, graph, records, unconnected, rel, byId };
}

const squareRing = (lon: number, lat: number, d: number): LngLat[][] => [
  [
    [lon, lat],
    [lon + d, lat],
    [lon + d, lat + d],
    [lon, lat + d],
    [lon, lat],
  ],
];

const get = (byId: Map<string, PlaceRecord['place']>, id: string) => {
  const p = byId.get(id);
  if (!p) throw new Error(`missing ${id}`);
  return p;
};

describe('boundary', () => {
  it('assembles the multipolygon from split outer ways', () => {
    const { boundary } = pipeline();
    expect(boundary.multiPolygon).toHaveLength(1);
    expect(boundary.bbox).toEqual([75.688, 31.238, 75.692, 31.242]);
    expect(boundary.contains([75.69, 31.24])).toBe(true);
    expect(boundary.contains([75.693, 31.24])).toBe(false);
  });

  it('fails loudly when the relation is missing or cannot be closed — never guesses', () => {
    const osm = syntheticOsm({
      nodes: squareNodes(1, 75.7, 31.25),
      ways: [[10, [1, 2, 3]]],
      relations: [[5, [['way', 10, 'outer']], { type: 'multipolygon' }]],
    });
    expect(() => buildBoundary(osm, 6)).toThrow(BuildError);
    expect(() => buildBoundary(osm, 6)).toThrow(/never substitutes a guessed rectangle/);
    expect(() => buildBoundary(osm, 5)).toThrow(/could not be assembled/);
  });
});

describe('buildings', () => {
  it('includes closed ways and multipolygon relations with holes', () => {
    const { b } = pipeline();
    expect(b.buildings.map((x) => x.id)).toEqual([
      'osm:way/200',
      'osm:way/201',
      'osm:way/202',
      'osm:way/205',
      'osm:relation/900002',
    ]);
    const mp = b.buildings.find((x) => x.id === 'osm:relation/900002')!;
    expect(mp.multiPolygon[0]).toHaveLength(2); // outer + inner
    expect(mp.height).toMatchObject({ levels: 3, heightSource: 'osm-levels-estimate' });
    expect(mp.displayName).toBe('Unnamed building · 3 floors');
  });

  it('derives height, category and campus membership', () => {
    const { b, status, byId: places } = pipeline();
    const byId = new Map(b.buildings.map((x) => [x.id, x]));
    expect(byId.get('osm:way/200')).toMatchObject({ categoryId: 'library', name: 'Synthetic Library Block' });
    expect(status.get('osm:way/200')).toMatchObject({ status: 'inside', inCampusInventory: true });
    expect(byId.get('osm:way/201')!.height).toMatchObject({
      heightM: 12,
      minHeightM: 3,
      heightSource: 'osm-height',
    });
    expect(byId.get('osm:way/202')!.height.heightSource).toBe('fallback');
    expect(byId.get('osm:way/202')!.displayName).toBe('Unnamed building');
    // v2 (owner decision 2): the off-campus cafe footprint is classified outside and never shipped as a
    // building; being named, it survives only as a point-only context place without a footprint reference.
    // (v1 expected a building record with campusZone 'off-campus-nearby'.)
    expect(byId.get('osm:way/205')).toMatchObject({ categoryId: 'food' });
    expect(status.get('osm:way/205')).toMatchObject({ status: 'outside', inCampusInventory: false });
    const cafe = get(places, 'osm:way/205');
    expect(cafe).toMatchObject({ kind: 'facility', campusZone: 'off-campus-nearby', categoryId: 'food' });
    expect(cafe.buildingId).toBeUndefined();
    expect(cafe.description).toMatch(/shown as a point only/);
  });

  it('keeps an invalid footprint for review (rule R1) and skips only elements without geometry', () => {
    const osm = syntheticOsm({
      nodes: { ...squareNodes(1, 75.7, 31.25), ...squareNodes(10, 75.71, 31.25) },
      ways: [
        [100, [1, 3, 2, 4, 1], { building: 'yes' }],
        [101, [10, 11, 12], { building: 'yes' }],
        [102, ring(10), { building: 'yes' }],
      ],
    });
    const r = collectBuildings(osm);
    // v2: a bow-tie is no longer silently skipped; it is kept with its problems and classified 'uncertain'.
    expect(r.buildings.map((x) => x.id)).toEqual(['osm:way/100', 'osm:way/102']);
    const bowtie = r.buildings[0]!;
    expect(bowtie.problems.join(' ')).toMatch(/self-intersection|spike/);
    expect(bowtie.areaM2).toBeNull();
    expect(r.skipped).toEqual([{ ref: 'way/101', reason: 'building way is not closed' }]);
    const geo = createBoundary({ type: 'Polygon', coordinates: squareRing(75.69, 31.24, 0.05) });
    const [m] = classifyBuildings([bowtie], geo, [], []);
    expect(m!.membership).toMatchObject({
      status: 'uncertain',
      reasonCode: 'invalid-geometry',
      inCampusInventory: false,
    });
  });
});

describe('places', () => {
  it('makes every footprint a building place and keeps unnamed features unnamed', () => {
    const { byId } = pipeline();
    expect(get(byId, 'osm:way/202')).toMatchObject({
      kind: 'building',
      name: null,
      displayName: 'Unnamed building',
    });
    expect(get(byId, 'osm:node/40')).toMatchObject({
      name: null,
      displayName: 'Unnamed place · Washroom',
      categoryId: 'washroom',
    });
    expect(get(byId, 'osm:way/207')).toMatchObject({
      kind: 'area',
      categoryId: 'park',
      displayName: 'Unnamed area · Park & green space',
    });
  });

  it('creates the campus area place from the boundary relation', () => {
    const { byId } = pipeline();
    expect(get(byId, `osm:relation/${RELATION}`)).toMatchObject({
      kind: 'area',
      categoryId: 'university',
      campusZone: 'on-campus',
      aliases: ['STU'],
      contact: { phone: '+00 0000 000000' }, // ftp website dropped
    });
  });

  it('classifies a barrier gate as a gate and a gate-named neighbourhood honestly', () => {
    const { byId } = pipeline();
    expect(get(byId, 'osm:node/43')).toMatchObject({ kind: 'gate', categoryId: 'gate' });
    expect(get(byId, 'osm:node/43').description).toMatch(/barrier=gate.*Access is tagged "permissive"/);
    const hill = get(byId, 'osm:way/206');
    expect(hill).toMatchObject({ kind: 'area', categoryId: 'other', campusZone: 'off-campus-nearby' });
    expect(hill.description).toMatch(/landuse=residential, not as a gate.*not a campus entrance/);
  });

  it('says an off-campus gate structure is not linked to a campus entrance', () => {
    const { byId } = pipeline();
    expect(get(byId, 'osm:node/43').description).not.toMatch(/outside the campus boundary/);
    const osm = syntheticOsm({
      nodes: {
        ...squareNodes(1, 75.7, 31.25),
        8: [75.71, 31.26, { man_made: 'ceremonial_gate', name: 'Colony main gate' }],
      },
      ways: [[10, ring(1)]],
      relations: [[5, [['way', 10, 'outer']], { type: 'multipolygon', amenity: 'university', name: 'U' }]],
    });
    const boundary = buildBoundary(osm, 5);
    const records = collectPlaces(osm, { boundary, buildings: [], maxBounds, retrievedAt });
    const gate = records.find((r) => r.place.id === 'osm:node/8')!.place;
    expect(gate).toMatchObject({ kind: 'gate', campusZone: 'off-campus-nearby', name: 'Colony main gate' });
    expect(gate.description).toMatch(/ceremonial gate structure.*not as a barrier or entrance/);
    expect(gate.description).toMatch(
      /outside the campus boundary.*nothing in the data links it to a campus entrance/,
    );
  });

  it('keeps raw hours, wheelchair tags, aliases and drops unsafe websites', () => {
    const { byId } = pipeline();
    expect(get(byId, 'osm:way/200')).toMatchObject({
      openingHours: 'Mo-Fr 09:00-17:00',
      aliases: ['Library Block', 'SLB Old'],
      levels: 4,
      provenance: { sourceId: 'osm', sourceRef: 'way/200', retrievedAt, verificationStatus: 'imported' },
    });
    expect(get(byId, 'osm:node/41').wheelchair).toBe('yes');
    expect(get(byId, 'osm:node/42')).toMatchObject({ openingHours: '24/7' });
    expect(get(byId, 'osm:node/42').contact).toBeUndefined();
  });
});

describe('connectors', () => {
  it('measures buildings from the outline and leaves far places unconnected', () => {
    const { byId, unconnected, graph } = pipeline();
    const lib = get(byId, 'osm:way/200');
    expect(lib.connectorLengthM).toBe(0); // the footway ends on the entrance vertex
    expect(graph.osmNodeIds[lib.graphNodeId!]).toBe(11);
    expect(get(byId, 'osm:way/202').graphNodeId).toBeUndefined();
    expect(unconnected).toContain('osm:way/202');
    for (const p of byId.values()) {
      if (p.connectorLengthM !== undefined)
        expect(p.connectorLengthM).toBeLessThanOrEqual(APP_CONFIG.routing.maxPlaceConnectorM);
    }
  });

  it('connects only to foot-accessible nodes', () => {
    const { byId, graph } = pipeline();
    const footNodes = new Set(graph.graph.edges.filter((e) => e.foot).flatMap((e) => [e.from, e.to]));
    for (const p of byId.values())
      if (p.graphNodeId !== undefined) expect(footNodes.has(p.graphNodeId)).toBe(true);
  });
});

describe('relations', () => {
  it('derives located_in, accessed_via and part_of from geometry', () => {
    const { rel, byId } = pipeline();
    const ids = rel.relations.map((r) => r.id);
    expect(ids).toContain('located_in:osm:node/40->osm:way/200');
    expect(ids).toContain('located_in:osm:node/42->osm:way/201');
    expect(ids).toContain('accessed_via:osm:way/200->osm:node/11');
    expect(get(byId, 'osm:node/11')).toMatchObject({
      kind: 'entrance',
      buildingId: 'osm:way/200',
      displayName: 'Main entrance · Synthetic Library Block',
    });
    expect(rel.attachedEntrances).toEqual(['osm:node/11']);
    expect(ids).toContain(`part_of:osm:way/200->osm:relation/${RELATION}`);
    expect(ids.some((i) => i.startsWith('part_of:osm:way/205'))).toBe(false); // off campus
    expect(ids.some((i) => i.startsWith(`part_of:osm:relation/${RELATION}`))).toBe(false);
  });

  it('limits nearby to essential categories within the radius and marks it as distance-only', () => {
    const { rel, byId } = pipeline();
    const nearby = rel.relations.filter((r) => r.type === 'nearby');
    expect(nearby.length).toBeGreaterThan(0);
    const counts = new Map<string, number>();
    for (const r of nearby) {
      counts.set(r.from, (counts.get(r.from) ?? 0) + 1);
      expect(r).toMatchObject({ method: 'distance', inferred: true });
      expect(r.provenance.notes).toMatch(/does not imply a path/);
      const from = get(byId, r.from);
      const to = get(byId, r.to);
      expect(from.name).not.toBeNull();
      expect(['food', 'water', 'washroom', 'finance', 'health', 'printing']).toContain(to.categoryId);
      expect(r.distanceM!).toBeCloseTo(haversineM(from.location!, to.location!), 0);
      expect(r.distanceM!).toBeLessThanOrEqual(NEARBY_RADIUS_M);
      expect(to.buildingId === from.id).toBe(false);
    }
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(NEARBY_LIMIT);
  });

  it('reports entrances that are not on any building outline', () => {
    const osm = syntheticOsm({
      nodes: { ...squareNodes(1, 75.7, 31.25), 9: [75.705, 31.255, { entrance: 'yes' }] },
      ways: [
        [10, ring(1)],
        [11, ring(1), { building: 'yes' }],
      ],
      relations: [[5, [['way', 10, 'outer']], { type: 'multipolygon', amenity: 'university', name: 'U' }]],
    });
    const boundary = buildBoundary(osm, 5);
    const b = collectBuildings(osm);
    const records = collectPlaces(osm, { boundary, buildings: b.buildings, maxBounds, retrievedAt });
    const rel = buildRelations(records, {
      campusPlaceId: 'osm:relation/5',
      buildings: b.buildings,
      retrievedAt,
    });
    expect(rel.unattachedEntrances).toEqual(['osm:node/9']);
    expect(rel.relations.some((r) => r.type === 'accessed_via')).toBe(false);
  });
});
