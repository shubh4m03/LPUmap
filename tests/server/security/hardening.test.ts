/**
 * Regression tests for the server-hardening wave (red-team open items):
 *  1. bodies rejected while being read (415 / 413 / 400 bad JSON, UTF-8,
 *     structural bounds, schema) are audited as 'rejected' for the
 *     authenticated actor, on every write route of the table;
 *  2. GET /api/locations answers If-None-Match with 304 before building the
 *     body, reads the body as ONE consistent batch and never selects the
 *     private/large version columns;
 *  3. the ETag carries the publication schema version;
 *  4. the public accuracy class comes from the stored template version and
 *     only when the templateRef is consistent with the model;
 *  5. Google Maps photo hosts, trailing-dot hosts and free-text fields
 *     (identity.description/notes, archive reason, template text) follow the
 *     prohibited-source rule;
 *  6. the permanent-delete snapshot limit is counted in UTF-8 bytes;
 *  7. zero-width characters and U+2028/2029 are rejected in names/aliases;
 *  8. the optional global login cap;
 *  plus the publish/restore publication-version guard's 409 message.
 * Every case runs against a fresh local D1 (wrangler getPlatformProxy, no remote).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetJwksCache } from '../../../server/auth/access.ts';
import { resetSaltMemo } from '../../../server/auth/salt.ts';
import { insertTemplateStmt, insertTemplateVersionStmt } from '../../../server/db/studio-templates.ts';
import type { SqlDatabase } from '../../../server/db/types.ts';
import { DELETE_SNAPSHOT_MAX_BYTES, deleteSnapshotFits } from '../../../server/domain/studio/buildings.ts';
import { parseEnv } from '../../../server/env.ts';
import { handleAdmin } from '../../../server/handlers/admin/index.ts';
import { ADMIN_ROUTES } from '../../../server/handlers/admin/routes.ts';
import { loginRateRule, loginRateRules } from '../../../server/handlers/admin/session.ts';
import { etagMatches, handlePublication, publicationEtag } from '../../../server/handlers/publication.ts';
import {
  publishResponseSchema,
  studioBuildingDetailSchema,
  studioIdentitySchema,
  templateDefinitionSchema,
  type OwnerTemplateInput,
  type StudioBuildingDetail,
  type StudioDraft,
} from '../../../src/building-studio/schema.ts';
import { containsProhibitedSourceUrl, isProhibitedSourceUrl } from '../../../src/building-studio/text.ts';
import { PUBLICATION_SCHEMA_VERSION, publicationSchema } from '../../../src/community/schema.ts';
import { OWNER as JWT_OWNER } from '../auth/jwt-fixtures.ts';
import { TEST_PASSWORD, countingDb, errorCode, makeDeps, req, validSuggestion } from '../http/fixtures.ts';
import type { ReqOptions } from '../http/fixtures.ts';
import { createTestDb } from '../http/harness.ts';
import { SITE_B, newDraft, publishBody } from '../studio/helpers.ts';
import { NOW, accessDeps, asOwner, makeKit, ownerJwt, pwDeps, pwLogin, submit } from './helpers.ts';
import type { Kit } from './helpers.ts';

let k: Kit;

beforeEach(async () => {
  k = await makeKit(await createTestDb());
  resetSaltMemo();
  resetJwksCache();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(async () => k.t.dispose());

const ACTOR = JWT_OWNER.toLowerCase();
const S = '/studio';
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

interface AuditRow {
  id: number;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  outcome: string;
  detail: string | null;
  before_json: string | null;
  after_json: string | null;
}

async function auditRows(db: SqlDatabase): Promise<AuditRow[]> {
  return (await db.prepare('SELECT * FROM audit_events ORDER BY id').all<AuditRow>()).results;
}

async function newAuditRows(db: SqlDatabase, run: () => Promise<unknown>): Promise<AuditRow[]> {
  const before = (await auditRows(db)).length;
  await run();
  return (await auditRows(db)).slice(before);
}

// ---------------------------------------------------------------------------
// 1. Body rejections are audited
// ---------------------------------------------------------------------------

const SAMPLE: Record<string, string> = {
  ':id': 'sug_aaaaaaaaaaaaaaaaaaaaaaaaaa',
  ':locationId': 'own:aaaaaaaaaaaaaaaaaaaaaaaaaa',
  ':targetId': encodeURIComponent('osm:way/123456'),
  ':buildingId': 'stu:aaaaaaaaaaaaaaaaaaaaaaaaaa',
  ':templateId': 'stv:aaaaaaaaaaaaaaaaaaaaaaaaaa',
  ':subjectId': encodeURIComponent('art:num-25'),
};
const DECODED: Record<string, string> = { ':targetId': 'osm:way/123456', ':subjectId': 'art:num-25' };
const concrete = (pattern: string) => `/api/admin${pattern.replace(/:[a-zA-Z]+/g, (m) => SAMPLE[m]!)}`;
const concreteRel = (pattern: string) => concrete(pattern).slice('/api/admin'.length);
const entityOf = (pattern: string): string | null => {
  const m = /:[a-zA-Z]+/.exec(pattern)?.[0];
  return m === undefined ? null : (DECODED[m] ?? SAMPLE[m]!);
};

/** Authenticated writes that take no body or write nothing (so have no audit target). */
const UNAUDITED_WRITES = new Set(['DELETE /session', 'POST /studio/validate']);
const WRITES = ADMIN_ROUTES.filter((r) => r.method !== 'GET' && r.handler.permission !== null);
const AUDITED = WRITES.filter((r) => !UNAUDITED_WRITES.has(`${r.method} ${r.pattern}`));

describe('1. body rejections are audited as rejected', () => {
  it('every authenticated write route (except logout and the validate dry run) declares its audit target', () => {
    expect(AUDITED).toHaveLength(31); // 16 community + 13 studio + 2 artwork writes
    for (const r of AUDITED) {
      expect(r.handler.audit, `${r.method} ${r.pattern}`).toBeDefined();
      expect(r.handler.audit!.action).toMatch(/^[a-z]+\.[a-z-]+$/);
    }
    for (const r of WRITES.filter((x) => UNAUDITED_WRITES.has(`${x.method} ${x.pattern}`)))
      expect(r.handler.audit).toBeUndefined();
  });

  it.each(AUDITED.map((r) => [`${r.method} ${r.pattern}`, r] as const))(
    '%s: malformed JSON → 400 and one rejected audit row for the actor (body never echoed)',
    async (_label, r) => {
      const rows = await newAuditRows(k.t.db, async () => {
        const res = await asOwner(k, r.method, concreteRel(r.pattern), {
          raw: '{"revision": 1, "secret": "BODY-MARKER-91f2"',
        });
        expect(res.status).toBe(400);
        expect(await errorCode(res)).toBe('invalid');
      });
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row).toMatchObject({
        actor: ACTOR,
        action: r.handler.audit!.action,
        entity_type: r.handler.audit!.entityType,
        entity_id: entityOf(r.pattern),
        outcome: 'rejected',
        before_json: null,
        after_json: null,
      });
      expect(row.detail).toBe('invalid (HTTP 400): Request body is not valid JSON');
      expect(JSON.stringify(row)).not.toContain('BODY-MARKER');
    },
  );

  it('415 (wrong content type), 413 (too large) and structural bounds are audited too', async () => {
    const id = SAMPLE[':buildingId']!;
    const rows = await newAuditRows(k.t.db, async () => {
      const r415 = await asOwner(k, 'PUT', `${S}/buildings/${id}/draft`, {
        raw: '{"revision":1}',
        headers: { 'Content-Type': 'text/plain' },
      });
      expect(r415.status).toBe(415);
      const r413 = await asOwner(k, 'POST', `${S}/buildings`, { raw: `{"x":"${'a'.repeat(40 * 1024)}"}` });
      expect(r413.status).toBe(413);
      const deep = `${'['.repeat(40)}${']'.repeat(40)}`;
      const rDeep = await asOwner(k, 'POST', `${S}/buildings/${id}/publish`, { raw: deep });
      expect(rDeep.status).toBe(400);
      const rLoc = await asOwner(k, 'PATCH', `/locations/${SAMPLE[':locationId']}`, {
        raw: '{"revision":1}',
        headers: { 'Content-Type': 'application/json; charset=latin1' },
      });
      expect(rLoc.status).toBe(415);
    });
    expect(rows.map((r) => [r.action, r.entity_id, r.outcome, r.detail?.split(':')[0]])).toEqual([
      ['building.save-draft', id, 'rejected', 'invalid (HTTP 415)'],
      ['building.create', null, 'rejected', 'too-large (HTTP 413)'],
      ['building.publish', id, 'rejected', 'invalid (HTTP 400)'],
      ['location.update', SAMPLE[':locationId'], 'rejected', 'invalid (HTTP 415)'],
    ]);
  });

  it('a community body that fails its schema (400, before the domain) is audited; a valid one is not double-audited', async () => {
    const created = await submit(k, { body: validSuggestion(), ip: '198.51.100.9' });
    expect(created.status).toBe(201);
    const { reference } = await json<{ reference: string }>(created);
    const rows = await newAuditRows(k.t.db, async () => {
      const bad = await asOwner(k, 'POST', `/suggestions/${reference}/reject`, { body: { revision: 'one' } });
      expect(bad.status).toBe(400);
    });
    expect(rows).toEqual([
      expect.objectContaining({
        action: 'suggestion.reject',
        entity_id: reference,
        outcome: 'rejected',
        detail: 'invalid (HTTP 400): Request body is invalid',
      }),
    ]);
  });

  it('password mode: the session actor is recorded', async () => {
    const s = await pwLogin(k);
    const rows = await newAuditRows(k.t.db, async () => {
      const res = await handleAdmin(
        req('POST', '/api/admin/locations', { raw: 'nope', cookie: s.cookie, csrf: s.csrf }),
        pwDeps(k),
      );
      expect(res.status).toBe(400);
    });
    expect(rows).toEqual([
      expect.objectContaining({
        actor: 'owner',
        action: 'location.create',
        entity_id: null,
        outcome: 'rejected',
      }),
    ]);
  });

  it('no audit row for unauthenticated callers, the login route or the validate dry run', async () => {
    const rows = await newAuditRows(k.t.db, async () => {
      const anon = await handleAdmin(req('POST', '/api/admin/locations', { raw: 'nope' }), accessDeps(k));
      expect(anon.status).toBe(401);
      const login = await handleAdmin(req('POST', '/api/admin/session', { raw: 'nope' }), pwDeps(k));
      expect(login.status).toBe(400);
      const validate = await asOwner(k, 'POST', `${S}/validate`, { raw: 'nope' });
      expect(validate.status).toBe(400);
    });
    expect(rows).toEqual([]);
  });

  it('a failing audit write never masks the original 400', async () => {
    const broken: SqlDatabase = {
      prepare(sql) {
        if (/INSERT INTO audit_events/.test(sql)) throw new Error('audit store down');
        return k.t.db.prepare(sql);
      },
      batch: (s) => k.t.db.batch(s),
      exec: (sql) => k.t.db.exec(sql),
    };
    const res = await handleAdmin(
      req('POST', `/api/admin${S}/buildings`, {
        raw: 'nope',
        headers: { 'Cf-Access-Jwt-Assertion': await ownerJwt(k) },
      }),
      accessDeps(k, { DB: broken }),
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 2 + 3. Publication: early 304, narrow columns, one consistent read, schema-versioned ETag
// ---------------------------------------------------------------------------

async function createBuilding(draft: StudioDraft = newDraft()): Promise<StudioBuildingDetail> {
  const res = await asOwner(k, 'POST', `${S}/buildings`, { body: { targetId: null, draft } });
  expect(res.status).toBe(201);
  return studioBuildingDetailSchema.parse(await res.json());
}

/** Publishes, acknowledging whatever warnings the server requires (reason recorded). */
async function publishAcking(id: string, revision: number): Promise<Response> {
  let res = await asOwner(k, 'POST', `${S}/buildings/${id}/publish`, { body: publishBody(revision) });
  if (res.status === 422) {
    const body = await json<{ error: { details?: { missingAcknowledgements?: string[] } } }>(res);
    const acknowledgements = (body.error.details?.missingAcknowledgements ?? []).map((code) => ({
      code,
      reason: 'Acknowledged by the hardening regression test fixture',
    }));
    res = await asOwner(k, 'POST', `${S}/buildings/${id}/publish`, {
      body: publishBody(revision, { acknowledgements }),
    });
  }
  return res;
}

const publicationReq = (o: ReqOptions = {}, db: SqlDatabase = k.t.db) =>
  handlePublication(
    req('GET', '/api/locations', o),
    makeDeps({ env: { ...k.pwEnv, DB: db }, now: () => NOW }),
  );

describe('2. GET /api/locations: early 304 and a narrow, consistent read', () => {
  it('a matching If-None-Match is answered with 304 from the version read alone (no row is read)', async () => {
    const b = await createBuilding();
    expect((await publishAcking(b.head.id, 1)).status).toBe(200);
    const first = await publicationReq();
    const etag = first.headers.get('ETag')!;

    const counting = countingDb(k.t.db);
    const res = await publicationReq({ headers: { 'If-None-Match': etag } }, counting.db);
    expect(res.status).toBe(304);
    expect(res.headers.get('ETag')).toBe(etag);
    expect(await res.text()).toBe('');
    expect(counting.prepared).toHaveLength(1);
    expect(counting.prepared[0]).toMatch(/FROM meta/);
    expect(counting.prepared.join('\n')).not.toMatch(/locations|overrides|studio_/);
  });

  it('the full body is read in ONE batch and never selects validation, acknowledgements, summaries or actors', async () => {
    const b = await createBuilding();
    expect((await publishAcking(b.head.id, 1)).status).toBe(200);
    const batches: number[] = [];
    const counting = countingDb(k.t.db);
    const db: SqlDatabase = {
      ...counting.db,
      batch: (s) => {
        batches.push(s.length);
        return k.t.db.batch(s);
      },
    };
    const res = await publicationReq({}, db);
    expect(res.status).toBe(200);
    // v3: state, locations, overrides, studio versions, artwork decisions
    expect(batches).toEqual([5]);
    expect(counting.prepared).toHaveLength(5);
    const artworkSql = counting.prepared.find((s) => /artwork_associations/.test(s))!;
    expect(artworkSql).not.toMatch(/\bnote\b|created_by|updated_by|\*/);
    const studioSql = counting.prepared.find((s) => /studio_building_versions/.test(s))!;
    expect(studioSql).not.toMatch(/v\.\*|validation_json|acknowledgements_json|change_summary|published_by/);
    const pub = publicationSchema.parse(await res.json());
    expect(pub.buildings?.map((x) => x.id)).toEqual([b.head.id]);
    expect(res.headers.get('ETag')).toBe(publicationEtag(pub.publicationVersion));
  });

  it('a stale or absent validator still gets the full body (200)', async () => {
    const stale = await publicationReq({ headers: { 'If-None-Match': publicationEtag(999) } });
    expect(stale.status).toBe(200);
    expect(publicationSchema.parse(await stale.json()).publicationVersion).toBe(0);
  });
});

describe('3. the ETag carries the publication schema version', () => {
  it(`is W/"pub-v${PUBLICATION_SCHEMA_VERSION}-<n>" and differs between schema versions`, async () => {
    const res = await publicationReq();
    expect(res.headers.get('ETag')).toBe(`W/"pub-v${PUBLICATION_SCHEMA_VERSION}-0"`);
    expect(publicationEtag(7, 1)).not.toBe(publicationEtag(7, 2));
    expect(etagMatches(publicationEtag(7, 1), publicationEtag(7, 2))).toBe(false);
  });

  it('a client holding a pre-change (schema-less) ETag for the same version gets 200, never a false 304', async () => {
    const res = await publicationReq({ headers: { 'If-None-Match': 'W/"pub-0"' } });
    expect(res.status).toBe(200);
    const v1 = await publicationReq({ headers: { 'If-None-Match': publicationEtag(0, 1) } });
    expect(v1.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 4. accuracyClass is derived from the stored template version
// ---------------------------------------------------------------------------

const {
  anchor: _a,
  rotationDeg: _r,
  modelConfigVersion: _m,
  geometryGuide: _g,
  ...variantDefaults
} = newDraft().model;

function stylizedTemplate(): OwnerTemplateInput {
  return {
    name: 'Owner stylized pavilion',
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
  } as OwnerTemplateInput;
}

async function publicAccuracy(): Promise<string[]> {
  const pub = publicationSchema.parse(await (await publicationReq()).json());
  return (pub.buildings ?? []).map((b) => b.accuracyClass);
}

async function saveAndPublish(id: string, revision: number, draft: StudioDraft): Promise<number> {
  const saved = await asOwner(k, 'PUT', `${S}/buildings/${id}/draft`, { body: { revision, draft } });
  expect(saved.status).toBe(200);
  const rev = studioBuildingDetailSchema.parse(await saved.json()).head.revision;
  const res = await publishAcking(id, rev);
  expect(res.status).toBe(200);
  return publishResponseSchema.parse(await res.json()).building.head.revision;
}

describe('4. accuracyClass comes from the stored template version, never from the client claim', () => {
  it('a consistent ref keeps the template class; a wrong variant or another generator falls back to generic-prefab', async () => {
    const t = await asOwner(k, 'POST', `${S}/templates`, { body: { definition: stylizedTemplate() } });
    expect(t.status).toBe(201);
    const templateId = (await json<{ definition: { id: string } }>(t)).definition.id;
    const ref = { templateId, templateVersion: 1, variantId: 'standard' };

    // Positive control: the model really is the box generator the template builds with.
    const b = await createBuilding(newDraft({ templateRef: ref }));
    const r1 = await publishAcking(b.head.id, 1);
    expect(r1.status).toBe(200);
    let rev = publishResponseSchema.parse(await r1.json()).building.head.revision;
    expect(await publicAccuracy()).toEqual(['stylized']);

    // A variant the stored template version does not define.
    rev = await saveAndPublish(b.head.id, rev, newDraft({ templateRef: { ...ref, variantId: 'spoofed' } }));
    expect(await publicAccuracy()).toEqual(['generic-prefab']);

    // A model of a different generator claiming the box template.
    await saveAndPublish(
      b.head.id,
      rev,
      newDraft({
        templateRef: ref,
        model: { generatorId: 'hall', shape: { kind: 'hall' } } as Partial<StudioDraft['model']>,
      }),
    );
    expect(await publicAccuracy()).toEqual(['generic-prefab']);
    const versions = (
      await k.t.db
        .prepare('SELECT version, accuracy_class FROM studio_building_versions ORDER BY version')
        .all<{ version: number; accuracy_class: string }>()
    ).results;
    expect(versions.map((v) => v.accuracy_class)).toEqual(['stylized', 'generic-prefab', 'generic-prefab']);
  });

  it('an owner template whose STORED class is evidence-grade is capped at generic-prefab', async () => {
    const id = 'stv:bbbbbbbbbbbbbbbbbbbbbbbbbb';
    const { basedOn: _b, ...body } = stylizedTemplate();
    const definition = { ...body, accuracyClass: 'surveyed', id, version: 1, renderCost: 'low' };
    // Precondition: the stored row is a VALID definition, so only the cap can keep the class modest.
    expect(templateDefinitionSchema.safeParse(definition).success).toBe(true);
    const now = NOW.toISOString();
    await k.t.db.batch([
      insertTemplateStmt(k.t.db, { id, name: definition.name, actor: 'fixture', now }),
      insertTemplateVersionStmt(k.t.db, {
        templateId: id,
        version: 1,
        definitionJson: JSON.stringify(definition),
        generatorId: 'box',
        generatorVersion: 1,
        actor: 'fixture',
        now,
      }),
    ]);
    const b = await createBuilding(
      newDraft({ templateRef: { templateId: id, templateVersion: 1, variantId: 'standard' } }),
    );
    expect((await publishAcking(b.head.id, 1)).status).toBe(200);
    expect(await publicAccuracy()).toEqual(['generic-prefab']);
  });
});

// ---------------------------------------------------------------------------
// 5 + 7. Text rules
// ---------------------------------------------------------------------------

describe('5. prohibited sources: Maps photos, trailing dots, free-text fields', () => {
  it.each([
    'https://lh3.googleusercontent.com/p/AF1QipNxYz=w408-h306-k-no',
    'https://lh5.googleusercontent.com/gps-cs-s/AB5caB_x=w400',
    'https://www.google.com./maps/place/LPU',
    'https://google.com../maps/@31.25,75.70,17z',
    'https://maps.google.com./?q=31.25,75.70',
  ])('URL field rejects %s', (url) => expect(isProhibitedSourceUrl(url)).toBe(true));

  it.each([
    'Measured from www.google.com./maps/place/x yesterday',
    'Traced over google.co.in../maps/@31.2,75.7,18z',
    'Photo: lh3.googleusercontent.com/p/AF1QipX',
    'See maps.google\u3002com/?q=1',
  ])('free text rejects %s', (t) => expect(containsProhibitedSourceUrl(t)).toBe(true));

  it.each([
    'https://lh3.googleusercontent.com/a/ACg8ocProfilePicture',
    'Ends a sentence with lpu.in.',
    'https://sites.research.google./gr/open-buildings/',
    'https://www.google.com./search?q=lpu',
  ])('still allows %s', (t) => expect(containsProhibitedSourceUrl(t)).toBe(false));

  it('identity.description and notes reject a Maps URL; plain prose stays allowed', () => {
    const identity = newDraft().identity!;
    for (const field of ['description', 'notes'] as const) {
      const bad = studioIdentitySchema.safeParse({
        ...identity,
        [field]: 'From https://maps.app.goo.gl/AbC1',
      });
      expect(bad.success, field).toBe(false);
      const ok = studioIdentitySchema.safeParse({ ...identity, [field]: 'Not taken from Google Maps.' });
      expect(ok.success, field).toBe(true);
    }
  });

  it('over HTTP: a description citing Google Maps is refused (400), nothing stored, the rejection audited', async () => {
    const draft = newDraft();
    draft.identity = { ...draft.identity!, description: 'Footprint from www.google.com./maps/place/x' };
    const rows = await newAuditRows(k.t.db, async () => {
      const res = await asOwner(k, 'POST', `${S}/buildings`, { body: { targetId: null, draft } });
      expect(res.status).toBe(400);
    });
    expect(rows.map((r) => [r.action, r.outcome])).toEqual([['building.create', 'rejected']]);
    expect(await k.t.count('studio_buildings')).toBe(0);
  });

  it('archive reasons and template text follow the rule too', async () => {
    const b = await createBuilding();
    const archive = await asOwner(k, 'POST', `${S}/buildings/${b.head.id}/archive`, {
      body: { revision: 1, reason: 'Duplicate of https://lh3.googleusercontent.com/p/AF1Qip' },
    });
    expect(archive.status).toBe(400);
    const tpl = await asOwner(k, 'POST', `${S}/templates`, {
      body: { definition: { ...stylizedTemplate(), intendedUse: 'Copied from maps.google.com/x' } },
    });
    expect(tpl.status).toBe(400);
  });
});

describe('7. invisible characters in names and aliases', () => {
  it.each([
    ['zero-width space', 'Block\u200b34'],
    ['ZWJ in Latin text', 'Block\u200d34'],
    ['ZWNJ next to a space', 'Main \u200cGate'],
    ['joiner between a Devanagari letter and ASCII digits', 'ब्लॉक\u200d34'],
    ['word joiner', 'Block\u206034'],
    ['zero-width no-break space (BOM) inside a name', 'Lib\ufeffrary'],
    ['line separator', 'Block\u202834'],
    ['paragraph separator', 'Block\u202934'],
  ])('studio name and alias reject a %s', (_label, name) => {
    const identity = newDraft().identity!;
    expect(studioIdentitySchema.safeParse({ ...identity, name }).success).toBe(false);
    expect(studioIdentitySchema.safeParse({ ...identity, aliases: [name] }).success).toBe(false);
  });

  it('joiners inside or ending Indic and Arabic-script words stay allowed', () => {
    const identity = newDraft().identity!;
    for (const name of ['क्\u200dष Bhawan', 'می\u200cخواهم Hall', 'पुस्तकालय\u200c ब्लॉक', 'ब्लॉक\u200c'])
      expect(studioIdentitySchema.safeParse({ ...identity, name }).success, name).toBe(true);
  });

  it('a public suggestion and an owner location named with a zero-width space are refused (400)', async () => {
    const pub = await submit(k, {
      body: validSuggestion({ name: 'Quiet\u200bStudy Corner' }),
      ip: '198.51.100.7',
    });
    expect(pub.status).toBe(400);
    expect(await k.t.count('suggestions')).toBe(0);
    const own = await asOwner(k, 'POST', '/locations', {
      body: {
        fields: { name: 'Gate\u2028Two', categoryId: 'library', location: [75.7049, 31.2536] },
      },
    });
    expect(own.status).toBe(400);
    expect(await k.t.count('locations')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Delete snapshot limit in UTF-8 bytes
// ---------------------------------------------------------------------------

describe('6. the permanent-delete snapshot limit counts UTF-8 bytes', () => {
  it('a snapshot under the limit in UTF-16 units but over it in UTF-8 bytes does not fit', () => {
    const devanagari = 'ह'.repeat(Math.floor(DELETE_SNAPSHOT_MAX_BYTES / 2)); // 3 bytes each in UTF-8
    const snapshot = { head: { id: 'stu:x' }, draft: { identity: { notes: devanagari } } };
    expect(JSON.stringify(snapshot).length).toBeLessThan(DELETE_SNAPSHOT_MAX_BYTES);
    expect(deleteSnapshotFits(snapshot)).toBe(false);
    expect(deleteSnapshotFits({ notes: 'a'.repeat(1000) })).toBe(true);
    // {"s":"…"} is 8 ASCII bytes + 10 × 3 bytes = 38 bytes, although only 18 UTF-16 units.
    expect(deleteSnapshotFits({ s: 'ह'.repeat(10) }, 30)).toBe(false);
    expect(deleteSnapshotFits({ s: 'ह'.repeat(10) }, 38)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Optional global login cap
// ---------------------------------------------------------------------------

describe('8. optional global login rate cap', () => {
  const wrong = (ip: string, extra: Record<string, string> = {}) =>
    handleAdmin(
      req('POST', '/api/admin/session', { body: { password: 'wrong guess' }, ip }),
      pwDeps(k, extra),
    );

  it('ADMIN_LOGIN_GLOBAL_LIMIT parses as an integer 1–100000; anything else is ignored with a warning', () => {
    expect(parseEnv({ ADMIN_LOGIN_GLOBAL_LIMIT: '20' }).loginGlobalLimit).toBe(20);
    expect(parseEnv({}).loginGlobalLimit).toBeNull();
    for (const bad of ['0', '-1', '1e3', '12.5', 'lots', '100001']) {
      const env = parseEnv({ ADMIN_LOGIN_GLOBAL_LIMIT: bad });
      expect(env.loginGlobalLimit, bad).toBeNull();
      expect(env.warnings).toContain('ADMIN_LOGIN_GLOBAL_LIMIT');
    }
    expect(loginRateRules(null)).toEqual([loginRateRule()]);
    expect(loginRateRules(9)[1]).toMatchObject({ limit: 9, global: true, windowS: loginRateRule().windowS });
  });

  it('without the setting, attempts spread over many clients are limited per client only', async () => {
    for (let i = 1; i <= 6; i++) expect((await wrong(`203.0.113.${i}`)).status).toBe(401);
  });

  it('with the setting, the N+1-th attempt in the window from ANY client is 429, even with the right password', async () => {
    const cap = { ADMIN_LOGIN_GLOBAL_LIMIT: '3' };
    for (let i = 1; i <= 3; i++) expect((await wrong(`203.0.113.${i}`, cap)).status).toBe(401);
    const blocked = await wrong('203.0.113.50', cap);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    const owner = await handleAdmin(
      req('POST', '/api/admin/session', { body: { password: TEST_PASSWORD }, ip: '198.51.100.1' }),
      pwDeps(k, cap),
    );
    expect(owner.status).toBe(429);
  });

  it('a client already over its own limit does not consume the global budget', async () => {
    const cap = { ADMIN_LOGIN_GLOBAL_LIMIT: '6' };
    const perClient = loginRateRule().limit;
    for (let i = 0; i < perClient; i++) expect((await wrong('203.0.113.9', cap)).status).toBe(401);
    for (let i = 0; i < 5; i++) expect((await wrong('203.0.113.9', cap)).status).toBe(429);
    // perClient (5) of the global 6 are used; the 6th attempt from another client is still served.
    expect((await wrong('203.0.113.10', cap)).status).toBe(401);
    expect((await wrong('203.0.113.11', cap)).status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// Publish/restore publication-version guard → explicit 409
// ---------------------------------------------------------------------------

describe('publication-version guard: 409 that says what happened', () => {
  /** Bumps publication_version just before the next db.batch: another change "lands" mid-publish. */
  function racingDb(): { db: SqlDatabase; arm: () => void } {
    let armed = false;
    return {
      arm: () => {
        armed = true;
      },
      db: {
        prepare: (sql) => k.t.db.prepare(sql),
        exec: (sql) => k.t.db.exec(sql),
        batch: async (s) => {
          if (armed) {
            armed = false;
            await k.t.db
              .prepare(
                "UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'publication_version'",
              )
              .run();
          }
          return k.t.db.batch(s);
        },
      },
    };
  }

  const ownerOn = async (db: SqlDatabase, method: string, path: string, body: unknown) =>
    handleAdmin(
      req(method, `/api/admin${path}`, {
        body,
        headers: { 'Cf-Access-Jwt-Assertion': await ownerJwt(k) },
      }),
      accessDeps(k, { DB: db }),
    );

  it('publish: nothing is written, the revision is still current, and the same request then succeeds', async () => {
    const b = await createBuilding();
    const race = racingDb();
    race.arm();
    const res = await ownerOn(race.db, 'POST', `${S}/buildings/${b.head.id}/publish`, publishBody(1));
    expect(res.status).toBe(409);
    const body = await json<{
      error: { code: string; message: string; details: { current: { revision: number } } };
    }>(res);
    expect(body.error.code).toBe('conflict');
    expect(body.error.message).toMatch(/published map changed while this building was being validated/);
    expect(body.error.details.current.revision).toBe(1);
    expect(await k.t.count('studio_building_versions')).toBe(0);
    expect((await publishAcking(b.head.id, 1)).status).toBe(200);
  });

  it('restore: the same explicit 409 when the publication moves during re-validation', async () => {
    const b = await createBuilding(newDraft({ model: { anchor: SITE_B } as Partial<StudioDraft['model']> }));
    const pub = await publishAcking(b.head.id, 1);
    const rev = publishResponseSchema.parse(await pub.json()).building.head.revision;
    const arch = await asOwner(k, 'POST', `${S}/buildings/${b.head.id}/archive`, {
      body: { revision: rev, reason: null },
    });
    expect(arch.status).toBe(200);
    const archRev = publishResponseSchema.parse(await arch.json()).building.head.revision;
    const race = racingDb();
    race.arm();
    const res = await ownerOn(race.db, 'POST', `${S}/buildings/${b.head.id}/restore`, {
      revision: archRev,
      acknowledgements: [],
    });
    expect(res.status).toBe(409);
    expect((await json<{ error: { message: string } }>(res)).error.message).toMatch(/published map changed/);
  });

  it('a real concurrent head change keeps the usual "changed by someone else" 409', async () => {
    const b = await createBuilding();
    const stale = await asOwner(k, 'POST', `${S}/buildings/${b.head.id}/publish`, {
      body: publishBody(99),
    });
    expect(stale.status).toBe(409);
    expect((await json<{ error: { message: string } }>(stale)).error.message).toMatch(
      /changed by someone else/,
    );
  });
});
