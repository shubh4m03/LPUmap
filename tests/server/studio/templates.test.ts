/**
 * Template library (S2, §3.3, §12): starter templates come from code; owner
 * templates are versioned D1 rows. A template change NEVER changes a
 * building: published instances stay byte-identical (publication, version
 * rows, publication_version) because an instance stores its full model.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPublication } from '../../../server/domain/publication.ts';
import {
  applyStudioTemplate,
  createOwnerTemplate,
  createStudioBuilding,
  getStudioLibrary,
  publishStudioBuilding,
  resolveTemplateDefinition,
  retireOwnerTemplate,
  unretireOwnerTemplate,
  updateOwnerTemplate,
} from '../../../server/domain/studio/index.ts';
import { DomainError } from '../../../server/errors.ts';
import { starterLibrary } from '../../../src/building-studio/asset-library.ts';
import {
  OWNER_TEMPLATE_ID_RE,
  studioBuildingDetailSchema,
  studioLibraryResponseSchema,
  templateListingSchema,
  type OwnerTemplateInput,
} from '../../../src/building-studio/schema.ts';
import { createTestDb, type TestDb } from '../helpers/test-db.ts';
import { auditOf, newDraft, publicationVersion, publishBody, SITE_B, studioClock } from './helpers.ts';

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

const defaults = newDraft().model;
const {
  anchor: _a,
  rotationDeg: _r,
  modelConfigVersion: _m,
  geometryGuide: _g,
  ...variantDefaults
} = defaults;

/** An owner variant of the box generator ("stylized"), never presented as evidence-backed. */
function input(over: Partial<OwnerTemplateInput> = {}): OwnerTemplateInput {
  return {
    name: 'Owner pavilion variant',
    libraryCategory: 'generic-low-rise',
    intendedUse: 'Generic low-rise placeholder for unmapped structures',
    suggestedCategoryId: 'building',
    generatorId: 'box',
    generatorVersion: 1,
    constraints: {
      widthM: { min: 10, max: 40 },
      lengthM: { min: 10, max: 40 },
      heightM: { min: 3, max: 20 },
      floors: { min: 1, max: 5 },
      roofShapes: ['flat', 'gable'],
      windowPatterns: ['punched', 'ribbon'],
      balconiesAllowed: false,
    },
    variants: [{ id: 'standard', name: 'Standard', description: null, defaults: variantDefaults }],
    accuracyClass: 'stylized',
    basedOn: null,
    ...over,
  };
}

describe('library', () => {
  it('lists every starter template (code, active, all versions, no revision)', async () => {
    const lib = studioLibraryResponseSchema.parse(await getStudioLibrary(t.db, c.owner()));
    const code = lib.templates.filter((x) => x.source === 'code');
    expect(code.map((x) => x.definition.id)).toEqual(starterLibrary().map((e) => e.definition.id));
    expect(code.length).toBeGreaterThanOrEqual(17);
    for (const x of code) {
      expect(x).toMatchObject({ status: 'active', revision: null });
      expect(x.versions).toContain(x.definition.version);
      expect(x.definition.accuracyClass).toBe('generic-prefab');
    }
  });
});

describe('owner templates', () => {
  it('creates v1 with a server id and render cost; updates make immutable new versions; retire/unretire', async () => {
    const created = templateListingSchema.parse(
      await createOwnerTemplate(t.db, { definition: input() }, c.owner()),
    );
    const id = created.definition.id;
    expect(id).toMatch(OWNER_TEMPLATE_ID_RE);
    expect(created).toMatchObject({ source: 'owner', status: 'active', versions: [1], revision: 1 });
    expect(created.definition).toMatchObject({
      version: 1,
      accuracyClass: 'stylized',
      renderCost: expect.any(String),
    });
    expect((await auditOf(t.db, id)).map((a) => `${a.entity_type}:${a.action}:${a.outcome}`)).toEqual([
      'template:template.create:success',
    ]);

    const v2 = templateListingSchema.parse(
      await updateOwnerTemplate(
        t.db,
        id,
        { revision: 1, definition: input({ name: 'Owner pavilion v2' }) },
        c.owner(),
      ),
    );
    expect(v2).toMatchObject({
      versions: [1, 2],
      revision: 2,
      definition: { version: 2, name: 'Owner pavilion v2' },
    });
    // v1 stays resolvable (provenance), unchanged
    expect(await resolveTemplateDefinition(t.db, c.owner(), { templateId: id, templateVersion: 1 })).toEqual(
      created.definition,
    );
    const stale = await domainError(
      updateOwnerTemplate(t.db, id, { revision: 1, definition: input() }, c.owner()),
    );
    expect(stale.code).toBe('conflict');
    expect((stale.details as { currentTemplate: { revision: number } }).currentTemplate.revision).toBe(2);

    const retired = templateListingSchema.parse(
      await retireOwnerTemplate(t.db, id, { revision: 2 }, c.owner()),
    );
    expect(retired).toMatchObject({ status: 'retired', revision: 3 });
    expect((await domainError(retireOwnerTemplate(t.db, id, { revision: 3 }, c.owner()))).code).toBe(
      'invalid-transition',
    );
    const lib = studioLibraryResponseSchema.parse(await getStudioLibrary(t.db, c.owner()));
    expect(lib.templates.find((x) => x.definition.id === id)).toMatchObject({
      status: 'retired',
      versions: [1, 2],
    });
    expect(
      templateListingSchema.parse(await unretireOwnerTemplate(t.db, id, { revision: 3 }, c.owner())).status,
    ).toBe('active');
    expect((await auditOf(t.db, id)).map((a) => `${a.action}:${a.outcome}`)).toEqual([
      'template.create:success',
      'template.version:success',
      'template.version:rejected',
      'template.retire:success',
      'template.retire:rejected',
      'template.unretire:success',
    ]);
  });

  it('rejects unknown generator versions (422), accuracy claims and missing provenance (404)', async () => {
    const badVersion = await domainError(
      createOwnerTemplate(t.db, { definition: { ...input(), generatorVersion: 7 } }, c.owner()),
    );
    expect(badVersion.code).toBe('unsupported-model');
    const claim = await domainError(
      createOwnerTemplate(t.db, { definition: { ...input(), accuracyClass: 'surveyed' } }, c.owner()),
    );
    expect(claim.code).toBe('invalid');
    const basedOn = await domainError(
      createOwnerTemplate(
        t.db,
        { definition: input({ basedOn: { templateId: 'no-such-template', templateVersion: 1 } }) },
        c.owner(),
      ),
    );
    expect(basedOn.code).toBe('not-found');
    const unknown = await domainError(
      updateOwnerTemplate(
        t.db,
        'stv:zzzzzzzzzzzzzzzzzzzzzzzzzz',
        { revision: 1, definition: input() },
        c.owner(),
      ),
    );
    expect(unknown.code).toBe('not-found');
  });

  it('a template update leaves published instances byte-identical (publication, versions, publication_version)', async () => {
    const tpl = templateListingSchema.parse(
      await createOwnerTemplate(t.db, { definition: input() }, c.owner()),
    );
    const d = studioBuildingDetailSchema.parse(
      await createStudioBuilding(
        t.db,
        { targetId: null, draft: newDraft({ model: { anchor: SITE_B } }) },
        c.owner(),
      ),
    );
    // place it from the owner template (explicit apply), then publish
    await applyStudioTemplate(
      t.db,
      d.head.id,
      {
        revision: 1,
        templateId: tpl.definition.id,
        templateVersion: 1,
        variantId: 'standard',
        dryRun: false,
      },
      c.owner(),
    );
    await publishStudioBuilding(t.db, d.head.id, publishBody(2), c.owner());

    const pubBefore = JSON.stringify(await getPublication(t.db));
    const rowsBefore = (
      await t.db.prepare('SELECT * FROM studio_building_versions ORDER BY building_id, version').all()
    ).results;
    const headBefore = await t.db
      .prepare('SELECT * FROM studio_buildings WHERE id = ?')
      .bind(d.head.id)
      .first();
    const pv = await publicationVersion(t.db);
    expect(pubBefore).toContain(tpl.definition.id);

    const changed = input({
      name: 'Owner pavilion, red roof',
      variants: [
        {
          id: 'standard',
          name: 'Standard',
          description: null,
          defaults: { ...variantDefaults, roof: { shape: 'flat', colour: '#aa2222', material: 'metal' } },
        },
      ],
    });
    await updateOwnerTemplate(t.db, tpl.definition.id, { revision: 1, definition: changed }, c.owner());
    await retireOwnerTemplate(t.db, tpl.definition.id, { revision: 2 }, c.owner());

    expect(JSON.stringify(await getPublication(t.db))).toBe(pubBefore);
    expect(
      (await t.db.prepare('SELECT * FROM studio_building_versions ORDER BY building_id, version').all())
        .results,
    ).toEqual(rowsBefore);
    expect(await t.db.prepare('SELECT * FROM studio_buildings WHERE id = ?').bind(d.head.id).first()).toEqual(
      headBefore,
    );
    expect(await publicationVersion(t.db)).toBe(pv);
  });
});
