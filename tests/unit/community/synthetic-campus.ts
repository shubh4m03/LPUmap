/**
 * Tiny synthetic campus for community-module tests (pure data, DOM-free).
 * All coordinates lie inside APP_CONFIG.map.maxBounds.
 *
 * Graph:  0 ──foot── 1 ──foot── 2 ──road(no foot)── 3      4 (isolated)
 * footNodes = {0, 1, 2}; node 3 only touches a non-walkable edge; node 4 has no edges.
 */
import type { CampusData } from '../../../src/data/campus-data.ts';
import type {
  BoundaryFile,
  BuildingsFile,
  GraphEdge,
  GraphFile,
  LngLat,
  Manifest,
  Place,
  Relation,
} from '../../../src/data/schema.ts';

export const NODES: LngLat[] = [
  [75.7, 31.25],
  [75.7005, 31.25],
  [75.701, 31.25],
  [75.702, 31.25],
  [75.71, 31.26],
];

const edge = (id: number, from: number, to: number, foot: boolean): GraphEdge => ({
  id,
  from,
  to,
  lengthM: 47.5,
  highway: foot ? 'footway' : 'primary',
  foot,
  bicycle: 'ride',
  steps: false,
  wheelchair: 'unknown',
  onewayBicycle: false,
  onewayFoot: false,
  indoor: false,
  surface: null,
  name: null,
  source: 'osm',
  osmWayId: 1000 + id,
});

export const GRAPH: GraphFile = {
  schemaVersion: 1,
  nodes: NODES,
  edges: [edge(0, 0, 1, true), edge(1, 1, 2, true), edge(2, 2, 3, false)],
};

/** Square campus boundary around the graph (node 4 is outside it). */
export const BOUNDARY: BoundaryFile = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [75.695, 31.245],
            [75.706, 31.245],
            [75.706, 31.255],
            [75.695, 31.255],
            [75.695, 31.245],
          ],
        ],
      },
      properties: { id: 'osm:relation/1', name: 'Test campus', sourceRef: 'relation/1' },
    },
  ],
};

const prov = (ref: string) => ({ sourceId: 'osm', sourceRef: ref, verificationStatus: 'imported' as const });

export const BLOCK_34: Place = {
  id: 'osm:way/100',
  name: 'Block 34',
  displayName: 'Block 34',
  aliases: ['B34'],
  categoryId: 'academic',
  kind: 'building',
  location: [75.7001, 31.2501],
  buildingId: 'osm:way/100',
  campusZone: 'on-campus',
  wheelchair: 'unknown',
  graphNodeId: 0,
  connectorLengthM: 14.7,
  provenance: prov('way/100'),
};

export const LIBRARY: Place = {
  id: 'osm:node/200',
  name: 'Main Library',
  displayName: 'Main Library',
  aliases: [],
  categoryId: 'library',
  kind: 'facility',
  location: [75.7006, 31.2502],
  buildingId: 'osm:way/100',
  campusZone: 'on-campus',
  openingHours: 'Mo-Sa 09:00-20:00',
  wheelchair: 'yes',
  graphNodeId: 1,
  connectorLengthM: 23.5,
  provenance: prov('node/200'),
};

export const FOOD_COURT: Place = {
  id: 'cur:food-court',
  name: 'Food Court',
  displayName: 'Food Court',
  aliases: [],
  categoryId: 'food',
  kind: 'facility',
  location: [75.7011, 31.2503],
  campusZone: 'on-campus',
  wheelchair: 'unknown',
  provenance: { sourceId: 'curated:test', verificationStatus: 'verified', lastVerifiedAt: '2026-01-01' },
};

export const UNNAMED: Place = {
  id: 'osm:way/300',
  name: null,
  displayName: 'Unnamed building',
  aliases: [],
  categoryId: 'building',
  kind: 'building',
  location: [75.703, 31.251],
  buildingId: 'osm:way/300',
  campusZone: 'on-campus',
  wheelchair: 'unknown',
  provenance: prov('way/300'),
};

export const PLACES: Place[] = [BLOCK_34, LIBRARY, FOOD_COURT, UNNAMED];

const footprint = (p: Place, ring: LngLat[]): BuildingsFile['features'][number] => ({
  type: 'Feature',
  id: p.id,
  geometry: { type: 'Polygon', coordinates: [ring] },
  properties: {
    id: p.id,
    name: p.name,
    displayName: p.displayName,
    levels: null,
    heightM: 6,
    minHeightM: 0,
    heightSource: 'fallback',
    categoryId: p.categoryId,
    campusZone: p.campusZone,
  },
});

export const BUILDINGS: BuildingsFile = {
  type: 'FeatureCollection',
  features: [
    footprint(BLOCK_34, [
      [75.6999, 31.2499],
      [75.7008, 31.2499],
      [75.7008, 31.2504],
      [75.6999, 31.2504],
      [75.6999, 31.2499],
    ]),
    footprint(UNNAMED, [
      [75.7029, 31.2509],
      [75.7031, 31.2509],
      [75.7031, 31.2511],
      [75.7029, 31.2511],
      [75.7029, 31.2509],
    ]),
  ],
};

const rel = (id: string, type: Relation['type'], from: string, to: string): Relation => ({
  id,
  type,
  from,
  to,
  inferred: true,
  method: 'osm-containment',
  provenance: prov(id),
});

export const RELATIONS: Relation[] = [
  rel('r1', 'located_in', LIBRARY.id, BLOCK_34.id),
  rel('r2', 'nearby', FOOD_COURT.id, LIBRARY.id),
  rel('r3', 'nearby', FOOD_COURT.id, UNNAMED.id),
];

export const DATASET_VERSION = 'synthetic-v1';

export function syntheticCampus(overrides: Partial<CampusData> = {}): CampusData {
  const manifest: Manifest = {
    schemaVersion: 1,
    datasetVersion: DATASET_VERSION,
    builtFrom: '2026-01-01T00:00:00Z',
    sources: [{ id: 'osm', name: 'OpenStreetMap' }],
    files: {},
    counts: { places: PLACES.length, 'graph:nodes': NODES.length },
    bbox: [75.695, 31.245, 75.706, 31.255],
  };
  return {
    manifest,
    boundary: BOUNDARY,
    buildings: BUILDINGS,
    basemap: { type: 'FeatureCollection', features: [] },
    places: PLACES,
    relations: RELATIONS,
    graph: GRAPH,
    ...overrides,
  };
}
