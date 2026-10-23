/**
 * Override survival across the v1 → v2 base-data switch, and back (Gate 6,
 * owner condition 4). Isolated: a throwaway local D1 (wrangler
 * getPlatformProxy, persist: false) — never a deployed or shared database.
 *
 * 1. Seed D1 against the COMMITTED v1 dataset (git show V1_COMMIT) with the
 *    unchanged server domain code: an owner location, approved community
 *    locations with and without an access node, an override renaming an
 *    on-campus OSM building (with an access node), a hidden on-campus OSM
 *    building, an override and a hide on off-campus places that v2 moves to
 *    the context layer, a hide on an off-campus building v2 no longer ships,
 *    an override on an on-campus building v2 holds for boundary review, and
 *    conflicting-revision edits.
 * 2. Switch the base to the v2 public/data and assert: campus overrides and
 *    hides still apply; vanished targets are orphans (reported with a reason,
 *    never applied to another feature, never deleted from D1); locations
 *    persist; access nodes are re-validated against the v2 graph; publication
 *    and merge are deterministic; quality warnings list the orphans.
 * 3. A hidden campus building stays hidden when a refresh drops and then
 *    reintroduces it.
 * 4. Roll back to v1: the same D1 rows apply again (orphans reappear as
 *    applied — docs/DATA_ROLLBACK.md §4).
 *
 * Targets are chosen from the data by rule, not hard-coded, so a later data
 * refresh keeps the test meaningful; each rule's expectation is asserted.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildBaseData, type BaseData } from '../../../server/base-data.ts';
import {
  approveSuggestion,
  createLocation,
  createSuggestion,
  deleteOverride,
  getOverride,
  getOverview,
  getPublication,
  getQualityWarnings,
  hideOverride,
  listAudit,
  listLocations,
  listOverrides,
  putOverride,
  updateLocation,
} from '../../../server/domain/index.ts';
import type { LocationRecord } from '../../../server/db/records.ts';
import { DomainError } from '../../../server/errors.ts';
import { checkAccessNode, pointInPolygons } from '../../../src/community/geo.ts';
import { mergePublication } from '../../../src/community/merge.ts';
import type { Publication } from '../../../src/community/schema.ts';
import type { CampusData } from '../../../src/data/campus-data.ts';
import type { LngLat, Place } from '../../../src/data/schema.ts';
import { loadRealCampus, shuffled } from '../../unit/community/real-campus.ts';
import { realBaseData } from '../helpers/base-data.ts';
import { clock, contribution, T0 } from '../helpers/context.ts';
import { createTestDb, type TestDb } from '../helpers/test-db.ts';
import { v1BaseData, v1Source, V1_DATASET_VERSION } from './v1-dataset.ts';

const v1 = v1Source();
const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortedIds = (ids: Iterable<string>) => [...ids].sort(byString);
const DAY = 86_400_000;

async function domainError(p: Promise<unknown>): Promise<DomainError> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(DomainError);
  return e as DomainError;
}

/** First walkable node within 60 m of `at` (validated by the production check), or undefined. */
function nearestValidNode(base: BaseData, at: LngLat): number | undefined {
  let best: { id: number; d: number } | undefined;
  for (const id of base.footNodes) {
    const c = checkAccessNode(base.graphNodes, base.footNodes, id, at);
    if (c.ok && (!best || c.distanceM < best.d || (c.distanceM === best.d && id < best.id)))
      best = { id, d: c.distanceM };
  }
  return best?.id;
}

interface Targets {
  rename: Place;
  hide: Place;
  contextOverride: Place;
  contextHide: Place;
  removedHide: Place;
  reviewOverride: Place;
}

function pickTargets(v1Base: BaseData, v2Base: BaseData, v2: CampusData): Targets {
  const v1Places = [...v1Base.places.values()].sort((a, b) => byString(a.id, b.id));
  const inventory = new Set(
    v2.buildings.features.filter((f) => f.properties.inCampusInventory).map((f) => f.properties.id),
  );
  const campusBuildings = v1Places.filter(
    (p) =>
      p.kind === 'building' &&
      p.campusZone === 'on-campus' &&
      p.location !== null &&
      v2Base.places.has(p.id) &&
      inventory.has(p.id),
  );
  // Prefer a hide target that hosts another place in v2 (exercises the footprint cascade).
  const host = campusBuildings.find((b) => v2.places.some((p) => p.buildingId === b.id && p.id !== b.id));
  const hide = host ?? campusBuildings[1]!;
  const rename = campusBuildings.find(
    (b) => b.id !== hide.id && nearestValidNode(v1Base, b.location!) !== undefined,
  )!;
  const contextFacilities = v1Places.filter(
    (p) =>
      p.campusZone === 'off-campus-nearby' &&
      p.kind === 'facility' &&
      p.name !== null &&
      v2Base.contextPlaces.has(p.id),
  );
  const removedHide = v1Places.find(
    (p) =>
      p.kind === 'building' &&
      p.campusZone === 'off-campus-nearby' &&
      !v2Base.places.has(p.id) &&
      !v2Base.contextPlaces.has(p.id),
  )!;
  const reviewOverride = v1Places.find(
    (p) =>
      p.campusZone === 'on-campus' &&
      !v2Base.places.has(p.id) &&
      v2Base.reviewItems.get(p.id)?.campusStatus === 'uncertain',
  )!;
  return {
    rename,
    hide,
    contextOverride: contextFacilities[0]!,
    contextHide: contextFacilities[1]!,
    removedHide,
    reviewOverride,
  };
}

/** Walkable nodes inside the v1 boundary, spread out, for test locations ~3 m from a node. */
function campusSpots(base: BaseData, n: number): { node: number; at: LngLat }[] {
  const out: { node: number; at: LngLat }[] = [];
  const ids = [...base.footNodes].sort((a, b) => a - b);
  for (const id of ids) {
    const [lon, lat] = base.graphNodes[id]!;
    const at: LngLat = [lon, lat + 0.00003];
    if (!pointInPolygons(at, base.boundary)) continue;
    if (out.some((s) => Math.abs(s.at[0] - at[0]) + Math.abs(s.at[1] - at[1]) < 0.003)) continue;
    const c = checkAccessNode(base.graphNodes, base.footNodes, id, at);
    if (c.ok) out.push({ node: id, at });
    if (out.length === n) break;
  }
  return out;
}

const NAMES = {
  rename: 'Compat Test Renamed Block',
  context: 'Compat Test Renamed Off-campus Shop',
  review: 'Compat Test Review Block',
  owner: 'Compat Test Owner Kiosk',
  communityRouted: 'Compat Test Community Desk',
  communityUnrouted: 'Compat Test Community Bench',
};

describe.skipIf('skip' in v1)('override survival: v1 → v2 base data (isolated local D1)', () => {
  let t: TestDb;
  let v1Base: BaseData;
  let v2Base: BaseData;
  let v2Campus: CampusData;
  let T: Targets;
  let renameNode: number;
  let ownerLoc: LocationRecord;
  let communityRouted: LocationRecord;
  let communityUnrouted: LocationRecord;
  let pubV1: Publication;
  let snapshot: { overrides: unknown[]; locations: unknown[]; suggestions: unknown[]; audit: number };
  let cV1: ReturnType<typeof clock>;
  let cV2: ReturnType<typeof clock>;

  const snap = async () => ({
    overrides: await t.rows('overrides'),
    locations: await t.rows('locations'),
    suggestions: await t.rows('suggestions'),
    audit: await t.count('audit_events'),
  });

  beforeAll(async () => {
    t = await createTestDb();
    v1Base = v1BaseData('dir' in v1 ? v1.dir : '');
    v2Base = await realBaseData();
    v2Campus = loadRealCampus();
    T = pickTargets(v1Base, v2Base, v2Campus);
    cV1 = clock(v1Base);
    cV2 = clock(v2Base, T0 + 30 * DAY);
  });
  afterAll(async () => {
    await t?.dispose();
  });

  it('fixture: the two datasets are the committed v1 and the working v2', () => {
    expect(v1Base.datasetVersion).toBe(V1_DATASET_VERSION);
    expect(v2Base.datasetVersion).not.toBe(V1_DATASET_VERSION);
    for (const p of Object.values(T)) expect(p, 'every target rule found a place').toBeDefined();
    expect(new Set(Object.values(T).map((p) => p.id)).size).toBe(6);
  });

  it('phase 1 (v1 base): seeds overrides, hides, locations and conflicting edits', async () => {
    renameNode = nearestValidNode(v1Base, T.rename.location!)!;
    // Override renaming an on-campus OSM building, with an access node.
    const r1 = await putOverride(
      t.db,
      T.rename.id,
      { revision: null, hidden: false, fields: { name: NAMES.rename }, accessPoint: { nodeId: renameNode } },
      cV1.owner(),
    );
    expect(r1.override).toMatchObject({ revision: 1, baseDatasetVersion: V1_DATASET_VERSION });
    const r2 = await putOverride(
      t.db,
      T.rename.id,
      { revision: 1, hidden: false, fields: { name: NAMES.rename, description: 'Compat test description' } },
      cV1.owner(),
    );
    expect(r2.override).toMatchObject({ revision: 2, accessNodeId: renameNode });
    // Conflicting-revision edit: a second editor still holds revision 1.
    const stale = await domainError(
      putOverride(
        t.db,
        T.rename.id,
        { revision: 1, hidden: false, fields: { name: 'Lost update' } },
        cV1.owner(),
      ),
    );
    expect(stale.code).toBe('conflict');

    await hideOverride(t.db, T.hide.id, {}, cV1.owner());
    await putOverride(
      t.db,
      T.contextOverride.id,
      { revision: null, hidden: false, fields: { name: NAMES.context } },
      cV1.owner(),
    );
    await hideOverride(t.db, T.contextHide.id, {}, cV1.owner());
    await hideOverride(t.db, T.removedHide.id, {}, cV1.owner());
    await putOverride(
      t.db,
      T.reviewOverride.id,
      { revision: null, hidden: false, fields: { name: NAMES.review } },
      cV1.owner(),
    );

    const [s1, s2, s3] = campusSpots(v1Base, 3);
    expect(s3, 'three walkable campus spots').toBeDefined();
    ownerLoc = await createLocation(
      t.db,
      {
        fields: { name: NAMES.owner, categoryId: 'water', location: s1!.at },
        accessPoint: { nodeId: s1!.node },
      },
      cV1.owner(),
    );
    ownerLoc = await updateLocation(
      t.db,
      ownerLoc.id,
      { revision: 1, fields: { description: 'Compat test: owner location' } },
      cV1.owner(),
    );
    const staleLoc = await domainError(
      updateLocation(t.db, ownerLoc.id, { revision: 1, fields: { description: 'Lost update' } }, cV1.owner()),
    );
    expect(staleLoc.code).toBe('conflict');

    const ref1 = (
      await createSuggestion(
        t.db,
        contribution({ name: NAMES.communityRouted, categoryId: 'health', location: s2!.at }),
        cV1.anon(),
      )
    ).reference;
    communityRouted = (
      await approveSuggestion(t.db, ref1, { revision: 1, accessPoint: { nodeId: s2!.node } }, cV1.owner())
    ).location;
    const ref2 = (
      await createSuggestion(
        t.db,
        contribution({ name: NAMES.communityUnrouted, categoryId: 'health', location: s3!.at }),
        cV1.anon(),
      )
    ).reference;
    communityUnrouted = (await approveSuggestion(t.db, ref2, { revision: 1 }, cV1.owner())).location;
    expect(communityRouted.accessNodeId).toBe(s2!.node);
    expect(communityUnrouted.accessNodeId).toBeNull();

    // Under v1 nothing is an orphan.
    const q = await getQualityWarnings(t.db, cV1.owner());
    expect(q.counts['orphan-override']).toBe(0);
    expect(await t.count('overrides')).toBe(6);
    pubV1 = await getPublication(t.db);
    snapshot = await snap();
  });

  it('phase 2 (v2 base): D1 is untouched by the switch — no row deleted, rewritten or added', async () => {
    await listOverrides(t.db, cV2.owner());
    await getQualityWarnings(t.db, cV2.owner());
    await listLocations(t.db);
    expect(await getPublication(t.db)).toEqual(pubV1);
    expect(await snap()).toEqual(snapshot);
  });

  it('campus overrides and hides still apply; vanished targets are orphans with a reason', async () => {
    const list = await listOverrides(t.db, cV2.owner());
    const byId = new Map(list.items.map((o) => [o.targetId, o]));
    expect(byId.get(T.rename.id)).toMatchObject({ orphan: false, orphanReason: null, hidden: false });
    expect(byId.get(T.hide.id)).toMatchObject({ orphan: false, orphanReason: null, hidden: true });
    expect(byId.get(T.contextOverride.id)).toMatchObject({ orphan: true, orphanReason: 'context-layer' });
    expect(byId.get(T.contextHide.id)).toMatchObject({
      orphan: true,
      orphanReason: 'context-layer',
      hidden: true,
    });
    expect(byId.get(T.removedHide.id)).toMatchObject({
      orphan: true,
      orphanReason: 'not-in-dataset',
      hidden: true,
    });
    expect(byId.get(T.reviewOverride.id)).toMatchObject({ orphan: true, orphanReason: 'boundary-review' });
    // Orphans stay viewable (and explicitly deletable), but cannot be edited against v2.
    expect(await getOverride(t.db, T.contextOverride.id, cV2.owner())).toMatchObject({
      orphan: true,
      place: null,
    });
    const edit = await domainError(
      putOverride(
        t.db,
        T.contextOverride.id,
        { revision: 1, hidden: false, fields: { name: 'x' } },
        cV2.owner(),
      ),
    );
    expect(edit.code).toBe('not-found');
    // A conflicting-revision edit is still refused after the switch.
    const stale = await domainError(
      putOverride(
        t.db,
        T.rename.id,
        { revision: 1, hidden: false, fields: { name: 'Lost update' } },
        cV2.owner(),
      ),
    );
    expect(stale.code).toBe('conflict');
    // Data rows unchanged; the only new rows are the two REJECTED attempts in the audit log.
    const after = await snap();
    expect({ ...after, audit: 0 }).toEqual({ ...snapshot, audit: 0 });
    const added = (
      await t.rows<{ action: string; outcome: string; entity_id: string }>('audit_events')
    ).slice(snapshot.audit);
    expect(added.map((a) => [a.action, a.outcome, a.entity_id])).toEqual([
      ['override.put', 'rejected', T.contextOverride.id],
      ['override.put', 'rejected', T.rename.id],
    ]);
    snapshot = after;
  });

  it('quality warnings list exactly the orphans (with reasons) and re-validate access nodes on the v2 graph', async () => {
    const q = await getQualityWarnings(t.db, cV2.owner());
    const orphans = q.warnings.filter((w) => w.kind === 'orphan-override');
    expect(sortedIds(orphans.map((w) => w.id))).toEqual(
      sortedIds([T.contextOverride.id, T.contextHide.id, T.removedHide.id, T.reviewOverride.id]),
    );
    const reason = new Map(orphans.map((w) => [w.id, w.orphanReason]));
    expect(reason.get(T.contextOverride.id)).toBe('context-layer');
    expect(reason.get(T.removedHide.id)).toBe('not-in-dataset');
    expect(reason.get(T.reviewOverride.id)).toBe('boundary-review');
    for (const w of orphans) {
      expect(w.message).toContain(V1_DATASET_VERSION);
      expect(w.message).toContain(v2Base.datasetVersion);
    }
    // Access nodes: every stored node is re-checked against the v2 graph (unchanged indices → still valid).
    expect(q.counts['override-access-invalid']).toBe(0);
    for (const l of [ownerLoc, communityRouted])
      expect(checkAccessNode(v2Base.graphNodes, v2Base.footNodes, l.accessNodeId!, l.location).ok).toBe(true);
    const notRoutable = q.warnings.filter((w) => w.kind === 'location-not-routable').map((w) => w.id);
    expect(notRoutable).toEqual([communityUnrouted.id]);
    expect(q.warnings.filter((w) => w.kind === 'location-outside-boundary')).toEqual([]);
    const ov = await getOverview(t.db, cV2.owner());
    expect(ov.overrides).toMatchObject({ total: 6, hidden: 3, orphan: 4, withAccessPoint: 1 });
    expect(ov.datasetVersion).toBe(v2Base.datasetVersion);
  });

  it('owner and community locations persist unchanged', async () => {
    const { items } = await listLocations(t.db);
    expect(sortedIds(items.map((l) => l.id))).toEqual(
      sortedIds([ownerLoc.id, communityRouted.id, communityUnrouted.id]),
    );
    expect(items.find((l) => l.id === ownerLoc.id)).toEqual(ownerLoc);
    expect(items.find((l) => l.id === communityRouted.id)).toEqual(communityRouted);
    expect(items.find((l) => l.id === communityUnrouted.id)).toEqual(communityUnrouted);
  });

  it('merge on v2 applies campus overrides only, never to another feature, deterministically', async () => {
    const pub = await getPublication(t.db);
    const before = JSON.stringify(v2Campus);
    const m = mergePublication(v2Campus, pub);
    const again = mergePublication(v2Campus, {
      ...pub,
      overrides: shuffled(pub.overrides, 7),
      locations: shuffled(pub.locations, 11),
    });
    expect(JSON.stringify(again)).toBe(JSON.stringify(m));
    expect(JSON.stringify(v2Campus)).toBe(before); // base never mutated

    const r = m.report;
    expect(sortedIds(r.orphanOverrides)).toEqual(
      sortedIds([T.contextOverride.id, T.contextHide.id, T.removedHide.id, T.reviewOverride.id]),
    );
    expect(r.overriddenPlaces).toEqual([T.rename.id]);
    expect(r.hiddenPlaces).toEqual([T.hide.id]);
    expect(r.removedBuildings).toEqual([T.hide.id]);
    expect(sortedIds(r.addedLocations)).toEqual(
      sortedIds([ownerLoc.id, communityRouted.id, communityUnrouted.id]),
    );
    expect(r.invalidAccess).toEqual([]);
    expect(r.shadowedLocations).toEqual([]);

    const out = new Map(m.data.places.map((p) => [p.id, p]));
    expect(out.get(T.rename.id)).toMatchObject({
      name: NAMES.rename,
      graphNodeId: renameNode,
      provenance: { sourceId: 'owner' },
    });
    expect(m.data.buildings.features.find((f) => f.properties.id === T.rename.id)?.properties.name).toBe(
      NAMES.rename,
    );
    expect(out.has(T.hide.id)).toBe(false);
    expect(m.data.buildings.features.some((f) => f.properties.id === T.hide.id)).toBe(false);
    expect(m.data.relations.some((x) => x.from === T.hide.id || x.to === T.hide.id)).toBe(false);
    expect(out.get(ownerLoc.id)?.graphNodeId).toBe(ownerLoc.accessNodeId);
    expect(out.get(communityRouted.id)?.graphNodeId).toBe(communityRouted.accessNodeId);
    expect(out.get(communityUnrouted.id)?.graphNodeId).toBeUndefined();

    // Orphans are applied to nothing: their names appear nowhere in the merged data.
    const json = JSON.stringify(m.data);
    expect(json).not.toContain(NAMES.context);
    expect(json).not.toContain(NAMES.review);
    // Every other base place is byte-identical (except losing buildingId of the hidden footprint).
    for (const p of v2Campus.places) {
      if (p.id === T.rename.id || p.id === T.hide.id) continue;
      if (p.buildingId === T.hide.id) {
        const { buildingId: _b, ...rest } = p;
        expect(out.get(p.id)).toEqual(rest);
      } else expect(out.get(p.id)).toBe(p);
    }
    expect(m.data.places.length).toBe(v2Campus.places.length - 1 + 3);
    // Counts are recomputed from the merged campus data.
    expect(m.data.manifest.counts.places).toBe(m.data.places.length);
    expect(m.data.manifest.counts.buildings).toBe(
      m.data.buildings.features.filter((f) => f.properties.inCampusInventory).length,
    );
  });

  it('access nodes are re-validated: a rebuild that breaks one makes it unroutable, D1 keeps it', async () => {
    const node = ownerLoc.accessNodeId!;
    const graph = {
      ...v2Campus.graph,
      edges: v2Campus.graph.edges.map((e) => (e.from === node || e.to === node ? { ...e, foot: false } : e)),
    };
    const rebuilt = buildBaseData({
      datasetVersion: 'compat-sim-rebuild',
      places: v2Campus.places,
      graph,
      boundary: v2Campus.boundary,
    });
    const q = await getQualityWarnings(t.db, { base: rebuilt, now: cV2.now });
    expect(q.warnings.filter((w) => w.kind === 'location-not-routable').map((w) => w.id)).toContain(
      ownerLoc.id,
    );
    const m = mergePublication({ ...v2Campus, graph }, await getPublication(t.db));
    expect(m.report.invalidAccess.map((i) => i.id)).toContain(ownerLoc.id);
    expect(m.data.places.find((p) => p.id === ownerLoc.id)?.graphNodeId).toBeUndefined();
    expect((await snap()).locations).toEqual(snapshot.locations);
  });

  it('refresh reintroduces a hidden building: it stays hidden', async () => {
    // A refresh that drops the building (e.g. an OSM edit) makes the hide an orphan — kept in D1 ...
    const without = buildBaseData({
      datasetVersion: 'compat-sim-dropped',
      places: v2Campus.places.filter((p) => p.id !== T.hide.id),
      graph: v2Campus.graph,
      boundary: v2Campus.boundary,
    });
    const dropped = await listOverrides(t.db, { base: without });
    expect(dropped.items.find((o) => o.targetId === T.hide.id)).toMatchObject({ orphan: true, hidden: true });
    // ... and the next refresh that brings it back hides it again, with no owner action.
    const back = {
      ...v2Campus,
      manifest: { ...v2Campus.manifest, datasetVersion: 'compat-sim-reintroduced' },
    };
    const m = mergePublication(back, await getPublication(t.db));
    expect(m.report.hiddenPlaces).toEqual([T.hide.id]);
    expect(m.data.places.some((p) => p.id === T.hide.id)).toBe(false);
    expect(m.data.buildings.features.some((f) => f.properties.id === T.hide.id)).toBe(false);
    expect(await snap()).toEqual(snapshot);
  });

  it('rollback to v1: the same rows apply again (orphans reappear as applied)', async () => {
    // Every v2 place id exists in v1, so nothing made in the v2 era becomes an orphan after rollback.
    for (const id of v2Base.places.keys()) expect(v1Base.places.has(id)).toBe(true);
    const back = clock(v1Base, T0 + 60 * DAY);
    const list = await listOverrides(t.db, back.owner());
    expect(list.items.every((o) => !o.orphan && o.orphanReason === null)).toBe(true);
    const q = await getQualityWarnings(t.db, back.owner());
    expect(q.counts['orphan-override']).toBe(0);
    expect(q.counts['override-access-invalid']).toBe(0);
    expect(await snap()).toEqual(snapshot);
  });

  it('an orphan is removed only by an explicit, audited owner delete', async () => {
    const row = (await listOverrides(t.db, cV2.owner())).items.find((o) => o.targetId === T.removedHide.id)!;
    await deleteOverride(t.db, T.removedHide.id, { revision: row.revision }, cV2.owner());
    expect(await t.count('overrides')).toBe(5);
    const audit = await listAudit(t.db, { entityType: 'override' });
    expect(audit.items.some((e) => e.action === 'override.delete' && e.entityId === T.removedHide.id)).toBe(
      true,
    );
  });
});
