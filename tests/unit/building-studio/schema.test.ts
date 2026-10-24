/**
 * Building Studio wire contracts (src/building-studio/schema.ts): a valid
 * fixture passes, and every refinement rejects its broken variant.
 */
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  acknowledgementSchema,
  acknowledgementsSchema,
  applyTemplateRequestSchema,
  archiveRequestSchema,
  BASE_BUILDING_ID_RE,
  createStudioBuildingRequestSchema,
  defaultDuplicateOffsetM,
  deleteStudioBuildingRequestSchema,
  duplicateRequestSchema,
  GENERATORS,
  GENERATOR_IDS,
  LIBRARY_CATEGORIES,
  missingAcknowledgements,
  modelConfigV1Schema,
  modelSupport,
  ownerTemplateInputSchema,
  publishedStudioBuildingSchema,
  publishRequestSchema,
  restoreRequestSchema,
  saveDraftRequestSchema,
  STUDIO_CATEGORY_IDS,
  STUDIO_ID_RE,
  STUDIO_LIMITS,
  studioDraftSchema,
  studioIdentitySchema,
  studioPublicId,
  templateDefinitionSchema,
  validateRequestSchema,
  validationIssueSchema,
  validationResultSchema,
  VALIDATION_CODES,
  verificationDraftSchema,
  verificationSchema,
  WARNING_CODES,
} from '../../../src/building-studio/schema.ts';
import { ANCHOR, clone, draft, identity, model, published, STU_ID, template } from './fixtures.ts';

/** Parses `value`; when `path` is given, some issue must start with that path. */
function rejects(schema: z.ZodType, value: unknown, path?: (string | number)[]) {
  const r = schema.safeParse(value);
  expect(r.success, JSON.stringify(value).slice(0, 200)).toBe(false);
  if (path && !r.success) {
    const paths = r.error.issues.map((i) => i.path.join('.'));
    expect(
      paths.some((p) => p.startsWith(path.join('.'))),
      `issue at ${path.join('.')} in ${paths.join(' | ')}`,
    ).toBe(true);
  }
}
const accepts = (schema: z.ZodType, value: unknown) => {
  const r = schema.safeParse(value);
  expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
  return r.success ? (r.data as unknown) : undefined;
};

const GMAPS = 'https://www.google.com/maps/place/Lovely+Professional+University/@31.25,75.70,17z';

describe('ids', () => {
  it('studio ids: stu: + 20–32 lower-case base32', () => {
    expect(STUDIO_ID_RE.test(`stu:${'a'.repeat(20)}`)).toBe(true);
    expect(STUDIO_ID_RE.test(`stu:${'a2'.repeat(16)}`)).toBe(true);
    for (const bad of [
      `stu:${'a'.repeat(19)}`,
      `stu:${'a'.repeat(33)}`,
      `stu:${'A'.repeat(26)}`,
      `stu:${'a1'.repeat(13)}`,
      `own:${'a'.repeat(26)}`,
      `stu:${'a8'.repeat(13)}`,
    ])
      expect(STUDIO_ID_RE.test(bad), bad).toBe(false);
  });

  it('base building ids: OSM ways/relations and curated ids only', () => {
    for (const ok of ['osm:way/422437885', 'osm:relation/21599790', 'cur:central-library'])
      expect(BASE_BUILDING_ID_RE.test(ok), ok).toBe(true);
    for (const bad of [
      'osm:node/1',
      'osm:way/0',
      'osm:way/abc',
      'cur:',
      'stu:abcdefghijklmnopqrst',
      'osm:way/1 ',
    ])
      expect(BASE_BUILDING_ID_RE.test(bad), bad).toBe(false);
  });

  it('the public id is the target id for a base-building model, else the studio id', () => {
    expect(studioPublicId({ id: STU_ID, targetId: null })).toBe(STU_ID);
    expect(studioPublicId({ id: STU_ID, targetId: 'osm:way/7' })).toBe('osm:way/7');
  });
});

describe('ModelConfigV1', () => {
  it('accepts a valid model', () => accepts(modelConfigV1Schema, model()));

  it('rejects unknown keys at every level (writes are strict)', () => {
    rejects(modelConfigV1Schema, { ...model(), footprint: [] });
    rejects(modelConfigV1Schema, { ...model(), roof: { ...model().roof, texture: 'photo' } }, ['roof']);
    rejects(modelConfigV1Schema, { ...model(), facade: { ...model().facade, extra: 1 } }, ['facade']);
    rejects(modelConfigV1Schema, { ...model(), shape: { kind: 'box', x: 1 } }, ['shape']);
  });

  it('rejects an unknown modelConfigVersion, generator or generator version', () => {
    rejects(modelConfigV1Schema, { ...model(), modelConfigVersion: 2 }, ['modelConfigVersion']);
    rejects(modelConfigV1Schema, { ...model(), generatorId: 'dome' }, ['generatorId']);
    rejects(modelConfigV1Schema, { ...model(), generatorVersion: 99 }, ['generatorVersion']);
  });

  it('shape.kind must match the generator', () => {
    rejects(modelConfigV1Schema, { ...model(), shape: { kind: 'hall' } }, ['shape', 'kind']);
  });

  it('allows only the roofs a generator can build (S14)', () => {
    const lshape = {
      ...model(),
      generatorId: 'l-shape',
      shape: { kind: 'l-shape', notchWidthFrac: 0.5, notchLengthFrac: 0.5, notchCorner: 'front-left' },
    };
    accepts(modelConfigV1Schema, lshape);
    rejects(
      modelConfigV1Schema,
      { ...lshape, roof: { shape: 'gable', pitchDeg: 30, colour: '#aa0000', material: 'tile' } },
      ['roof', 'shape'],
    );
    rejects(
      modelConfigV1Schema,
      { ...model(), roof: { shape: 'stepped', colour: '#aa0000', material: 'concrete' } },
      ['roof', 'shape'],
    );
    for (const id of GENERATOR_IDS) expect(GENERATORS[id].roofs.length).toBeGreaterThan(0);
  });

  it('pitched roofs need pitchDeg; flat and stepped roofs have none', () => {
    accepts(modelConfigV1Schema, {
      ...model(),
      roof: { shape: 'gable', pitchDeg: 25, colour: '#884433', material: 'tile' },
    });
    rejects(
      modelConfigV1Schema,
      { ...model(), roof: { shape: 'gable', colour: '#884433', material: 'tile' } },
      ['roof', 'pitchDeg'],
    );
    rejects(
      modelConfigV1Schema,
      { ...model(), roof: { shape: 'flat', pitchDeg: 5, colour: '#884433', material: 'concrete' } },
      ['roof', 'pitchDeg'],
    );
    rejects(
      modelConfigV1Schema,
      { ...model(), roof: { shape: 'hip', pitchDeg: 90, colour: '#884433', material: 'tile' } },
      ['roof', 'pitchDeg'],
    );
  });

  it("windowDensity is 0 exactly when the pattern is 'none'", () => {
    const f = model().facade;
    accepts(modelConfigV1Schema, { ...model(), facade: { ...f, windowPattern: 'none', windowDensity: 0 } });
    rejects(
      modelConfigV1Schema,
      { ...model(), facade: { ...f, windowPattern: 'none', windowDensity: 0.2 } },
      ['facade', 'windowDensity'],
    );
    rejects(modelConfigV1Schema, { ...model(), facade: { ...f, windowPattern: 'grid', windowDensity: 0 } }, [
      'facade',
      'windowDensity',
    ]);
    rejects(modelConfigV1Schema, { ...model(), facade: { ...f, windowDensity: 1.5 } }, [
      'facade',
      'windowDensity',
    ]);
  });

  it('colours are #rrggbb lower-case hex', () => {
    for (const c of ['#ABCDEF', '#abc', 'red', '#abcdeg', 'rgb(1,2,3)'])
      rejects(modelConfigV1Schema, { ...model(), facade: { ...model().facade, wallColour: c } }, [
        'facade',
        'wallColour',
      ]);
  });

  it('placement: rotation in [0, 360), anchor a valid [lon, lat]', () => {
    accepts(modelConfigV1Schema, { ...model(), rotationDeg: 0 });
    accepts(modelConfigV1Schema, { ...model(), rotationDeg: 359.9 });
    rejects(modelConfigV1Schema, { ...model(), rotationDeg: 360 }, ['rotationDeg']);
    rejects(modelConfigV1Schema, { ...model(), rotationDeg: -1 }, ['rotationDeg']);
    rejects(modelConfigV1Schema, { ...model(), anchor: [200, 31] }, ['anchor']);
    rejects(modelConfigV1Schema, { ...model(), anchor: [75.7] }, ['anchor']);
  });

  it('storable envelope is enforced; publish ranges are not (a draft may hold them)', () => {
    accepts(modelConfigV1Schema, { ...model(), widthM: STUDIO_LIMITS.dims.widthM.max + 100 });
    accepts(modelConfigV1Schema, { ...model(), floors: STUDIO_LIMITS.dims.floors.max + 1 });
    rejects(modelConfigV1Schema, { ...model(), widthM: 0 }, ['widthM']);
    rejects(modelConfigV1Schema, { ...model(), widthM: STUDIO_LIMITS.storable.maxMetres + 1 }, ['widthM']);
    rejects(modelConfigV1Schema, { ...model(), heightM: Number.POSITIVE_INFINITY }, ['heightM']);
    rejects(modelConfigV1Schema, { ...model(), lengthM: Number.NaN }, ['lengthM']);
    rejects(modelConfigV1Schema, { ...model(), floors: 2.5 }, ['floors']);
    rejects(modelConfigV1Schema, { ...model(), floors: 0 }, ['floors']);
    rejects(modelConfigV1Schema, { ...model(), baseOffsetM: -0.1 }, ['baseOffsetM']);
  });

  it('shape parameters are range-checked per generator', () => {
    const tp = (shape: object) => ({ ...model(), generatorId: 'tower-podium', shape });
    accepts(
      modelConfigV1Schema,
      tp({ kind: 'tower-podium', podiumFloors: 2, towerWidthFrac: 0.5, towerLengthFrac: 0.5 }),
    );
    rejects(
      modelConfigV1Schema,
      tp({ kind: 'tower-podium', podiumFloors: 0, towerWidthFrac: 0.5, towerLengthFrac: 0.5 }),
      ['shape'],
    );
    const st = {
      ...model(),
      generatorId: 'stepped',
      roof: { shape: 'stepped', colour: '#999999', material: 'concrete' },
    };
    accepts(modelConfigV1Schema, { ...st, shape: { kind: 'stepped', tiers: 3, setbackM: 2 } });
    rejects(modelConfigV1Schema, { ...st, shape: { kind: 'stepped', tiers: 6, setbackM: 2 } }, ['shape']);
  });

  it('an optional geometry guide must name a detection', () => {
    accepts(modelConfigV1Schema, { ...model(), geometryGuide: { detectionId: 'det:microsoft-ml:0123abcd' } });
    rejects(modelConfigV1Schema, { ...model(), geometryGuide: { detectionId: 'osm:way/1' } }, [
      'geometryGuide',
    ]);
  });
});

describe('modelSupport (S2: never reinterpret, never drop)', () => {
  it('accepts a supported model', () => expect(modelSupport(model())).toMatchObject({ ok: true }));
  it.each([
    [{ ...model(), modelConfigVersion: 2 }, 'unknown-model-config-version'],
    [{ ...model(), generatorId: 'dome' }, 'unknown-generator'],
    [{ ...model(), generatorVersion: 7 }, 'unknown-generator-version'],
    [{ ...model(), widthM: -1 }, 'invalid-config'],
    [{ nope: true }, 'invalid-config'],
  ])('reports %#', (m, reason) => expect(modelSupport(m)).toMatchObject({ ok: false, reason }));
});

describe('identity', () => {
  it('accepts a minimal identity (name may be null; never invented)', () =>
    accepts(studioIdentitySchema, identity()));

  it('blank optional text becomes null', () => {
    const out = accepts(studioIdentitySchema, {
      ...identity(),
      name: '   ',
      subtype: '',
      description: ' ',
      notes: '',
    });
    expect(out).toMatchObject({ name: null, subtype: null, description: null, notes: null });
  });

  it('rejects short names, control characters and unknown keys', () => {
    rejects(studioIdentitySchema, { ...identity(), name: 'A' }, ['name']);
    rejects(studioIdentitySchema, { ...identity(), name: 'Block‮34' }, ['name']);
    rejects(studioIdentitySchema, { ...identity(), description: 'ok\u0007' }, ['description']);
    rejects(studioIdentitySchema, { ...identity(), officialBlock: '34' });
  });

  it('aliases: at most 10, unique case-insensitively, non-empty', () => {
    accepts(studioIdentitySchema, { ...identity(), aliases: ['UB', 'Uni Block'] });
    rejects(studioIdentitySchema, { ...identity(), aliases: ['UB', 'ub'] }, ['aliases']);
    rejects(studioIdentitySchema, { ...identity(), aliases: [''] }, ['aliases']);
    rejects(studioIdentitySchema, { ...identity(), aliases: Array.from({ length: 11 }, (_, i) => `A${i}`) }, [
      'aliases',
    ]);
  });

  it('category comes from the registry (no "other" placeholder); "building" means use not recorded', () => {
    expect(STUDIO_CATEGORY_IDS).toContain('building');
    expect(STUDIO_CATEGORY_IDS).not.toContain('other');
    accepts(studioIdentitySchema, { ...identity(), categoryId: 'building' });
    rejects(studioIdentitySchema, { ...identity(), categoryId: 'other' }, ['categoryId']);
    rejects(studioIdentitySchema, { ...identity(), categoryId: 'castle' }, ['categoryId']);
  });

  it('private notes have a length limit', () => {
    rejects(studioIdentitySchema, { ...identity(), notes: 'x'.repeat(STUDIO_LIMITS.notes + 1) }, ['notes']);
  });
});

describe('verification (S3, S6)', () => {
  const sourceBacked = {
    status: 'source-backed',
    citation: { url: 'https://www.lpu.in/campus/', title: 'LPU campus page', accessedOn: '2026-10-20' },
    note: 'Page lists this block by name and photo.',
  };
  const surveyed = {
    status: 'surveyed',
    surveyDate: '2026-10-01',
    note: 'Walked around and paced the outline.',
  };

  it('complete evidence passes both schemas', () => {
    for (const v of [{ status: 'unverified' }, sourceBacked, surveyed]) {
      accepts(verificationSchema, v);
      accepts(verificationDraftSchema, v);
    }
  });

  it('a draft may hold incomplete evidence; publishing needs it complete', () => {
    const incomplete = {
      status: 'source-backed',
      citation: { url: '', title: '', accessedOn: '' },
      note: '',
    };
    accepts(verificationDraftSchema, incomplete);
    rejects(verificationSchema, incomplete);
    accepts(verificationDraftSchema, { status: 'surveyed', surveyDate: '', note: '' });
    rejects(verificationSchema, { ...surveyed, surveyDate: '' }, ['surveyDate']);
    rejects(verificationSchema, { ...surveyed, note: 'short' }, ['note']);
    rejects(verificationSchema, { ...sourceBacked, citation: { ...sourceBacked.citation, url: '' } }, [
      'citation',
      'url',
    ]);
  });

  it('rejects Google Maps / Earth / Street View as a source, even in a draft', () => {
    for (const schema of [verificationSchema, verificationDraftSchema]) {
      rejects(schema, { ...sourceBacked, citation: { ...sourceBacked.citation, url: GMAPS } }, [
        'citation',
        'url',
      ]);
      rejects(
        schema,
        { ...sourceBacked, citation: { ...sourceBacked.citation, title: 'see maps.app.goo.gl/AbCd' } },
        ['citation', 'title'],
      );
      rejects(schema, { ...sourceBacked, note: 'Traced from https://earth.google.com/web/@31.25,75.70' }, [
        'note',
      ]);
      rejects(schema, { ...surveyed, note: 'Checked on goo.gl/maps/xyz before the walk' }, ['note']);
    }
  });

  it('accepts Google Open Buildings (a separately licensed dataset) as a citation', () => {
    accepts(verificationSchema, {
      ...sourceBacked,
      citation: { ...sourceBacked.citation, url: 'https://sites.research.google/gr/open-buildings/' },
    });
  });

  it('dates are real calendar dates; URLs are http(s) without credentials', () => {
    rejects(verificationSchema, { ...surveyed, surveyDate: '2026-02-30' }, ['surveyDate']);
    rejects(verificationSchema, { ...surveyed, surveyDate: '01-10-2026' }, ['surveyDate']);
    rejects(
      verificationDraftSchema,
      { ...sourceBacked, citation: { ...sourceBacked.citation, url: 'ftp://x.org/a' } },
      ['citation', 'url'],
    );
    rejects(
      verificationDraftSchema,
      { ...sourceBacked, citation: { ...sourceBacked.citation, url: 'https://u:p@x.org/' } },
      ['citation', 'url'],
    );
    rejects(verificationDraftSchema, { status: 'verified' }, ['status']);
  });
});

describe('templates', () => {
  it('accepts a valid template with two variants', () => accepts(templateDefinitionSchema, template()));

  it('variants use the template generator and stay inside its constraints', () => {
    const t = template();
    const v = t.variants[0]!;
    rejects(
      templateDefinitionSchema,
      { ...t, variants: [{ ...v, defaults: { ...v.defaults, widthM: 5 } }] },
      ['variants', 0, 'defaults', 'widthM'],
    );
    rejects(
      templateDefinitionSchema,
      {
        ...t,
        variants: [{ ...v, defaults: { ...v.defaults, generatorId: 'hall', shape: { kind: 'hall' } } }],
      },
      ['variants', 0, 'defaults', 'generatorId'],
    );
    rejects(templateDefinitionSchema, { ...t, variants: [v, { ...v }] }, ['variants', 1, 'id']);
    rejects(
      templateDefinitionSchema,
      {
        ...t,
        variants: [
          {
            ...v,
            defaults: {
              ...v.defaults,
              roof: { shape: 'gable', pitchDeg: 20, colour: '#884433', material: 'tile' },
            },
          },
        ],
      },
      ['variants', 0, 'defaults', 'roof'],
    );
    rejects(
      templateDefinitionSchema,
      {
        ...t,
        variants: [
          { ...v, defaults: { ...v.defaults, facade: { ...v.defaults.facade, windowPattern: 'grid' } } },
        ],
      },
      ['variants', 0, 'defaults', 'facade'],
    );
    rejects(
      templateDefinitionSchema,
      {
        ...t,
        variants: [{ ...v, defaults: { ...v.defaults, facade: { ...v.defaults.facade, balconies: true } } }],
      },
      ['variants', 0, 'defaults', 'facade', 'balconies'],
    );
    rejects(templateDefinitionSchema, { ...t, variants: [] }, ['variants']);
  });

  it('constraints: ranges ordered, roofs buildable by the generator', () => {
    const t = template();
    rejects(
      templateDefinitionSchema,
      { ...t, constraints: { ...t.constraints, widthM: { min: 50, max: 10 } } },
      ['constraints', 'widthM'],
    );
    rejects(
      templateDefinitionSchema,
      { ...t, constraints: { ...t.constraints, roofShapes: ['flat', 'stepped'] } },
      ['constraints', 'roofShapes'],
    );
  });

  it('library categories cover the 17 owner types', () => expect(LIBRARY_CATEGORIES).toHaveLength(17));

  it('owner templates are never evidence-backed and get id/version/renderCost from the server', () => {
    const { id: _i, version: _v, renderCost: _r, ...body } = template();
    accepts(ownerTemplateInputSchema, {
      ...body,
      basedOn: { templateId: 'academic-block', templateVersion: 1 },
    });
    rejects(ownerTemplateInputSchema, { ...body, accuracyClass: 'surveyed', basedOn: null }, [
      'accuracyClass',
    ]);
    rejects(ownerTemplateInputSchema, { ...body, basedOn: null, id: 'x' });
  });
});

describe('draft and requests', () => {
  it('accepts a valid draft and rejects unknown keys (no client footprint)', () => {
    accepts(studioDraftSchema, draft());
    rejects(studioDraftSchema, { ...draft(), footprint: { type: 'Polygon', coordinates: [] } });
    rejects(studioDraftSchema, { ...draft(), status: 'published' });
  });

  it('a base-building model has no identity in the draft; the record kind is checked by the validator', () => {
    accepts(createStudioBuildingRequestSchema, {
      targetId: 'osm:way/422437885',
      draft: draft({ identity: null }),
    });
    rejects(createStudioBuildingRequestSchema, { targetId: 'osm:node/1', draft: draft() }, ['targetId']);
    rejects(createStudioBuildingRequestSchema, { targetId: null, draft: draft(), id: STU_ID });
  });

  it('position corrections need a reason and never cite Google Maps', () => {
    accepts(
      studioDraftSchema,
      draft({ positionCorrection: { reason: 'OSM outline is offset 6 m west (site survey).' } }),
    );
    rejects(studioDraftSchema, draft({ positionCorrection: { reason: 'wrong' } }), ['positionCorrection']);
    rejects(studioDraftSchema, draft({ positionCorrection: { reason: `Offset, compare ${GMAPS}` } }), [
      'positionCorrection',
    ]);
  });

  it('every write carries a positive integer revision', () => {
    accepts(saveDraftRequestSchema, { revision: 3, draft: draft() });
    rejects(saveDraftRequestSchema, { revision: 0, draft: draft() }, ['revision']);
    rejects(saveDraftRequestSchema, { draft: draft() }, ['revision']);
  });

  it('publish: change summary required; one acknowledgement + reason per warning code', () => {
    const ack = { code: 'boundary-crossing', reason: 'Wing crosses the mapped boundary; owner confirmed.' };
    accepts(publishRequestSchema, { revision: 1, acknowledgements: [ack], changeSummary: 'First publish' });
    rejects(publishRequestSchema, { revision: 1, acknowledgements: [], changeSummary: 'x' }, [
      'changeSummary',
    ]);
    rejects(publishRequestSchema, { revision: 1, acknowledgements: [ack, ack], changeSummary: 'Publish' }, [
      'acknowledgements',
    ]);
    rejects(acknowledgementSchema, { code: 'outside-campus', reason: 'errors cannot be acknowledged' }, [
      'code',
    ]);
    rejects(acknowledgementSchema, { ...ack, reason: 'ok' }, ['reason']);
    rejects(acknowledgementSchema, { ...ack, reason: `Matches ${GMAPS}` }, ['reason']);
    accepts(restoreRequestSchema, { revision: 2, acknowledgements: [] });
  });

  it('archive reason is optional; delete needs the typed id', () => {
    expect(accepts(archiveRequestSchema, { revision: 1, reason: '  ' })).toEqual({
      revision: 1,
      reason: null,
    });
    accepts(deleteStudioBuildingRequestSchema, { revision: 4, confirmId: STU_ID });
    rejects(deleteStudioBuildingRequestSchema, { revision: 4 }, ['confirmId']);
  });

  it('duplicate: a visible offset (≥ 1 m, ≤ 200 m) or the default', () => {
    accepts(duplicateRequestSchema, { offsetM: null });
    accepts(duplicateRequestSchema, { offsetM: { east: 0, north: -12 } });
    rejects(duplicateRequestSchema, { offsetM: { east: 0.5, north: 0.5 } }, ['offsetM']);
    rejects(duplicateRequestSchema, { offsetM: { east: 201, north: 0 } }, ['offsetM', 'east']);
    expect(defaultDuplicateOffsetM({ widthM: 20 })).toEqual({ east: 25, north: 0 });
    expect(defaultDuplicateOffsetM({ widthM: 400 })).toEqual({ east: 200, north: 0 });
  });

  it('apply-template is explicit (dryRun required) and validate takes the record id or null', () => {
    accepts(applyTemplateRequestSchema, {
      revision: 1,
      templateId: 'academic-block',
      templateVersion: 2,
      variantId: 'plain',
      dryRun: true,
    });
    rejects(
      applyTemplateRequestSchema,
      { revision: 1, templateId: 'academic-block', templateVersion: 2, variantId: 'plain' },
      ['dryRun'],
    );
    accepts(applyTemplateRequestSchema, {
      revision: 1,
      templateId: `stv:${'q'.repeat(26)}`,
      templateVersion: 1,
      variantId: 'plain',
      dryRun: false,
    });
    accepts(validateRequestSchema, { targetId: null, draft: draft(), recordId: null });
    rejects(validateRequestSchema, { targetId: null, draft: draft(), recordId: 'own:x' }, ['recordId']);
  });
});

describe('validation issues', () => {
  it('every code has a fixed severity; warnings are the acknowledgeable codes', () => {
    expect(WARNING_CODES).toEqual(
      Object.keys(VALIDATION_CODES).filter(
        (c) => VALIDATION_CODES[c as keyof typeof VALIDATION_CODES] === 'warning',
      ),
    );
    expect(WARNING_CODES).toContain('boundary-uncertain');
    expect(WARNING_CODES).not.toContain('outside-campus');
  });

  it('an issue must carry its code severity', () => {
    const issue = {
      code: 'outside-campus',
      severity: 'error',
      message: 'Footprint is outside the campus boundary.',
      path: 'model.anchor',
      data: { insideFraction: 0 },
    };
    accepts(validationIssueSchema, issue);
    rejects(validationIssueSchema, { ...issue, severity: 'warning' }, ['severity']);
    rejects(validationIssueSchema, { ...issue, code: 'made-up' }, ['code']);
    rejects(validationIssueSchema, { ...issue, data: { nested: { a: 1 } } }, ['data']);
    accepts(validationResultSchema, {
      issues: [issue],
      errorCount: 1,
      warningCount: 0,
      publishable: false,
      requiredAcknowledgements: [],
    });
  });

  it('missingAcknowledgements lists uncovered warning codes', () => {
    expect(
      missingAcknowledgements(['boundary-crossing', 'possible-duplicate'], [{ code: 'possible-duplicate' }]),
    ).toEqual(['boundary-crossing']);
    expect(acknowledgementsSchema.safeParse([]).success).toBe(true);
  });
});

describe('PublishedStudioBuilding (public, v2 publication)', () => {
  it('accepts a valid record and strips private fields', () => {
    const withNotes = {
      ...published(),
      identity: { ...published().identity, notes: 'private' },
      createdBy: 'owner@x',
    };
    const out = accepts(publishedStudioBuildingSchema, withNotes) as Record<string, unknown>;
    expect(out).not.toHaveProperty('createdBy');
    expect(out.identity).not.toHaveProperty('notes');
  });

  it('new building: identity required, no correction, no footprint-prism', () => {
    rejects(publishedStudioBuildingSchema, published({ identity: null }), ['identity']);
    rejects(publishedStudioBuildingSchema, published({ positionCorrected: true }), ['positionCorrected']);
    rejects(
      publishedStudioBuildingSchema,
      published({
        model: { ...model(), generatorId: 'footprint-prism', shape: { kind: 'footprint-prism' } },
      }),
      ['model'],
    );
  });

  it('base-building model: identity and access stay with the place override', () => {
    const base = { targetId: 'osm:way/422437885', identity: null } as const;
    accepts(
      publishedStudioBuildingSchema,
      published({
        ...base,
        model: { ...model(), generatorId: 'footprint-prism', shape: { kind: 'footprint-prism' } },
      }),
    );
    accepts(publishedStudioBuildingSchema, published({ ...base, positionCorrected: true }));
    rejects(publishedStudioBuildingSchema, published({ ...base, identity: published().identity }), [
      'identity',
    ]);
    rejects(publishedStudioBuildingSchema, published({ ...base, accessNodeId: 12 }), ['accessNodeId']);
    rejects(
      publishedStudioBuildingSchema,
      published({
        ...base,
        positionCorrected: true,
        model: { ...model(), generatorId: 'footprint-prism', shape: { kind: 'footprint-prism' } },
      }),
      ['model'],
    );
  });

  it('keeps a model this client cannot generate (rendered as a prism, never dropped)', () => {
    const future = published({
      model: {
        ...model(),
        modelConfigVersion: 3,
        generatorId: 'dome',
        generatorVersion: 5,
        novel: true,
      } as never,
    });
    const out = accepts(publishedStudioBuildingSchema, future) as { model: unknown };
    expect(modelSupport(out.model)).toMatchObject({ ok: false, reason: 'unknown-model-config-version' });
    rejects(publishedStudioBuildingSchema, published({ model: { generatorId: 'box' } as never }), ['model']);
  });

  it('footprint: closed rings, at most 256 vertices', () => {
    const fp = clone(published().footprint);
    fp.coordinates[0]!.pop();
    rejects(publishedStudioBuildingSchema, published({ footprint: fp }), ['footprint']);
    const ring = Array.from(
      { length: 256 },
      (_, i) => [ANCHOR[0] + Math.cos(i) * 1e-4, ANCHOR[1] + Math.sin(i) * 1e-4] as [number, number],
    );
    rejects(
      publishedStudioBuildingSchema,
      published({ footprint: { type: 'Polygon', coordinates: [[...ring, ring[0]!]] } }),
      ['footprint'],
    );
    rejects(
      publishedStudioBuildingSchema,
      published({ footprint: { type: 'MultiPolygon', coordinates: [] } as never }),
      ['footprint'],
    );
  });

  it('membership: inventory statuses only; curated decisions carry their source', () => {
    const m = published().membership;
    rejects(
      publishedStudioBuildingSchema,
      published({ membership: { ...m, campusStatus: 'outside' as never } }),
      ['membership'],
    );
    rejects(
      publishedStudioBuildingSchema,
      published({ membership: { ...m, campusStatus: 'uncertain' as never } }),
      ['membership'],
    );
    rejects(publishedStudioBuildingSchema, published({ membership: { ...m, decision: 'curated' } }), [
      'membership',
    ]);
    accepts(
      publishedStudioBuildingSchema,
      published({
        membership: {
          ...m,
          campusStatus: 'crossing',
          insideFraction: 0.4,
          reasonCode: 'curated-decision',
          decision: 'curated',
          decisionSource: `owner-confirmation: studio ${STU_ID} v1`,
        },
      }),
    );
  });

  it('verification must be complete in the public record', () => {
    rejects(
      publishedStudioBuildingSchema,
      published({ verification: { status: 'surveyed', surveyDate: '', note: '' } as never }),
      ['verification'],
    );
  });
});
