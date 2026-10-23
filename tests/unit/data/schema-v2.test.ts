/**
 * v2 data contract: synthetic fixtures (invented ids/values, not LPU data),
 * v1 rejection, lazy optional files, compatibility and rollback guarantees.
 */
import { describe, expect, it, vi } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';
import {
  boundaryReviewFileSchema,
  buildingPropsSchema,
  buildingsFileSchema,
  checkSchemaVersion,
  contextPlacesFileSchema,
  createOptionalLoaders,
  curatedBoundaryReviewSchema,
  DATA_FILES,
  DATA_SCHEMA_VERSION,
  DatasetError,
  detectionsFileSchema,
  directoryKeysLockSchema,
  graphFileSchema,
  loadCampusData,
  manifestSchema,
  placeSchema,
  placesFileSchema,
  REQUIRED_MANIFEST_FILE_KEYS,
  type BuildingProps,
  type Manifest,
} from '../../../src/data/index.ts';
import { syntheticBuildingProps } from '../../fixtures/synthetic-building-props.ts';

const square = [
  [
    [75.7, 31.25],
    [75.7002, 31.25],
    [75.7002, 31.2502],
    [75.7, 31.2502],
    [75.7, 31.25],
  ],
];
const prov = { sourceId: 'osm', verificationStatus: 'imported' as const };
const campusPlace = {
  id: 'osm:way/1',
  name: null,
  displayName: 'Unnamed building',
  aliases: [],
  categoryId: 'building',
  kind: 'building' as const,
  location: [75.7001, 31.2501],
  campusZone: 'on-campus' as const,
  wheelchair: 'unknown' as const,
  provenance: prov,
};
const contextPlace = {
  ...campusPlace,
  id: 'osm:node/9',
  name: 'Synthetic Roadside Cafe',
  displayName: 'Synthetic Roadside Cafe',
  categoryId: 'food',
  kind: 'facility' as const,
  campusZone: 'off-campus-nearby' as const,
};
const detection = {
  id: 'det:microsoft-ml:0123abcd',
  source: 'microsoft-ml',
  geometryKind: 'footprint',
  sourceRef: 'synthetic tile',
  areaM2: 120,
  confidence: null,
  matchedOsmId: null,
  matchIoU: null,
  confirmedBy: [],
  campusStatus: 'inside',
  insideFraction: 1,
  reviewSectionId: null,
  reviewStatus: 'unreviewed',
};
const files = Object.fromEntries(
  REQUIRED_MANIFEST_FILE_KEYS.map((k) => [k, { path: DATA_FILES[k], bytes: 0, sha256: '0' }]),
);
const manifest: Manifest = {
  schemaVersion: DATA_SCHEMA_VERSION,
  datasetVersion: 'synthetic-v2',
  builtFrom: '2026-10-23T09:39:00Z',
  sources: [
    { id: 'osm', name: 'OpenStreetMap', license: 'ODbL 1.0' },
    {
      id: 'microsoft-ml-buildings',
      name: 'Microsoft Global ML Building Footprints',
      license: 'CDLA-Permissive-2.0',
      licenseTextPath: 'licenses/CDLA-Permissive-2.0.txt',
    },
  ],
  files,
  counts: { buildings: 1 },
  bbox: [75.69, 31.24, 75.71, 31.26],
};

const issues = (props: Partial<BuildingProps>) => {
  const r = buildingPropsSchema.safeParse(syntheticBuildingProps({ id: 'osm:way/1', ...props }));
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe('BuildingPropsV2', () => {
  it('parses a complete synthetic feature, keeping render values under the render prefix', () => {
    const p = syntheticBuildingProps({ id: 'osm:way/1', directoryKey: 'C4-07', directoryCell: 'C4' });
    const parsed = buildingPropsSchema.parse(p);
    expect(parsed).toEqual(p);
    const renderKeys = Object.keys(parsed).filter((k) => k.startsWith('render'));
    expect(renderKeys.sort()).toEqual(['renderHeightM', 'renderHeightSource', 'renderMinHeightM']);
    expect(parsed).not.toHaveProperty('heightM');
    const fc = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: square }, properties: p }],
    };
    expect(buildingsFileSchema.safeParse(fc).success).toBe(true);
    const point = {
      ...fc,
      features: [{ ...fc.features[0], geometry: { type: 'Point', coordinates: [75.7, 31.25] } }],
    };
    expect(buildingsFileSchema.safeParse(point).success).toBe(false);
  });

  it('never ships an outside footprint and keeps inCampusInventory consistent', () => {
    expect(issues({ campusStatus: 'outside', inCampusInventory: false }).join()).toMatch(/never shipped/);
    expect(issues({ campusStatus: 'uncertain', inCampusInventory: true }).join()).toMatch(
      /inCampusInventory/,
    );
    expect(
      issues({
        campusStatus: 'uncertain',
        inCampusInventory: false,
        membershipReasonCode: 'review-section',
        reviewSectionId: 'synthetic-section',
      }),
    ).toEqual([]);
    expect(
      issues({ campusStatus: 'crossing', insideFraction: 0.8, membershipReasonCode: 'crossing-majority' }),
    ).toEqual([]);
  });

  it('ties null insideFraction/areaM2 to invalid geometry, which must be uncertain', () => {
    expect(
      issues({
        campusStatus: 'uncertain',
        inCampusInventory: false,
        insideFraction: null,
        areaM2: null,
        distanceToBoundaryM: null,
        membershipMethod: 'none',
        membershipReasonCode: 'invalid-geometry',
      }),
    ).toEqual([]);
    expect(issues({ insideFraction: null }).join()).toMatch(/insideFraction is null exactly/);
    expect(
      issues({
        insideFraction: null,
        areaM2: null,
        membershipMethod: 'none',
        membershipReasonCode: 'invalid-geometry',
      }).join(),
    ).toMatch(/must be uncertain/);
  });

  it('requires a source for curated decisions and for official block labels (never invented)', () => {
    expect(issues({ membershipDecision: 'curated' }).join()).toMatch(/membershipDecisionSource/);
    expect(
      issues({
        membershipDecision: 'curated',
        membershipDecisionSource: 'owner-confirmation: synthetic (2026-10-24)',
        membershipMethod: 'curated-decision',
        membershipReasonCode: 'curated-decision',
      }),
    ).toEqual([]);
    expect(issues({ officialBlockLabel: 'Block 99' }).join()).toMatch(/officialBlockSourceId/);
    expect(issues({ directoryKey: 'c4-7' }).length).toBeGreaterThan(0);
    expect(
      issues({
        directoryKey: 'C4-07',
        campusStatus: 'uncertain',
        inCampusInventory: false,
        membershipReasonCode: 'crossing-minority',
      }).join(),
    ).toMatch(/only campus-inventory buildings get a map key/);
  });

  it('keeps render heights honest: sources, fidelity and levels must agree', () => {
    expect(issues({ renderHeightSource: 'osm-height', osmHeightM: null, fidelityLevel: 2 }).join()).toMatch(
      /needs osmHeightM/,
    );
    expect(
      issues({
        renderHeightSource: 'osm-levels-estimate',
        levels: null,
        levelsSource: null,
        fidelityLevel: 1,
      }).join(),
    ).toMatch(/needs levels/);
    expect(issues({ fidelityLevel: 2 }).join()).toMatch(/fidelityLevel 2 does not match/);
    expect(issues({ fidelityLevel: 3 }).join()).toMatch(/verified/);
    expect(issues({ renderMinHeightM: 6 }).join()).toMatch(/renderMinHeightM/);
    expect(issues({ levels: 3, levelsSource: null }).join()).toMatch(/levelsSource/);
    // tag pass-throughs are null when untagged
    const p = syntheticBuildingProps({ id: 'osm:way/1' });
    expect([
      p.roofShape,
      p.roofMaterial,
      p.roofColour,
      p.buildingMaterial,
      p.buildingColour,
      p.osmHeightM,
    ]).toEqual([null, null, null, null, null, null]);
  });
});

describe('places, context places and detections', () => {
  it('places.json holds campus places only; context-places.json off-campus points only', () => {
    const v = DATA_SCHEMA_VERSION;
    expect(placesFileSchema.safeParse({ schemaVersion: v, places: [campusPlace] }).success).toBe(true);
    expect(placesFileSchema.safeParse({ schemaVersion: v, places: [contextPlace] }).success).toBe(false);
    expect(contextPlacesFileSchema.safeParse({ schemaVersion: v, places: [contextPlace] }).success).toBe(
      true,
    );
    expect(contextPlacesFileSchema.safeParse({ schemaVersion: v, places: [campusPlace] }).success).toBe(
      false,
    );
    const offCampusBuilding = { ...contextPlace, kind: 'building' };
    expect(contextPlacesFileSchema.safeParse({ schemaVersion: v, places: [offCampusBuilding] }).success).toBe(
      false,
    );
    const withFootprint = { ...contextPlace, buildingId: 'osm:way/77' };
    expect(contextPlacesFileSchema.safeParse({ schemaVersion: v, places: [withFootprint] }).success).toBe(
      false,
    );
  });

  it('validates detections: id/source agreement, no outside detections, match coupling', () => {
    const fc = (props: object) => ({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: square }, properties: props }],
    });
    expect(detectionsFileSchema.safeParse(fc(detection)).success).toBe(true);
    expect(
      detectionsFileSchema.safeParse(fc({ ...detection, source: 'google-open-buildings' })).success,
    ).toBe(false);
    expect(detectionsFileSchema.safeParse(fc({ ...detection, campusStatus: 'outside' })).success).toBe(false);
    expect(detectionsFileSchema.safeParse(fc({ ...detection, matchedOsmId: 'osm:way/1' })).success).toBe(
      false,
    );
    expect(detectionsFileSchema.safeParse(fc({ ...detection, id: 'det:microsoft-ml:XYZ' })).success).toBe(
      false,
    );
    // Data-agent addition: Google-only detections are typed points (no Google polygon is available).
    const pointFc = (props: object) => ({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [75.7, 31.25] }, properties: props },
      ],
    });
    const gPoint = {
      ...detection,
      id: 'det:google-open-buildings:0123abcd',
      source: 'google-open-buildings',
      geometryKind: 'point',
      confidence: 0.9,
      insideFraction: null,
    };
    expect(detectionsFileSchema.safeParse(pointFc(gPoint)).success).toBe(true);
    expect(detectionsFileSchema.safeParse(pointFc({ ...gPoint, geometryKind: 'footprint' })).success).toBe(
      false,
    );
    expect(detectionsFileSchema.safeParse(pointFc(detection)).success).toBe(false); // MS has polygons: never a point
    expect(detectionsFileSchema.safeParse(fc({ ...detection, geometryKind: 'point' })).success).toBe(false);
  });

  it('parses the curated boundary review and the generated summary', () => {
    const section = {
      id: 'synthetic-east-edge',
      title: 'Synthetic east edge',
      status: 'open',
      reason: 'Synthetic test section',
      evidence: ['synthetic evidence'],
      bufferM: 30,
      geometry: {
        type: 'LineString',
        coordinates: [
          [75.71, 31.25],
          [75.71, 31.26],
        ],
      },
    };
    const decision = {
      featureId: 'osm:way/1',
      status: 'inside',
      decidedAt: '2026-10-24',
      source: { kind: 'owner-confirmation', ref: 'synthetic' },
    };
    expect(
      curatedBoundaryReviewSchema.safeParse({ sections: [section], decisions: [decision] }).success,
    ).toBe(true);
    expect(
      curatedBoundaryReviewSchema.safeParse({
        sections: [],
        decisions: [{ ...decision, status: 'uncertain' }],
      }).success,
    ).toBe(false);
    expect(
      curatedBoundaryReviewSchema.safeParse({ sections: [{ ...section, evidence: [] }], decisions: [] })
        .success,
    ).toBe(false);
    const summary = {
      schemaVersion: DATA_SCHEMA_VERSION,
      boundarySourceRef: 'relation/1 v1',
      rules: APP_CONFIG.geo.membership,
      sections: [{ ...section, affectedIds: ['osm:way/1'] }],
      decisions: [decision],
      items: [
        {
          id: 'osm:way/1',
          kind: 'building',
          displayName: 'Unnamed building',
          campusStatus: 'uncertain',
          insideFraction: 0.8,
          distanceToBoundaryM: 0,
          membershipReasonCode: 'review-section',
          membershipReason: 'synthetic',
          reviewSectionId: 'synthetic-east-edge',
          pointAreaDisagreement: false,
          anchor: [75.7001, 31.2501],
          decision: 'auto',
          decisionSource: null,
        },
      ],
    };
    expect(boundaryReviewFileSchema.safeParse(summary).success).toBe(true);
  });

  it('validates the directory keys lock (unique, unretired keys)', () => {
    const lock = {
      $comment: 'synthetic',
      version: 1,
      gridOrigin: [75.6975, 31.261],
      cellM: 200,
      keys: { 'osm:way/1': 'C4-07' },
      retired: {},
    };
    expect(directoryKeysLockSchema.safeParse(lock).success).toBe(true);
    expect(
      directoryKeysLockSchema.safeParse({ ...lock, keys: { 'osm:way/1': 'C4-07', 'osm:way/2': 'C4-07' } })
        .success,
    ).toBe(false);
    expect(
      directoryKeysLockSchema.safeParse({
        ...lock,
        retired: { 'C4-07': { id: 'osm:way/9', retiredAt: '2026-10-24' } },
      }).success,
    ).toBe(false);
  });
});

describe('manifest v2', () => {
  it('requires every v2 file entry and the osm source', () => {
    expect(manifestSchema.safeParse(manifest).success).toBe(true);
    const { detections: _omit, ...rest } = files;
    expect(manifestSchema.safeParse({ ...manifest, files: rest }).success).toBe(false);
    expect(manifestSchema.safeParse({ ...manifest, sources: manifest.sources.slice(1) }).success).toBe(false);
    expect(
      manifestSchema.safeParse({ ...manifest, sources: [manifest.sources[0], manifest.sources[0]] }).success,
    ).toBe(false);
  });
});

describe('v1 rejection, compatibility and rollback', () => {
  it('rejects a v1 manifest with a schema-version error, before fetching anything else', async () => {
    expect(DATA_SCHEMA_VERSION).toBe(2);
    expect(() => checkSchemaVersion({ ...manifest, schemaVersion: 1 })).toThrow(
      expect.objectContaining({ code: 'schema-version' }),
    );
    const fetchImpl = vi.fn(
      async () =>
        ({ ok: true, status: 200, json: async () => ({ ...manifest, schemaVersion: 1 }) }) as Response,
    );
    const err = await loadCampusData({
      baseUrl: '/data/',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DatasetError);
    expect((err as DatasetError).code).toBe('schema-version');
    expect((err as DatasetError).message).toMatch(/schema version 1, but this app expects version 2/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects v1-shaped files individually', () => {
    expect(placesFileSchema.safeParse({ schemaVersion: 1, places: [campusPlace] }).success).toBe(false);
    expect(graphFileSchema.safeParse({ schemaVersion: 1, nodes: [], edges: [] }).success).toBe(false);
    const v1Building = {
      id: 'osm:way/1',
      name: null,
      displayName: 'x',
      levels: null,
      heightM: 6,
      minHeightM: 0,
      heightSource: 'fallback',
      categoryId: 'building',
      campusZone: 'on-campus',
    };
    expect(buildingPropsSchema.safeParse(v1Building).success).toBe(false);
  });

  it('keeps the Place shape and ids unchanged, so admin overrides keyed by base place ids still apply', () => {
    // A v1 place record (as written by the v1 pipeline) is a valid v2 place.
    expect(placeSchema.parse(campusPlace)).toEqual(campusPlace);
  });

  it('versions the service-worker data cache with the schema (rollback never mixes v1 and v2 data)', () => {
    expect(APP_CONFIG.cache.dataCache).toBe(`lpu-atlas-data-v${DATA_SCHEMA_VERSION}`);
  });
});

describe('lazy optional loaders', () => {
  function fetchFor(bodies: Record<string, unknown>) {
    return vi.fn(async (input: string | URL | Request) => {
      const file = String(input).replace(/^.*\//, '').replace(/\?.*$/, '');
      if (!(file in bodies)) return { ok: false, status: 404, json: async () => ({}) } as Response;
      const body = bodies[file];
      if (body instanceof Error) throw body;
      return { ok: true, status: 200, json: async () => body } as Response;
    });
  }
  const detectionsFc = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: square }, properties: detection },
    ],
  };

  it('are not fetched by loadCampusData', async () => {
    const empty = { type: 'FeatureCollection', features: [] };
    const fetchImpl = fetchFor({
      'manifest.json': manifest,
      'boundary.geojson': empty,
      'buildings.geojson': empty,
      'basemap.geojson': empty,
      'places.json': { schemaVersion: 2, places: [campusPlace] },
      'relations.json': { schemaVersion: 2, relations: [] },
      'graph.json': { schemaVersion: 2, nodes: [], edges: [] },
    });
    await loadCampusData({ baseUrl: '/data/', fetchImpl: fetchImpl as unknown as typeof fetch });
    const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => /context-places|detections|boundary-review/.test(u))).toBe(false);
  });

  it('fetch on first use with the dataset version, memoise, and retry after a failure', async () => {
    const bodies: Record<string, unknown> = {
      'context-places.json': new Error('offline'),
      'detections.geojson': detectionsFc,
    };
    const fetchImpl = fetchFor(bodies);
    const loaders = createOptionalLoaders(manifest, {
      baseUrl: '/data/',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(loaders.contextPlaces()).rejects.toMatchObject({ code: 'network' });
    bodies['context-places.json'] = { schemaVersion: 2, places: [contextPlace] };
    expect(await loaders.contextPlaces()).toHaveLength(1);
    await loaders.contextPlaces();
    expect(fetchImpl.mock.calls.filter((c) => String(c[0]).includes('context-places')).length).toBe(2);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('/data/context-places.json?v=synthetic-v2');
    expect((await loaders.detections()).features).toHaveLength(1);
  });

  it('refuse detections whose source has no licensed manifest record', async () => {
    const fetchImpl = fetchFor({ 'detections.geojson': detectionsFc });
    const bare = { ...manifest, sources: [manifest.sources[0]!] };
    const loaders = createOptionalLoaders(bare, {
      baseUrl: '/data/',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(loaders.detections()).rejects.toMatchObject({
      code: 'invalid',
      message: expect.stringMatching(/microsoft-ml-buildings/),
    });
  });
});
