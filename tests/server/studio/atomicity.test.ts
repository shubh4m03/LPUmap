/**
 * Building Studio atomicity by fault injection: every studio write is ONE
 * db.batch. A statement that fails at ANY position of that batch must leave
 * the studio tables, the publication version and every other row exactly as
 * they were, with a single new 'failed' audit row — and the same operation
 * must succeed afterwards (no stuck or half-written state). Races: a
 * competing writer between an operation's read and its batch yields 409 and
 * no partial state.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SqlDatabase } from '../../../server/db/types.ts';
import {
  applyStudioTemplate,
  archiveStudioBuilding,
  createOwnerTemplate,
  createStudioBuilding,
  deleteStudioBuilding,
  discardStudioDraft,
  duplicateStudioBuilding,
  publishStudioBuilding,
  restoreStudioBuilding,
  retireOwnerTemplate,
  saveStudioDraft,
  updateOwnerTemplate,
} from '../../../server/domain/studio/index.ts';
import { DomainError } from '../../../server/errors.ts';
import { starterLibrary } from '../../../src/building-studio/asset-library.ts';
import {
  studioBuildingDetailSchema,
  templateListingSchema,
  type OwnerTemplateInput,
} from '../../../src/building-studio/schema.ts';
import { createTestDb, type TestDb } from '../helpers/test-db.ts';
import { failingDb, racingDb } from '../integrity/helpers.ts';
import { newDraft, publishBody, studioClock, studioSnapshot, type StudioSnapshot } from './helpers.ts';

let t: TestDb;
const c = studioClock();
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.dispose();
});

const {
  anchor: _a,
  rotationDeg: _r,
  modelConfigVersion: _m,
  geometryGuide: _g,
  ...variantDefaults
} = newDraft().model;
const templateInput: OwnerTemplateInput = {
  name: 'Atomicity variant',
  libraryCategory: 'generic-low-rise',
  intendedUse: 'Test template for fault injection',
  suggestedCategoryId: 'building',
  generatorId: 'box',
  generatorVersion: 1,
  constraints: {
    widthM: { min: 5, max: 50 },
    lengthM: { min: 5, max: 50 },
    heightM: { min: 3, max: 30 },
    floors: { min: 1, max: 8 },
    roofShapes: ['flat'],
    windowPatterns: ['punched'],
    balconiesAllowed: false,
  },
  variants: [{ id: 'standard', name: 'Standard', description: null, defaults: variantDefaults }],
  accuracyClass: 'generic-prefab',
  basedOn: null,
};

const draftHead = async () => {
  const d = studioBuildingDetailSchema.parse(
    await createStudioBuilding(t.db, { targetId: null, draft: newDraft() }, c.owner()),
  );
  return { id: d.head.id, revision: d.head.revision };
};
const publishedHead = async () => {
  const h = await draftHead();
  await publishStudioBuilding(t.db, h.id, publishBody(h.revision), c.owner());
  return { id: h.id, revision: h.revision + 1 };
};
/** Published, then archived (so the next one at SITE_A has no overlap warnings). */
const archivedHead = async () => {
  const h = await publishedHead();
  await archiveStudioBuilding(t.db, h.id, { revision: h.revision, reason: null }, c.owner());
  return { id: h.id, revision: h.revision + 1 };
};
const publishedWithDraft = async () => {
  const h = await publishedHead();
  await saveStudioDraft(
    t.db,
    h.id,
    { revision: h.revision, draft: newDraft({ model: { rotationDeg: 10 } }) },
    c.owner(),
  );
  return { id: h.id, revision: h.revision + 1 };
};
const ownerTemplate = async () => {
  const l = templateListingSchema.parse(
    await createOwnerTemplate(t.db, { definition: templateInput }, c.owner()),
  );
  return { id: l.definition.id, revision: 1 };
};
const box = starterLibrary().find((e) => e.definition.generatorId === 'box')!.definition;

type Key = { id: string; revision: number };
interface Case {
  name: string;
  setup: () => Promise<Key>;
  run: (db: SqlDatabase, k: Key) => Promise<unknown>;
  /** Clean up after a successful run so the next case starts without overlaps at SITE_A. */
  after?: (k: Key) => Promise<unknown>;
}

const archiveAfter = (rev: (k: Key) => number) => async (k: Key) =>
  archiveStudioBuilding(t.db, k.id, { revision: rev(k), reason: null }, c.owner()).catch(() => undefined);

const cases: Case[] = [
  {
    name: 'create',
    setup: async () => ({ id: '', revision: 0 }),
    run: (db) => createStudioBuilding(db, { targetId: null, draft: newDraft() }, c.owner()),
  },
  {
    name: 'save draft',
    setup: draftHead,
    run: (db, k) =>
      saveStudioDraft(
        db,
        k.id,
        { revision: k.revision, draft: newDraft({ model: { heightM: 9 } }) },
        c.owner(),
      ),
  },
  {
    name: 'publish',
    setup: draftHead,
    run: (db, k) => publishStudioBuilding(db, k.id, publishBody(k.revision), c.owner()),
    after: archiveAfter((k) => k.revision + 1),
  },
  {
    name: 'publish a new version',
    setup: async () => {
      const k = await publishedWithDraft();
      return k;
    },
    run: (db, k) =>
      publishStudioBuilding(
        db,
        k.id,
        publishBody(k.revision, { changeSummary: 'Second version' }),
        c.owner(),
      ),
    after: archiveAfter((k) => k.revision + 1),
  },
  {
    name: 'discard draft',
    setup: publishedWithDraft,
    run: (db, k) => discardStudioDraft(db, k.id, { revision: k.revision }, c.owner()),
    after: archiveAfter((k) => k.revision + 1),
  },
  {
    name: 'archive (published)',
    setup: publishedHead,
    run: (db, k) => archiveStudioBuilding(db, k.id, { revision: k.revision, reason: 'test' }, c.owner()),
  },
  {
    name: 'restore (re-publish)',
    setup: archivedHead,
    run: (db, k) =>
      restoreStudioBuilding(db, k.id, { revision: k.revision, acknowledgements: [] }, c.owner()),
    after: archiveAfter((k) => k.revision + 1),
  },
  {
    name: 'permanent delete',
    setup: archivedHead,
    run: (db, k) => deleteStudioBuilding(db, k.id, { revision: k.revision, confirmId: k.id }, c.owner()),
  },
  {
    name: 'duplicate',
    setup: draftHead,
    run: (db, k) => duplicateStudioBuilding(db, k.id, { offsetM: { east: 0, north: 40 } }, c.owner()),
  },
  {
    name: 'apply template',
    setup: draftHead,
    run: (db, k) =>
      applyStudioTemplate(
        db,
        k.id,
        {
          revision: k.revision,
          templateId: box.id,
          templateVersion: box.version,
          variantId: box.variants[0]!.id,
          dryRun: false,
        },
        c.owner(),
      ),
  },
  {
    name: 'template create',
    setup: async () => ({ id: '', revision: 0 }),
    run: (db) => createOwnerTemplate(db, { definition: templateInput }, c.owner()),
  },
  {
    name: 'template new version',
    setup: ownerTemplate,
    run: (db, k) =>
      updateOwnerTemplate(
        db,
        k.id,
        { revision: k.revision, definition: { ...templateInput, name: 'Renamed variant' } },
        c.owner(),
      ),
  },
  {
    name: 'template retire',
    setup: ownerTemplate,
    run: (db, k) => retireOwnerTemplate(db, k.id, { revision: k.revision }, c.owner()),
  },
];

const withoutAudit = ({ audit: _audit, ...rest }: StudioSnapshot) => rest;

describe('every studio write is all-or-nothing', () => {
  for (const tc of cases) {
    it(`${tc.name}: a failure at any batch position changes nothing; the retry succeeds`, async () => {
      let positions = 0;
      for (let at = 0; ; at++) {
        const key = await tc.setup();
        const before = await studioSnapshot(t.db);
        const db = failingDb(t.db, at);
        const err = await tc.run(db, key).then(
          () => null,
          (e: unknown) => e,
        );
        expect(err, `${tc.name} @${at}`).toBeInstanceOf(DomainError);
        expect((err as DomainError).code).toBe('internal');
        const after = await studioSnapshot(t.db);
        expect(withoutAudit(after), `${tc.name} @${at}`).toEqual(withoutAudit(before));
        const added = after.audit.slice(before.audit.length);
        expect(
          added.map((a) => a.outcome),
          `${tc.name} @${at}`,
        ).toEqual(['failed']);
        // not stuck: the same operation succeeds now
        await tc.run(t.db, key);
        await tc.after?.(key);
        positions += 1;
        if (db.failedAt !== null && db.failedAt < at) break; // clamped: every position was covered
        if (at > 8) throw new Error('batch longer than expected');
      }
      expect(positions).toBeGreaterThanOrEqual(3);
    });
  }
});

describe('races: a competing writer between read and batch → 409, no partial state', () => {
  it('publish racing a draft save', async () => {
    const k = await draftHead();
    const raced = racingDb(t.db, () =>
      saveStudioDraft(
        t.db,
        k.id,
        { revision: k.revision, draft: newDraft({ model: { heightM: 9.5 } }) },
        c.owner(),
      ),
    );
    const before = await studioSnapshot(t.db);
    const err = await publishStudioBuilding(raced, k.id, publishBody(k.revision), c.owner()).then(
      () => null,
      (e: unknown) => e as DomainError,
    );
    expect(raced.competitorRan).toBe(true);
    expect(err?.code).toBe('conflict');
    const after = await studioSnapshot(t.db);
    expect(after.versions).toEqual(before.versions);
    expect(after.meta).toEqual(before.meta);
    // the competitor's save + this attempt's rejection; no 'success' publish row
    expect(after.audit.slice(before.audit.length).map((a) => `${a.action}:${a.outcome}`)).toEqual([
      'building.save-draft:success',
      'building.publish:rejected',
    ]);
    await archiveStudioBuilding(t.db, k.id, { revision: k.revision + 1, reason: null }, c.owner());
  });

  it('archive racing a publish', async () => {
    const k = await draftHead();
    const raced = racingDb(t.db, () => publishStudioBuilding(t.db, k.id, publishBody(k.revision), c.owner()));
    const err = await archiveStudioBuilding(
      raced,
      k.id,
      { revision: k.revision, reason: null },
      c.owner(),
    ).then(
      () => null,
      (e: unknown) => e as DomainError,
    );
    expect(err?.code).toBe('conflict');
    expect((err?.details as { current: { status: string } }).current.status).toBe('published');
    await archiveStudioBuilding(t.db, k.id, { revision: k.revision + 1, reason: null }, c.owner());
  });

  it('two creates for the same base target: exactly one wins', async () => {
    const { prismDraft, realStudioBase } = await import('./helpers.ts');
    const target = realStudioBase().buildings.features.find((f) => f.properties.campusStatus === 'inside')!
      .properties.id;
    const raced = racingDb(t.db, () =>
      createStudioBuilding(t.db, { targetId: target, draft: prismDraft(target) }, c.owner()),
    );
    const err = await createStudioBuilding(
      raced,
      { targetId: target, draft: prismDraft(target) },
      c.owner(),
    ).then(
      () => null,
      (e: unknown) => e as DomainError,
    );
    expect(err?.code).toBe('conflict');
    const n = await t.db
      .prepare('SELECT COUNT(*) AS n FROM studio_buildings WHERE target_id = ?')
      .bind(target)
      .first<{ n: number }>();
    expect(n?.n).toBe(1);
  });
});
