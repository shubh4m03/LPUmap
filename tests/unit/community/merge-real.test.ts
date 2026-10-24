/**
 * mergePublication on the REAL generated dataset in public/data (read from
 * disk, validated with the production schemas).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { mergePublication } from '../../../src/community/merge.ts';
import { boundaryPolygons, campusZoneFor, footNodeSet } from '../../../src/community/geo.ts';
import {
  EMPTY_PUBLICATION,
  type Publication,
  type PublishedLocation,
} from '../../../src/community/schema.ts';
import type { CampusData } from '../../../src/data/campus-data.ts';
import {
  basemapFileSchema,
  boundaryFileSchema,
  buildingsFileSchema,
  DATA_FILES,
  graphFileSchema,
  manifestSchema,
  placesFileSchema,
  relationsFileSchema,
  type LngLat,
  type Place,
} from '../../../src/data/schema.ts';
import { isRoutablePlace } from '../../../src/facilities/directory.ts';
import { createRouter } from '../../../src/routing/index.ts';
import { insideContributionArea } from '../../../src/community/geo.ts';

const DATA_DIR = join(process.cwd(), 'public', 'data');
const read = <S extends z.ZodType>(schema: S, file: string): z.infer<S> =>
  schema.parse(JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')));

function loadRealCampus(): CampusData {
  return {
    manifest: read(manifestSchema, DATA_FILES.manifest),
    boundary: read(boundaryFileSchema, DATA_FILES.boundary),
    buildings: read(buildingsFileSchema, DATA_FILES.buildings),
    basemap: read(basemapFileSchema, DATA_FILES.basemap),
    places: read(placesFileSchema, DATA_FILES.places).places,
    relations: read(relationsFileSchema, DATA_FILES.relations).relations,
    graph: read(graphFileSchema, DATA_FILES.graph),
  };
}

const T = '2026-10-01T10:00:00.000Z';
const location = (id: string, at: LngLat, accessNodeId: number | null): PublishedLocation => ({
  id,
  origin: 'community',
  name: 'Community Water Cooler',
  categoryId: 'water',
  location: at,
  wheelchair: 'unknown',
  verificationStatus: 'unverified',
  accessNodeId,
  revision: 1,
  updatedAt: T,
});

describe('mergePublication on the real dataset', () => {
  let base: CampusData;
  let building: Place;
  let foot: Set<number>;

  beforeAll(() => {
    base = loadRealCampus();
    foot = footNodeSet(base.graph);
    // A named OSM building with a footprint, a graph node and at least one relation.
    const withRelations = new Set(base.relations.flatMap((r) => [r.from, r.to]));
    const footprints = new Set(base.buildings.features.map((f) => f.properties.id));
    const found = base.places.find(
      (p) =>
        p.id.startsWith('osm:') &&
        p.kind === 'building' &&
        p.name !== null &&
        footprints.has(p.id) &&
        withRelations.has(p.id),
    );
    if (!found) throw new Error('real dataset has no named OSM building with footprint and relations');
    building = found;
  });

  it('an empty publication reproduces the base places, footprints, relations and counts', () => {
    const { data } = mergePublication(base, EMPTY_PUBLICATION);
    expect(data.places).toEqual(base.places);
    expect(data.buildings).toEqual(base.buildings);
    expect(data.relations).toEqual(base.relations);
    for (const [k, v] of Object.entries(base.manifest.counts))
      expect([k, data.manifest.counts[k]]).toEqual([k, v]);
  });

  it('a hidden OSM building disappears from places, buildings and relations', () => {
    const pub: Publication = {
      ...EMPTY_PUBLICATION,
      publicationVersion: 1,
      overrides: [
        { targetId: building.id, hidden: true, fields: {}, accessNodeId: null, revision: 1, updatedAt: T },
      ],
    };
    const { data, report } = mergePublication(base, pub);
    expect(data.places.some((p) => p.id === building.id)).toBe(false);
    expect(data.buildings.features.some((f) => f.properties.id === building.id)).toBe(false);
    expect(data.relations.some((r) => r.from === building.id || r.to === building.id)).toBe(false);
    expect(data.places.some((p) => p.buildingId === building.id)).toBe(false);
    expect(report.hiddenPlaces).toEqual([building.id]);
    expect(report.droppedRelations).toBeGreaterThan(0);
    expect(data.manifest.counts.places).toBe(base.places.length - 1);
    expect(data.manifest.counts.buildings).toBe(base.buildings.features.length - 1);
    expect(data.manifest.counts.relations).toBe(base.relations.length - report.droppedRelations);
  });

  /** A walkable node whose point dLat° north stays on campus (off-campus locations go to contextPlaces). */
  const campusNode = (dLat: number) => {
    const polygons = boundaryPolygons(base.boundary);
    return [...foot]
      .sort((a, b) => a - b)
      .find((n) => {
        const [lon, lat] = base.graph.nodes[n]!;
        return (
          insideContributionArea([lon, lat]) && campusZoneFor([lon, lat + dLat], polygons) === 'on-campus'
        );
      })!;
  };

  it('a published location is routable only with a validated access node', () => {
    // Pick a walkable node on campus, and put the location ~11 m north of it (still on campus).
    const nodeId = campusNode(0.0001);
    const node = base.graph.nodes[nodeId]!;
    const at: LngLat = [node[0], node[1] + 0.0001];
    const pub: Publication = {
      ...EMPTY_PUBLICATION,
      publicationVersion: 2,
      locations: [location('com:mapOnly', at, null), location('com:routable', at, nodeId)],
    };
    const { data, report } = mergePublication(base, pub);
    const mapOnly = data.places.find((p) => p.id === 'com:mapOnly')!;
    const routable = data.places.find((p) => p.id === 'com:routable')!;
    expect(isRoutablePlace(mapOnly)).toBe(false);
    expect(isRoutablePlace(routable)).toBe(true);
    expect(routable.graphNodeId).toBe(nodeId);
    expect(report.invalidAccess).toEqual([]);

    const router = createRouter(data.graph);
    const target = data.places.find((p) => p.id === building.id)!;
    const result = router.route({
      from: {
        kind: 'place',
        placeId: routable.id,
        label: routable.displayName,
        location: routable.location!,
        nodeId,
      },
      to: {
        kind: 'place',
        placeId: target.id,
        label: target.displayName,
        location: target.location!,
        ...(target.graphNodeId !== undefined ? { nodeId: target.graphNodeId } : {}),
      },
      profile: 'walk',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.distanceM).toBeGreaterThan(0);
  });

  it('an access node farther than maxPlaceConnectorM is rejected (not routable, never snapped)', () => {
    const nodeId = campusNode(0.0018);
    const n = base.graph.nodes[nodeId]!;
    // ~200 m north of the node: other nodes may be closer, but nothing is ever snapped.
    const { data, report } = mergePublication(base, {
      ...EMPTY_PUBLICATION,
      locations: [location('com:far', [n[0], n[1] + 0.0018], nodeId)],
    });
    const far = data.places.find((p) => p.id === 'com:far')!;
    expect(isRoutablePlace(far)).toBe(false);
    expect(far.graphNodeId).toBeUndefined();
    expect(report.invalidAccess.map((i) => i.reason)).toEqual(['location-too-far']);
  });

  it('merges a realistic publication in under 20 ms', () => {
    const named = base.places.filter((p) => p.location && p.name).slice(0, 60);
    const nodeIds = [...foot].sort((a, b) => a - b);
    const pub: Publication = {
      ...EMPTY_PUBLICATION,
      publicationVersion: 3,
      overrides: named.map((p, i) => ({
        targetId: p.id,
        hidden: i % 10 === 0,
        fields: i % 2 ? { description: `Edited ${i}` } : { name: `${p.name} (edited)` },
        accessNodeId: i % 3 === 0 ? (p.graphNodeId ?? null) : null,
        revision: 1,
        updatedAt: T,
      })),
      locations: nodeIds.slice(0, 50).map((n, i) => {
        const c = base.graph.nodes[n]!;
        return location(`com:perf${i}`, [c[0], c[1] + 0.0001], i % 2 ? n : null);
      }),
    };
    for (let i = 0; i < 3; i++) mergePublication(base, pub); // warm-up (JIT)
    const times: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      mergePublication(base, pub);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[3]!).toBeLessThan(20); // median
  });
});
