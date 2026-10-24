/**
 * Building Studio records on a local D1 (isolated, persist: false) against the
 * REAL base dataset: the §9 state machine, optimistic revisions (409 with the
 * current head), validation (422 shapes), acknowledgements, the audit of every
 * write, duplicate and apply-template, and publication v2 (published only; no
 * drafts, notes, actors, acknowledgements or validation).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyStudioTemplate,
  archiveStudioBuilding,
  createStudioBuilding,
  deleteStudioBuilding,
  discardStudioDraft,
  duplicateStudioBuilding,
  getStudioBuilding,
  listStudioBuildings,
  publishStudioBuilding,
  restoreStudioBuilding,
  saveStudioDraft,
  validateStudioRequest,
} from '../../../server/domain/studio/index.ts';
import { getPublication } from '../../../server/domain/publication.ts';
import { DomainError } from '../../../server/errors.ts';
import { createEnuFrame } from '../../../src/building-studio/footprint.ts';
import { publicationSchema, PUBLICATION_SCHEMA_VERSION } from '../../../src/community/schema.ts';
import {
  STUDIO_ID_RE,
  studioBuildingDetailSchema,
  studioBuildingListSchema,
  publishResponseSchema,
  applyTemplateResponseSchema,
  validationResultSchema,
  type StudioBuildingDetail,
} from '../../../src/building-studio/schema.ts';
import { starterLibrary } from '../../../src/building-studio/asset-library.ts';
import { createTestDb, type TestDb } from '../helpers/test-db.ts';
import {
  auditOf,
  newDraft,
  OWNER,
  PRIVATE_NOTE,
  publicationVersion,
  publishBody,
  realStudioBase,
  SITE_A,
  SITE_B,
  studioClock,
  studioSnapshot,
} from './helpers.ts';

let t: TestDb;
const c = studioClock();
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

const create = async (draft = newDraft()) =>
  studioBuildingDetailSchema.parse(await createStudioBuilding(t.db, { targetId: null, draft }, c.owner()));

async function published(draft = newDraft()) {
  const d = await create(draft);
  const r = await publishStudioBuilding(t.db, d.head.id, publishBody(d.head.revision), c.owner());
  return publishResponseSchema.parse(r).building;
}

const lastAudit = async (id: string) => (await auditOf(t.db, id)).at(-1)!;

describe('the test sites', () => {
  it('SITE_A and SITE_B are empty, inside the campus and publishable without warnings', async () => {
    for (const anchor of [SITE_A, SITE_B]) {
      const v = validationResultSchema.parse(
        await validateStudioRequest(
          t.db,
          { targetId: null, recordId: null, draft: newDraft({ model: { anchor } }) },
          c.owner(),
        ),
      );
      expect(v.errorCount, JSON.stringify(v.issues)).toBe(0);
      expect(v.warningCount, JSON.stringify(v.issues)).toBe(0);
    }
  });
});

describe('create and save drafts', () => {
  it('creates a draft (rev 1, draftRevision 1) with a server id and audits it', async () => {
    const d = await create();
    expect(d.head).toMatchObject({
      status: 'draft',
      revision: 1,
      draftRevision: 1,
      hasDraft: true,
      publishedVersion: null,
      targetId: null,
      createdBy: OWNER,
    });
    expect(d.head.id).toMatch(STUDIO_ID_RE);
    expect(d.draft).toEqual(newDraft());
    expect(d.validation?.errorCount).toBe(0);
    expect(d.modelAvailable).toBe(true);
    const a = await lastAudit(d.head.id);
    expect(a).toMatchObject({
      action: 'building.create',
      outcome: 'success',
      entity_type: 'building',
      actor: OWNER,
    });
  });

  it('ignores nothing silently: unknown keys (e.g. a client footprint or status) are 400 and nothing is stored', async () => {
    const before = await studioSnapshot(t.db);
    for (const body of [
      { targetId: null, draft: { ...newDraft(), footprint: { type: 'Polygon', coordinates: [] } } },
      { targetId: null, draft: newDraft(), status: 'published' },
      { targetId: null, draft: { ...newDraft(), id: 'stu:aaaaaaaaaaaaaaaaaaaaaaaaaa' } },
    ]) {
      const e = await domainError(createStudioBuilding(t.db, body, c.owner()));
      expect(e.code).toBe('invalid');
      expect(e.status).toBe(400);
    }
    const after = await studioSnapshot(t.db);
    expect(after.buildings).toEqual(before.buildings);
    // each rejected attempt is audited
    expect(after.audit.slice(before.audit.length).map((a) => `${a.action}:${a.outcome}`)).toEqual([
      'building.create:rejected',
      'building.create:rejected',
      'building.create:rejected',
    ]);
  });

  it('an unknown generator version is 422 unsupported-model (never reinterpreted)', async () => {
    const draft = { ...newDraft(), model: { ...newDraft().model, generatorVersion: 99 } };
    const e = await domainError(createStudioBuilding(t.db, { targetId: null, draft }, c.owner()));
    expect(e.code).toBe('unsupported-model');
    expect(e.status).toBe(422);
    const v = await domainError(
      validateStudioRequest(t.db, { targetId: null, recordId: null, draft }, c.owner()),
    );
    expect(v.code).toBe('unsupported-model');
  });

  it('saves drafts even with validation errors; the audit names changed fields but stores no coordinates', async () => {
    const d = await create();
    const moved = newDraft({ model: { anchor: [75.70171, 31.24963], heightM: 400 } });
    const saved = studioBuildingDetailSchema.parse(
      await saveStudioDraft(t.db, d.head.id, { revision: 1, draft: moved }, c.owner()),
    );
    expect(saved.head).toMatchObject({ revision: 2, draftRevision: 2, status: 'draft' });
    expect(saved.validation?.issues.map((i) => i.code)).toContain('dimension-out-of-range');
    const a = await lastAudit(d.head.id);
    expect(a.action).toBe('building.save-draft');
    const after = JSON.parse(a.after_json!) as { changedFields: string[] };
    expect(after.changedFields).toEqual(['model.anchor', 'model.heightM']);
    expect(a.after_json).not.toContain('75.70171');
    expect(a.before_json).not.toContain('75.7015');
  });

  it('a stale revision is 409 conflict with the current head; nothing changes and the attempt is audited', async () => {
    const d = await create();
    await saveStudioDraft(t.db, d.head.id, { revision: 1, draft: newDraft() }, c.owner());
    const before = await studioSnapshot(t.db);
    for (const call of [
      () => saveStudioDraft(t.db, d.head.id, { revision: 1, draft: newDraft() }, c.owner()),
      () => publishStudioBuilding(t.db, d.head.id, publishBody(1), c.owner()),
      () => archiveStudioBuilding(t.db, d.head.id, { revision: 1, reason: null }, c.owner()),
      () => discardStudioDraft(t.db, d.head.id, { revision: 1 }, c.owner()),
      () =>
        applyStudioTemplate(
          t.db,
          d.head.id,
          { revision: 1, templateId: 'x', templateVersion: 1, variantId: 'y', dryRun: false },
          c.owner(),
        ),
    ]) {
      const e = await domainError(call());
      expect(e.code).toBe('conflict');
      expect(e.status).toBe(409);
      expect((e.details as { current: { revision: number; id: string } }).current).toMatchObject({
        id: d.head.id,
        revision: 2,
      });
    }
    const after = await studioSnapshot(t.db);
    expect(after.buildings).toEqual(before.buildings);
    expect(after.meta).toEqual(before.meta);
    expect(after.audit.slice(before.audit.length).every((a) => a.outcome === 'rejected')).toBe(true);
  });

  it('unknown ids are 404', async () => {
    const id = 'stu:zzzzzzzzzzzzzzzzzzzzzzzzzz';
    expect((await domainError(getStudioBuilding(t.db, id, c.owner()))).code).toBe('not-found');
    expect(
      (await domainError(saveStudioDraft(t.db, id, { revision: 1, draft: newDraft() }, c.owner()))).code,
    ).toBe('not-found');
  });
});

describe('publish', () => {
  it('publishes atomically: version 1, draft cleared, publication bumped by one, audited with summary', async () => {
    const d = await create(newDraft({ model: { anchor: SITE_B } }));
    const v0 = await publicationVersion(t.db);
    const r = publishResponseSchema.parse(
      await publishStudioBuilding(t.db, d.head.id, publishBody(1), c.owner()),
    );
    expect(r.publicationVersion).toBe(v0 + 1);
    expect(r.building.head).toMatchObject({
      status: 'published',
      publishedVersion: 1,
      hasDraft: false,
      revision: 2,
    });
    expect(r.building.draft).toBeNull();
    expect(r.building.published).toMatchObject({
      version: 1,
      record: newDraft({ model: { anchor: SITE_B } }),
      changeSummary: 'First publication of the fixture building',
      publishedBy: OWNER,
      membership: { campusStatus: 'inside', decision: 'auto', decisionSource: null },
    });
    expect(r.building.published!.footprintAreaM2).toBeCloseTo(400, 0);
    const a = await lastAudit(d.head.id);
    expect(a).toMatchObject({ action: 'building.publish', outcome: 'success' });
    const after = JSON.parse(a.after_json!) as Record<string, unknown>;
    expect(after).toMatchObject({
      version: 1,
      changeSummary: 'First publication of the fixture building',
      acknowledgements: [],
      move: { before: null, after: { anchor: SITE_B, rotationDeg: 0 } },
    });

    // Archive it again so later overlap checks at SITE_B stay clean.
    await archiveStudioBuilding(t.db, d.head.id, { revision: 2, reason: null }, c.owner());
  });

  it('publication v2 lists published buildings only, in id order, without notes, actors, drafts or acknowledgements', async () => {
    const p = await published();
    // a newer draft never leaks into the publication
    await saveStudioDraft(
      t.db,
      p.head.id,
      {
        revision: p.head.revision,
        draft: newDraft({ identity: { ...newDraft().identity!, name: 'Draft Only Name' } }),
      },
      c.owner(),
    );
    const draftOnly = await create(newDraft({ model: { anchor: SITE_B } }));
    const pub = publicationSchema.parse(await getPublication(t.db));
    expect(pub.schemaVersion).toBe(PUBLICATION_SCHEMA_VERSION);
    const ids = pub.buildings!.map((b) => b.id);
    expect(ids).toContain(p.head.id);
    expect(ids).not.toContain(draftOnly.head.id);
    expect([...ids].sort()).toEqual(ids);
    const text = JSON.stringify(pub);
    expect(text).not.toContain(PRIVATE_NOTE);
    expect(text).not.toContain('Draft Only Name');
    expect(text).not.toContain(OWNER);
    expect(text).not.toContain('changeSummary');
    expect(text).not.toContain('acknowledgements');
    expect(text).not.toContain('"notes"');
    const b = pub.buildings!.find((x) => x.id === p.head.id)!;
    expect(b).toMatchObject({
      targetId: null,
      version: 1,
      accuracyClass: 'generic-prefab',
      verification: { status: 'unverified' },
      identity: { name: 'Fixture Pavilion', categoryId: 'building', directoryVisible: true },
      positionCorrected: false,
    });
    expect(Object.keys(b.identity!)).not.toContain('notes');
    // deterministic: same publication version → byte-identical body
    expect(JSON.stringify(await getPublication(t.db))).toBe(text);
    await archiveStudioBuilding(t.db, p.head.id, { revision: p.head.revision + 1, reason: null }, c.owner());
    await archiveStudioBuilding(t.db, draftOnly.head.id, { revision: 1, reason: null }, c.owner());
  });

  it('publishing with errors is 422 validation-failed with the validation; nothing is written', async () => {
    const d = await create(newDraft({ model: { heightM: 200, floors: 50, floorHeightM: 4 } }));
    const before = await studioSnapshot(t.db);
    const e = await domainError(publishStudioBuilding(t.db, d.head.id, publishBody(1), c.owner()));
    expect(e.code).toBe('validation-failed');
    expect(e.status).toBe(422);
    const details = e.details as { validation: { errorCount: number; issues: { code: string }[] } };
    expect(details.validation.errorCount).toBeGreaterThan(0);
    expect(details.validation.issues.map((i) => i.code)).toContain('dimension-out-of-range');
    const after = await studioSnapshot(t.db);
    expect(after.buildings).toEqual(before.buildings);
    expect(after.versions).toEqual(before.versions);
    expect(after.meta).toEqual(before.meta);
    expect(after.audit.slice(before.audit.length)).toMatchObject([
      { action: 'building.publish', outcome: 'rejected' },
    ]);
  });

  it('a warning needs an acknowledgement with a reason; it is stored with the version and in the audit', async () => {
    // 3 floors × 3.2 m = 9.6 m but a 15 m body: height-floors-conflict (a warning)
    const d = await create(newDraft({ model: { heightM: 15 } }));
    const e = await domainError(publishStudioBuilding(t.db, d.head.id, publishBody(1), c.owner()));
    expect(e.code).toBe('validation-failed');
    expect((e.details as { missingAcknowledgements: string[] }).missingAcknowledgements).toEqual([
      'height-floors-conflict',
    ]);
    const acks = [
      { code: 'height-floors-conflict', reason: 'Tall ground-floor hall, intentionally' },
      // not present → ignored and never recorded
      { code: 'possible-duplicate', reason: 'Not relevant to this building' },
    ];
    const r = publishResponseSchema.parse(
      await publishStudioBuilding(t.db, d.head.id, publishBody(1, { acknowledgements: acks }), c.owner()),
    );
    expect(r.building.published!.acknowledgements).toEqual([acks[0]]);
    const a = await lastAudit(d.head.id);
    expect(JSON.parse(a.after_json!)).toMatchObject({ acknowledgements: [acks[0]] });
    expect(a.after_json).not.toContain('possible-duplicate');
    await archiveStudioBuilding(t.db, d.head.id, { revision: 2, reason: null }, c.owner());
  });

  it('acknowledgements cannot override errors', async () => {
    const d = await create(newDraft({ model: { widthM: 1 } }));
    const e = await domainError(
      publishStudioBuilding(
        t.db,
        d.head.id,
        publishBody(1, {
          acknowledgements: [{ code: 'height-floors-conflict', reason: 'trying to force it' }],
        }),
        c.owner(),
      ),
    );
    expect(e.code).toBe('validation-failed');
  });

  it('a building outside the campus can be saved as a draft but never published', async () => {
    const base = realStudioBase();
    const [w, s] = [75.686, 31.237]; // inside maxBounds, far outside the campus boundary
    expect(base.boundary.containsPoint([w, s])).toBe(false);
    const d = await create(newDraft({ model: { anchor: [w, s] } }));
    expect(d.validation?.issues.map((i) => i.code)).toContain('outside-campus');
    const e = await domainError(publishStudioBuilding(t.db, d.head.id, publishBody(1), c.owner()));
    expect(e.code).toBe('validation-failed');
    expect(
      (e.details as { validation: { issues: { code: string }[] } }).validation.issues.map((i) => i.code),
    ).toContain('outside-campus');
  });

  it('publish without a draft, or of an archived record, is 409 invalid-transition', async () => {
    const p = await published();
    expect(
      (await domainError(publishStudioBuilding(t.db, p.head.id, publishBody(p.head.revision), c.owner())))
        .code,
    ).toBe('invalid-transition');
    await archiveStudioBuilding(t.db, p.head.id, { revision: p.head.revision, reason: null }, c.owner());
    await saveStudioDraft(
      t.db,
      p.head.id,
      { revision: p.head.revision + 1, draft: newDraft() },
      c.owner(),
    ).catch(() => undefined);
    const e = await domainError(
      publishStudioBuilding(t.db, p.head.id, publishBody(p.head.revision + 1), c.owner()),
    );
    expect(e.code).toBe('invalid-transition');
  });
});

describe('the §9 state machine', () => {
  it('draft → archive → restore (never published) → draft; publish → archive → restore re-publishes the last version', async () => {
    const d = await create();
    const v0 = await publicationVersion(t.db);
    const arch = publishResponseSchema.parse(
      await archiveStudioBuilding(t.db, d.head.id, { revision: 1, reason: 'Placed by mistake' }, c.owner()),
    );
    expect(arch.building.head).toMatchObject({
      status: 'archived',
      archiveReason: 'Placed by mistake',
      hasDraft: true,
    });
    expect(arch.publicationVersion).toBe(v0); // never public → no bump
    const back = publishResponseSchema.parse(
      await restoreStudioBuilding(t.db, d.head.id, { revision: 2, acknowledgements: [] }, c.owner()),
    );
    expect(back.building.head).toMatchObject({ status: 'draft', archivedAt: null, archiveReason: null });

    const pub = publishResponseSchema.parse(
      await publishStudioBuilding(t.db, d.head.id, publishBody(3), c.owner()),
    );
    expect(pub.publicationVersion).toBe(v0 + 1);
    const a2 = publishResponseSchema.parse(
      await archiveStudioBuilding(t.db, d.head.id, { revision: 4, reason: null }, c.owner()),
    );
    expect(a2.publicationVersion).toBe(v0 + 2);
    expect(publicationSchema.parse(await getPublication(t.db)).buildings!.map((b) => b.id)).not.toContain(
      d.head.id,
    );
    expect(
      (await domainError(archiveStudioBuilding(t.db, d.head.id, { revision: 5, reason: null }, c.owner())))
        .code,
    ).toBe('invalid-transition');
    for (const call of [
      () => saveStudioDraft(t.db, d.head.id, { revision: 5, draft: newDraft() }, c.owner()),
      () => discardStudioDraft(t.db, d.head.id, { revision: 5 }, c.owner()),
    ])
      expect((await domainError(call())).code).toBe('invalid-transition');

    const r = publishResponseSchema.parse(
      await restoreStudioBuilding(t.db, d.head.id, { revision: 5, acknowledgements: [] }, c.owner()),
    );
    expect(r.publicationVersion).toBe(v0 + 3);
    expect(r.building.head).toMatchObject({ status: 'published', publishedVersion: 1 });
    expect(
      (
        await t.db
          .prepare('SELECT COUNT(*) AS n FROM studio_building_versions WHERE building_id = ?')
          .bind(d.head.id)
          .first<{ n: number }>()
      )?.n,
    ).toBe(1);
    expect(publicationSchema.parse(await getPublication(t.db)).buildings!.map((b) => b.id)).toContain(
      d.head.id,
    );
    expect((await auditOf(t.db, d.head.id)).map((a) => `${a.action}:${a.outcome}`)).toEqual([
      'building.create:success',
      'building.archive:success',
      'building.restore:success',
      'building.publish:success',
      'building.archive:success',
      'building.archive:rejected',
      'building.save-draft:rejected',
      'building.discard-draft:rejected',
      'building.restore:success',
    ]);
    await archiveStudioBuilding(t.db, d.head.id, { revision: 6, reason: null }, c.owner());
  });

  it('discard draft: published + draft → published (public record unchanged); never published → 409', async () => {
    const p = await published();
    const saved = studioBuildingDetailSchema.parse(
      await saveStudioDraft(
        t.db,
        p.head.id,
        { revision: p.head.revision, draft: newDraft({ model: { heightM: 12.8, floors: 4 } }) },
        c.owner(),
      ),
    );
    expect(saved.head).toMatchObject({ status: 'published', hasDraft: true });
    const v = await publicationVersion(t.db);
    const back = studioBuildingDetailSchema.parse(
      await discardStudioDraft(t.db, p.head.id, { revision: saved.head.revision }, c.owner()),
    );
    expect(back.head).toMatchObject({ status: 'published', hasDraft: false, publishedVersion: 1 });
    expect(back.draft).toBeNull();
    expect(await publicationVersion(t.db)).toBe(v);
    expect(
      (await domainError(discardStudioDraft(t.db, p.head.id, { revision: back.head.revision }, c.owner())))
        .code,
    ).toBe('invalid-transition');
    const d = await create();
    expect((await domainError(discardStudioDraft(t.db, d.head.id, { revision: 1 }, c.owner()))).code).toBe(
      'invalid-transition',
    );
    await archiveStudioBuilding(t.db, p.head.id, { revision: back.head.revision, reason: null }, c.owner());
    await archiveStudioBuilding(t.db, d.head.id, { revision: 1, reason: null }, c.owner());
  });

  it('a second publish creates version 2 and keeps version 1 immutable', async () => {
    const p = await published();
    const v1 = await t.db
      .prepare('SELECT * FROM studio_building_versions WHERE building_id = ? AND version = 1')
      .bind(p.head.id)
      .first();
    const s = studioBuildingDetailSchema.parse(
      await saveStudioDraft(
        t.db,
        p.head.id,
        { revision: p.head.revision, draft: newDraft({ model: { rotationDeg: 15 } }) },
        c.owner(),
      ),
    );
    const r = publishResponseSchema.parse(
      await publishStudioBuilding(
        t.db,
        p.head.id,
        publishBody(s.head.revision, { changeSummary: 'Rotate to match the road' }),
        c.owner(),
      ),
    );
    expect(r.building.head.publishedVersion).toBe(2);
    expect(
      await t.db
        .prepare('SELECT * FROM studio_building_versions WHERE building_id = ? AND version = 1')
        .bind(p.head.id)
        .first(),
    ).toEqual(v1);
    const a = JSON.parse((await lastAudit(p.head.id)).after_json!) as { move: unknown };
    expect(a.move).toEqual({
      before: { anchor: SITE_A, rotationDeg: 0 },
      after: { anchor: SITE_A, rotationDeg: 15 },
    });
    await archiveStudioBuilding(
      t.db,
      p.head.id,
      { revision: r.building.head.revision, reason: null },
      c.owner(),
    );
  });
});

describe('permanent delete', () => {
  it('is allowed only for archived records with the exact id typed; the audit keeps the full before-snapshot', async () => {
    const p = await published();
    const nonArchived = await domainError(
      deleteStudioBuilding(t.db, p.head.id, { revision: p.head.revision, confirmId: p.head.id }, c.owner()),
    );
    expect(nonArchived.code).toBe('invalid-transition');
    const a = publishResponseSchema.parse(
      await archiveStudioBuilding(
        t.db,
        p.head.id,
        { revision: p.head.revision, reason: 'Superseded' },
        c.owner(),
      ),
    );
    const rev = a.building.head.revision;
    const mismatch = await domainError(
      deleteStudioBuilding(t.db, p.head.id, { revision: rev, confirmId: `${p.head.id} ` }, c.owner()),
    );
    expect(mismatch.code).toBe('invalid');
    expect(mismatch.status).toBe(400);
    const stale = await domainError(
      deleteStudioBuilding(t.db, p.head.id, { revision: rev - 1, confirmId: p.head.id }, c.owner()),
    );
    expect(stale.code).toBe('conflict');

    const versions = (
      await t.db.prepare('SELECT * FROM studio_building_versions WHERE building_id = ?').bind(p.head.id).all()
    ).results;
    expect(versions).toHaveLength(1);
    const r = await deleteStudioBuilding(t.db, p.head.id, { revision: rev, confirmId: p.head.id }, c.owner());
    expect(r.deletedId).toBe(p.head.id);
    expect(
      await t.db.prepare('SELECT * FROM studio_buildings WHERE id = ?').bind(p.head.id).first(),
    ).toBeNull();
    expect(
      (
        await t.db
          .prepare('SELECT * FROM studio_building_versions WHERE building_id = ?')
          .bind(p.head.id)
          .all()
      ).results,
    ).toEqual([]);
    const audit = await t.db
      .prepare('SELECT * FROM audit_events WHERE id = ?')
      .bind(r.auditEventId)
      .first<{ action: string; before_json: string; entity_id: string }>();
    expect(audit).toMatchObject({ action: 'building.delete', entity_id: p.head.id });
    const before = JSON.parse(audit!.before_json) as {
      head: { id: string };
      versions: { version: number; record: unknown }[];
    };
    expect(before.head.id).toBe(p.head.id);
    expect(before.versions.map((v) => v.version)).toEqual([1]);
    expect(before.versions[0]!.record).toEqual(newDraft());
    expect((await domainError(getStudioBuilding(t.db, p.head.id, c.owner()))).code).toBe('not-found');
  });
});

describe('duplicate', () => {
  it('makes a new unpublished stu: draft with no name, aliases, verification, access or guide, offset by width + 5 m east', async () => {
    const src = await create(
      newDraft({
        identity: { ...newDraft().identity!, aliases: ['Old alias'] },
        verification: {
          status: 'surveyed',
          surveyDate: '2026-10-01',
          note: 'Paced out by the owner on site.',
        },
      }),
    );
    const before = await studioSnapshot(t.db);
    const copy: StudioBuildingDetail = studioBuildingDetailSchema.parse(
      await duplicateStudioBuilding(t.db, src.head.id, { offsetM: null }, c.owner()),
    );
    expect(copy.head.id).not.toBe(src.head.id);
    expect(copy.head).toMatchObject({ status: 'draft', publishedVersion: null, targetId: null, revision: 1 });
    expect(copy.draft!.identity).toMatchObject({ name: null, aliases: [], categoryId: 'building' });
    expect(copy.draft!.verification).toEqual({ status: 'unverified' });
    expect(copy.draft!.accessNodeId).toBeNull();
    expect(copy.draft!.positionCorrection).toBeNull();
    const xy = createEnuFrame(SITE_A).toLocal(copy.draft!.model.anchor);
    expect(xy[0]).toBeCloseTo(25, 6); // widthM 20 + 5 m east
    expect(xy[1]).toBeCloseTo(0, 6);
    // the source is unchanged; both ids carry a duplicate audit row
    expect((await studioSnapshot(t.db)).buildings).toContainEqual(
      before.buildings.find((b) => (b as { id: string }).id === src.head.id),
    );
    expect((await lastAudit(src.head.id)).action).toBe('building.duplicate');
    expect((await lastAudit(copy.head.id)).action).toBe('building.duplicate');
    // explicit offsets must be visible
    expect(
      (
        await domainError(
          duplicateStudioBuilding(t.db, src.head.id, { offsetM: { east: 0.5, north: 0 } }, c.owner()),
        )
      ).code,
    ).toBe('invalid');
  });
});

describe('apply template', () => {
  const entry = starterLibrary().find(
    (e) => e.definition.generatorId === 'box' && e.definition.variants.length >= 2,
  )!;

  it('dryRun previews (nothing saved); a save replaces generator/shape/roof/facade/detail and keeps placement and dimensions', async () => {
    expect(entry).toBeDefined();
    const def = entry.definition;
    const variant = def.variants[1]!;
    const d = await create();
    const before = await studioSnapshot(t.db);
    const body = { revision: 1, templateId: def.id, templateVersion: def.version, variantId: variant.id };
    const preview = applyTemplateResponseSchema.parse(
      await applyStudioTemplate(t.db, d.head.id, { ...body, dryRun: true }, c.owner()),
    );
    expect(preview.saved).toBe(false);
    expect(preview.building).toBeNull();
    expect(await studioSnapshot(t.db)).toEqual(before);
    expect(preview.draft.model).toMatchObject({
      anchor: SITE_A,
      rotationDeg: 0,
      widthM: 20,
      lengthM: 20,
      heightM: 9.6,
      roof: variant.defaults.roof,
      facade: variant.defaults.facade,
      detailLevel: variant.defaults.detailLevel,
    });
    expect(preview.draft.templateRef).toEqual({
      templateId: def.id,
      templateVersion: def.version,
      variantId: variant.id,
    });
    expect(preview.draft.identity).toEqual(newDraft().identity);

    const saved = applyTemplateResponseSchema.parse(
      await applyStudioTemplate(t.db, d.head.id, { ...body, dryRun: false }, c.owner()),
    );
    expect(saved.saved).toBe(true);
    expect(saved.building!.head).toMatchObject({ revision: 2, draftRevision: 2 });
    expect(saved.building!.draft).toEqual(preview.draft);
    expect((await lastAudit(d.head.id)).action).toBe('building.apply-template');

    const missing = await domainError(
      applyStudioTemplate(
        t.db,
        d.head.id,
        { ...body, revision: 2, variantId: 'no-such-variant', dryRun: true },
        c.owner(),
      ),
    );
    expect(missing.code).toBe('not-found');
    const noTemplate = await domainError(
      applyStudioTemplate(
        t.db,
        d.head.id,
        { ...body, revision: 2, templateVersion: 999, dryRun: true },
        c.owner(),
      ),
    );
    expect(noTemplate.code).toBe('not-found');
  });
});

describe('list', () => {
  it('lists heads newest first with honest titles, counts and keyset pagination', async () => {
    const unnamed = await create(newDraft({ identity: { ...newDraft().identity!, name: null } }));
    const first = studioBuildingListSchema.parse(await listStudioBuildings(t.db, { limit: '2' }, c.owner()));
    expect(first.items).toHaveLength(2);
    expect(first.items[0]!.id).toBe(unnamed.head.id);
    expect(first.items[0]!.title).toBe('Unnamed building (owner-placed model)');
    expect(first.nextCursor).not.toBeNull();
    const next = studioBuildingListSchema.parse(
      await listStudioBuildings(t.db, { limit: '2', cursor: first.nextCursor! }, c.owner()),
    );
    expect(next.items.map((i) => i.id)).not.toContain(unnamed.head.id);
    const archived = studioBuildingListSchema.parse(
      await listStudioBuildings(t.db, { status: 'archived' }, c.owner()),
    );
    expect(archived.items.every((i) => i.status === 'archived')).toBe(true);
    const byName = studioBuildingListSchema.parse(
      await listStudioBuildings(t.db, { q: 'Fixture' }, c.owner()),
    );
    expect(byName.items.length).toBeGreaterThan(0);
    expect((await domainError(listStudioBuildings(t.db, { cursor: 'not-a-cursor' }, c.owner()))).code).toBe(
      'invalid',
    );
  });
});
