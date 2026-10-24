/**
 * Integrity red team (Building Studio), against a local D1 and the REAL base
 * dataset:
 *  - validation bypass over the real admin HTTP dispatcher: every error case
 *    stays unpublishable even when EVERY warning code is acknowledged; the
 *    schema-level rejections (absurd values, Google Maps evidence in any
 *    provenance field, acknowledging an error code) store nothing; warnings
 *    need an acknowledgement and then publish;
 *  - two overlapping drafts published concurrently can never both publish
 *    without acknowledging the overlap (validation and publish are atomic
 *    with respect to the published set);
 *  - template and code-library updates never change a published instance:
 *    the public record, the immutable version rows and the generated mesh
 *    are byte-identical (SHA-256 / meshHash before and after);
 *  - a published model this build cannot generate (unknown generator
 *    version) is never dropped and never reinterpreted: it stays in the
 *    publication, the client draws the fallback prism, the quality view
 *    flags it and every write that would reinterpret it is 422.
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../../../server/env.ts';
import { handleAdmin } from '../../../server/handlers/admin/index.ts';
import { handlePublication } from '../../../server/handlers/publication.ts';
import { getPublication } from '../../../server/domain/publication.ts';
import {
  applyStudioTemplate,
  archiveStudioBuilding,
  createStudioBuilding,
  discardStudioDraft,
  duplicateStudioBuilding,
  getStudioBuilding,
  getStudioQuality,
  publishStudioBuilding,
  restoreStudioBuilding,
  saveStudioDraft,
  validateStudioRequest,
} from '../../../server/domain/studio/index.ts';
import { DomainError } from '../../../server/errors.ts';
import { modelFromVariant, starterLibrary } from '../../../src/building-studio/asset-library.ts';
import { createEnuFrame } from '../../../src/building-studio/footprint.ts';
import { meshHash } from '../../../src/building-studio/mesh/cache.ts';
import { generateStudioMesh } from '../../../src/building-studio/mesh/generate.ts';
import { mergeStudioBuildings } from '../../../src/building-studio/merge.ts';
import { studioInstanceFor } from '../../../src/building-studio/render/maplibre/instances.ts';
import {
  modelSupport,
  publishResponseSchema,
  studioBuildingDetailSchema,
  studioErrorDetailsSchema,
  studioQualityResponseSchema,
  validationResultSchema,
  WARNING_CODES,
  type PublishedStudioBuilding,
  type StudioDraft,
  type TemplateDefinition,
} from '../../../src/building-studio/schema.ts';
import { publicationSchema } from '../../../src/community/schema.ts';
import type { LngLat } from '../../../src/data/schema.ts';
import { isoStudioModel } from '../../../src/isometric/studio.ts';
import { realData } from '../../unit/building-studio/real-data.ts';
import { accessEnvVars, claims, jwksFetch, makeKey, sign, type TestKey } from '../auth/jwt-fixtures.ts';
import { fileAssets, makeDeps, req } from '../http/fixtures.ts';
import { createTestDb, type TestDb } from '../http/harness.ts';
import {
  newDraft,
  publicationVersion,
  publishBody,
  realStudioBase,
  realStudioParts,
  SITE_A,
  SITE_B,
  studioClock,
  studioSnapshot,
} from './helpers.ts';

let t: TestDb;
let key: TestKey;
const now = new Date('2026-10-24T09:00:00.000Z');
const c = studioClock(realStudioBase(), Date.parse('2026-10-24T10:00:00.000Z'));

beforeAll(async () => {
  t = await createTestDb();
  key = await makeKey('rt1');
});
afterAll(async () => t.dispose());

const deps = () =>
  makeDeps({
    env: { DB: t.db, ASSETS: fileAssets, ...accessEnvVars } as Env,
    now: () => now,
    fetch: jwksFetch([key]),
  });

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const headers = { 'Cf-Access-Jwt-Assertion': await sign(key, claims(now)) };
  return handleAdmin(
    req(method, `/api/admin/studio${path}`, { headers, ...(body === undefined ? {} : { body }) }),
    deps(),
  );
}

async function publicBuildings(): Promise<PublishedStudioBuilding[]> {
  const res = await handlePublication(req('GET', '/api/locations'), deps());
  return publicationSchema.parse(await res.json()).buildings ?? [];
}

/** An acknowledgement for EVERY warning code: errors must still block. */
const ALL_ACKS = WARNING_CODES.map((code) => ({ code, reason: 'Red team: acknowledging everything' }));

const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

async function domainError(p: Promise<unknown>): Promise<DomainError> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(DomainError);
  return e as DomainError;
}

/** A point `east`/`north` metres from `p`. */
const offset = (p: LngLat, east: number, north: number): LngLat => {
  const q = createEnuFrame(p).toLngLat([east, north]);
  return [q[0], q[1]];
};

function draftWith(model: Partial<StudioDraft['model']>, rest: Partial<Omit<StudioDraft, 'model'>> = {}) {
  return newDraft({ model, ...rest });
}

/** The first candidate where a 20 m box, and the same box 8 m east, publish with no warning or error. */
async function cleanSite(candidates: LngLat[]): Promise<LngLat> {
  for (const site of candidates) {
    const clean = await Promise.all(
      [site, offset(site, 8, 0)].map(async (anchor) => {
        const r = validationResultSchema.parse(
          await validateStudioRequest(
            t.db,
            { targetId: null, recordId: null, draft: draftWith({ anchor }) },
            c.owner(),
          ),
        );
        return r.errorCount === 0 && r.requiredAcknowledgements.length === 0;
      }),
    );
    if (clean.every(Boolean)) return site;
  }
  throw new Error('no clean test site among the candidates');
}

// ---------------------------------------------------------------------------
// 1. Validation bypass through the real HTTP API
// ---------------------------------------------------------------------------

describe('validation bypass via direct admin API calls', () => {
  const graph = realStudioParts().graph;
  const footNodes = new Set(graph.edges.filter((e) => e.foot).flatMap((e) => [e.from, e.to]));
  // A walkable node far (> 500 m) from SITE_A.
  const farNode = [...footNodes].find((i) => {
    const n = graph.nodes[i]!;
    const [x, y] = createEnuFrame(SITE_A).toLocal(n);
    return Math.hypot(x, y) > 500;
  })!;
  const someBase = realStudioBase().buildings.features.find((f) => f.geometry.type === 'Polygon')!;

  const ERROR_CASES: { name: string; draft: StudioDraft; targetId?: string; code: string }[] = [
    {
      name: 'outside the campus (but inside the map area)',
      draft: draftWith({ anchor: [75.686, 31.237] }),
      code: 'outside-campus',
    },
    {
      name: 'outside the map area',
      draft: draftWith({ anchor: [75.6, 31.2] }),
      code: 'outside-max-bounds',
    },
    {
      name: 'absurd width (storable 5000 m)',
      draft: draftWith({ widthM: 5000 }),
      code: 'dimension-out-of-range',
    },
    {
      name: 'absurd floors and height (400 floors, 1280 m)',
      draft: draftWith({ floors: 400, heightM: 1280 }),
      code: 'dimension-out-of-range',
    },
    {
      name: 'invalid geometry (stepped setbacks larger than the footprint)',
      draft: draftWith({
        generatorId: 'stepped',
        shape: { kind: 'stepped', tiers: 5, setbackM: 20 },
        roof: { shape: 'stepped', colour: '#8a8a8a', material: 'concrete' },
      }),
      code: 'geometry-invalid',
    },
    {
      name: 'invalid geometry (podium taller than the building)',
      draft: draftWith({
        generatorId: 'tower-podium',
        shape: { kind: 'tower-podium', podiumFloors: 6, towerWidthFrac: 0.5, towerLengthFrac: 0.5 },
      }),
      code: 'geometry-invalid',
    },
    {
      name: "'footprint-prism' on a new building",
      draft: draftWith({ generatorId: 'footprint-prism', shape: { kind: 'footprint-prism' } }),
      code: 'not-applicable',
    },
    {
      name: 'source-backed evidence dated in the future',
      draft: draftWith(
        {},
        {
          verification: {
            status: 'source-backed',
            citation: {
              url: 'https://example.org/campus-plan',
              title: 'Campus plan',
              accessedOn: '2099-01-01',
            },
            note: 'Building shown on the published campus plan.',
          },
        },
      ),
      code: 'verification-evidence',
    },
    {
      name: 'routing through a walkable node > 60 m away',
      draft: draftWith({}, { accessNodeId: farNode }),
      code: 'access-node-invalid',
    },
    {
      name: 'routing through a node that does not exist',
      draft: draftWith({}, { accessNodeId: graph.nodes.length + 10 }),
      code: 'access-node-invalid',
    },
    {
      name: 'identity on a model of a base building',
      draft: { ...draftWith({ generatorId: 'footprint-prism', shape: { kind: 'footprint-prism' } }) },
      targetId: someBase.properties.id,
      code: 'not-applicable',
    },
  ];

  for (const tc of ERROR_CASES)
    it(`error stays unpublishable with every warning acknowledged: ${tc.name}`, async () => {
      const created = await call('POST', '/buildings', { targetId: tc.targetId ?? null, draft: tc.draft });
      expect(created.status, await created.clone().text()).toBe(201);
      const d = studioBuildingDetailSchema.parse(await created.json());
      expect(d.validation?.issues.map((i) => i.code)).toContain(tc.code);
      const before = await studioSnapshot(t.db);
      const res = await call(
        'POST',
        `/buildings/${d.head.id}/publish`,
        publishBody(d.head.revision, { acknowledgements: ALL_ACKS }),
      );
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: { code: string; details: unknown } };
      expect(body.error.code).toBe('validation-failed');
      const details = studioErrorDetailsSchema.parse(body.error.details);
      expect(details.validation?.issues.map((i) => i.code)).toContain(tc.code);
      const after = await studioSnapshot(t.db);
      expect(after.versions).toEqual(before.versions);
      expect(after.buildings).toEqual(before.buildings);
      expect(after.meta).toEqual(before.meta);
      expect((await publicBuildings()).map((b) => b.id)).not.toContain(d.head.id);
      // Clean up so later overlap checks see only what they create.
      await call('POST', `/buildings/${d.head.id}/archive`, { revision: d.head.revision, reason: null });
    });

  const GOOGLE = [
    'https://www.google.com/maps/place/Lovely+Professional+University/@31.25,75.70,17z',
    'https://maps.app.goo.gl/AbCdEf123',
    'https://www.google.com/url?q=https://maps.google.com/?cid=123',
    'https://cbk0.google.com/cbk?output=thumbnail&panoid=abc',
  ];

  it('Google Maps / Earth / Street View evidence is rejected in every provenance field (400, nothing stored)', async () => {
    const base = draftWith({ anchor: offset(SITE_A, 0, -60) });
    const created = studioBuildingDetailSchema.parse(
      await (await call('POST', '/buildings', { targetId: null, draft: base })).json(),
    );
    const id = created.head.id;
    const before = await studioSnapshot(t.db);
    for (const url of GOOGLE) {
      const verifications: StudioDraft['verification'][] = [
        {
          status: 'source-backed',
          citation: { url, title: 'Map listing', accessedOn: '2026-10-01' },
          note: 'Position checked on the map listing.',
        },
        {
          status: 'source-backed',
          citation: { url: 'https://example.org/plan', title: 'Plan', accessedOn: '2026-10-01' },
          note: `Position also checked at ${url} for the outline.`,
        },
        { status: 'surveyed', surveyDate: '2026-10-01', note: `Walked around it; compared with ${url}` },
      ];
      for (const verification of verifications) {
        const r = await call('PUT', `/buildings/${id}/draft`, {
          revision: 1,
          draft: { ...base, verification },
        });
        expect(r.status, url).toBe(400);
        const v = await call('POST', '/validate', {
          targetId: null,
          recordId: null,
          draft: { ...base, verification },
        });
        expect(v.status, url).toBe(400);
      }
      const pub = await call(
        'POST',
        `/buildings/${id}/publish`,
        publishBody(1, { changeSummary: `Traced from ${url}` }),
      );
      expect(pub.status, url).toBe(400);
      const ack = await call(
        'POST',
        `/buildings/${id}/publish`,
        publishBody(1, { acknowledgements: [{ code: 'boundary-crossing', reason: `see ${url}` }] }),
      );
      expect(ack.status, url).toBe(400);
    }
    const after = await studioSnapshot(t.db);
    expect(after.buildings).toEqual(before.buildings);
    expect(after.versions).toEqual(before.versions);
    await call('POST', `/buildings/${id}/archive`, { revision: 1, reason: null });
  });

  it('absurd or non-finite values and acknowledging an ERROR code are 400; nothing is stored', async () => {
    const before = await studioSnapshot(t.db);
    for (const model of [
      { widthM: 5001 },
      { heightM: 0 },
      { floors: 0 },
      { floors: 2.5 },
      { baseOffsetM: -1 },
      { rotationDeg: 360 },
      { anchor: [200, 31.25] },
    ] as Partial<StudioDraft['model']>[]) {
      const r = await call('POST', '/buildings', { targetId: null, draft: draftWith(model) });
      expect(r.status, JSON.stringify(model)).toBe(400);
    }
    const raw = JSON.stringify({ targetId: null, draft: draftWith({}) }).replace(
      '"widthM":20',
      '"widthM":1e999',
    );
    const headers = { 'Cf-Access-Jwt-Assertion': await sign(key, claims(now)) };
    const inf = await handleAdmin(req('POST', '/api/admin/studio/buildings', { headers, raw }), deps());
    expect(inf.status).toBe(400);

    const d = studioBuildingDetailSchema.parse(
      await (
        await call('POST', '/buildings', {
          targetId: null,
          draft: draftWith({ anchor: [75.686, 31.237] }),
        })
      ).json(),
    );
    const mid = await studioSnapshot(t.db);
    const forced = await call(
      'POST',
      `/buildings/${d.head.id}/publish`,
      publishBody(1, { acknowledgements: [{ code: 'outside-campus', reason: 'Trying to force it' }] }),
    );
    expect(forced.status).toBe(400);
    expect((await studioSnapshot(t.db)).versions).toEqual(mid.versions);
    expect(before.versions).toEqual(mid.versions);
    await call('POST', `/buildings/${d.head.id}/archive`, { revision: 1, reason: null });
  });

  it('a boundary-crossing footprint needs its acknowledgement; then it publishes as crossing (audited)', async () => {
    // Find a boundary vertex where a 30 m box is 'crossing' (not 'uncertain': away from review sections).
    const fc = realStudioParts().boundary;
    const rings: LngLat[][] = fc.features.flatMap((f) =>
      f.geometry.type === 'Polygon'
        ? [f.geometry.coordinates[0] as LngLat[]]
        : (f.geometry.coordinates as LngLat[][][]).map((poly) => poly[0]!),
    );
    let site: LngLat | null = null;
    for (const v of rings.flat()) {
      const draft = draftWith({ anchor: [v[0], v[1]], widthM: 30, lengthM: 30 });
      const r = validationResultSchema.parse(
        await validateStudioRequest(t.db, { targetId: null, recordId: null, draft }, c.owner()),
      );
      const codes = r.issues.map((i) => i.code);
      if (
        r.errorCount === 0 &&
        codes.includes('boundary-crossing') &&
        r.requiredAcknowledgements.length === 1
      ) {
        site = [v[0], v[1]];
        break;
      }
    }
    expect(site, 'a crossing test site exists on the real boundary').not.toBeNull();
    const created = studioBuildingDetailSchema.parse(
      await (
        await call('POST', '/buildings', {
          targetId: null,
          draft: draftWith({ anchor: site!, widthM: 30, lengthM: 30 }),
        })
      ).json(),
    );
    const id = created.head.id;
    const missing = await call('POST', `/buildings/${id}/publish`, publishBody(1));
    expect(missing.status).toBe(422);
    const details = studioErrorDetailsSchema.parse(
      ((await missing.json()) as { error: { details: unknown } }).error.details,
    );
    expect(details.missingAcknowledgements).toEqual(['boundary-crossing']);
    expect((await publicBuildings()).map((b) => b.id)).not.toContain(id);
    const ok = await call(
      'POST',
      `/buildings/${id}/publish`,
      publishBody(1, {
        acknowledgements: [{ code: 'boundary-crossing', reason: 'Gatehouse straddles the boundary wall' }],
      }),
    );
    expect(ok.status).toBe(200);
    const pub = (await publicBuildings()).find((b) => b.id === id)!;
    expect(pub.membership.campusStatus).toBe('crossing');
    await archiveStudioBuilding(t.db, id, { revision: 2, reason: null }, c.owner());
  });

  it('overlapping a base building needs an acknowledgement (never silently moved or clipped)', async () => {
    const f = realStudioBase().buildings.features.find(
      (x) =>
        x.geometry.type === 'Polygon' &&
        (x.properties.areaM2 ?? 0) > 600 &&
        x.properties.campusStatus === 'inside',
    )!;
    const anchor: LngLat = [f.properties.anchorLon!, f.properties.anchorLat!];
    const draft = draftWith({ anchor });
    const created = studioBuildingDetailSchema.parse(
      await (await call('POST', '/buildings', { targetId: null, draft })).json(),
    );
    const codes = created.validation!.issues.map((i) => i.code);
    expect(codes.some((x) => x === 'overlap-base-building' || x === 'possible-duplicate')).toBe(true);
    const res = await call('POST', `/buildings/${created.head.id}/publish`, publishBody(1));
    expect(res.status).toBe(422);
    // Nothing was moved or resized to "fix" it.
    const head = studioBuildingDetailSchema.parse(
      await (await call('GET', `/buildings/${created.head.id}`)).json(),
    );
    expect(head.draft!.model.anchor).toEqual(anchor);
    expect(head.draft!.model.widthM).toBe(20);
    await archiveStudioBuilding(t.db, created.head.id, { revision: 1, reason: null }, c.owner());
  });
});

// ---------------------------------------------------------------------------
// 2. Concurrency: validation vs the published set
// ---------------------------------------------------------------------------

describe('two overlapping drafts published at the same time', () => {
  it('never both publish without acknowledging the overlap', async () => {
    const site = offset(SITE_B, 0, 80);
    const a = studioBuildingDetailSchema.parse(
      await createStudioBuilding(t.db, { targetId: null, draft: draftWith({ anchor: site }) }, c.owner()),
    );
    const b = studioBuildingDetailSchema.parse(
      await createStudioBuilding(
        t.db,
        { targetId: null, draft: draftWith({ anchor: offset(site, 8, 0) }) },
        c.owner(),
      ),
    );
    // Each alone is clean (the other is only a draft).
    expect(a.validation!.requiredAcknowledgements).toEqual([]);
    expect(b.validation!.requiredAcknowledgements).toEqual([]);
    const results = await Promise.allSettled([
      publishStudioBuilding(t.db, a.head.id, publishBody(1), c.owner()),
      publishStudioBuilding(t.db, b.head.id, publishBody(1), c.owner()),
    ]);
    const published = (await getPublication(t.db)).buildings!.filter(
      (x) => x.id === a.head.id || x.id === b.head.id,
    );
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeLessThanOrEqual(1);
    expect(published.length).toBeLessThanOrEqual(1);
    // The loser retries: now the overlap is reported and must be acknowledged.
    const loser = results[0]!.status === 'fulfilled' ? b : a;
    const e = await domainError(publishStudioBuilding(t.db, loser.head.id, publishBody(1), c.owner()));
    expect(['validation-failed', 'conflict']).toContain(e.code);
    for (const id of [a.head.id, b.head.id]) {
      const d = await getStudioBuilding(t.db, id, c.owner());
      await archiveStudioBuilding(t.db, id, { revision: d.head.revision, reason: null }, c.owner());
    }
  });

  it('a restore racing an overlapping publish: at most one becomes public without the acknowledgement', async () => {
    const site = await cleanSite([
      offset(SITE_A, -80, 0),
      offset(SITE_A, 0, -140),
      offset(SITE_B, 80, 0),
      offset(SITE_B, 0, 140),
    ]);
    const a = studioBuildingDetailSchema.parse(
      await createStudioBuilding(t.db, { targetId: null, draft: draftWith({ anchor: site }) }, c.owner()),
    );
    await publishStudioBuilding(t.db, a.head.id, publishBody(1), c.owner());
    await archiveStudioBuilding(t.db, a.head.id, { revision: 2, reason: null }, c.owner());
    const b = studioBuildingDetailSchema.parse(
      await createStudioBuilding(
        t.db,
        { targetId: null, draft: draftWith({ anchor: offset(site, 8, 0) }) },
        c.owner(),
      ),
    );
    expect(b.validation!.requiredAcknowledgements).toEqual([]); // A is archived: not in the published set
    const before = await publicationVersion(t.db);
    const results = await Promise.allSettled([
      restoreStudioBuilding(t.db, a.head.id, { revision: 3, acknowledgements: [] }, c.owner()),
      publishStudioBuilding(t.db, b.head.id, publishBody(1), c.owner()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeLessThanOrEqual(1);
    const ids = (await getPublication(t.db)).buildings!.map((x) => x.id);
    expect(ids.filter((id) => id === a.head.id || id === b.head.id).length).toBeLessThanOrEqual(1);
    // A rejected writer changed nothing: one bump at most.
    expect(await publicationVersion(t.db)).toBeLessThanOrEqual(before + 1);
    for (const id of [a.head.id, b.head.id]) {
      const d = await getStudioBuilding(t.db, id, c.owner());
      if (d.head.status !== 'archived')
        await archiveStudioBuilding(t.db, id, { revision: d.head.revision, reason: null }, c.owner());
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Template / library updates never change a published building
// ---------------------------------------------------------------------------

describe('template and code-library updates leave published instances byte-identical', () => {
  it('a new starter version, a missing template, apply-template previews and a discarded apply change nothing public', async () => {
    const entry = starterLibrary().find((e) => e.definition.generatorId === 'box')!;
    const def = entry.definition;
    const variant = def.variants[0]!;
    const site = offset(SITE_A, 0, 80);
    const model = modelFromVariant(variant, { anchor: site, rotationDeg: 15 });
    const ref = { templateId: def.id, templateVersion: def.version, variantId: variant.id };
    const d = studioBuildingDetailSchema.parse(
      await createStudioBuilding(
        t.db,
        { targetId: null, draft: newDraft({ model, templateRef: ref }) },
        c.owner(),
      ),
    );
    const acks = d.validation!.requiredAcknowledgements.map((code) => ({
      code,
      reason: 'Template guidance',
    }));
    publishResponseSchema.parse(
      await publishStudioBuilding(t.db, d.head.id, publishBody(1, { acknowledgements: acks }), c.owner()),
    );

    const fingerprint = async () => {
      const pub = (await getPublication(t.db)).buildings!.find((b) => b.id === d.head.id)!;
      const rows = (
        await t.db
          .prepare('SELECT * FROM studio_building_versions WHERE building_id = ?')
          .bind(d.head.id)
          .all()
      ).results;
      const support = modelSupport(pub.model);
      if (!support.ok) throw new Error('model unavailable');
      const mesh = generateStudioMesh(support.config);
      if (!mesh.ok) throw new Error(mesh.message);
      return { record: sha(pub), rows: sha(rows), mesh: meshHash(mesh.mesh), footprint: sha(pub.footprint) };
    };
    const before = await fingerprint();
    const pv = await publicationVersion(t.db);

    // (a) A deploy ships version 2 of the same starter template with different defaults.
    const v2: TemplateDefinition = {
      ...def,
      version: def.version + 1,
      variants: def.variants.map((v) => ({
        ...v,
        defaults: {
          ...v.defaults,
          heightM: v.defaults.heightM + 3,
          roof: { ...v.defaults.roof, colour: '#aa2222' },
          facade: { ...v.defaults.facade, wallColour: '#112233' },
        },
      })),
    };
    const upgraded = { templates: [...starterLibrary().map((e) => e.definition), v2] };
    const ctxV2 = () => c.owner({ library: upgraded });
    studioBuildingDetailSchema.parse(await getStudioBuilding(t.db, d.head.id, ctxV2()));
    expect(await fingerprint()).toEqual(before);

    // (b) An explicit apply-template preview writes nothing.
    const preview = await applyStudioTemplate(
      t.db,
      d.head.id,
      { revision: 2, templateId: def.id, templateVersion: v2.version, variantId: variant.id, dryRun: true },
      ctxV2(),
    );
    expect(preview.saved).toBe(false);
    expect(preview.draft.model.roof.colour).toBe('#aa2222');
    expect(await fingerprint()).toEqual(before);
    expect(await publicationVersion(t.db)).toBe(pv);

    // (c) Applying saves a DRAFT only; the public record stays until an explicit publish; discard restores.
    const applied = await applyStudioTemplate(
      t.db,
      d.head.id,
      { revision: 2, templateId: def.id, templateVersion: v2.version, variantId: variant.id, dryRun: false },
      ctxV2(),
    );
    expect(applied.saved).toBe(true);
    expect(await fingerprint()).toEqual(before);
    expect(await publicationVersion(t.db)).toBe(pv);
    await discardStudioDraft(t.db, d.head.id, { revision: 3 }, ctxV2());
    expect(await fingerprint()).toEqual(before);

    // (d) The template disappears from the library entirely (missing template): still rendered and listed.
    const without = {
      templates: starterLibrary()
        .map((e) => e.definition)
        .filter((x) => x.id !== def.id),
    };
    const missingCtx = () => c.owner({ library: without });
    const detail = studioBuildingDetailSchema.parse(await getStudioBuilding(t.db, d.head.id, missingCtx()));
    expect(detail.modelAvailable).toBe(true);
    expect(detail.published?.record.templateRef).toEqual(ref);
    expect(await fingerprint()).toEqual(before);
    expect(await publicationVersion(t.db)).toBe(pv);

    // (e) Archive + restore under the missing-template library re-publishes the SAME version.
    const arch = publishResponseSchema.parse(
      await archiveStudioBuilding(t.db, d.head.id, { revision: 4, reason: null }, missingCtx()),
    );
    publishResponseSchema.parse(
      await restoreStudioBuilding(
        t.db,
        d.head.id,
        { revision: arch.building.head.revision, acknowledgements: acks },
        missingCtx(),
      ),
    );
    expect(await fingerprint()).toEqual(before);
    const end = await getStudioBuilding(t.db, d.head.id, c.owner());
    await archiveStudioBuilding(t.db, d.head.id, { revision: end.head.revision, reason: null }, c.owner());
  });
});

// ---------------------------------------------------------------------------
// 4. A published model this build cannot generate
// ---------------------------------------------------------------------------

describe('published model with an unknown generator version (a newer or rolled-back build)', () => {
  it('is kept in the publication, drawn as the fallback prism, flagged, and never reinterpreted by a write', async () => {
    const site = offset(SITE_B, 0, -80);
    const src = studioBuildingDetailSchema.parse(
      await createStudioBuilding(t.db, { targetId: null, draft: draftWith({ anchor: site }) }, c.owner()),
    );
    publishResponseSchema.parse(await publishStudioBuilding(t.db, src.head.id, publishBody(1), c.owner()));
    // Simulate the record a newer build published (generator box v99): same tables, raw SQL.
    const id = 'stu:redteamunknownversion22';
    const at = '2026-10-24T10:30:00.000Z';
    await t.db.batch([
      t.db
        .prepare(
          `INSERT INTO studio_buildings (id, target_id, status, draft_json, draft_revision, published_version,
             created_by, created_at, updated_by, updated_at, revision)
           VALUES (?, NULL, 'published', NULL, 0, 1, 'owner@example.org', ?, 'owner@example.org', ?, 2)`,
        )
        .bind(id, at, at),
      t.db
        .prepare(
          `INSERT INTO studio_building_versions
           SELECT ?, version, json_set(record_json, '$.model.generatorVersion', 99), footprint_json,
                  footprint_area_m2, membership_json, validation_json, acknowledgements_json, change_summary,
                  model_config_version, generator_id, 99, accuracy_class, position_corrected, published_by, ?
           FROM studio_building_versions WHERE building_id = ? AND version = 1`,
        )
        .bind(id, at, src.head.id),
    ]);
    await archiveStudioBuilding(t.db, src.head.id, { revision: 2, reason: null }, c.owner());

    // Never dropped from the publication; the model is kept as an envelope (not reinterpreted).
    const pub = (await publicBuildings()).find((b) => b.id === id);
    expect(pub).toBeDefined();
    expect(pub!.model.generatorVersion).toBe(99);
    expect(modelSupport(pub!.model).ok).toBe(false);

    // Client: one place, one feature, a fallback prism in both 3D modes, reported.
    const { campus, base } = realData();
    const merged = mergeStudioBuildings({
      data: campus,
      buildings: [pub!],
      reviewSections: base.reviewSections,
      curatedDecisions: base.curatedDecisions,
    });
    expect(merged.data.places.filter((p) => p.id === id)).toHaveLength(1);
    expect(merged.data.buildings.features.filter((f) => f.properties.id === id)).toHaveLength(1);
    expect(merged.report.unavailable).toEqual([id]);
    const rm = merged.studioModels.find((m) => m.publicId === id)!;
    expect(rm.modelAvailable).toBe(false);
    expect(studioInstanceFor(rm).modelAvailable).toBe(false);
    expect(isoStudioModel(rm).fallback).toBe(true);

    // Admin quality view flags it.
    const q = studioQualityResponseSchema.parse(await getStudioQuality(t.db, c.owner()));
    expect(q.warnings.filter((w) => w.id === id).map((w) => w.kind)).toContain('model-unavailable');
    expect(q.generatorVersionsInUse).toContainEqual(
      expect.objectContaining({ generatorId: 'box', generatorVersion: 99 }),
    );

    // Writes that would reinterpret it are refused; the stored record is unchanged.
    const before = await studioSnapshot(t.db);
    const unknownModel = { ...draftWith({ anchor: site }).model, generatorVersion: 99 };
    for (const write of [
      () => duplicateStudioBuilding(t.db, id, { offsetM: null }, c.owner()),
      () =>
        applyStudioTemplate(
          t.db,
          id,
          {
            revision: 2,
            templateId: starterLibrary()[0]!.definition.id,
            templateVersion: 1,
            variantId: starterLibrary()[0]!.definition.variants[0]!.id,
            dryRun: false,
          },
          c.owner(),
        ),
      () =>
        saveStudioDraft(
          t.db,
          id,
          { revision: 2, draft: { ...draftWith({ anchor: site }), model: unknownModel } },
          c.owner(),
        ),
    ]) {
      const e = await domainError(write());
      expect(e.code).toBe('unsupported-model');
    }
    const after = await studioSnapshot(t.db);
    expect(after.buildings).toEqual(before.buildings);
    expect(after.versions).toEqual(before.versions);
    expect(after.meta).toEqual(before.meta);

    // Archive is allowed (it reads nothing); restore re-publishes only what this build can read → 422, kept.
    const arch = publishResponseSchema.parse(
      await archiveStudioBuilding(t.db, id, { revision: 2, reason: null }, c.owner()),
    );
    const e = await domainError(
      restoreStudioBuilding(
        t.db,
        id,
        { revision: arch.building.head.revision, acknowledgements: [] },
        c.owner(),
      ),
    );
    expect(e.code).toBe('unsupported-model');
    expect(
      (
        await t.db
          .prepare('SELECT COUNT(*) AS n FROM studio_building_versions WHERE building_id = ?')
          .bind(id)
          .first<{ n: number }>()
      )?.n,
    ).toBe(1);
  });
});
