// @vitest-environment node
// G-29: connected_by_path exists only for curated records that cite a mapped
// path; it is never derived from graph connectivity.
import { describe, expect, it } from 'vitest';
import type { GraphFile, LngLat, Place, Relation } from '../../../src/data/schema.ts';
import { relationsFileSchema } from '../../../src/data/schema.ts';
import type { PlaceRecord } from '../../../scripts/lib/build-places.ts';
import { mergeCurated } from '../../../scripts/lib/curated.ts';
import type { CuratedInputs, CuratedDataError } from '../../../scripts/lib/curated.ts';
import type { PathConnectionsFile } from '../../../scripts/lib/curated-schema.ts';
import { pathConnectionsFileSchema } from '../../../scripts/lib/curated-schema.ts';

// ~0.0001° ≈ 10 m here. Two square blocks 100 m apart, joined by way 500 (a covered walkway).
const square = (x: number, y: number): LngLat[][][] => [
  [
    [
      [x, y],
      [x + 0.0002, y],
      [x + 0.0002, y + 0.0002],
      [x, y + 0.0002],
      [x, y],
    ],
  ],
];
function building(id: string, x: number, y: number, extra: Partial<Place> = {}): PlaceRecord {
  return {
    geometry: 'area',
    multiPolygon: square(x, y),
    place: {
      id,
      name: id,
      displayName: id,
      aliases: [],
      categoryId: 'building',
      kind: 'building',
      location: [x + 0.0001, y + 0.0001],
      campusZone: 'on-campus',
      wheelchair: 'unknown',
      provenance: { sourceId: 'osm', sourceRef: id.slice(4), verificationStatus: 'imported' },
      ...extra,
    },
  };
}
const A = building('osm:way/1', 75.7, 31.25);
const B = building('osm:way/2', 75.7012, 31.25);
const FAR = building('osm:way/3', 75.71, 31.26);
const OFF = building('osm:way/4', 75.7024, 31.25, { campusZone: 'off-campus-nearby' });

const edge = (
  id: number,
  from: number,
  to: number,
  wayId: number,
  extra: Partial<GraphFile['edges'][number]> = {},
) => ({
  id,
  from,
  to,
  lengthM: 10,
  highway: 'footway',
  foot: true,
  bicycle: 'push' as const,
  steps: false,
  wheelchair: 'unknown' as const,
  onewayBicycle: false,
  onewayFoot: false,
  indoor: false,
  surface: null,
  name: null,
  source: 'osm' as const,
  osmWayId: wayId,
  campus: true,
  ...extra,
});
// Way 500 runs from A's east edge to B's west edge; way 600 is a road you may not walk;
// way 700 leaves campus; A and B are also graph-connected through way 800 far away.
const graph: GraphFile = {
  schemaVersion: 2,
  nodes: [
    [75.7002, 31.2501],
    [75.7007, 31.2501],
    [75.7012, 31.2501],
    [75.7002, 31.2502],
    [75.7012, 31.2502],
    [75.7024, 31.2501],
  ],
  edges: [
    edge(0, 0, 1, 500),
    edge(1, 1, 2, 500),
    edge(2, 3, 4, 600, { foot: false, highway: 'motorway' }),
    edge(3, 2, 5, 700, { campus: false }),
    edge(4, 0, 2, 800),
  ],
};

const terms = { license: 'CC0-1.0 (synthetic test data)', attribution: 'Synthetic fixture' };
const source = {
  name: 'OSM way 500',
  url: 'https://www.openstreetmap.org/way/500',
  retrievedAt: '2026-10-23',
  ...terms,
};
type Conn = PathConnectionsFile['connections'][number];
const conn = (extra: Partial<Conn> = {}): Conn => ({
  from: A.place.id,
  to: B.place.id,
  pathOsmWayId: 500,
  evidence: 'osm-tagging',
  note: 'highway=footway, covered=yes, runs from block 1 to block 2',
  source,
  ...extra,
});
const inputs = (connections: Conn[]): CuratedInputs => ({
  aliases: { aliases: [] },
  overrides: { overrides: [] },
  organizations: { records: [] },
  pathConnections: { connections },
  present: [],
});
const ctx = { graph, maxDistanceM: 60 };
const records = () => [A, B, FAR, OFF].map((r) => structuredClone(r));
const problems = (connections: Conn[]): string[] => {
  try {
    mergeCurated(records(), inputs(connections), ctx);
  } catch (e) {
    return (e as CuratedDataError).problems;
  }
  return [];
};

describe('connected_by_path from curated evidence', () => {
  it('produces nothing without a cited record, even when the graph connects the places', () => {
    const r = mergeCurated(records(), inputs([]), ctx);
    expect(r.relations.filter((x) => x.type === 'connected_by_path')).toEqual([]);
    expect(r.applied.pathConnections).toBe(0);
  });

  it('turns a cited, checked record into a curated relation with its path id and licensed source', () => {
    const r = mergeCurated(records(), inputs([conn()]), ctx);
    expect(r.relations).toEqual([
      {
        id: 'connected_by_path:osm:way/1->osm:way/2',
        type: 'connected_by_path',
        from: 'osm:way/1',
        to: 'osm:way/2',
        inferred: false,
        method: 'curated',
        pathOsmWayId: 500,
        provenance: {
          sourceId: 'curated:openstreetmap-org-way-500',
          sourceRef: 'https://www.openstreetmap.org/way/500',
          retrievedAt: '2026-10-23',
          verificationStatus: 'imported',
          notes:
            'Joined by OSM way 500 (osm-tagging): highway=footway, covered=yes, runs from block 1 to block 2',
        },
      },
    ]);
    expect(r.sources).toEqual([
      expect.objectContaining({ id: 'curated:openstreetmap-org-way-500', ...terms }),
    ]);
    expect(relationsFileSchema.safeParse({ schemaVersion: 2, relations: r.relations }).success).toBe(true);
    expect(
      mergeCurated(records(), inputs([conn({ evidence: 'physical-survey' })]), ctx).relations[0]!.provenance,
    ).toMatchObject({ verificationStatus: 'verified' });
  });

  it('rejects missing endpoints, self links, duplicates and off-campus places', () => {
    const p = problems([
      conn({ to: 'osm:way/99' }),
      conn({ to: A.place.id }),
      conn(),
      conn({ from: B.place.id, to: A.place.id }),
      conn({ to: OFF.place.id, pathOsmWayId: 500 }),
    ]);
    expect(p.join('\n')).toMatch(/connections\[0\].*place osm:way\/99 does not exist/);
    expect(p.join('\n')).toMatch(/connections\[1\].*connects a place to itself/);
    expect(p.join('\n')).toMatch(/connections\[3\].*duplicate connection/);
    expect(p.join('\n')).toMatch(/connections\[4\].*osm:way\/4 is off campus/);
  });

  it('requires the cited way to be a walkable on-campus path in the graph that reaches both places', () => {
    const p = problems([
      conn({ pathOsmWayId: 12345 }),
      conn({ pathOsmWayId: 600 }),
      conn({ pathOsmWayId: 700 }),
      conn({ to: FAR.place.id }),
    ]).filter((x) => !x.includes('duplicate connection')); // entries 0-2 share one pair on purpose
    expect(p).toHaveLength(4);
    expect(p[0]).toMatch(/way 12345 is not a path in the routing graph/);
    expect(p[1]).toMatch(/way 600 is not walkable/);
    expect(p[2]).toMatch(/way 700 leaves the campus boundary/);
    expect(p[3]).toMatch(/way 500 passes \d+ m from osm:way\/3 \(more than 60 m\)/);
  });

  it('refuses a record whose source has no licence terms', () => {
    const { license: _l, attribution: _a, ...bare } = source;
    expect(problems([conn({ source: bare })])).toEqual([
      expect.stringMatching(/has no licence\/attribution/),
    ]);
  });

  it('documents in the shipped curated file that there are no records yet', async () => {
    const { readFileSync } = await import('node:fs');
    const file = pathConnectionsFileSchema.parse(
      JSON.parse(
        readFileSync(new URL('../../../data/curated/path-connections.json', import.meta.url), 'utf8'),
      ),
    );
    expect(file.connections).toEqual([]);
    expect(file.$comment).toMatch(/No connection is recorded yet/);
  });
});

describe('relationSchema rules for connected_by_path', () => {
  const rel = (extra: Partial<Relation>): unknown => ({
    id: 'r',
    type: 'connected_by_path',
    from: 'a',
    to: 'b',
    inferred: false,
    method: 'curated',
    pathOsmWayId: 500,
    provenance: { sourceId: 'curated:x', verificationStatus: 'imported' },
    ...extra,
  });
  const ok = (r: unknown) => relationsFileSchema.safeParse({ schemaVersion: 2, relations: [r] }).success;

  it('accepts only curated, non-inferred relations that cite a path', () => {
    expect(ok(rel({}))).toBe(true);
    expect(ok(rel({ inferred: true }))).toBe(false);
    expect(ok(rel({ method: 'distance' }))).toBe(false);
    expect(ok(rel({ method: 'graph-path' as Relation['method'] }))).toBe(false);
    expect(ok(rel({ pathOsmWayId: undefined }))).toBe(false);
    expect(ok(rel({ type: 'nearby', method: 'distance', inferred: true, distanceM: 3 }))).toBe(false);
    expect(
      ok(rel({ type: 'nearby', method: 'distance', inferred: true, distanceM: 3, pathOsmWayId: undefined })),
    ).toBe(true);
  });
});
