/** Invented (synthetic) campus data for app-shell tests. Not real LPU records. */
import { DATA_SCHEMA_VERSION, type CampusData, type GraphEdge, type Place } from '../../../src/data/index.ts';

const prov = (over: Partial<Place['provenance']> = {}): Place['provenance'] => ({
  sourceId: 'osm',
  sourceRef: 'node/1',
  retrievedAt: new Date().toISOString(),
  verificationStatus: 'imported',
  ...over,
});

function place(
  p: Partial<Place> & Pick<Place, 'id' | 'name' | 'displayName' | 'categoryId' | 'kind'>,
): Place {
  return {
    aliases: [],
    location: [75.7, 31.25],
    campusZone: 'on-campus',
    wheelchair: 'unknown',
    provenance: prov({ sourceRef: p.id.replace(/^osm:/, '') }),
    ...p,
  };
}

export const NAMED = place({
  id: 'osm:node/1',
  name: 'Synthetic Food Point',
  displayName: 'Synthetic Food Point',
  categoryId: 'food',
  kind: 'facility',
  // v2: campus places only in the campus data (it is located_in the on-campus UNNAMED building). The
  // off-campus label is exercised through withOffCampusNamed() below.
  openingHours: 'Mo-Su 00:00-24:00',
  graphNodeId: 0,
  contact: { phone: '+91 1824 517000', website: 'https://example.org/food' },
});

export const UNNAMED = place({
  id: 'osm:way/2',
  name: null,
  displayName: 'Unnamed building · 4 floors',
  categoryId: 'building',
  kind: 'building',
  location: [75.701, 31.25],
  levels: 4,
  heightM: 12.8,
  heightSource: 'osm-levels-estimate',
  graphNodeId: 1,
});

export const ORG = place({
  id: 'cur:synthetic-library',
  name: 'Synthetic Library',
  displayName: 'Synthetic Library',
  categoryId: 'library',
  kind: 'organization',
  location: null,
  contact: { website: 'https://example.org/library' },
  provenance: prov({ sourceId: 'curated:lib', sourceRef: 'https://example.org/library' }),
});

export const STALE = place({
  id: 'osm:node/4',
  name: 'Stale Hours Cafe',
  displayName: 'Stale Hours Cafe',
  categoryId: 'food',
  kind: 'facility',
  openingHours: 'Mo-Fr 08:00-18:00',
  location: [75.702, 31.25],
  // Sits on graph node 2 and is connected to it, so it is routable (findNearest only routes places with a
  // validated graphNodeId since commit 7075dfc; the fixture previously relied on the router snapping it).
  graphNodeId: 2,
  connectorLengthM: 0,
  provenance: prov({ sourceRef: 'node/4', retrievedAt: '2019-01-01T00:00:00Z' }),
});

export const ODD = place({
  id: 'osm:node/5',
  name: 'Odd Hours Shop',
  displayName: 'Odd Hours Shop',
  categoryId: 'shop',
  kind: 'facility',
  openingHours: 'sunrise-sunset',
  location: [75.7015, 31.2505],
  contact: { website: 'javascript:alert(1)' },
});

export const BANK = place({
  id: 'osm:node/6',
  name: 'Synthetic Bank',
  displayName: 'Synthetic Bank',
  categoryId: 'finance',
  kind: 'facility',
  location: [75.7001, 31.2501],
});

export const PLACES: Place[] = [NAMED, UNNAMED, ORG, STALE, ODD, BANK];

const edge = (id: number, from: number, to: number): GraphEdge => ({
  id,
  from,
  to,
  lengthM: 95,
  highway: 'footway',
  foot: true,
  bicycle: 'ride',
  steps: false,
  wheelchair: 'unknown',
  onewayBicycle: false,
  onewayFoot: false,
  indoor: false,
  surface: null,
  name: null,
  source: 'osm',
  osmWayId: 10,
});

const empty = { type: 'FeatureCollection' as const, features: [] };

export function syntheticCampus(): CampusData {
  return {
    manifest: {
      schemaVersion: DATA_SCHEMA_VERSION,
      datasetVersion: 'synthetic-001',
      builtFrom: '2026-10-01T00:00:00Z',
      sources: [
        { id: 'osm', name: 'OpenStreetMap', license: 'ODbL 1.0' },
        { id: 'curated:lib', name: 'Synthetic library page', url: 'https://example.org/library' },
      ],
      files: {},
      counts: {},
      bbox: [75.69, 31.24, 75.71, 31.26],
    },
    boundary: empty,
    buildings: empty,
    basemap: empty,
    places: PLACES.map((p) => ({ ...p })),
    relations: [
      {
        id: 'rel-1',
        type: 'located_in',
        from: NAMED.id,
        to: UNNAMED.id,
        inferred: true,
        method: 'osm-containment',
        provenance: prov(),
      },
      {
        id: 'rel-2',
        type: 'nearby',
        from: NAMED.id,
        to: BANK.id,
        inferred: true,
        method: 'distance',
        distanceM: 15,
        provenance: prov(),
      },
    ],
    graph: {
      schemaVersion: DATA_SCHEMA_VERSION,
      nodes: [
        [75.7, 31.25],
        [75.701, 31.25],
        [75.702, 31.25],
      ],
      edges: [edge(0, 0, 1), edge(1, 1, 2)],
    },
  };
}

/**
 * The same data with NAMED as an off-campus place, as the opt-in "Nearby, outside campus" layer would
 * show it (owner decision 2). Used to check its 'Outside campus' labelling and that campus search
 * does not offer it.
 */
export function withOffCampusNamed(): CampusData {
  const data = syntheticCampus();
  return {
    ...data,
    places: data.places.map((p) =>
      p.id === NAMED.id ? { ...p, campusZone: 'off-campus-nearby' as const } : p,
    ),
  };
}
