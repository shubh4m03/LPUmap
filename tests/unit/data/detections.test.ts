// @vitest-environment node
/**
 * Detections (owner decision 1): matching rules, Google confirmation threshold,
 * Google-only points, review sections, and geometry kept exactly as published.
 * Synthetic snapshots only.
 */
import { describe, expect, it } from 'vitest';
import type { LngLat } from '../../../src/data/schema.ts';
import { detectionsFileSchema } from '../../../src/data/schema.ts';
import { createBoundary } from '../../../src/geo/boundary.ts';
import { collectBuildings } from '../../../scripts/lib/build-buildings.ts';
import type { GoogleSnapshot, MsSnapshot } from '../../../scripts/lib/detection-sources.ts';
import { buildDetections } from '../../../scripts/lib/detections.ts';
import { syntheticOsm } from './osm-builder.ts';

const P = (x: number, y: number): LngLat => [75.7 + 0.01 * x, 31.25 + 0.01 * y];
const sq = (x: number, y: number, d: number) => [
  [P(x, y), P(x + d, y), P(x + d, y + d), P(x, y + d), P(x, y)],
];
const boundary = createBoundary({ type: 'Polygon', coordinates: sq(0, 0, 1) });
const line = (coords: unknown) =>
  JSON.stringify({
    type: 'Feature',
    properties: { height: -1, confidence: -1 },
    geometry: { type: 'Polygon', coordinates: coords },
  });

const osm = collectBuildings(
  syntheticOsm({
    nodes: { 1: P(0.1, 0.1), 2: P(0.12, 0.1), 3: P(0.12, 0.12), 4: P(0.1, 0.12) },
    ways: [[100, [1, 2, 3, 4, 1], { building: 'yes' }]],
  }),
).buildings;

const msLines = [
  line(sq(0.1003, 0.0997, 0.02)), // OSM way/100 shifted a few metres: matched (IoU ≥ 0.3), not shipped
  line(sq(0.5, 0.5, 0.01)), // inside, no OSM: shipped
  line(sq(0.995, 0.5, 0.01)), // only 50 % inside: still a candidate (≥ 50 %)
  line(sq(0.997, 0.6, 0.01)), // 30 % inside: not a candidate
  line(sq(0.115, 0.1, 0.02)), // 25 % covered by way/100 (partial): shipped
];
const ms: MsSnapshot = {
  source: {
    sourceId: 'microsoft-ml-buildings',
    name: 'Synthetic MS',
    url: 'https://example.org/ms',
    license: 'CDLA-Permissive-2.0',
    licenseUrl: 'https://example.org/cdla',
    attribution: 'synthetic',
    datasetLinksUrl: 'https://example.org/links.csv',
    tileUrl: 'https://example.org/2026-01-01/tile.csv.gz',
    quadkey: '1',
    release: '2026-01-01',
    retrievedAt: '2026-01-01T00:00:00Z',
    tileSha256: '0'.repeat(64),
    tileBytes: 1,
    featuresInTile: msLines.length,
    featuresInSnapshot: msLines.length,
    filterBBox: [75, 31, 76, 32],
    licenseTextUrl: 'https://example.org/cdla',
    licenseTextRetrievedAt: '2026-01-01T00:00:00Z',
  },
  lines: msLines,
  licenseText: 'synthetic licence text\n',
};
const row = (x: number, y: number, area: number, conf: number, code: string) => {
  const [lon, lat] = P(x, y);
  return `${lat},${lon},${area},${conf},${code}`;
};
const google: GoogleSnapshot = {
  source: {
    sourceId: 'google-open-buildings',
    name: 'Synthetic Google',
    url: 'https://example.org/g',
    license: 'ODbL 1.0',
    licenseUrl: 'https://example.org/odbl',
    attribution: 'synthetic',
    version: 'v3',
    tileUrl: 'https://example.org/points.csv.gz',
    s2Token: '0',
    retrievedAt: '2026-01-01T00:00:00Z',
    tileSha256: '0'.repeat(64),
    tileBytes: 1,
    rowsInTile: 5,
    rowsInSnapshot: 5,
    filterBBox: [75, 31, 76, 32],
    confidenceThreshold: 0.875,
    confidenceThresholdSource: 'synthetic',
    minAreaM2: 50,
  },
  rows: [
    row(0.505, 0.505, 100, 0.9, 'A'), // confirms the inside MS footprint
    row(0.125, 0.11, 100, 0.8, 'B'), // inside the partial MS footprint but below the threshold: no confirmation
    row(0.3, 0.3, 80, 0.95, 'C'), // strong, in no footprint: Google-only point
    row(0.11, 0.11, 80, 0.95, 'D'), // inside the OSM footprint: not a detection
    row(0.31, 0.3, 30, 0.95, 'E'), // too small
  ],
  licenseNotice: 'synthetic\n',
};

describe('buildDetections', () => {
  const r = buildDetections({ ms, google, boundary, sections: [], osmFootprints: osm });
  const props = r.file.features.map((f) => f.properties);

  it('ships only unmatched detections, with the audit matching rule and counts', () => {
    expect(r.summary.microsoft).toMatchObject({
      inSnapshot: 5,
      candidates: 4,
      matched: 1,
      partial: 1,
      msOnly: 2,
      shipped: 3,
    });
    expect(props.every((p) => p.matchedOsmId === null && p.matchIoU === null)).toBe(true);
    expect(detectionsFileSchema.safeParse(r.file).success).toBe(true);
  });

  it('confirms an MS footprint only with a Google point at or above the recorded threshold', () => {
    const confirmed = props.filter((p) => p.confirmedBy.includes('google-open-buildings'));
    expect(confirmed).toHaveLength(1);
    expect(r.summary.microsoft.confirmedByGoogle).toBe(1);
  });

  it('adds strong Google-only detections as typed points with the source area and confidence', () => {
    const points = r.file.features.filter((f) => f.geometry.type === 'Point');
    expect(points).toHaveLength(1);
    expect(points[0]!.properties).toMatchObject({
      source: 'google-open-buildings',
      geometryKind: 'point',
      areaM2: 80,
      confidence: 0.95,
      insideFraction: null,
    });
    expect(points[0]!.properties.sourceRef).toMatch(/plus code C$/);
  });

  it('keeps published geometry exactly (no offset correction) and never names or keys a detection', () => {
    // Every shipped polygon is one of the published polygons, coordinate for coordinate. (Two shipped
    // polygons lie fully inside the boundary — the MS-only square and the partly covered one — so the
    // check compares the whole set rather than picking "the" fully-inside feature.)
    const shipped = r.file.features
      .filter((f) => f.geometry.type === 'Polygon')
      .map((f) => JSON.stringify(f.geometry.coordinates))
      .sort();
    const expected = [sq(0.5, 0.5, 0.01), sq(0.995, 0.5, 0.01), sq(0.115, 0.1, 0.02)]
      .map((c) => JSON.stringify(c))
      .sort();
    expect(shipped).toEqual(expected);
    for (const p of props) {
      expect(Object.keys(p)).not.toContain('name');
      expect(Object.keys(p)).not.toContain('directoryKey');
      expect(Object.keys(p)).not.toContain('renderHeightM');
    }
  });

  it('is deterministic and records licensed sources and the shipped licence text', () => {
    const again = buildDetections({ ms, google, boundary, sections: [], osmFootprints: osm });
    expect(JSON.stringify(again.file)).toBe(JSON.stringify(r.file));
    expect(r.sources.map((s) => [s.id, s.license])).toEqual([
      ['microsoft-ml-buildings', 'CDLA-Permissive-2.0'],
      ['google-open-buildings', 'ODbL 1.0'],
    ]);
    expect(r.licenseFiles).toEqual({ 'licenses/CDLA-Permissive-2.0.txt': 'synthetic licence text\n' });
  });

  it('marks detections in an open review section as uncertain with the section id', () => {
    const withSection = buildDetections({
      ms,
      google,
      boundary,
      osmFootprints: osm,
      sections: [
        {
          id: 'synthetic',
          title: 't',
          status: 'open',
          reason: 'r',
          evidence: ['e'],
          bufferM: 0,
          geometry: { type: 'Polygon', coordinates: sq(0.45, 0.45, 0.1) },
        },
      ],
    });
    const inSection = withSection.file.features.find((f) => f.properties.reviewSectionId === 'synthetic');
    expect(inSection?.properties.campusStatus).toBe('uncertain');
  });

  it('measures OSM coverage as a union, so duplicate OSM outlines are not counted twice', () => {
    // Two identical OSM ways each cover 28 % of the detection: union coverage is 28 %
    // (partial → shipped), not 56 % (≥ MATCH_COVERAGE → wrongly "matched").
    const dupOsm = collectBuildings(
      syntheticOsm({
        nodes: { 1: P(0.6, 0.2), 2: P(0.62, 0.2), 3: P(0.62, 0.22), 4: P(0.6, 0.22) },
        ways: [
          [200, [1, 2, 3, 4, 1], { building: 'yes' }],
          [201, [1, 2, 3, 4, 1], { building: 'yes' }],
        ],
      }),
    ).buildings;
    expect(dupOsm).toHaveLength(2);
    const lines = [line(sq(0.6144, 0.2, 0.02))];
    const d = buildDetections({
      ms: { ...ms, lines, source: { ...ms.source, featuresInTile: 1, featuresInSnapshot: 1 } },
      google: null,
      boundary,
      sections: [],
      osmFootprints: dupOsm,
    });
    expect(d.summary.microsoft).toMatchObject({ candidates: 1, matched: 0, partial: 1, shipped: 1 });
  });

  it('produces nothing without snapshots', () => {
    const none = buildDetections({ ms: null, google: null, boundary, sections: [], osmFootprints: osm });
    expect(none.file.features).toEqual([]);
    expect(none.sources).toEqual([]);
  });
});
