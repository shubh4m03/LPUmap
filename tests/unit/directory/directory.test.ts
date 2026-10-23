/** Directory service on synthetic (invented) buildings and places. */
import { describe, expect, it } from 'vitest';
import type { BuildingsFile, Place, Relation } from '../../../src/data/schema.ts';
import { compareDirectoryKeys, createDirectory } from '../../../src/directory/index.ts';
import { syntheticBuildingProps } from '../../fixtures/synthetic-building-props.ts';

const geometry = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [75.7, 31.25],
      [75.7001, 31.25],
      [75.7001, 31.2501],
      [75.7, 31.25],
    ],
  ],
};
const feature = (props: Parameters<typeof syntheticBuildingProps>[0]) => ({
  type: 'Feature' as const,
  geometry,
  properties: syntheticBuildingProps(props),
});
const buildings: BuildingsFile = {
  type: 'FeatureCollection',
  features: [
    feature({ id: 'osm:way/3', directoryKey: 'C10-01', directoryCell: 'C10' }),
    feature({
      id: 'osm:way/1',
      name: 'Synthetic Hall',
      displayName: 'Synthetic Hall',
      directoryKey: 'C4-07',
      directoryCell: 'C4',
    }),
    feature({
      id: 'osm:way/2',
      displayName: 'Unnamed building · 4 floors',
      directoryKey: 'C4-02',
      directoryCell: 'C4',
    }),
    feature({ id: 'osm:way/4', displayName: 'Unnamed building', categoryId: 'sports' }), // no key yet
    feature({
      id: 'osm:way/5',
      campusStatus: 'uncertain',
      inCampusInventory: false,
      membershipReasonCode: 'review-section',
      reviewSectionId: 'synthetic',
    }),
  ],
};
const prov = { sourceId: 'osm', verificationStatus: 'imported' as const };
const place = (id: string, extra: Partial<Place> = {}): Place => ({
  id,
  name: null,
  displayName: 'x',
  aliases: [],
  categoryId: 'building',
  kind: 'building',
  location: [75.70005, 31.25005],
  campusZone: 'on-campus',
  wheelchair: 'unknown',
  provenance: prov,
  ...extra,
});
const places: Place[] = [
  place('osm:way/1', { graphNodeId: 3 }),
  place('osm:way/2'),
  place('osm:way/3', { location: null }),
  place('osm:node/10', { kind: 'facility', categoryId: 'food' }),
  place('cur:synthetic-school', { kind: 'organization', location: null }),
];
const rel = (id: string, type: Relation['type'], from: string, to: string): Relation => ({
  id,
  type,
  from,
  to,
  inferred: true,
  method: 'osm-containment',
  provenance: prov,
});
const relations = [
  rel('r1', 'located_in', 'osm:node/10', 'osm:way/1'),
  rel('r2', 'part_of', 'cur:synthetic-school', 'osm:way/1'),
  rel('r3', 'nearby', 'osm:node/10', 'osm:way/2'),
];

describe('createDirectory', () => {
  const dir = createDirectory({ buildings, places, relations });

  it('lists only campus-inventory buildings, keyed first in key order', () => {
    expect(dir.entries.map((e) => e.id)).toEqual(['osm:way/2', 'osm:way/1', 'osm:way/3', 'osm:way/4']);
    expect(dir.byId.has('osm:way/5')).toBe(false);
    expect(compareDirectoryKeys('C4-07', 'C10-01')).toBeLessThan(0);
  });

  it('uses honest titles and subtitles', () => {
    expect(dir.byId.get('osm:way/1')).toMatchObject({ title: 'Synthetic Hall', subtitle: 'Map key C4-07' });
    expect(dir.byId.get('osm:way/2')).toMatchObject({
      title: 'Building C4-02',
      subtitle: 'Unnamed building · 4 floors',
      officialBlock: null,
    });
    expect(dir.byId.get('osm:way/4')).toMatchObject({ title: 'Unnamed building', key: null });
  });

  it('derives facilities, organizations and routability from the records', () => {
    expect(dir.byId.get('osm:way/1')).toMatchObject({
      facilityIds: ['osm:node/10'],
      organizationIds: ['cur:synthetic-school'],
      routable: true,
      routableReason: 'routable',
    });
    expect(dir.byId.get('osm:way/2')).toMatchObject({
      facilityIds: [],
      routable: false,
      routableReason: 'not-connected',
    });
    expect(dir.byId.get('osm:way/3')?.routableReason).toBe('no-location');
    expect(dir.byId.get('osm:way/4')?.routableReason).toBe('no-place-record');
    expect(dir.byId.get('osm:way/4')?.provenance).toMatchObject({ sourceId: 'osm', sourceRef: 'way/4' });
  });

  it('searches by key (exact key first), name and label; filters by category', () => {
    expect(dir.byKey.get('C4-07')?.id).toBe('osm:way/1');
    expect(dir.search('c4-07')[0]?.id).toBe('osm:way/1');
    expect(dir.search('synthetic hall').map((e) => e.id)).toEqual(['osm:way/1']);
    expect(dir.search('4 floors').map((e) => e.id)).toEqual(['osm:way/2']);
    expect(dir.search('   ')).toEqual([]);
    expect(dir.filter(['sports']).map((e) => e.id)).toEqual(['osm:way/4']);
    expect(dir.filter([])).toHaveLength(4);
  });
});
