/**
 * Models of existing base buildings (S4, S5, §2) and survival across a
 * base-data version change (§12): the base snapshot is never rewritten, one
 * studio record per target, the footprint-prism model keeps the mapped
 * footprint, and a record whose target disappears in a new datasetVersion is
 * KEPT in D1, flagged as an orphan with a reason, and can never be published
 * or restored against the new data (no silent D1 change on a data deploy).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPublication } from '../../../server/domain/publication.ts';
import {
  archiveStudioBuilding,
  createStudioBuilding,
  getStudioBuilding,
  getStudioQuality,
  publishStudioBuilding,
  restoreStudioBuilding,
  saveStudioDraft,
} from '../../../server/domain/studio/index.ts';
import { DomainError } from '../../../server/errors.ts';
import {
  publishResponseSchema,
  studioBuildingDetailSchema,
  studioQualityResponseSchema,
} from '../../../src/building-studio/schema.ts';
import { publicationSchema } from '../../../src/community/schema.ts';
import { createTestDb, type TestDb } from '../helpers/test-db.ts';
import {
  prismDraft,
  publicationVersion,
  publishBody,
  realStudioBase,
  studioBaseWithout,
  studioClock,
  studioSnapshot,
} from './helpers.ts';

let t: TestDb;
const base = realStudioBase();
const c = studioClock(base);
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.dispose();
});

async function domainError(p: Promise<unknown>): Promise<DomainError> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(DomainError);
  return e as DomainError;
}

/** Inside-campus base buildings, by rule (not hard-coded ids). */
const inside = base.buildings.features.filter(
  (f) => f.properties.campusStatus === 'inside' && f.properties.membershipDecision === 'auto',
);
const [TARGET, OTHER] = [inside[0]!.properties.id, inside[1]!.properties.id];

describe('base-building models', () => {
  it('footprint-prism: the server fixes anchor/rotation/size from the base footprint and publishes the mapped footprint unchanged', async () => {
    const d = studioBuildingDetailSchema.parse(
      await createStudioBuilding(t.db, { targetId: TARGET, draft: prismDraft(TARGET) }, c.owner()),
    );
    expect(d.head.targetId).toBe(TARGET);
    expect(d.draft!.model.rotationDeg).toBe(0);
    expect(d.draft!.model.widthM).not.toBe(10); // informational size derived from the base footprint
    expect(base.boundary.containsPoint(d.draft!.model.anchor)).toBe(true);
    expect(d.validation?.errorCount, JSON.stringify(d.validation?.issues)).toBe(0);

    const r = publishResponseSchema.parse(
      await publishStudioBuilding(t.db, d.head.id, publishBody(1), c.owner()),
    );
    const baseCoords = base.buildingsById.get(TARGET)!.geometry.coordinates as number[][][];
    // same polygon (rings may start at another vertex after RFC 7946 normalization; compare as vertex sets)
    const asSet = (rings: number[][][]) =>
      new Set(rings.flat().map((p) => `${p[0]!.toFixed(7)},${p[1]!.toFixed(7)}`));
    expect(asSet(r.building.published!.footprint.coordinates as number[][][])).toEqual(asSet(baseCoords));
    const pub = publicationSchema.parse(await getPublication(t.db));
    const b = pub.buildings!.find((x) => x.id === d.head.id)!;
    expect(b).toMatchObject({
      targetId: TARGET,
      identity: null,
      accessNodeId: null,
      positionCorrected: false,
    });
  });

  it('one studio record per base building (409 with the existing head); unknown targets are 404', async () => {
    const before = await studioSnapshot(t.db);
    const dup = await domainError(
      createStudioBuilding(t.db, { targetId: TARGET, draft: prismDraft(TARGET) }, c.owner()),
    );
    expect(dup.code).toBe('conflict');
    expect((dup.details as { current: { targetId: string } }).current.targetId).toBe(TARGET);
    const missing = await domainError(
      createStudioBuilding(t.db, { targetId: 'osm:way/1', draft: prismDraft(TARGET) }, c.owner()),
    );
    expect(missing.code).toBe('not-found');
    expect((await studioSnapshot(t.db)).buildings).toEqual(before.buildings);
  });

  it('identity/access on a base model, or a footprint-prism new building, are validation errors (never silently dropped)', async () => {
    const d = studioBuildingDetailSchema.parse(
      await createStudioBuilding(
        t.db,
        { targetId: OTHER, draft: { ...prismDraft(OTHER), accessNodeId: 1 } },
        c.owner(),
      ),
    );
    expect(d.validation?.issues.map((i) => i.code)).toContain('not-applicable');
    const e = await domainError(publishStudioBuilding(t.db, d.head.id, publishBody(1), c.owner()));
    expect(e.code).toBe('validation-failed');
    await archiveStudioBuilding(t.db, d.head.id, { revision: 1, reason: null }, c.owner());
  });
});

describe('a new base-data version where the target disappeared', () => {
  it('keeps the record, flags it as an orphan with a reason, and blocks publish and restore', async () => {
    const head = (await t.db
      .prepare('SELECT id, revision FROM studio_buildings WHERE target_id = ?')
      .bind(TARGET)
      .first<{ id: string; revision: number }>())!;
    const refreshed = studioBaseWithout([TARGET]);
    expect(refreshed.datasetVersion).not.toBe(base.datasetVersion);
    const next = studioClock(refreshed, c.now.getTime());
    const snap = await studioSnapshot(t.db);
    const pv = await publicationVersion(t.db);

    // reads against the new data change nothing in D1
    const detail = studioBuildingDetailSchema.parse(await getStudioBuilding(t.db, head.id, next.owner()));
    expect(detail.head).toMatchObject({ status: 'published', targetId: TARGET, publishedVersion: 1 });
    expect(detail.validation?.issues.map((i) => i.code)).toContain('base-target-missing');
    const q = studioQualityResponseSchema.parse(await getStudioQuality(t.db, next.owner()));
    const orphan = q.warnings.find((w) => w.kind === 'orphan-target' && w.id === head.id);
    expect(orphan?.targetId).toBe(TARGET);
    expect(orphan?.message).toMatch(/not in the current base dataset \(test-refresh-1\)/);
    expect(q.warnings.find((w) => w.kind === 'now-invalid' && w.id === head.id)).toBeDefined();
    expect(await studioSnapshot(t.db)).toEqual(snap);
    expect(await publicationVersion(t.db)).toBe(pv);

    // a new publish of the orphan is refused (it would publish a model of a building that no longer exists)
    const saved = studioBuildingDetailSchema.parse(
      await saveStudioDraft(
        t.db,
        head.id,
        { revision: head.revision, draft: prismDraft(TARGET) },
        next.owner(),
      ),
    );
    const pub = await domainError(
      publishStudioBuilding(t.db, head.id, publishBody(saved.head.revision), next.owner()),
    );
    expect(pub.code).toBe('validation-failed');
    expect(
      (pub.details as { validation: { issues: { code: string }[] } }).validation.issues.map((i) => i.code),
    ).toContain('base-target-missing');

    // archived, it cannot be restored against the new data either; the record stays in D1
    const arch = publishResponseSchema.parse(
      await archiveStudioBuilding(
        t.db,
        head.id,
        { revision: saved.head.revision, reason: null },
        next.owner(),
      ),
    );
    const restore = await domainError(
      restoreStudioBuilding(
        t.db,
        head.id,
        { revision: arch.building.head.revision, acknowledgements: [] },
        next.owner(),
      ),
    );
    expect(restore.code).toBe('validation-failed');
    expect(
      await t.db
        .prepare('SELECT COUNT(*) AS n FROM studio_building_versions WHERE building_id = ?')
        .bind(head.id)
        .first<{ n: number }>(),
    ).toEqual({ n: 1 });

    // back on the original data (e.g. a data rollback) the same record restores and publishes again
    const r = publishResponseSchema.parse(
      await restoreStudioBuilding(
        t.db,
        head.id,
        { revision: arch.building.head.revision, acknowledgements: [] },
        c.owner(),
      ),
    );
    expect(r.building.head).toMatchObject({ status: 'published', publishedVersion: 1, hasDraft: true });
  });
});
