/**
 * Red-team: attacks on the artwork verification endpoints
 * (/api/admin/artwork/associations/**) and on what they publish
 * (GET /api/locations v3 `artworkAssociations`), sent as real requests through
 * the admin dispatcher over an isolated, non-persistent local D1 with the real
 * base dataset and the real published artwork manifest. Complements
 * tests/server/artwork/http.test.ts (contract behaviour) with method/path
 * tricks, Origin/CSRF variants, evidence URL and text injection, the
 * Google Maps provenance rule, payload bounds, publication leaks and ETags.
 *
 * Regressions pinned here (each failed before its fix):
 *  - a Google Maps / Earth / Street View URL (or one inside the description)
 *    was accepted as evidence and published;
 *  - bidi controls, unpaired surrogates and tabs were accepted in the public
 *    evidence text and URL and in the private note (a lone surrogate in the
 *    note was silently stored as U+FFFD);
 *  - ten schema-valid evidence items larger than the 0003 CHECK
 *    (evidence_json <= 8192) failed the batch with a 500 instead of a 422.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearArtworkManifestCache } from '../../../server/artwork-manifest.ts';
import { handlePublication } from '../../../server/handlers/publication.ts';
import { PROHIBITED_SOURCE_MESSAGE } from '../../../src/building-studio/text.ts';
import {
  NOW,
  OWNER_EMAIL,
  PRIVATE_NOTE,
  accessDeps,
  asOwner,
  assocPath,
  auditRows,
  handleAdmin,
  makeArtKit,
  officialDoc,
  publication,
  pwDeps,
  req,
  siteSign,
  type ArtKit,
} from '../artwork/helpers.ts';
import { claims, sign } from '../auth/jwt-fixtures.ts';
import { createTestDb, type TestDb } from '../helpers/test-db.ts';

let t: TestDb;
let k: ArtKit;

beforeAll(async () => {
  t = await createTestDb();
  k = await makeArtKit(t.db);
});
afterAll(async () => t.dispose());

/** audit_events is append-only: each check looks only at rows added after this mark. */
let auditBase = 0;
const markAudit = async () => {
  const row = await t.db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM audit_events').first<{ m: number }>();
  auditBase = Number(row?.m ?? 0);
};
beforeEach(async () => {
  await t.db.prepare('DELETE FROM artwork_associations').run();
  clearArtworkManifestCache();
  await markAudit();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const SUBJECT = 'art:num-34'; // unresolved in the curated baseline
const BUILDING = 'osm:way/422437890'; // a campus-inventory base building
const PATH = assocPath(SUBJECT);

const verifyBody = (over: Record<string, unknown> = {}) => ({
  expectedRevision: null,
  status: 'verified',
  buildingId: BUILDING,
  evidence: [siteSign()],
  ...over,
});
const put = (body: unknown) => asOwner(k, 'PUT', PATH, { body });
const stored = async () => t.count('artwork_associations');
const newAudit = async () => (await auditRows(t.db, SUBJECT)).filter((r) => Number(r.id) > auditBase);
const pubVersion = async () => Number((await publication(k)).body.publicationVersion);
type ErrorBody = { error: { code: string; message: string; issues?: { path: string; message: string }[] } };
const errorOf = async (res: Response) => ((await res.json()) as ErrorBody).error;

/** A refused write: nothing stored, audited as one 'rejected' row. */
async function expectRefused(res: Response, status: number, path?: string, message?: string) {
  expect(res.status).toBe(status);
  const err = await errorOf(res);
  if (path) expect(err.issues?.map((i) => i.path)).toContain(path);
  if (path && message) expect(err.issues?.find((i) => i.path === path)?.message).toBe(message);
  expect(await stored()).toBe(0);
  expect((await newAudit()).map((r) => r.outcome)).toEqual(['rejected']);
}

// ---------------------------------------------------------------------------

describe('route surface: methods, authentication, paths', () => {
  it.each(['HEAD', 'OPTIONS'])('%s is refused (405) with no CORS headers', async (method) => {
    for (const path of ['/api/admin/artwork/associations', `/api/admin${PATH}`]) {
      const res = await handleAdmin(
        req(method, path, { headers: { 'Access-Control-Request-Method': 'PUT' } }),
        pwDeps(k),
      );
      expect(res.status).toBe(405);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
  });

  it('POST / PATCH on an artwork route: 401 without a session, 405 with one; never a write', async () => {
    for (const method of ['POST', 'PATCH']) {
      const anon = await handleAdmin(req(method, `/api/admin${PATH}`, { body: verifyBody() }), pwDeps(k));
      expect(anon.status).toBe(401);
      const owner = await asOwner(k, method, PATH, { body: verifyBody() });
      expect(owner.status).toBe(405);
    }
    expect(await stored()).toBe(0);
  });

  it('a valid Access identity that is not an owner is refused on every artwork route', async () => {
    const jwt = await sign(k.key, claims(NOW, { email: 'stranger@example.org' }));
    for (const [method, path] of [
      ['GET', '/api/admin/artwork/associations'],
      ['GET', `/api/admin${PATH}`],
      ['PUT', `/api/admin${PATH}`],
      ['DELETE', `/api/admin${PATH}`],
    ] as const) {
      const res = await handleAdmin(
        req(method, path, {
          headers: { 'Cf-Access-Jwt-Assertion': jwt },
          ...(method === 'GET' ? {} : { body: verifyBody() }),
        }),
        accessDeps(k),
      );
      expect([401, 403], `${method} ${path}`).toContain(res.status);
    }
    expect(await stored()).toBe(0);
  });

  it.each([
    'art%3Anum-34%2F..%2F..%2Fsession',
    '..%2F..%2Fsession',
    'art%3Anum-34%00',
    'art%3Anum-34%20',
    'art%253Anum-34',
    'art%3Anum-34%3Bdrop',
    'art%3ANUM-34',
    `art%3Anum-${'9'.repeat(80)}`,
  ])('subject id %s → 400 before any lookup, nothing written', async (raw) => {
    const get = await asOwner(k, 'GET', `/artwork/associations/${raw}`);
    expect(get.status).toBe(400);
    const w = await asOwner(k, 'PUT', `/artwork/associations/${raw}`, { body: verifyBody() });
    expect(w.status).toBe(400);
    expect(await stored()).toBe(0);
  });

  it('admin artwork reads are never cacheable and are JSON with nosniff', async () => {
    for (const path of ['/artwork/associations', PATH]) {
      const res = await asOwner(k, 'GET', path);
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(res.headers.get('Content-Type')).toMatch(/^application\/json/);
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    }
  });
});

describe('CSRF / Origin on artwork writes (Access mode: no CSRF token, Origin required)', () => {
  it.each([
    ['cross-site fetch metadata', { headers: { 'Sec-Fetch-Site': 'cross-site' } }],
    ['same-site (sibling subdomain) fetch metadata', { headers: { 'Sec-Fetch-Site': 'same-site' } }],
    ['opaque Origin "null"', { origin: 'null' }],
    ['look-alike Origin', { origin: 'https://atlas.test.evil.example' }],
    ['scheme-downgraded Origin', { origin: 'http://atlas.test' }],
    ['missing Origin', { origin: null }],
  ])('%s → 403, nothing stored or audited', async (_label, o) => {
    for (const method of ['PUT', 'DELETE']) {
      const body = method === 'PUT' ? verifyBody() : { expectedRevision: 1 };
      const res = await asOwner(k, method, PATH, { body, ...o });
      expect(res.status).toBe(403);
      expect((await errorOf(res)).code).toBe('csrf');
    }
    expect(await stored()).toBe(0);
    expect(await newAudit()).toHaveLength(0);
  });

  it('a form-encodable (text/plain) body is refused with 415 even from the right origin', async () => {
    const res = await asOwner(k, 'PUT', PATH, {
      raw: JSON.stringify(verifyBody()),
      headers: { 'Content-Type': 'text/plain' },
    });
    await expectRefused(res, 415);
  });
});

describe('evidence URL injection and the provenance rule', () => {
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '//evil.example/x',
    '/admin',
    'https://owner:pw@evil.example/',
  ])('URL %j → 400, nothing stored', async (url) => {
    await expectRefused(await put(verifyBody({ evidence: [officialDoc({ url })] })), 400, 'evidence.0.url');
  });

  it.each([
    'https://www.google.com/maps/place/Lovely+Professional+University',
    'https://maps.google.co.in/?q=lpu+block+34',
    'https://maps.app.goo.gl/AbCdEf',
    'https://goo.gl/maps/AbCdEf',
    'https://earth.google.com/web/@31.25,75.70',
    'https://www.google.com/url?q=https://maps.google.com/?q=lpu',
    'https://lh3.googleusercontent.com/p/AF1QipExample',
  ])('Google Maps / Earth URL %s → 422 (never a source), nothing stored or published', async (url) => {
    const v0 = await pubVersion();
    await expectRefused(
      await put(verifyBody({ evidence: [officialDoc({ url })] })),
      422,
      'evidence.0.url',
      PROHIBITED_SOURCE_MESSAGE,
    );
    expect(await pubVersion()).toBe(v0);
  });

  it('a Google Maps link inside the (public) description → 422', async () => {
    await expectRefused(
      await put(verifyBody({ evidence: [siteSign({ description: 'Pinned at maps.app.goo.gl/xyz123' })] })),
      422,
      'evidence.0.description',
      PROHIBITED_SOURCE_MESSAGE,
    );
  });

  it('an allowed source URL is stored exactly and published', async () => {
    const url = 'https://www.lpu.in/campus/directory.pdf#page=4';
    const res = await put(verifyBody({ evidence: [officialDoc({ url })] }));
    expect(res.status).toBe(200);
    const pub = await publication(k);
    expect(JSON.stringify(pub.body.artworkAssociations)).toContain(JSON.stringify(url));
  });
});

describe('stored text: spoofing controls and markup', () => {
  const desc = (description: string) => verifyBody({ evidence: [siteSign({ description })] });
  const url = (u: string) => verifyBody({ evidence: [officialDoc({ url: u })] });

  it.each([
    ['bidi override in the description', desc('Sign ‮KCOLB'), 'evidence.0.description'],
    ['bidi isolate in the description', desc('Sign ⁦x⁩'), 'evidence.0.description'],
    ['lone surrogate in the description', desc('Sign \ud800 x'), 'evidence.0.description'],
    ['bidi override in the URL', url('https://example.org/a‮b'), 'evidence.0.url'],
    ['tab inside the URL', url('https://exa\tmple.org/'), 'evidence.0.url'],
    ['lone surrogate in the private note', verifyBody({ note: 'abc \udc00 def' }), 'note'],
    ['bidi isolate in the private note', verifyBody({ note: 'abc ⁦ def' }), 'note'],
    ['NUL in the private note', verifyBody({ note: 'abc \u0000 def' }), 'note'],
  ])('%s → 400, nothing stored', async (_label, body, path) => {
    await expectRefused(await put(body), 400, path);
  });

  it('markup is stored and returned as inert JSON text (React renders it as text)', async () => {
    const description = '"><img src=x onerror=alert(1)><script>alert(2)</script>';
    const res = await put(
      verifyBody({ evidence: [siteSign({ description })], note: '<svg onload=alert(3)>' }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/^application\/json/);
    const view = (await res.json()) as { decision: { evidence: { description: string }[]; note: string } };
    expect(view.decision.evidence[0]!.description).toBe(description);
    expect(view.decision.note).toBe('<svg onload=alert(3)>');
  });

  it('a prototype-pollution key is refused (strict schema), not merged', async () => {
    const raw =
      '{"__proto__":{"status":"verified"},"expectedRevision":null,"status":"unresolved","buildingId":null,"evidence":[]}';
    await expectRefused(await asOwner(k, 'PUT', PATH, { raw }), 400);
    expect(({} as Record<string, unknown>).status).toBeUndefined();
  });
});

describe('payload bounds', () => {
  it('ten schema-valid evidence items larger than the stored bound → 422 (not a failed batch / 500)', async () => {
    const v0 = await pubVersion();
    const evidence = Array.from({ length: 10 }, (_, i) =>
      officialDoc({ description: `${i} `.padEnd(500, 'x'), url: `https://example.org/${'a'.repeat(470)}` }),
    );
    await expectRefused(await put(verifyBody({ evidence })), 422, 'evidence');
    expect(await pubVersion()).toBe(v0);
  });

  it('ten maximal non-ASCII descriptions within the bound are stored exactly', async () => {
    const evidence = Array.from({ length: 10 }, (_, i) =>
      siteSign({ description: `${i} `.padEnd(500, 'é') }),
    );
    expect((await put(verifyBody({ evidence }))).status).toBe(200);
    const row = await t.db
      .prepare('SELECT evidence_json FROM artwork_associations')
      .first<{ evidence_json: string }>();
    expect(JSON.parse(row!.evidence_json)).toEqual(evidence);
  });

  it('more than 10 evidence items, a body over 32 KB, or a deeply nested body is refused', async () => {
    await expectRefused(
      await put(verifyBody({ evidence: Array.from({ length: 11 }, () => siteSign()) })),
      400,
    );
    await markAudit();
    const big = JSON.stringify(verifyBody({ note: 'x'.repeat(40_000) }));
    await expectRefused(await asOwner(k, 'PUT', PATH, { raw: big }), 413);
    await markAudit();
    await expectRefused(await asOwner(k, 'PUT', PATH, { raw: `${'['.repeat(200)}${']'.repeat(200)}` }), 400);
  });
});

describe('publication: no private data, correct ETags', () => {
  const conditional = (etag: string) =>
    handlePublication(req('GET', '/api/locations', { headers: { 'If-None-Match': etag } }), pwDeps(k));

  it('never leaks the private note, the actors or createdAt; the ETag follows every change', async () => {
    const etag0 = (await publication(k)).res.headers.get('ETag')!;
    expect(etag0).toBeTruthy();

    expect((await put(verifyBody({ note: PRIVATE_NOTE }))).status).toBe(200);
    const p1 = await publication(k);
    const etag1 = p1.res.headers.get('ETag')!;
    expect(etag1).not.toBe(etag0);
    expect(p1.text).not.toContain(PRIVATE_NOTE);
    expect(p1.text.toLowerCase()).not.toContain(OWNER_EMAIL.toLowerCase());
    const pub = (p1.body.artworkAssociations as Record<string, unknown>[]).find(
      (a) => a.subjectId === SUBJECT,
    )!;
    expect(Object.keys(pub).sort()).toEqual([
      'buildingId',
      'evidence',
      'revision',
      'status',
      'subjectId',
      'updatedAt',
    ]);

    // The old ETag is never answered with 304 after a change.
    expect((await conditional(etag0)).status).toBe(200);

    // A refused write (a Maps URL) changes nothing: the current ETag still validates.
    const refused = await put(
      verifyBody({ expectedRevision: 1, evidence: [officialDoc({ url: 'https://maps.app.goo.gl/x' })] }),
    );
    expect(refused.status).toBe(422);
    expect((await conditional(etag1)).status).toBe(304);

    // Reset → a new ETag, and the decision is gone from the publication.
    expect((await asOwner(k, 'DELETE', PATH, { body: { expectedRevision: 1 } })).status).toBe(200);
    const p2 = await publication(k);
    expect(p2.res.headers.get('ETag')).not.toBe(etag1);
    expect((p2.body.artworkAssociations as { subjectId: string }[]).map((a) => a.subjectId)).not.toContain(
      SUBJECT,
    );
    expect(p2.text).not.toContain(PRIVATE_NOTE);
  });
});
