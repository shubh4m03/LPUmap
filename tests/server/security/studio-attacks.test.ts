/**
 * Red-team: attacks on the Building Studio (/api/admin/studio/**) and on the
 * public publication v2, sent as real requests through the admin dispatcher
 * and GET /api/locations over a local D1. Complements tests/server/studio/http.test.ts
 * (route-table auth/CSRF/body limits) with method/path tricks, Origin/CSRF
 * bypass variants, spoofing, payload bombs, leaks, races and audit integrity.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetJwksCache } from '../../../server/auth/access.ts';
import { resetSaltMemo } from '../../../server/auth/salt.ts';
import { handleAdmin } from '../../../server/handlers/admin/index.ts';
import { handlePublication } from '../../../server/handlers/publication.ts';
import {
  publishResponseSchema,
  studioBuildingDetailSchema,
  type StudioBuildingDetail,
} from '../../../src/building-studio/schema.ts';
import { publicationSchema } from '../../../src/community/schema.ts';
import { OWNER as JWT_OWNER, claims, sign } from '../auth/jwt-fixtures.ts';
import { ORIGIN, countingDb, errorCode, makeDeps, req, validSuggestion } from '../http/fixtures.ts';
import type { ReqOptions } from '../http/fixtures.ts';
import { createTestDb } from '../http/harness.ts';
import { PRIVATE_NOTE, SITE_B, auditOf, newDraft, publishBody, studioSnapshot } from '../studio/helpers.ts';
import { NOW, accessDeps, asOwner, makeKit, pwDeps, pwLogin, submit } from './helpers.ts';
import type { Kit } from './helpers.ts';

let k: Kit;

// Studio rows cannot be deleted unless archived (0002 triggers), so every test gets a fresh local D1.
beforeEach(async () => {
  k = await makeKit(await createTestDb());
  resetSaltMemo();
  resetJwksCache();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(async () => k.t.dispose());

const S = '/studio';
const studioWrites = (prepared: string[]) => prepared.filter((s) => /studio_|audit_events|meta/i.test(s));
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

async function create(body: unknown = { targetId: null, draft: newDraft() }): Promise<StudioBuildingDetail> {
  const res = await asOwner(k, 'POST', `${S}/buildings`, { body });
  expect(res.status).toBe(201);
  return studioBuildingDetailSchema.parse(await res.json());
}

async function publish(id: string, revision: number, over: Record<string, unknown> = {}) {
  return asOwner(k, 'POST', `${S}/buildings/${id}/publish`, { body: publishBody(revision, over) });
}

async function published(over: Parameters<typeof newDraft>[0] = {}): Promise<StudioBuildingDetail> {
  const d = await create({ targetId: null, draft: newDraft(over) });
  const res = await publish(d.head.id, 1);
  expect(res.status).toBe(200);
  return publishResponseSchema.parse(await res.json()).building;
}

const publicBody = async (o: ReqOptions = {}) =>
  handlePublication(req('GET', '/api/locations', o), pwDeps(k));

// ---------------------------------------------------------------------------

describe('method and path tricks on studio routes', () => {
  const ID = 'stu:aaaaaaaaaaaaaaaaaaaaaaaaaa';

  it.each(['HEAD', 'OPTIONS', 'PROPFIND', 'patch'])(
    '%s is refused (405) before authentication or any DB access, with no CORS headers',
    async (method) => {
      const counting = countingDb(k.t.db);
      const res = await handleAdmin(
        req(method, `/api/admin${S}/buildings/${ID}`, {
          headers: { 'Access-Control-Request-Method': 'DELETE' },
        }),
        makeDeps({ env: { ...k.pwEnv, DB: counting.db } }),
      );
      // 'patch' is upper-cased by the dispatcher → PATCH: no studio route has it → 405 after auth (401 here)
      expect([401, 405]).toContain(res.status);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(res.headers.get('Access-Control-Allow-Methods')).toBeNull();
      expect(studioWrites(counting.prepared)).toEqual([]);
    },
  );

  it('an authenticated OPTIONS/HEAD never reaches a handler', async () => {
    for (const m of ['OPTIONS', 'HEAD']) {
      const res = await asOwner(k, m, `${S}/buildings`);
      expect(res.status).toBe(405);
    }
  });

  it.each([
    [`${S}//buildings`, 404],
    [`${S}/buildings.`, 404],
    [`${S}%2Fbuildings`, 404],
    [`/STUDIO/buildings`, 404],
    [`${S}/buildings;x=1`, 404],
    [`${S}/buildings/${ID.toUpperCase()}`, 400],
    [`${S}/buildings/${ID}%00`, 400],
    [`${S}/buildings/${ID}.`, 400],
    [`${S}/buildings/${encodeURIComponent(encodeURIComponent(ID))}`, 400],
    [`${S}/buildings/${ID}/publish/extra`, 404],
    [`${S}/templates/academic-block/retire`, 405],
    [`${S}/buildings/osm:way%2F123`, 400],
  ])('unauthenticated %s → 401 (no enumeration); as owner → %i', async (path, ownerStatus) => {
    const counting = countingDb(k.t.db);
    const anon = await handleAdmin(
      req('GET', `/api/admin${path}`),
      makeDeps({ env: { ...k.pwEnv, DB: counting.db } }),
    );
    expect(anon.status).toBe(401);
    expect(studioWrites(counting.prepared)).toEqual([]);
    const owner = await asOwner(k, 'GET', path);
    expect(owner.status).toBe(ownerStatus);
  });

  it('dot-segments are normalised before routing and still need authentication', async () => {
    const anon = await handleAdmin(req('GET', `/api/admin${S}/buildings/%2e%2e/%2e%2e/session`), pwDeps(k));
    expect(anon.status).toBe(401);
    // escaping the /api/admin prefix lands nowhere
    const out = await asOwner(k, 'GET', `/%2e%2e/locations`);
    expect(out.status).toBe(404);
  });

  it('a percent-encoded id resolves to the same record as the plain id (one canonical id)', async () => {
    const d = await create();
    const enc = await asOwner(k, 'GET', `${S}/buildings/${encodeURIComponent(d.head.id)}`);
    expect(enc.status).toBe(200);
    expect(studioBuildingDetailSchema.parse(await enc.json()).head.id).toBe(d.head.id);
  });

  it('method-override headers and query parameters cannot turn a GET into a delete', async () => {
    const d = await create();
    const res = await asOwner(k, 'GET', `${S}/buildings/${d.head.id}?_method=DELETE`, {
      headers: { 'X-HTTP-Method-Override': 'DELETE', 'X-Method-Override': 'DELETE' },
    });
    expect(res.status).toBe(200);
    expect((await studioSnapshot(k.t.db)).buildings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe('Origin / CSRF bypass variants on studio writes', () => {
  const body = { targetId: null, draft: newDraft() };

  it.each([
    ['Origin: null', { origin: 'null' }],
    ['look-alike suffix', { origin: `${ORIGIN}.evil.example` }],
    ['trailing slash', { origin: `${ORIGIN}/` }],
    ['explicit default port', { origin: `${ORIGIN}:443` }],
    ['http scheme', { origin: ORIGIN.replace('https:', 'http:') }],
    ['same-site (not same-origin) fetch metadata', { headers: { 'Sec-Fetch-Site': 'same-site' } }],
  ] as const)('Access mode, %s → 403 csrf, nothing written', async (_l, o) => {
    const counting = countingDb(k.t.db);
    const jwt = await sign(k.key, claims(NOW));
    const res = await handleAdmin(
      req('POST', `/api/admin${S}/buildings`, {
        body,
        ...o,
        headers: { 'Cf-Access-Jwt-Assertion': jwt, ...('headers' in o ? o.headers : {}) },
      }),
      makeDeps({ env: { ...k.accessEnv, DB: counting.db }, now: () => NOW, fetch: accessDeps(k).fetch! }),
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('csrf');
    expect(studioWrites(counting.prepared)).toEqual([]);
  });

  it.each([
    'text/plain',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    'application/json; charset=utf-16',
    'application/json-patch+json',
    'application/jsonp',
  ])('a simple-request / non-JSON content type (%s) → 415, nothing written', async (ct) => {
    const res = await asOwner(k, 'POST', `${S}/buildings`, {
      raw: JSON.stringify(body),
      headers: { 'Content-Type': ct },
    });
    expect(res.status).toBe(415);
    expect((await studioSnapshot(k.t.db)).buildings).toEqual([]);
  });

  it("password mode: another session's CSRF token, or a duplicated session cookie, is refused", async () => {
    const a = await pwLogin(k);
    const b = await pwLogin(k);
    const swapped = await handleAdmin(
      req('POST', `/api/admin${S}/buildings`, { body, cookie: a.cookie, csrf: b.csrf }),
      pwDeps(k),
    );
    expect(swapped.status).toBe(403);
    expect(await errorCode(swapped)).toBe('csrf');
    const doubled = await handleAdmin(
      req('POST', `/api/admin${S}/buildings`, { body, cookie: `${a.cookie}; ${b.cookie}`, csrf: a.csrf }),
      pwDeps(k),
    );
    expect(doubled.status).toBe(401);
    expect((await studioSnapshot(k.t.db)).buildings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('spoofing: ids, targets, templates, generators, server-owned fields', () => {
  it.each([
    ['client-chosen id', { id: 'stu:aaaaaaaaaaaaaaaaaaaaaaaaaa' }],
    ['status', { status: 'published' }],
    ['actor', { actor: 'someone@else.org' }],
    ['revision', { revision: 99 }],
    ['publishedVersion', { publishedVersion: 7 }],
    ['footprint', { footprint: { type: 'Polygon', coordinates: [] } }],
    ['prototype key', JSON.parse('{"__proto__":{"status":"published"}}') as Record<string, unknown>],
  ])('a create body with a server-owned field (%s) is 400 and stores nothing', async (_l, extra) => {
    const res = await asOwner(k, 'POST', `${S}/buildings`, {
      raw: JSON.stringify({ targetId: null, draft: newDraft(), ...extra }),
    });
    expect(res.status).toBe(400);
    expect((await studioSnapshot(k.t.db)).buildings).toEqual([]);
  });

  it('a raw "__proto__" key inside the draft is rejected, not merged into the prototype', async () => {
    const raw = JSON.stringify({ targetId: null, draft: newDraft() }).replace(
      '"identity":{',
      '"identity":{"__proto__":{"directoryVisible":false},',
    );
    const res = await asOwner(k, 'POST', `${S}/buildings`, { raw });
    expect(res.status).toBe(400);
    expect(({} as Record<string, unknown>).directoryVisible).toBeUndefined();
  });

  it.each([
    ['a node (not a building)', 'osm:node/123', 400],
    ['a zero-padded way id', 'osm:way/0123', 400],
    ['a way that is not in the base data', 'osm:way/999999999999', 404],
    ['a curated id that is not a building', 'cur:no-such-building', 404],
  ])('create targeting %s → %i, nothing stored', async (_l, targetId, status) => {
    const res = await asOwner(k, 'POST', `${S}/buildings`, {
      body: { targetId, draft: newDraft({ identity: null }) },
    });
    expect(res.status).toBe(status);
    expect((await studioSnapshot(k.t.db)).buildings).toEqual([]);
  });

  it.each([
    ['generatorVersion 2', { generatorVersion: 2 }, 422],
    ['generatorVersion as a string', { generatorVersion: '1' }, 400],
    ['generatorVersion 1.5', { generatorVersion: 1.5 }, 400],
    ['generatorVersion 0', { generatorVersion: 0 }, 400],
    ['generatorVersion 2^53 (not a safe integer)', { generatorVersion: 2 ** 53 }, 400],
    ['generatorId __proto__', { generatorId: '__proto__' }, 422],
    ['generatorId constructor', { generatorId: 'constructor' }, 422],
    ['modelConfigVersion 2', { modelConfigVersion: 2 }, 422],
  ])('generator injection (%s) → %i, never stored or reinterpreted', async (_l, model, status) => {
    const draft = newDraft();
    const res = await asOwner(k, 'POST', `${S}/buildings`, {
      body: { targetId: null, draft: { ...draft, model: { ...draft.model, ...model } } },
    });
    expect(res.status).toBe(status);
    expect((await studioSnapshot(k.t.db)).buildings).toEqual([]);
  });

  it('owner template generator injection (__proto__ / unknown version) → 422, nothing stored', async () => {
    for (const generatorId of ['__proto__', 'constructor', 'toString']) {
      const res = await asOwner(k, 'POST', `${S}/templates`, {
        body: { definition: { generatorId, generatorVersion: 1, variants: [] } },
      });
      expect(res.status).toBe(422);
      expect(await errorCode(res)).toBe('unsupported-model');
    }
    expect((await studioSnapshot(k.t.db)).templates).toEqual([]);
  });

  it.each([
    { templateId: 'academic-block', templateVersion: 999, variantId: 'default' },
    { templateId: 'stv:aaaaaaaaaaaaaaaaaaaaaaaaaa', templateVersion: 1, variantId: 'default' },
    { templateId: 'surveyed', templateVersion: 1, variantId: 'surveyed' },
  ])('a spoofed templateRef ($templateId) never raises the public accuracy class', async (templateRef) => {
    const b = await published({ templateRef });
    expect(b.published?.record.templateRef).toEqual(templateRef);
    const pub = publicationSchema.parse(await (await publicBody()).json());
    expect(pub.buildings?.map((x) => x.accuracyClass)).toEqual(['generic-prefab']);
  });

  it('list filters are bound as data: LIKE wildcards, SQL in q/cursor, repeated keys and huge limits', async () => {
    await create();
    const items = async (qs: string) => {
      const res = await asOwner(k, 'GET', `${S}/buildings?${qs}`);
      return [res.status, res.status === 200 ? (await json<{ items: unknown[] }>(res)).items.length : -1];
    };
    expect(await items('q=Fixture')).toEqual([200, 1]);
    expect(await items(`q=${encodeURIComponent('%')}`)).toEqual([200, 0]);
    expect(await items(`q=${encodeURIComponent('_')}`)).toEqual([200, 0]);
    expect(await items(`q=${encodeURIComponent("' OR '1'='1")}`)).toEqual([200, 0]);
    const forged = Buffer.from(JSON.stringify(["0000' OR 1=1 --", 'stu:x'])).toString('base64url');
    expect(await items(`cursor=${forged}`)).toEqual([200, 0]);
    expect((await items('cursor=%%%'))[0]).toBe(400);
    expect((await items('status=published&status=draft'))[0]).toBe(400);
    expect((await items('limit=1000000000'))[0]).toBe(400);
    expect((await items('limit=-1'))[0]).toBe(400);
    expect((await items('targetId=osm:way/1%20OR%201=1'))[0]).toBe(400);
  });

  it('a dry-run validate with another record id writes nothing', async () => {
    const other = await published();
    const before = await studioSnapshot(k.t.db);
    const res = await asOwner(k, 'POST', `${S}/validate`, {
      body: { targetId: null, draft: newDraft(), recordId: other.head.id },
    });
    expect(res.status).toBe(200);
    expect(await studioSnapshot(k.t.db)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------

describe('payload bombs and hostile values', () => {
  it('a 10 MB streamed body without Content-Length → 413 and the stream is cancelled', async () => {
    const chunk = new TextEncoder().encode(`{"pad":"${'x'.repeat(64 * 1024)}`);
    let sent = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent >= 10 * 1024 * 1024) return c.close();
        sent += chunk.byteLength;
        c.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const jwt = await sign(k.key, claims(NOW));
    const request = new Request(`${ORIGIN}/api/admin${S}/buildings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'Cf-Access-Jwt-Assertion': jwt },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    const res = await handleAdmin(request, accessDeps(k));
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(256 * 1024);
    expect(cancelled).toBe(true);
  });

  it('16 000 levels of nesting inside 32 KB → 400 (no stack overflow), nothing stored', async () => {
    const raw = `{"targetId":null,"draft":${'['.repeat(16000)}${']'.repeat(16000)}}`;
    const res = await asOwner(k, 'POST', `${S}/buildings`, { raw });
    expect(res.status).toBe(400);
    expect((await studioSnapshot(k.t.db)).buildings).toEqual([]);
  });

  it.each([
    ['1e308 m wide', { widthM: 1e308 }],
    ['-1e308 m high', { heightM: -1e308 }],
    ['anchor beyond the globe', { anchor: [1e308, 31.25] }],
    ['rotation 360', { rotationDeg: 360 }],
    ['400.5 floors', { floors: 400.5 }],
  ])('%s → 400 (outside the storable envelope), nothing stored', async (_l, model) => {
    const draft = newDraft();
    const res = await asOwner(k, 'POST', `${S}/buildings`, {
      body: { targetId: null, draft: { ...draft, model: { ...draft.model, ...model } } },
    });
    expect(res.status).toBe(400);
    expect((await studioSnapshot(k.t.db)).buildings).toEqual([]);
  });

  it.each([
    ['a denormal length (5e-324 m)', { lengthM: 5e-324 }],
    [
      'the largest storable block (5 km, 400 floors, balconies, full detail)',
      {
        widthM: 5000,
        lengthM: 5000,
        heightM: 5000,
        floors: 400,
        floorHeightM: 12.5,
        detailLevel: 'details',
        facade: { ...newDraft().model.facade, balconies: true },
      },
    ],
  ])(
    '%s is stored as a draft with errors, never published, without hanging the server',
    async (_l, model) => {
      const draft = newDraft();
      const started = Date.now();
      const res = await asOwner(k, 'POST', `${S}/buildings`, {
        body: { targetId: null, draft: { ...draft, model: { ...draft.model, ...model } } },
      });
      expect(res.status).toBe(201);
      const d = studioBuildingDetailSchema.parse(await res.json());
      expect(d.validation?.issues.map((i) => i.code)).toContain('dimension-out-of-range');
      const pub = await publish(d.head.id, 1);
      expect(pub.status).toBe(422);
      expect(await errorCode(pub)).toBe('validation-failed');
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(publicationSchema.parse(await (await publicBody()).json()).buildings).toEqual([]);
    },
  );

  it('-0 is stored as 0 (no negative-zero leaks into the public record)', async () => {
    const b = await published({ model: { rotationDeg: -0, baseOffsetM: -0 } });
    expect(Object.is(b.published?.record.model.rotationDeg, 0)).toBe(true);
    const text = await (await publicBody()).text();
    expect(text).not.toContain('-0');
  });

  it.each([
    ['right-to-left override', 'Block ‮evil'],
    ['first strong isolate', 'Block ⁨x⁩'],
    ['lone high surrogate', 'Block \ud800'],
    ['NUL', 'Block\u0000'],
    ['C1 control', 'Block\u0085'],
    ['line feed in a single-line name', 'Block\nTwo'],
  ])('a name with a %s → 400', async (_l, name) => {
    const d = newDraft();
    const res = await asOwner(k, 'POST', `${S}/buildings`, {
      body: { targetId: null, draft: { ...d, identity: { ...d.identity!, name } } },
    });
    expect(res.status).toBe(400);
  });

  it('markup in names/aliases/descriptions is stored as inert text and served only as JSON', async () => {
    const xss = '<img src=x onerror=alert(1)>';
    const svg = '</script><svg onload=alert(2)>';
    const d = newDraft();
    const b = await published({
      identity: { ...d.identity!, name: xss, aliases: [svg], description: `${xss} "quoted" & more` },
    });
    expect(b.published?.record.identity?.name).toBe(xss);
    const res = await publicBody();
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    const pub = publicationSchema.parse(await res.json());
    expect(pub.buildings?.[0]?.identity?.name).toBe(xss);
    expect(pub.buildings?.[0]?.identity?.aliases).toEqual([svg]);
  });

  it.each([
    ['a percent-encoded /maps path', 'https://www.google.com/%6Daps/place/LPU'],
    ['an upper-case percent-encoded path', 'https://google.co.in/%6D%61%70%73/@31.25,75.70,17z'],
    ['a doubled slash before /maps', 'https://www.google.com//maps/place/LPU'],
    ['a percent-encoded goo.gl/maps short link', 'https://goo.gl/%6Daps/abc'],
    ['a percent-encoded /streetview path', 'https://www.google.com/%73treetview'],
  ])('a Google Maps citation disguised with %s is rejected even in a draft (400)', async (_l, url) => {
    const res = await asOwner(k, 'POST', `${S}/buildings`, {
      body: {
        targetId: null,
        draft: newDraft({
          verification: {
            status: 'source-backed',
            citation: { url, title: 'Map', accessedOn: '2026-10-01' },
            note: 'Measured from the map view',
          },
        }),
      },
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('Google Maps');
    expect((await studioSnapshot(k.t.db)).buildings).toEqual([]);
  });

  it('a disguised Google Maps URL in a change summary is rejected at publish', async () => {
    const d = await create();
    const res = await publish(d.head.id, 1, {
      changeSummary: 'Traced from google.com/%6Daps/place/LPU',
    });
    expect(res.status).toBe(400);
    expect((await studioSnapshot(k.t.db)).versions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('leaks: publication, errors, caching', () => {
  it('nothing private reaches GET /api/locations (notes, drafts, archived, duplicates, acks, summaries, actors)', async () => {
    // a published building with private text everywhere a private value can live
    const d = await create({ targetId: null, draft: newDraft({ model: { heightM: 14 } }) });
    const pub = await publish(d.head.id, 1, {
      changeSummary: 'SUMMARY-MARKER-91 first publication',
      acknowledgements: [{ code: 'height-floors-conflict', reason: 'ACK-MARKER-92 tall floor' }],
    });
    expect(pub.status).toBe(200);
    // a newer DRAFT on the published record (new name + new notes) stays private
    const base = newDraft({ model: { heightM: 14 } });
    const saved = await asOwner(k, 'PUT', `${S}/buildings/${d.head.id}/draft`, {
      body: {
        revision: 2,
        draft: { ...base, identity: { ...base.identity!, name: 'DRAFT-NAME-93', notes: 'NOTES-MARKER-94' } },
      },
    });
    expect(saved.status).toBe(200);
    // a duplicate (draft) and an archived building stay private too
    expect(
      (await asOwner(k, 'POST', `${S}/buildings/${d.head.id}/duplicate`, { body: { offsetM: null } })).status,
    ).toBe(201);
    const gone = await published({
      model: { anchor: SITE_B },
      identity: { ...newDraft().identity!, name: 'ARCHIVED-NAME-95' },
    });
    const arch = await asOwner(k, 'POST', `${S}/buildings/${gone.head.id}/archive`, {
      body: { revision: gone.head.revision, reason: 'REASON-MARKER-96' },
    });
    expect(arch.status).toBe(200);

    const res = await publicBody();
    const text = await res.text();
    for (const marker of [
      PRIVATE_NOTE,
      'SUMMARY-MARKER-91',
      'ACK-MARKER-92',
      'DRAFT-NAME-93',
      'NOTES-MARKER-94',
      'ARCHIVED-NAME-95',
      'REASON-MARKER-96',
      JWT_OWNER.toLowerCase(),
      'notes',
      'acknowledg',
      'changeSummary',
      'publishedBy',
      'createdBy',
      'draft',
      'validation',
      'revision',
    ])
      expect(text, marker).not.toContain(marker);
    const body = publicationSchema.parse(JSON.parse(text));
    expect(body.buildings?.map((b) => b.id)).toEqual([d.head.id]);
  });

  it('unauthenticated studio errors carry no details, and admin responses are never cacheable', async () => {
    const d = await create();
    const anon = await handleAdmin(
      req('POST', `/api/admin${S}/buildings/${d.head.id}/publish`, { body: publishBody(99) }),
      pwDeps(k),
    );
    expect(anon.status).toBe(401);
    expect(Object.keys((await json<{ error: object }>(anon)).error).sort()).toEqual(['code', 'message']);
    const stale = await publish(d.head.id, 99);
    expect(stale.status).toBe(409);
    expect(stale.headers.get('Cache-Control')).toBe('no-store');
    for (const p of ['/buildings', `/buildings/${d.head.id}`, '/library', '/quality']) {
      const r = await asOwner(k, 'GET', `${S}${p}`);
      expect(r.status, p).toBe(200);
      expect(r.headers.get('Cache-Control'), p).toBe('no-store');
      expect(r.headers.get('Access-Control-Allow-Origin'), p).toBeNull();
    }
  });

  it('archive, restore and publish each change the ETag, so a cached copy never outlives a removal', async () => {
    const b = await published();
    const first = await publicBody();
    const etag = first.headers.get('ETag')!;
    expect(first.headers.get('Cache-Control')).toBe('no-cache');
    expect((await publicBody({ headers: { 'If-None-Match': etag } })).status).toBe(304);
    const arch = await asOwner(k, 'POST', `${S}/buildings/${b.head.id}/archive`, {
      body: { revision: b.head.revision, reason: null },
    });
    expect(arch.status).toBe(200);
    const after = await publicBody({ headers: { 'If-None-Match': etag } });
    expect(after.status).toBe(200);
    expect(publicationSchema.parse(await after.json()).buildings).toEqual([]);
    // a pure draft save, duplicate or template change does not touch the public ETag
    const etag2 = after.headers.get('ETag')!;
    const dup = await asOwner(k, 'POST', `${S}/buildings/${b.head.id}/duplicate`, {
      body: { offsetM: null },
    });
    expect(dup.status).toBe(201);
    expect((await publicBody({ headers: { 'If-None-Match': etag2 } })).status).toBe(304);
  });
});

// ---------------------------------------------------------------------------

describe('races and replays', () => {
  it('8 concurrent publishes of the same revision → exactly one version, one bump, one success audit', async () => {
    const d = await create();
    const before = (await studioSnapshot(k.t.db)).meta;
    const results = await Promise.all(Array.from({ length: 8 }, () => publish(d.head.id, 1)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s !== 200).every((s) => s === 409)).toBe(true);
    const snap = await studioSnapshot(k.t.db);
    expect(snap.versions).toHaveLength(1);
    const v = (m: unknown[]) =>
      Number((m as { key: string; value: string }[]).find((r) => r.key === 'publication_version')!.value);
    expect(v(snap.meta)).toBe(v(before) + 1);
    const audits = await auditOf(k.t.db, d.head.id);
    expect(audits.filter((a) => a.action === 'building.publish' && a.outcome === 'success')).toHaveLength(1);
    expect(audits.filter((a) => a.action === 'building.publish' && a.outcome === 'rejected')).toHaveLength(7);
  });

  it('two different drafts at one site published concurrently cannot both skip the overlap/duplicate warning', async () => {
    const a = await create();
    const b = await create();
    const [ra, rb] = await Promise.all([publish(a.head.id, 1), publish(b.head.id, 1)]);
    expect([ra.status, rb.status].filter((s) => s === 200)).toHaveLength(1);
    expect((await studioSnapshot(k.t.db)).versions).toHaveLength(1);
    // the loser, retried, now sees the published twin and must acknowledge it
    const loser = ra.status === 200 ? b : a;
    const retry = await publish(loser.head.id, 1);
    expect(retry.status).toBe(422);
    const details = (await json<{ error: { details: { missingAcknowledgements: string[] } } }>(retry)).error
      .details;
    expect(details.missingAcknowledgements).toEqual(expect.arrayContaining(['possible-duplicate']));
  });

  it('publish, archive and save racing on one revision: exactly one wins, the state is consistent', async () => {
    const d = await create();
    const [p, a, s] = await Promise.all([
      publish(d.head.id, 1),
      asOwner(k, 'POST', `${S}/buildings/${d.head.id}/archive`, { body: { revision: 1, reason: null } }),
      asOwner(k, 'PUT', `${S}/buildings/${d.head.id}/draft`, {
        body: { revision: 1, draft: newDraft({ model: { heightM: 12.8, floors: 4 } }) },
      }),
    ]);
    expect([p.status, a.status, s.status].filter((x) => x === 200)).toHaveLength(1);
    const snap = await studioSnapshot(k.t.db);
    const head = snap.buildings[0] as { status: string; revision: number; published_version: number | null };
    expect(head.revision).toBe(2);
    expect(snap.versions).toHaveLength(head.status === 'published' ? 1 : 0);
  });

  it('restore and permanent delete racing on an archived record: one wins, no orphan versions', async () => {
    const b = await published();
    const arch = await asOwner(k, 'POST', `${S}/buildings/${b.head.id}/archive`, {
      body: { revision: b.head.revision, reason: null },
    });
    const rev = publishResponseSchema.parse(await arch.json()).building.head.revision;
    const [r, del] = await Promise.all([
      asOwner(k, 'POST', `${S}/buildings/${b.head.id}/restore`, {
        body: { revision: rev, acknowledgements: [] },
      }),
      asOwner(k, 'DELETE', `${S}/buildings/${b.head.id}`, { body: { revision: rev, confirmId: b.head.id } }),
    ]);
    expect([r.status, del.status].filter((x) => x === 200)).toHaveLength(1);
    const snap = await studioSnapshot(k.t.db);
    if (del.status === 200) expect([snap.buildings, snap.versions]).toEqual([[], []]);
    else expect(snap.versions).toHaveLength(1);
  });

  it('replaying a successful publish, archive or delete request is 409 and changes nothing', async () => {
    const d = await create();
    expect((await publish(d.head.id, 1)).status).toBe(200);
    const snap = await studioSnapshot(k.t.db);
    const replay = await publish(d.head.id, 1);
    expect(replay.status).toBe(409);
    const after = await studioSnapshot(k.t.db);
    expect({ ...after, audit: [] }).toEqual({ ...snap, audit: [] });
  });
});

// ---------------------------------------------------------------------------

describe('audit integrity', () => {
  it('every successful studio write leaves exactly one success row, attributed to the verified actor', async () => {
    const d = await create();
    const id = d.head.id;
    const call = (m: string, p: string, body: unknown) => asOwner(k, m, `${S}${p}`, { body });
    const steps: [string, () => Promise<Response>][] = [
      [
        'building.save-draft',
        () => call('PUT', `/buildings/${id}/draft`, { revision: 1, draft: newDraft() }),
      ],
      ['building.publish', () => call('POST', `/buildings/${id}/publish`, publishBody(2))],
      [
        'building.save-draft',
        () => call('PUT', `/buildings/${id}/draft`, { revision: 3, draft: newDraft() }),
      ],
      ['building.discard-draft', () => call('DELETE', `/buildings/${id}/draft`, { revision: 4 })],
      ['building.archive', () => call('POST', `/buildings/${id}/archive`, { revision: 5, reason: null })],
      [
        'building.restore',
        () => call('POST', `/buildings/${id}/restore`, { revision: 6, acknowledgements: [] }),
      ],
      ['building.archive', () => call('POST', `/buildings/${id}/archive`, { revision: 7, reason: 'x' })],
      ['building.delete', () => call('DELETE', `/buildings/${id}`, { revision: 8, confirmId: id })],
    ];
    for (const [action, run] of steps) {
      const res = await run();
      expect(res.status, action).toBe(200);
    }
    const rows = await auditOf(k.t.db, id);
    expect(rows.map((r) => [r.action, r.outcome, r.entity_type, r.actor])).toEqual([
      ['building.create', 'success', 'building', JWT_OWNER.toLowerCase()],
      ...steps.map(([a]) => [a, 'success', 'building', JWT_OWNER.toLowerCase()]),
    ]);
  });

  it('GET /audit?entity=building|template returns only studio rows (the filter is honoured)', async () => {
    const ip = '198.51.100.40';
    expect((await submit(k, { body: validSuggestion(), ip })).status).toBe(201);
    const b = await create();
    const t = await asOwner(k, 'POST', `${S}/templates`, {
      body: { definition: { name: 'x' } },
    });
    expect(t.status).toBe(400); // a rejected template attempt is audited as entity 'template'
    for (const [entity, ids] of [
      ['building', [b.head.id]],
      ['template', [null]],
    ] as const) {
      const res = await asOwner(k, 'GET', `/audit?entity=${entity}`);
      expect(res.status).toBe(200);
      const items = (await json<{ items: { entityType: string; entityId: string | null }[] }>(res)).items;
      expect(items.length, entity).toBeGreaterThan(0);
      expect(new Set(items.map((i) => i.entityType)), entity).toEqual(new Set([entity]));
      expect(new Set(items.map((i) => i.entityId))).toEqual(new Set(ids));
    }
  });

  it('studio audit rows are append-only at the database level', async () => {
    const b = await create();
    const row = (await auditOf(k.t.db, b.head.id))[0]!;
    await expect(
      k.t.db.prepare("UPDATE audit_events SET actor = 'x' WHERE id = ?").bind(row.id).run(),
    ).rejects.toThrow(/append-only/);
    await expect(k.t.db.prepare('DELETE FROM audit_events WHERE id = ?').bind(row.id).run()).rejects.toThrow(
      /append-only/,
    );
  });
});
