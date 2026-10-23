/**
 * Synthetic (invented) geometry for map tests. Not LPU data: coordinates
 * are arbitrary points near the configured map centre and names are
 * obviously fictional test labels.
 */
import type { CampusData } from '../../../src/data/campus-data.ts';
import { DATA_SCHEMA_VERSION, type Place } from '../../../src/data/schema.ts';
import { syntheticBuildingProps } from '../../fixtures/synthetic-building-props.ts';

const provenance = { sourceId: 'synthetic', verificationStatus: 'unverified' as const };

function square(lon: number, lat: number, d = 0.0002): number[][][] {
  return [
    [
      [lon, lat],
      [lon + d, lat],
      [lon + d, lat + d],
      [lon, lat + d],
      [lon, lat],
    ],
  ];
}

function place(over: Partial<Place> & Pick<Place, 'id' | 'categoryId' | 'kind'>): Place {
  return {
    name: null,
    displayName: 'Synthetic place',
    aliases: [],
    location: null,
    campusZone: 'on-campus',
    wheelchair: 'unknown',
    provenance,
    ...over,
  };
}

export function syntheticCampusData(): CampusData {
  return {
    manifest: {
      schemaVersion: DATA_SCHEMA_VERSION,
      datasetVersion: 'synthetic-0001',
      builtFrom: '2026-01-01T00:00:00Z',
      sources: [{ id: 'synthetic', name: 'Synthetic test fixture' }],
      files: {},
      counts: {},
      bbox: [75.69, 31.24, 75.71, 31.26],
    },
    boundary: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: square(75.69, 31.24, 0.02) },
          properties: { id: 'osm:relation/1', name: 'Synthetic Campus', sourceRef: 'test' },
        },
      ],
    },
    buildings: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: square(75.7, 31.25) },
          properties: syntheticBuildingProps({
            id: 'osm:way/10',
            name: 'Test Hall Alpha',
            displayName: 'Test Hall Alpha',
            renderHeightM: 21,
            renderHeightSource: 'osm-height',
            categoryId: 'academic',
          }),
        },
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: square(75.701, 31.25) },
          properties: syntheticBuildingProps({
            id: 'osm:way/11',
            displayName: 'Unnamed building · 4 floors',
            levels: 4,
            renderHeightM: 12.8,
            renderHeightSource: 'osm-levels-estimate',
          }),
        },
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: square(75.702, 31.25) },
          properties: syntheticBuildingProps({ id: 'osm:way/12' }),
        },
      ],
    },
    basemap: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [75.699, 31.249],
              [75.705, 31.249],
            ],
          },
          properties: { id: 'osm:way/20', layer: 'road', subclass: 'residential', name: 'Test Road' },
        },
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [75.7, 31.2485],
              [75.703, 31.2485],
            ],
          },
          properties: { id: 'osm:way/21', layer: 'path', subclass: 'footway', name: null },
        },
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: square(75.703, 31.251, 0.001) },
          properties: { id: 'osm:way/22', layer: 'green', subclass: 'park', name: null },
        },
      ],
    },
    places: [
      place({
        id: 'osm:way/10',
        name: 'Test Hall Alpha',
        displayName: 'Test Hall Alpha',
        categoryId: 'academic',
        kind: 'building',
        location: [75.7001, 31.2501],
      }),
      place({
        id: 'osm:node/30',
        name: 'Test Cafe',
        displayName: 'Test Cafe',
        categoryId: 'food',
        kind: 'facility',
        location: [75.7004, 31.2496],
      }),
      place({ id: 'osm:node/31', categoryId: 'finance', kind: 'facility', location: [75.7006, 31.2497] }),
      place({ id: 'cur:test-office', name: 'Test Office', categoryId: 'academic', kind: 'organization' }),
      place({
        id: 'osm:node/32',
        name: 'Test Lodge',
        categoryId: 'residential',
        kind: 'facility',
        location: [75.708, 31.258],
        campusZone: 'off-campus-nearby',
      }),
      place({
        id: 'osm:node/33',
        categoryId: 'no-such-category',
        kind: 'landmark',
        location: [75.7007, 31.2499],
      }),
    ],
    relations: [],
    graph: { schemaVersion: DATA_SCHEMA_VERSION, nodes: [], edges: [] },
  };
}
