/**
 * Recovery and rebuild survival, end to end through D1:
 * - revertAuditEvent restores EXACTLY the before snapshot (every editable
 *   field), as a new revision, audited, and can itself be reverted;
 * - permanent delete keeps the full before snapshot in the audit log and is
 *   recoverable from it;
 * - a simulated OSM rebuild (place removed, place renamed, new dataset
 *   version) keeps overrides on surviving targets, reports orphans, keeps
 *   hidden places hidden and keeps owner/community locations published.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/test-db.ts';
import {
  BLOCK_34,
  fakeBaseData,
  FOOD_COURT,
  LIBRARY,
  PLACES,
  syntheticCampus,
} from '../helpers/base-data.ts';
import { clock, contribution } from '../helpers/context.ts';
import {
  approveSuggestion,
  createLocation,
  createSuggestion,
  deleteLocation,
  getOverview,
  getPublication,
  getQualityWarnings,
  hit,
  hideLocation,
  hideOverride,
  listAudit,
  putOverride,
  revertAuditEvent,
  updateLocation,
} from '../../../server/domain/index.ts';
import { getLocationRow } from '../../../server/db/locations.ts';
import { getOverrideRow } from '../../../server/db/overrides.ts';
import type { LocationRecord, OverrideRecord } from '../../../server/db/records.ts';
import { mergePublication } from '../../../src/community/merge.ts';
import { domainError } from './helpers.ts';

const base = fakeBaseData();
const EDITABLE: (keyof LocationRecord)[] = [
  'name',
  'categoryId',
  'location',
  'description',
  'openingHours',
  'wheelchair',
  'website',
  'sourceUrl',
  'verificationStatus',
  'lastVerifiedAt',
  'accessNodeId',
  'accessNote',
  'status',
];
const pick = <T extends object>(o: T, keys: (keyof T)[]) => Object.fromEntries(keys.map((k) => [k, o[k]]));
const OVERRIDE_CONTENT: (keyof OverrideRecord)[] = ['fields', 'hidden', 'accessNodeId', 'accessNote', 'note'];

describe('recovery: revert restores exactly the before snapshot', () => {
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
  const lastEvent = async (action: string, entityId: string) =>
    (await listAudit(t.db, { action, entityId, limit: 1 })).items[0]!;

  it('an edit touching every field is undone field for field; reverting the revert re-applies it', async () => {
    const loc = await createLocation(
      t.db,
      {
        fields: {
          name: 'Central ATM',
          categoryId: 'finance',
          location: [75.7005, 31.2501],
          description: 'Two machines',
          openingHours: 'Mo-Su 00:00-24:00',
          wheelchair: 'yes',
          website: 'https://example.org/atm',
          sourceUrl: 'https://example.org/src',
          verificationStatus: 'verified',
          lastVerifiedAt: '2026-09-01',
        },
        accessPoint: { nodeId: 1, note: 'Front door' },
      },
      c.owner(),
    );
    const original = (await getLocationRow(t.db, loc.id))!;
    await updateLocation(
      t.db,
      loc.id,
      {
        revision: 1,
        fields: {
          name: 'Wrong ATM',
          categoryId: 'shop',
          location: [75.7009, 31.2501],
          description: null,
          openingHours: null,
          wheelchair: 'no',
          website: null,
          sourceUrl: null,
          verificationStatus: 'unverified',
          lastVerifiedAt: null,
        },
        accessPoint: { nodeId: 2 },
      },
      c.owner(),
    );
    const edited = (await getLocationRow(t.db, loc.id))!;
    const ev = await lastEvent('location.update', loc.id);
    expect(ev.before).toEqual(original);

    const v = (await getPublication(t.db)).publicationVersion;
    await revertAuditEvent(t.db, ev.id, c.owner());
    const restored = (await getLocationRow(t.db, loc.id))!;
    expect(pick(restored, EDITABLE)).toEqual(pick(original, EDITABLE));
    expect(restored).toMatchObject({
      id: loc.id,
      origin: 'owner',
      createdAt: original.createdAt,
      revision: 3,
    });
    expect((await getPublication(t.db)).publicationVersion).toBe(v + 1);
    const revertEv = await lastEvent('location.revert', loc.id);
    expect(revertEv).toMatchObject({ outcome: 'success', before: edited, after: restored });

    // Undo the undo: the edited values come back exactly.
    await revertAuditEvent(t.db, revertEv.id, c.owner());
    expect(pick((await getLocationRow(t.db, loc.id))!, EDITABLE)).toEqual(pick(edited, EDITABLE));
  });

  it('delete keeps the full before snapshot; revert restores it exactly (hidden, not public)', async () => {
    const loc = await createLocation(
      t.db,
      {
        fields: {
          name: 'Old Kiosk',
          categoryId: 'shop',
          location: [75.7005, 31.2501],
          description: 'Closed',
        },
        accessPoint: { nodeId: 1 },
      },
      c.owner(),
    );
    await hideLocation(t.db, loc.id, { revision: 1 }, c.owner());
    const beforeDelete = (await getLocationRow(t.db, loc.id))!;
    // Wrong confirmation and active-state deletes are refused and change nothing.
    expect(
      (await domainError(deleteLocation(t.db, loc.id, { revision: 2, confirmName: 'old kiosk' }, c.owner())))
        .code,
    ).toBe('invalid');
    expect(
      (await domainError(deleteLocation(t.db, loc.id, { revision: 2, confirmName: ' Old Kiosk' }, c.owner())))
        .code,
    ).toBe('invalid');
    await deleteLocation(t.db, loc.id, { revision: 2, confirmName: 'Old Kiosk' }, c.owner());
    expect(await getLocationRow(t.db, loc.id)).toBeNull();
    const ev = await lastEvent('location.delete', loc.id);
    expect(ev.before).toEqual(beforeDelete);
    expect(ev.after).toBeNull();

    const v = (await getPublication(t.db)).publicationVersion;
    await revertAuditEvent(t.db, ev.id, c.owner());
    const restored = (await getLocationRow(t.db, loc.id))!;
    expect(pick(restored, EDITABLE)).toEqual(pick(beforeDelete, EDITABLE));
    expect(restored).toMatchObject({ createdAt: beforeDelete.createdAt, createdBy: beforeDelete.createdBy });
    // Hidden locations are not public, so the publication did not change.
    expect((await getPublication(t.db)).publicationVersion).toBe(v);
    expect((await getPublication(t.db)).locations.some((l) => l.id === loc.id)).toBe(false);
  });

  it('an override edit (fields, hidden, access, private note) is restored exactly', async () => {
    await putOverride(
      t.db,
      FOOD_COURT.id,
      {
        revision: null,
        hidden: false,
        fields: { name: 'Food Court North', openingHours: 'Mo-Sa 08:00-22:00' },
        accessPoint: { nodeId: 2, note: 'Side gate' },
        note: 'Checked on site',
      },
      c.owner(),
    );
    const original = (await getOverrideRow(t.db, FOOD_COURT.id))!;
    await putOverride(
      t.db,
      FOOD_COURT.id,
      { revision: 1, hidden: true, fields: { description: 'Closed' }, accessPoint: null, note: null },
      c.owner(),
    );
    const ev = await lastEvent('override.put', FOOD_COURT.id);
    await revertAuditEvent(t.db, ev.id, c.owner());
    const restored = (await getOverrideRow(t.db, FOOD_COURT.id))!;
    expect(pick(restored, OVERRIDE_CONTENT)).toEqual(pick(original, OVERRIDE_CONTENT));
    expect(restored.revision).toBe(3);
    const merged = mergePublication(syntheticCampus(), await getPublication(t.db));
    expect(merged.data.places.find((p) => p.id === FOOD_COURT.id)).toMatchObject({
      name: 'Food Court North',
      graphNodeId: 2,
    });
  });
});

describe('rebuild survival through D1 → publication → merge', () => {
  let t: TestDb;
  const c = clock(base);
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.dispose();
  });

  it('keeps surviving overrides, reports orphans, keeps hidden hidden and published locations published', async () => {
    // Owner work on dataset v1.
    await putOverride(
      t.db,
      LIBRARY.id,
      { revision: null, hidden: false, fields: { name: 'Owner Library' } },
      c.owner(),
    );
    await putOverride(
      t.db,
      FOOD_COURT.id,
      { revision: null, hidden: false, fields: { description: 'Gone soon' } },
      c.owner(),
    );
    await hideOverride(t.db, BLOCK_34.id, { revision: null }, c.owner());
    const own = await createLocation(
      t.db,
      {
        fields: { name: 'Water Cooler', categoryId: 'water', location: [75.7009, 31.2501] },
        accessPoint: { nodeId: 2 },
      },
      c.owner(),
    );
    const { reference } = await createSuggestion(t.db, contribution(), c.anon());
    const { location: com } = await approveSuggestion(t.db, reference, { revision: 1 }, c.owner());

    // OSM refresh: the food court is gone, the library was renamed upstream, new dataset version.
    const places = PLACES.filter((p) => p.id !== FOOD_COURT.id).map((p) =>
      p.id === LIBRARY.id ? { ...p, name: 'Library (OSM rename)', displayName: 'Library (OSM rename)' } : p,
    );
    const rebuiltBase = fakeBaseData({ datasetVersion: 'synthetic-v2', places });
    const campus = syntheticCampus({
      places,
      relations: syntheticCampus().relations.filter(
        (r) => r.from !== FOOD_COURT.id && r.to !== FOOD_COURT.id,
      ),
    });
    campus.manifest = { ...campus.manifest, datasetVersion: 'synthetic-v2' };

    const publication = await getPublication(t.db);
    const { data, report } = mergePublication(campus, publication);
    expect(report.orphanOverrides).toEqual([FOOD_COURT.id]);
    expect(data.places.some((p) => p.description === 'Gone soon')).toBe(false);
    expect(data.places.find((p) => p.id === LIBRARY.id)?.name).toBe('Owner Library');
    expect(data.places.some((p) => p.id === BLOCK_34.id)).toBe(false);
    expect(data.buildings.features.some((f) => f.properties.id === BLOCK_34.id)).toBe(false);
    expect(data.places.find((p) => p.id === own.id)?.graphNodeId).toBe(2);
    expect(data.places.find((p) => p.id === com.id)).toMatchObject({ name: 'Campus Pharmacy' });
    expect(data.places.find((p) => p.id === com.id)?.graphNodeId).toBeUndefined();
    expect(data.manifest.datasetVersion).toBe('synthetic-v2');

    // The admin quality view reports the orphan against the version it was made on.
    const q = await getQualityWarnings(t.db, c.owner({ base: rebuiltBase }));
    const orphan = q.warnings.find((w) => w.kind === 'orphan-override');
    expect(orphan?.id).toBe(FOOD_COURT.id);
    expect(orphan?.message).toContain('synthetic-v1');
    // Nothing in D1 was lost or rewritten by the rebuild.
    expect(await t.count('overrides')).toBe(3);
    expect(await t.count('locations')).toBe(2);
  });
});

describe('retention of operational rows (rate limits, sessions)', () => {
  let t: TestDb;
  const c = clock(base);
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.dispose();
  });

  it('the owner dashboard purges expired buckets and sessions even when no public traffic arrives', async () => {
    const day = 86_400_000;
    const old = new Date(c.now.getTime() - 3 * day);
    // A daily bucket and an 8 h session created three days ago (both long expired), plus live ones.
    await hit(t.db, 'rl:live-bucket-000', 5, 600, c.now);
    // Inserted directly: hit() would itself purge expired rows, which is the path being bypassed here.
    await t.db
      .prepare('INSERT INTO rate_limits (bucket, count, window_start, expires_at) VALUES (?, ?, ?, ?)')
      .bind('rl:expired-daily-bucket', 3, old.toISOString(), new Date(old.getTime() + day).toISOString())
      .run();
    await t.db
      .prepare(
        'INSERT INTO sessions (id_hash, actor, csrf_token, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(
        'e'.repeat(64),
        'owner',
        'c'.repeat(32),
        old.toISOString(),
        new Date(old.getTime() + 8 * 3_600_000).toISOString(),
        old.toISOString(),
      )
      .run();
    expect(await t.count('rate_limits')).toBe(2);
    expect(await t.count('sessions')).toBe(1);

    await getOverview(t.db, c.owner());
    const rows = await t.rows<{ bucket: string }>('rate_limits');
    expect(rows.map((r) => r.bucket)).toEqual(['rl:live-bucket-000']);
    expect(await t.count('sessions')).toBe(0);
  });
});
