/**
 * Routing safety through the whole pipeline (domain → D1 → publication →
 * merge): a location or base place becomes routable only through an
 * explicitly supplied access node that validates against the CURRENT graph.
 * Routing fields smuggled inside `fields`, or stale nodes after a graph
 * rebuild, never produce a graphNodeId.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/test-db.ts';
import { fakeBaseData, FOOD_COURT, GRAPH, LIBRARY, syntheticCampus } from '../helpers/base-data.ts';
import { clock, contribution } from '../helpers/context.ts';
import {
  approveSuggestion,
  createLocation,
  createSuggestion,
  getPublication,
  putOverride,
  updateLocation,
} from '../../../server/domain/index.ts';
import { getLocationRow } from '../../../server/db/locations.ts';
import { getOverrideRow } from '../../../server/db/overrides.ts';
import { mergePublication } from '../../../src/community/merge.ts';
import { createFacilityDirectory } from '../../../src/facilities/directory.ts';
import { domainError } from './helpers.ts';

const base = fakeBaseData();
const SMUGGLED = {
  accessNodeId: 2,
  graphNodeId: 2,
  connectorLengthM: 1,
  status: 'hidden',
  origin: 'community',
};

describe('routing safety end to end', () => {
  let t: TestDb;
  const c = clock(base);
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.dispose();
  });
  beforeEach(async () => {
    await t.reset();
  });

  const merged = async (campus = syntheticCampus()) => mergePublication(campus, await getPublication(t.db));

  it('routing fields smuggled inside `fields` never make anything routable', async () => {
    const own = await createLocation(
      t.db,
      { fields: { name: 'Water Cooler', categoryId: 'water', location: [75.7009, 31.2501], ...SMUGGLED } },
      c.owner(),
    );
    expect(await getLocationRow(t.db, own.id)).toMatchObject({
      accessNodeId: null,
      status: 'active',
      origin: 'owner',
    });

    const { reference } = await createSuggestion(t.db, contribution(SMUGGLED), c.anon());
    const { location: com } = await approveSuggestion(
      t.db,
      reference,
      { revision: 1, fields: SMUGGLED },
      c.owner(),
    );
    expect(com).toMatchObject({ accessNodeId: null, status: 'active', origin: 'community' });

    await updateLocation(t.db, own.id, { revision: 1, fields: { description: 'x', ...SMUGGLED } }, c.owner());
    expect(await getLocationRow(t.db, own.id)).toMatchObject({
      accessNodeId: null,
      status: 'active',
      revision: 2,
    });

    // On a base place without a node, an override carrying only smuggled keys stores nothing.
    await putOverride(t.db, FOOD_COURT.id, { revision: null, hidden: false, fields: SMUGGLED }, c.owner());
    expect(await getOverrideRow(t.db, FOOD_COURT.id)).toBeNull();

    const { data } = await merged();
    const dir = createFacilityDirectory(data.places, data.relations);
    for (const id of [own.id, com.id, FOOD_COURT.id]) {
      const p = dir.get(id)!;
      expect(p.graphNodeId).toBeUndefined();
      expect(dir.isRoutable(p)).toBe(false);
    }
  });

  it('access points are validated at write time (missing, not walkable, too far are refused)', async () => {
    const at = [75.7009, 31.2501];
    for (const nodeId of [3, 4, 99, 0]) {
      const e = await domainError(
        createLocation(
          t.db,
          { fields: { name: 'Kiosk', categoryId: 'shop', location: at }, accessPoint: { nodeId } },
          c.owner(),
        ),
      );
      expect(e.status).toBe(422);
    }
    expect(await t.count('locations')).toBe(0);
  });

  it('a node valid when saved but invalid after a graph rebuild leaves the place NOT routable', async () => {
    const own = await createLocation(
      t.db,
      {
        fields: { name: 'Water Cooler', categoryId: 'water', location: [75.7009, 31.2501] },
        accessPoint: { nodeId: 2 },
      },
      c.owner(),
    );
    await putOverride(
      t.db,
      LIBRARY.id,
      { revision: null, hidden: false, fields: {}, accessPoint: { nodeId: 2 } },
      c.owner(),
    );
    expect((await merged()).data.places.find((p) => p.id === own.id)?.graphNodeId).toBe(2);

    // Rebuild: the 1–2 footway lost foot access, so node 2 touches no walkable edge.
    const rebuiltGraph = {
      ...GRAPH,
      edges: GRAPH.edges.map((e) => (e.id === 1 ? { ...e, foot: false } : e)),
    };
    const { data, report } = await merged(syntheticCampus({ graph: rebuiltGraph }));
    const dir = createFacilityDirectory(data.places, data.relations);
    for (const id of [own.id, LIBRARY.id]) {
      expect(dir.get(id)?.graphNodeId).toBeUndefined();
      expect(dir.isRoutable(dir.get(id)!)).toBe(false);
    }
    expect(report.invalidAccess.map((i) => [i.id, i.reason]).sort()).toEqual(
      [
        [LIBRARY.id, 'override-not-walkable'],
        [own.id, 'location-not-walkable'],
      ].sort(),
    );
    // The stored records are untouched: fixing the graph (or choosing a new node) restores routing.
    expect((await getLocationRow(t.db, own.id))?.accessNodeId).toBe(2);
  });
});
