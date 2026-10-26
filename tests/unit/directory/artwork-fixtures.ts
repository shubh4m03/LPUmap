/**
 * The committed campus dataset + the committed illustration manifest
 * (public/isometric-art/manifest.json), built into app services the way the
 * app does (buildServices). Owner decisions are test fixtures: no real
 * association is verified today.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildServices, type AtlasServices } from '../../../src/app/data/services.ts';
import type { CampusData } from '../../../src/data/index.ts';
import {
  isometricArtManifestSchema,
  type IsometricArtManifest,
  type PublishedArtworkAssociation,
} from '../../../src/isometric-art/index.ts';

const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(process.cwd(), f), 'utf8')) as T;

let data: CampusData | null = null;
let manifest: IsometricArtManifest | null = null;

export function campusData(): CampusData {
  data ??= {
    manifest: read('public/data/manifest.json'),
    boundary: read('public/data/boundary.geojson'),
    buildings: read('public/data/buildings.geojson'),
    basemap: read('public/data/basemap.geojson'),
    places: read<{ places: CampusData['places'] }>('public/data/places.json').places,
    relations: read<{ relations: CampusData['relations'] }>('public/data/relations.json').relations,
    graph: read('public/data/graph.json'),
  };
  return data;
}

export function artManifest(): IsometricArtManifest {
  manifest ??= isometricArtManifestSchema.parse(read('public/isometric-art/manifest.json'));
  return manifest;
}

export function artServices(decisions: readonly PublishedArtworkAssociation[] = []): AtlasServices {
  return buildServices(campusData(), {
    artwork: { manifest: artManifest(), unavailableReason: null },
    artworkDecisions: decisions,
  });
}

/** The reviewed candidate of art:num-25..29 (curated baseline: approximate). */
export const CANDIDATE_25 = 'osm:way/422823421';

/** A test-only owner decision that VERIFIES art:num-25 → CANDIDATE_25. */
export const VERIFIED_25: PublishedArtworkAssociation = {
  subjectId: 'art:num-25',
  status: 'verified',
  buildingId: CANDIDATE_25,
  evidence: [
    { kind: 'site-sign', description: 'Test fixture: sign photographed on site', date: '2026-10-24' },
  ],
  revision: 1,
  updatedAt: '2026-10-24T10:00:00Z',
};
