import { describe, expect, it } from 'vitest';
import { mergePublication } from '../../../src/community/merge.ts';
import {
  EMPTY_PUBLICATION,
  type Publication,
  type PublishedLocation,
  type PublishedOverride,
} from '../../../src/community/schema.ts';
import { BLOCK_34, FOOD_COURT, LIBRARY, PLACES, UNNAMED, syntheticCampus } from './synthetic-campus.ts';

const T = '2026-10-01T10:00:00.000Z';

const ov = (targetId: string, over: Partial<PublishedOverride> = {}): PublishedOverride => ({
  targetId,
  hidden: false,
  fields: {},
  accessNodeId: null,
  revision: 1,
  updatedAt: T,
  ...over,
});

const loc = (id: string, over: Partial<PublishedLocation> = {}): PublishedLocation => ({
  id,
  origin: id.startsWith('own:') ? 'owner' : 'community',
  name: 'Water Cooler',
  categoryId: 'water',
  location: [75.7009, 31.2501],
  wheelchair: 'unknown',
  verificationStatus: 'unverified',
  accessNodeId: null,
  revision: 1,
  updatedAt: T,
  ...over,
});

const pub = (over: Partial<Publication> = {}): Publication => ({
  ...EMPTY_PUBLICATION,
  publicationVersion: 7,
  generatedAt: T,
  ...over,
});

const byId = <T extends { id: string }>(places: T[], id: string): T | undefined =>
  places.find((p) => p.id === id);

describe('mergePublication', () => {
  it('returns the base unchanged (apart from recomputed counts) for an empty publication', () => {
    const base = syntheticCampus();
    const { data, report } = mergePublication(base, EMPTY_PUBLICATION);
    expect(data.places).toEqual(base.places);
    expect(data.buildings).toEqual(base.buildings);
    expect(data.relations).toEqual(base.relations);
    expect(data.manifest.sources).toEqual(base.manifest.sources);
    expect(data.manifest.datasetVersion).toBe(base.manifest.datasetVersion);
    expect(data.manifest.counts.places).toBe(PLACES.length);
    expect(report).toMatchObject({
      hiddenPlaces: [],
      orphanOverrides: [],
      addedLocations: [],
      droppedRelations: 0,
    });
  });

  it('never mutates the base dataset', () => {
    const base = syntheticCampus();
    const snapshot = JSON.parse(JSON.stringify(base));
    mergePublication(
      base,
      pub({
        overrides: [
          ov(BLOCK_34.id, { hidden: true }),
          ov(LIBRARY.id, { fields: { name: 'Renamed', location: [75.7, 31.2501] } }),
        ],
        locations: [loc('com:abc', { accessNodeId: 1 })],
      }),
    );
    expect(base).toEqual(snapshot);
  });

  it('rule 1: a hidden building disappears from places, footprints and relations; children lose buildingId', () => {
    const { data, report } = mergePublication(
      syntheticCampus(),
      pub({ overrides: [ov(BLOCK_34.id, { hidden: true })] }),
    );
    expect(byId(data.places, BLOCK_34.id)).toBeUndefined();
    expect(data.buildings.features.map((f) => f.properties.id)).toEqual([UNNAMED.id]);
    expect(data.relations.some((r) => r.from === BLOCK_34.id || r.to === BLOCK_34.id)).toBe(false);
    expect(data.relations.map((r) => r.id)).toEqual(['r2', 'r3']);
    expect(byId(data.places, LIBRARY.id)).not.toHaveProperty('buildingId');
    expect(report).toMatchObject({
      hiddenPlaces: [BLOCK_34.id],
      removedBuildings: [BLOCK_34.id],
      droppedRelations: 1,
    });
    expect(data.manifest.counts).toMatchObject({
      places: 3,
      buildings: 1,
      relations: 2,
      'category:academic': 0,
    });
  });

  it('rule 1: hiding a non-building drops only it and its relations', () => {
    const { data } = mergePublication(
      syntheticCampus(),
      pub({ overrides: [ov(LIBRARY.id, { hidden: true })] }),
    );
    expect(data.places.map((p) => p.id)).toEqual([BLOCK_34.id, FOOD_COURT.id, UNNAMED.id]);
    expect(data.buildings.features).toHaveLength(2);
    expect(data.relations.map((r) => r.id)).toEqual(['r3']);
  });

  it('rule 2: override fields replace base fields with owner provenance; footprint properties follow', () => {
    const { data, report } = mergePublication(
      syntheticCampus(),
      pub({
        overrides: [
          ov(UNNAMED.id, {
            fields: {
              name: 'Block 99',
              categoryId: 'academic',
              description: 'Labs',
              openingHours: 'Mo-Fr 08:00-17:00',
              wheelchair: 'limited',
              website: 'https://example.org/b99',
              verificationStatus: 'verified',
              lastVerifiedAt: '2026-09-30',
              sourceUrl: 'https://example.org/source',
            },
          }),
        ],
      }),
    );
    const p = byId(data.places, UNNAMED.id)!;
    expect(p).toMatchObject({
      name: 'Block 99',
      displayName: 'Block 99',
      categoryId: 'academic',
      description: 'Labs',
      openingHours: 'Mo-Fr 08:00-17:00',
      wheelchair: 'limited',
      contact: { website: 'https://example.org/b99' },
      provenance: {
        sourceId: 'owner',
        sourceRef: 'way/300',
        verificationStatus: 'verified',
        lastVerifiedAt: '2026-09-30',
      },
    });
    expect(p.provenance.notes).toContain('Owner override of osm');
    const f = data.buildings.features.find((x) => x.properties.id === UNNAMED.id)!;
    expect(f.properties).toMatchObject({ name: 'Block 99', displayName: 'Block 99', categoryId: 'academic' });
    expect(report.overriddenPlaces).toEqual([UNNAMED.id]);
    expect(data.manifest.sources.map((s) => s.id)).toEqual(['osm', 'owner']);
    expect(data.manifest.counts['buildings:unnamed']).toBe(0);
  });

  it('rule 2: absent override fields keep base values', () => {
    const { data } = mergePublication(
      syntheticCampus(),
      pub({ overrides: [ov(LIBRARY.id, { fields: { description: 'x' } })] }),
    );
    expect(byId(data.places, LIBRARY.id)).toMatchObject({
      name: 'Main Library',
      openingHours: LIBRARY.openingHours,
      wheelchair: 'yes',
      graphNodeId: 1,
      provenance: { verificationStatus: 'imported' },
    });
  });

  it('rule 3: a valid override access node replaces graphNodeId; invalid ones make the place NOT routable', () => {
    const good = mergePublication(
      syntheticCampus(),
      pub({ overrides: [ov(LIBRARY.id, { accessNodeId: 2 })] }),
    );
    const lib = byId(good.data.places, LIBRARY.id)!;
    expect(lib.graphNodeId).toBe(2);
    expect(lib.connectorLengthM).toBeGreaterThan(0);
    expect(lib.connectorLengthM).toBeLessThanOrEqual(60);

    for (const [nodeId, reason] of [
      [3, 'override-not-walkable'],
      [99, 'override-missing-node'],
      [0, 'override-too-far'],
    ] as const) {
      const r = mergePublication(
        syntheticCampus(),
        pub({ overrides: [ov(LIBRARY.id, { accessNodeId: nodeId })] }),
      );
      const p = byId(r.data.places, LIBRARY.id)!;
      expect(p.graphNodeId).toBeUndefined();
      expect(p.connectorLengthM).toBeUndefined();
      expect(r.report.invalidAccess).toEqual([expect.objectContaining({ id: LIBRARY.id, reason })]);
    }
  });

  it('rule 3: a moved place keeps its base node only while it still validates', () => {
    const near = mergePublication(
      syntheticCampus(),
      pub({ overrides: [ov(LIBRARY.id, { fields: { location: [75.7005, 31.2501] } })] }),
    );
    expect(byId(near.data.places, LIBRARY.id)?.graphNodeId).toBe(1);
    const far = mergePublication(
      syntheticCampus(),
      pub({ overrides: [ov(LIBRARY.id, { fields: { location: [75.7035, 31.2535] } })] }),
    );
    const p = byId(far.data.places, LIBRARY.id)!;
    expect(p.graphNodeId).toBeUndefined();
    expect(p.location).toEqual([75.7035, 31.2535]);
    expect(far.report.invalidAccess[0]).toMatchObject({ id: LIBRARY.id, reason: 'moved-too-far' });
  });

  it('rule 3: moving outside the boundary recomputes campusZone', () => {
    const r = mergePublication(
      syntheticCampus(),
      pub({ overrides: [ov(FOOD_COURT.id, { fields: { location: [75.715, 31.26] } })] }),
    );
    expect(byId(r.data.places, FOOD_COURT.id)?.campusZone).toBe('off-campus-nearby');
  });

  it('rule 4: published locations become facility places; routable only with a validated access node', () => {
    const r = mergePublication(
      syntheticCampus(),
      pub({
        locations: [
          loc('com:routable', {
            accessNodeId: 2,
            description: 'Cold water',
            sourceUrl: 'https://example.org/s',
          }),
          loc('own:maponly', { name: 'Law Gate Xerox', categoryId: 'printing', location: [75.715, 31.26] }),
          loc('com:badnode', { accessNodeId: 3 }),
        ],
      }),
    );
    const routable = byId(r.data.places, 'com:routable')!;
    expect(routable).toMatchObject({
      kind: 'facility',
      displayName: 'Water Cooler',
      campusZone: 'on-campus',
      graphNodeId: 2,
      description: 'Cold water',
      provenance: {
        sourceId: 'community',
        sourceRef: 'https://example.org/s',
        verificationStatus: 'unverified',
      },
    });
    const mapOnly = byId(r.data.places, 'own:maponly')!;
    expect(mapOnly).toMatchObject({ campusZone: 'off-campus-nearby', provenance: { sourceId: 'owner' } });
    expect(mapOnly.graphNodeId).toBeUndefined();
    // Never auto-snapped, even though node 2 is only ~14 m from com:badnode.
    expect(byId(r.data.places, 'com:badnode')?.graphNodeId).toBeUndefined();
    expect(r.report.invalidAccess.map((i) => [i.id, i.reason])).toEqual([
      ['com:badnode', 'location-not-walkable'],
    ]);
    expect(r.report.addedLocations).toEqual(['com:badnode', 'com:routable', 'own:maponly']);
    expect(r.data.manifest.sources.map((s) => s.id)).toEqual(['osm', 'owner', 'community']);
    expect(r.data.manifest.counts).toMatchObject({
      places: PLACES.length + 3,
      'kind:facility': 5,
      'category:water': 2,
      'places:notConnected': 4,
      'zone:off-campus-nearby': 1,
    });
  });

  it('rule 5: overrides of ids missing from the base are ignored and reported as orphans', () => {
    const r = mergePublication(
      syntheticCampus(),
      pub({
        overrides: [ov('osm:way/404', { hidden: true }), ov('osm:way/405', { fields: { name: 'Ghost' } })],
      }),
    );
    expect(r.report.orphanOverrides).toEqual(['osm:way/404', 'osm:way/405']);
    expect(r.data.places).toEqual(syntheticCampus().places);
    expect(r.data.places.some((p) => p.name === 'Ghost')).toBe(false);
  });

  it('rule 6: published ids colliding with base ids (or repeated) are ignored and reported', () => {
    const shadowBase = { ...FOOD_COURT, id: 'own:taken' };
    const r = mergePublication(
      syntheticCampus({ places: [...PLACES, shadowBase] }),
      pub({
        locations: [
          loc('own:taken', { name: 'Impostor' }),
          loc('com:twice'),
          loc('com:twice', { name: 'Again' }),
        ],
      }),
    );
    expect(byId(r.data.places, 'own:taken')?.name).toBe('Food Court');
    expect(r.report.shadowedLocations).toEqual(['com:twice', 'own:taken']);
    expect(r.data.places.filter((p) => p.id === 'com:twice')).toHaveLength(1);
  });

  it('rule 7: counts recomputed, datasetVersion kept, publicationVersion reported separately', () => {
    const base = syntheticCampus();
    const r = mergePublication(
      base,
      pub({ overrides: [ov(LIBRARY.id, { hidden: true })], locations: [loc('own:a')] }),
    );
    expect(r.data.manifest.datasetVersion).toBe(base.manifest.datasetVersion);
    expect(r.report.publicationVersion).toBe(7);
    expect(r.data.manifest.counts.places).toBe(r.data.places.length);
    expect(r.data.manifest.counts.relations).toBe(r.data.relations.length);
    expect(r.data.manifest.counts['graph:nodes']).toBe(5);
    expect(Object.keys(r.data.manifest.counts)).toEqual(Object.keys(r.data.manifest.counts).sort());
  });

  it('is deterministic regardless of input order', () => {
    const overrides = [ov(LIBRARY.id, { accessNodeId: 2 }), ov(UNNAMED.id, { hidden: true }), ov('osm:x/1')];
    const locations = [loc('com:b'), loc('own:a', { accessNodeId: 1 }), loc('com:a')];
    const a = mergePublication(syntheticCampus(), pub({ overrides, locations }));
    const b = mergePublication(
      syntheticCampus(),
      pub({ overrides: [...overrides].reverse(), locations: [...locations].reverse() }),
    );
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
