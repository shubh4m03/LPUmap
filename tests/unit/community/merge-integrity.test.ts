/**
 * Adversarial merge tests: precedence rules 1–7 on the REAL dataset, the
 * derived views the app builds from merged data (search docs, facility
 * directory counts, routing eligibility), byte-level immutability of the base
 * graph, simulated OSM rebuilds, and determinism under any input ordering —
 * including conflicting duplicate records.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { routeBlockReason } from '../../../src/app/place-actions.ts';
import {
  boundaryPolygons,
  campusZoneFor,
  checkAccessNode,
  footNodeSet,
  insideContributionArea,
} from '../../../src/community/geo.ts';
import { mergePublication } from '../../../src/community/merge.ts';
import {
  EMPTY_PUBLICATION,
  type Publication,
  type PublishedLocation,
  type PublishedOverride,
} from '../../../src/community/schema.ts';
import type { CampusData } from '../../../src/data/campus-data.ts';
import type { LngLat, Place } from '../../../src/data/schema.ts';
import { createFacilityDirectory } from '../../../src/facilities/directory.ts';
import { createRouter } from '../../../src/routing/index.ts';
import { createSearchIndex, docsFromPlaces } from '../../../src/search/index.ts';
import { DATA_DIR, loadRealCampus, shuffled } from './real-campus.ts';
import { FOOD_COURT, LIBRARY, PLACES, syntheticCampus } from './synthetic-campus.ts';

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
const loc = (id: string, at: LngLat, over: Partial<PublishedLocation> = {}): PublishedLocation => ({
  id,
  origin: id.startsWith('own:') ? 'owner' : 'community',
  name: 'Community Water Cooler',
  categoryId: 'water',
  location: at,
  wheelchair: 'unknown',
  verificationStatus: 'unverified',
  accessNodeId: null,
  revision: 1,
  updatedAt: T,
  ...over,
});
const pub = (over: Partial<Publication>): Publication => ({
  ...EMPTY_PUBLICATION,
  publicationVersion: 9,
  generatedAt: T,
  ...over,
});
const NOT_CONNECTED = 'Not connected to the mapped path network.';
const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

describe('merge integrity on the real dataset', () => {
  let base: CampusData;
  let foot: Set<number>;
  /**
   * An OSM building with a footprint, relations and at least one place inside it, chosen from what the
   * dataset contains (a named one first). The v2 campus-only data has no NAMED host building — the only
   * host is an unnamed footprint with a map key — so the search assertions use the building's sourced
   * name or, failing that, its map key (Decision D6), the way campus search finds unnamed buildings.
   */
  let building: Place;
  /** Search term that finds `building` in the base index: its name, else its map key. */
  let term: string;
  /** Map-key lookup over a dataset's buildings.geojson, as the app passes it to docsFromPlaces. */
  const mapKeys = (d: CampusData) => {
    const keys = new Map(d.buildings.features.map((f) => [f.properties.id, f.properties.directoryKey]));
    return (id: string) => keys.get(id);
  };
  /** A routable base facility that is not inside `building`. */
  let routable: Place;
  /** A walkable node inside the contribution area. */
  let nodeId: number;

  beforeAll(() => {
    base = loadRealCampus();
    foot = footNodeSet(base.graph);
    const footprints = new Set(base.buildings.features.map((f) => f.properties.id));
    const related = new Set(base.relations.flatMap((r) => [r.from, r.to]));
    const hosts = new Set(
      base.places.filter((p) => p.buildingId && p.buildingId !== p.id).map((p) => p.buildingId),
    );
    const keyOf = mapKeys(base);
    building = base.places
      .filter((p) => p.kind === 'building' && footprints.has(p.id) && related.has(p.id) && hosts.has(p.id))
      .filter((p) => p.name || keyOf(p.id))
      .sort((a, b) => Number(!a.name) - Number(!b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]!;
    expect(building).toBeDefined();
    term = building.name ?? keyOf(building.id)!;
    routable = base.places.find(
      (p) => p.graphNodeId !== undefined && p.kind === 'facility' && p.name && p.buildingId !== building.id,
    )!;
    expect(routable).toBeDefined();
    // v2: the graph also carries off-campus context paths, and a published location off campus is
    // (correctly) an 'Outside campus' place hidden from campus search, so pick a node whose test
    // locations (up to ~22 m north of it) stay on campus.
    const polygons = boundaryPolygons(base.boundary);
    nodeId = [...foot]
      .sort((a, b) => a - b)
      .find((n) => {
        const [lon, lat] = base.graph.nodes[n]!;
        return (
          insideContributionArea([lon, lat]) &&
          [0, 0.0001, 0.0002].every((d) => campusZoneFor([lon, lat + d], polygons) === 'on-campus')
        );
      })!;
    expect(nodeId).toBeDefined();
  });

  it('a hidden building vanishes from search, the facility directory, related places and counts', () => {
    const { data } = mergePublication(base, pub({ overrides: [ov(building.id, { hidden: true })] }));
    const children = base.places.filter((p) => p.buildingId === building.id && p.id !== building.id);
    expect(children.length).toBeGreaterThan(0);

    // Search: present in the base index, absent from the merged one.
    const baseHits = createSearchIndex(docsFromPlaces(base.places, { mapKey: mapKeys(base) })).search(term);
    expect(baseHits.some((h) => h.doc.ref === building.id)).toBe(true);
    const docs = docsFromPlaces(data.places, { mapKey: mapKeys(data) });
    expect(docs.some((d) => d.ref === building.id)).toBe(false);
    expect(
      createSearchIndex(docs)
        .search(term)
        .some((h) => h.doc.ref === building.id),
    ).toBe(false);

    // Directory: not resolvable, not counted, never shown as a related place.
    const dir = createFacilityDirectory(data.places, data.relations);
    expect(dir.get(building.id)).toBeUndefined();
    const baseCounts = createFacilityDirectory(base.places, base.relations).countsByCategory();
    expect(dir.countsByCategory()[building.categoryId]).toBe(baseCounts[building.categoryId]! - 1);
    for (const child of children) {
      expect(dir.get(child.id)).toBeDefined();
      expect(dir.get(child.id)!.buildingId).toBeUndefined();
      expect(dir.related(child.id).some((r) => r.place.id === building.id)).toBe(false);
    }
    expect(data.buildings.features.some((f) => f.properties.id === building.id)).toBe(false);
  });

  it('manifest counts always agree with the merged data and with the facility directory', () => {
    const named = base.places.filter((p) => p.name).slice(0, 120);
    const at = base.graph.nodes[nodeId]!;
    const { data } = mergePublication(
      base,
      pub({
        overrides: named.map((p, i) =>
          ov(p.id, i % 4 === 0 ? { hidden: true } : { fields: { categoryId: i % 3 ? 'food' : 'water' } }),
        ),
        locations: [
          loc('com:a', [at[0], at[1] + 0.0001], { accessNodeId: nodeId }),
          loc('own:b', [at[0], at[1] + 0.0002], { categoryId: 'printing' }),
        ],
      }),
    );
    const c = data.manifest.counts;
    const dirCounts = createFacilityDirectory(data.places, data.relations).countsByCategory();
    for (const [cat, n] of Object.entries(dirCounts)) expect([cat, c[`category:${cat}`]]).toEqual([cat, n]);
    expect(c.places).toBe(data.places.length);
    expect(c.buildings).toBe(data.buildings.features.length);
    expect(c.relations).toBe(data.relations.length);
    expect(c['places:notConnected']).toBe(
      data.places.filter((p) => p.location !== null && p.graphNodeId === undefined).length,
    );
    // Every relation still resolves to two present places.
    const ids = new Set(data.places.map((p) => p.id));
    expect(data.relations.every((r) => ids.has(r.from) && ids.has(r.to))).toBe(true);
    // Every place's buildingId still points at a footprint that exists.
    const fps = new Set(data.buildings.features.map((f) => f.properties.id));
    expect(data.places.every((p) => p.buildingId === undefined || fps.has(p.buildingId))).toBe(true);
  });

  it('an override with an invalid access node makes a routable base place NOT routable (no stale node)', () => {
    // A walkable node far (> maxPlaceConnectorM) from the place.
    const far = [...foot].find((n) => !checkAccessNode(base.graph.nodes, foot, n, routable.location!).ok)!;
    for (const accessNodeId of [far, base.graph.nodes.length + 5]) {
      const { data, report } = mergePublication(
        base,
        pub({ overrides: [ov(routable.id, { accessNodeId })] }),
      );
      const p = data.places.find((x) => x.id === routable.id)!;
      expect(p.graphNodeId).toBeUndefined();
      expect(p.connectorLengthM).toBeUndefined();
      const dir = createFacilityDirectory(data.places, data.relations);
      expect(routeBlockReason(p, dir)).toBe(NOT_CONNECTED);
      expect(report.invalidAccess.map((i) => i.id)).toEqual([routable.id]);
    }
  });

  it('published locations get a graphNodeId only through a validated access node — never snapped', () => {
    const nodes = base.graph.nodes;
    const candidates = [...foot].sort((a, b) => a - b).filter((n) => insideContributionArea(nodes[n]!));
    const locations: PublishedLocation[] = [];
    for (let i = 0; i < 60; i++) {
      const n = candidates[(i * 37) % candidates.length]!;
      const offset = [0, 0.0001, 0.0004, 0.002][i % 4]!; // ~0, 11, 44, 222 m north
      const accessNodeId =
        i % 5 === 0 ? null : i % 7 === 0 ? 999_999 : candidates[(i * 37 + (i % 3)) % candidates.length]!;
      locations.push(loc(`com:l${i}`, [nodes[n]![0], nodes[n]![1] + offset], { accessNodeId }));
    }
    const { data, report } = mergePublication(base, pub({ locations }));
    const dir = createFacilityDirectory(data.places, data.relations);
    const invalid = new Set(report.invalidAccess.map((i) => i.id));
    let routed = 0;
    for (const l of locations) {
      const p = data.places.find((x) => x.id === l.id)!;
      const check = l.accessNodeId === null ? null : checkAccessNode(nodes, foot, l.accessNodeId, l.location);
      if (check?.ok) {
        routed++;
        expect(p.graphNodeId).toBe(l.accessNodeId);
        expect(routeBlockReason(p, dir)).toBeNull();
      } else {
        expect(p.graphNodeId).toBeUndefined();
        expect(routeBlockReason(p, dir)).toBe(NOT_CONNECTED);
        expect(invalid.has(l.id)).toBe(l.accessNodeId !== null);
      }
    }
    expect(routed).toBeGreaterThan(0);
    expect(invalid.size).toBeGreaterThan(0);
  });

  it('never touches the routing graph: same object, same file bytes, same routes', () => {
    const graphBytes = readFileSync(join(DATA_DIR, 'graph.json'));
    const before = sha256(graphBytes);
    expect(before).toBe(base.manifest.files.graph?.sha256);
    const graphJson = JSON.stringify(base.graph);
    const at = base.graph.nodes[nodeId]!;
    const { data } = mergePublication(
      base,
      pub({
        overrides: [ov(building.id, { hidden: true }), ov(routable.id, { accessNodeId: nodeId })],
        locations: [loc('com:g', [at[0], at[1] + 0.0001], { accessNodeId: nodeId })],
      }),
    );
    expect(data.graph).toBe(base.graph);
    expect(JSON.stringify(base.graph)).toBe(graphJson);
    expect(sha256(readFileSync(join(DATA_DIR, 'graph.json')))).toBe(before);

    const target = base.places.find(
      (p) => p.graphNodeId !== undefined && p.id !== routable.id && p.location,
    )!;
    const req = {
      from: { kind: 'point' as const, label: 'start', location: routable.location! },
      to: { kind: 'point' as const, label: 'end', location: target.location! },
      profile: 'walk' as const,
    };
    expect(createRouter(data.graph).route(req)).toEqual(createRouter(base.graph).route(req));
  });

  it('a map-only published location is refused as a route endpoint in the app’s own terms', () => {
    const at = base.graph.nodes[nodeId]!;
    const { data } = mergePublication(
      base,
      pub({ locations: [loc('own:maponly', [at[0], at[1] + 0.0001])] }),
    );
    const p = data.places.find((x) => x.id === 'own:maponly')!;
    const dir = createFacilityDirectory(data.places, data.relations);
    expect(dir.isRoutable(p)).toBe(false);
    expect(routeBlockReason(p, dir)).toBe(NOT_CONNECTED);
    // It is still searchable and counted (map-only is truthful, not hidden).
    expect(docsFromPlaces(data.places).some((d) => d.ref === 'own:maponly')).toBe(true);
  });

  it('orphan overrides (look-alike ids) are reported and never applied to another feature', () => {
    const lookalikes = [routable.id.toUpperCase(), `${routable.id} `, ` ${routable.id}`, `${routable.id}0`];
    const { data, report } = mergePublication(
      base,
      pub({ overrides: lookalikes.map((id) => ov(id, { hidden: true, fields: { name: 'Hijacked' } })) }),
    );
    expect(report.orphanOverrides).toEqual([...lookalikes].sort());
    expect(data.places.find((p) => p.id === routable.id)).toEqual(routable);
    expect(data.places.some((p) => p.name === 'Hijacked')).toBe(false);
    expect(data.places).toHaveLength(base.places.length);
  });

  it('survives a simulated OSM rebuild: present targets keep overrides, vanished ones become orphans', () => {
    // v2 campus data holds a single named facility (the routable subject), so the three subjects are
    // named non-building places (organizations, landmarks, areas) in id order.
    const named = base.places.filter((p) => p.name && p.kind !== 'building' && p.id !== routable.id);
    expect(named.length).toBeGreaterThanOrEqual(3);
    const removed = named[0]!;
    const renamed = named[1]!;
    const hiddenOne = named[2]!;
    const at = base.graph.nodes[nodeId]!;
    const publication = pub({
      overrides: [
        ov(removed.id, { fields: { description: 'Owner note on a removed place' } }),
        ov(renamed.id, { fields: { name: 'Owner Chosen Name' } }),
        ov(hiddenOne.id, { hidden: true }),
      ],
      locations: [
        loc('own:kept', [at[0], at[1] + 0.0001], { accessNodeId: nodeId }),
        loc('com:kept', [at[0], at[1] + 0.0002]),
      ],
    });
    const rebuilt: CampusData = {
      ...base,
      manifest: { ...base.manifest, datasetVersion: 'rebuilt-0001' },
      places: base.places
        .filter((p) => p.id !== removed.id)
        .map((p) => (p.id === renamed.id ? { ...p, name: 'New OSM Name', displayName: 'New OSM Name' } : p)),
      relations: base.relations.filter((r) => r.from !== removed.id && r.to !== removed.id),
    };
    const { data, report } = mergePublication(rebuilt, publication);
    expect(report.orphanOverrides).toEqual([removed.id]);
    expect(data.places.some((p) => p.id === removed.id)).toBe(false);
    expect(data.places.some((p) => p.description === 'Owner note on a removed place')).toBe(false);
    expect(data.places.find((p) => p.id === renamed.id)).toMatchObject({ name: 'Owner Chosen Name' });
    expect(data.places.some((p) => p.id === hiddenOne.id)).toBe(false);
    expect(report.hiddenPlaces).toEqual([hiddenOne.id]);
    expect(data.places.find((p) => p.id === 'own:kept')?.graphNodeId).toBe(nodeId);
    expect(data.places.find((p) => p.id === 'com:kept')?.graphNodeId).toBeUndefined();
    expect(data.manifest.datasetVersion).toBe('rebuilt-0001');
    expect(data.manifest.counts.places).toBe(rebuilt.places.length - 1 + 2);
  });

  it('is deterministic for any ordering of a large publication (5 shuffles)', () => {
    const named = base.places.filter((p) => p.name).slice(0, 80);
    const cands = [...foot].sort((a, b) => a - b).filter((n) => insideContributionArea(base.graph.nodes[n]!));
    const overrides = [
      ...named.map((p, i) =>
        ov(p.id, {
          hidden: i % 6 === 0,
          fields: i % 2 ? { name: `Renamed ${i}` } : {},
          accessNodeId: i % 5 ? null : cands[i]!,
        }),
      ),
      ov('osm:way/1'),
      ov('osm:way/2', { hidden: true }),
    ];
    const locations = cands.slice(0, 30).map((n, i) => {
      const c = base.graph.nodes[n]!;
      return loc(i % 2 ? `own:p${i}` : `com:p${i}`, [c[0], c[1] + 0.0001], {
        accessNodeId: i % 3 ? n : null,
      });
    });
    const reference = JSON.stringify(mergePublication(base, pub({ overrides, locations })));
    for (const seed of [1, 2, 3, 4, 5]) {
      const again = mergePublication(
        base,
        pub({ overrides: shuffled(overrides, seed), locations: shuffled(locations, seed * 7) }),
      );
      expect(JSON.stringify(again)).toBe(reference);
    }
  });
});

describe('merge determinism with conflicting duplicate records', () => {
  const variants = (a: PublishedOverride, b: PublishedOverride) => [
    [a, b],
    [b, a],
  ];

  it('two overrides for the same target: the outcome does not depend on input order', () => {
    const a = ov(LIBRARY.id, { fields: { name: 'Name A' }, revision: 3 });
    const b = ov(LIBRARY.id, { fields: { name: 'Name B' }, revision: 3 });
    const outs = variants(a, b).map(([x, y]) =>
      JSON.stringify(mergePublication(syntheticCampus(), pub({ overrides: [x!, y!] }))),
    );
    expect(outs[0]).toBe(outs[1]);
  });

  it('two overrides for the same target: the newest revision wins and the duplicate is reported', () => {
    const older = ov(LIBRARY.id, { hidden: true, revision: 2 });
    const newer = ov(LIBRARY.id, { fields: { name: 'Newest' }, revision: 5 });
    for (const [x, y] of variants(older, newer)) {
      const { data, report } = mergePublication(syntheticCampus(), pub({ overrides: [x!, y!] }));
      expect(data.places.find((p) => p.id === LIBRARY.id)?.name).toBe('Newest');
      expect(report.hiddenPlaces).toEqual([]);
      expect(report.duplicateOverrides).toEqual([LIBRARY.id]);
    }
  });

  it('two published locations with the same id: the outcome does not depend on input order', () => {
    const a = loc('com:same', [75.7009, 31.2501], { name: 'First Cooler' });
    const b = loc('com:same', [75.7009, 31.2501], { name: 'Second Cooler' });
    const ab = mergePublication(syntheticCampus(), pub({ locations: [a, b] }));
    const ba = mergePublication(syntheticCampus(), pub({ locations: [b, a] }));
    expect(JSON.stringify(ab)).toBe(JSON.stringify(ba));
    expect(ab.data.places.filter((p) => p.id === 'com:same')).toHaveLength(1);
    expect(ab.report.shadowedLocations).toEqual(['com:same']);
  });

  it('a published location cannot resurrect a hidden base place by reusing its id', () => {
    const shadow: Place = { ...FOOD_COURT, id: 'own:taken' };
    const { data, report } = mergePublication(
      syntheticCampus({ places: [...PLACES, shadow] }),
      pub({
        overrides: [ov('own:taken', { hidden: true })],
        locations: [loc('own:taken', [75.7009, 31.2501], { name: 'Impostor' })],
      }),
    );
    expect(data.places.some((p) => p.id === 'own:taken')).toBe(false);
    expect(report.shadowedLocations).toEqual(['own:taken']);
  });
});
