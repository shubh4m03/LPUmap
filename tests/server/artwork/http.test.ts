/**
 * Artwork verification over the REAL admin dispatcher, domain and local D1
 * (isolated, non-persistent), with the real base dataset and the real
 * published artwork manifest:
 *  - auth: 401 on every artwork route, Origin/CSRF 403 on writes, the
 *    `artwork:verify` permission, malformed ids 400, unknown subjects 404;
 *  - validation: 400 for malformed bodies, 422 for rule violations (verified
 *    without evidence, official document without URL, future date,
 *    approximate without a note, evidence on unresolved, non-campus building);
 *  - optimistic concurrency: 409 with the current record; nothing written;
 *  - audit: success rows with before/after, rejected rows, no trace of a stale write;
 *  - publication v3: public fields only (no note, no actors), ETag bump;
 *  - the merge: verified → buildingId, approximate → unconfirmedMatchId,
 *    reset → curated baseline; published studio buildings count, drafts do not.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { can, type Actor } from '../../../server/auth/authorize.ts';
import { clearArtworkManifestCache } from '../../../server/artwork-manifest.ts';
import { ARTWORK_ROUTES } from '../../../server/handlers/admin/artwork-routes.ts';
import { ADMIN_ROUTES } from '../../../server/handlers/admin/routes.ts';
import { createStudioBuilding, publishStudioBuilding } from '../../../server/domain/studio/index.ts';
import { studioBuildingDetailSchema } from '../../../src/building-studio/schema.ts';
import { publicationSchema } from '../../../src/community/schema.ts';
import { createTestDb, type TestDb } from '../helpers/test-db.ts';
import { newDraft, publishBody, studioClock } from '../studio/helpers.ts';
import {
  PRIVATE_NOTE,
  TODAY,
  approximateBaseline,
  asOwner,
  assocPath,
  auditRows,
  handleAdmin,
  json,
  makeArtKit,
  officialDoc,
  ownerStatement,
  publication,
  pwDeps,
  pwLogin,
  realManifest,
  req,
  siteSign,
  type ArtKit,
} from './helpers.ts';

let t: TestDb;
let k: ArtKit;

beforeAll(async () => {
  t = await createTestDb();
  k = await makeArtKit(t.db);
});
afterAll(async () => t.dispose());
/** audit_events is append-only: each test looks only at the rows it added. */
let auditBase = 0;
beforeEach(async () => {
  for (const tbl of ['artwork_associations', 'sessions', 'rate_limits'])
    await t.db.prepare(`DELETE FROM ${tbl}`).run();
  clearArtworkManifestCache();
  const row = await t.db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM audit_events').first<{ m: number }>();
  auditBase = Number(row?.m ?? 0);
});
const newAudit = async (subjectId: string) =>
  (await auditRows(t.db, subjectId)).filter((r) => Number(r.id) > auditBase);

const SUBJECT = 'art:num-34'; // unresolved in the curated baseline
const BUILDING = 'osm:way/422437890'; // a campus-inventory base building

type View = {
  subjectId: string;
  baseline: { status: string; buildingId: string | null } | null;
  decision: {
    status: string;
    buildingId: string | null;
    evidence: unknown[];
    note: string | null;
    revision: number;
    createdBy: string;
    updatedBy: string;
  } | null;
  effective: {
    status: string;
    buildingId: string | null;
    unconfirmedMatchId: string | null;
    source: string;
    revision: number | null;
  };
};

const verifyBody = (over: Record<string, unknown> = {}) => ({
  expectedRevision: null,
  status: 'verified',
  buildingId: BUILDING,
  evidence: [siteSign()],
  note: PRIVATE_NOTE,
  ...over,
});

const put = (subjectId: string, body: unknown) => asOwner(k, 'PUT', assocPath(subjectId), { body });
const del = (subjectId: string, body: unknown) => asOwner(k, 'DELETE', assocPath(subjectId), { body });

async function pubVersion(): Promise<number> {
  return Number((await publication(k)).body.publicationVersion);
}

// ---------------------------------------------------------------------------
// Routing, authentication, CSRF, permission
// ---------------------------------------------------------------------------

describe('route table and authorization', () => {
  it('registers exactly the four contract routes, each protected', () => {
    expect(ARTWORK_ROUTES.map((r) => `${r.method} ${r.pattern} ${r.handler.permission}`)).toEqual([
      'GET /artwork/associations admin:read',
      'GET /artwork/associations/:subjectId admin:read',
      'PUT /artwork/associations/:subjectId artwork:verify',
      'DELETE /artwork/associations/:subjectId artwork:verify',
    ]);
    for (const r of ARTWORK_ROUTES) expect(ADMIN_ROUTES).toContain(r);
    const writes = ARTWORK_ROUTES.filter((r) => r.method !== 'GET');
    expect(writes.map((r) => r.handler.audit)).toEqual([
      { action: 'artwork.put', entityType: 'artwork', param: 'subjectId' },
      { action: 'artwork.reset', entityType: 'artwork', param: 'subjectId' },
    ]);
  });

  it('the owner role holds artwork:verify; a role without it is refused', () => {
    const owner: Actor = { id: 'owner', role: 'owner', mode: 'password' };
    expect(can(owner, 'artwork:verify')).toBe(true);
    const stranger = { id: 'x', role: 'moderator', mode: 'password' } as unknown as Actor;
    expect(can(stranger, 'artwork:verify')).toBe(false);
  });

  it.each([
    ['GET', '/api/admin/artwork/associations'],
    ['GET', `/api/admin${assocPath(SUBJECT)}`],
    ['PUT', `/api/admin${assocPath(SUBJECT)}`],
    ['DELETE', `/api/admin${assocPath(SUBJECT)}`],
  ])('%s %s without a session → 401, nothing written', async (method, path) => {
    const res = await handleAdmin(
      req(method, path, method === 'GET' ? {} : { body: verifyBody() }),
      pwDeps(k),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await t.count('artwork_associations')).toBe(0);
  });

  it('password mode: a write without the CSRF token, with a wrong token, or cross-origin → 403; nothing written', async () => {
    const s = await pwLogin(k);
    const path = `/api/admin${assocPath(SUBJECT)}`;
    const cases = [
      req('PUT', path, { body: verifyBody(), cookie: s.cookie }),
      req('PUT', path, { body: verifyBody(), cookie: s.cookie, csrf: 'x'.repeat(43) }),
      req('PUT', path, {
        body: verifyBody(),
        cookie: s.cookie,
        csrf: s.csrf,
        origin: 'https://evil.example',
      }),
      req('PUT', path, { body: verifyBody(), cookie: s.cookie, csrf: s.csrf, origin: null }),
      req('DELETE', path, { body: { expectedRevision: 1 }, cookie: s.cookie }),
    ];
    for (const r of cases) {
      const res = await handleAdmin(r, pwDeps(k));
      expect(res.status).toBe(403);
      expect(['csrf', 'forbidden']).toContain((await json<{ error: { code: string } }>(res)).error.code);
    }
    expect(await t.count('artwork_associations')).toBe(0);
    expect(await newAudit(SUBJECT)).toHaveLength(0);

    // The same request with the session's token and same origin succeeds.
    const ok = await handleAdmin(
      req('PUT', path, { body: verifyBody(), cookie: s.cookie, csrf: s.csrf }),
      pwDeps(k),
    );
    expect(ok.status).toBe(200);
    const rows = await newAudit(SUBJECT);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: 'owner', action: 'artwork.put', outcome: 'success' });
  });

  it('malformed subject ids → 400 before any lookup; unknown subjects → 404', async () => {
    for (const bad of [
      'art:num-',
      'ART:NUM-1',
      'art:num-1/../x',
      'art:block-25',
      `art:num-${'a'.repeat(70)}`,
    ]) {
      const res = await asOwner(k, 'GET', `/artwork/associations/${encodeURIComponent(bad)}`);
      expect(res.status, bad).toBe(400);
    }
    const res = await asOwner(k, 'GET', assocPath('art:num-999'));
    expect(res.status).toBe(404);
    const w = await put('art:num-999', verifyBody());
    expect(w.status).toBe(404);
    const rows = await newAudit('art:num-999');
    expect(rows.map((r) => [r.action, r.outcome])).toEqual([['artwork.put', 'rejected']]);
    expect(await t.count('artwork_associations')).toBe(0);
  });

  it('503 (never a guess) when the manifest cannot be loaded', async () => {
    const res = await asOwner(
      k,
      'GET',
      '/artwork/associations',
      {},
      {
        ASSETS: { fetch: async () => new Response('nope', { status: 404 }) },
      },
    );
    expect(res.status).toBe(503);
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe('unavailable');
  });
});

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

describe('GET list and detail', () => {
  it('lists every manifest subject with its curated baseline and the merged effective status', async () => {
    const res = await asOwner(k, 'GET', '/artwork/associations');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await json<{ items: View[]; issues: unknown[] }>(res);
    const m = realManifest();
    expect(body.items.map((i) => i.subjectId)).toEqual(m.subjects.map((s) => s.subjectId));
    expect(body.issues).toEqual([]);
    const approx = approximateBaseline();
    const a = body.items.find((i) => i.subjectId === approx.subjectId)!;
    expect(a.decision).toBeNull();
    expect(a.effective).toMatchObject({
      status: 'approximate',
      buildingId: null, // approximate is never an identity
      unconfirmedMatchId: approx.buildingId,
      source: 'curated',
    });
    expect(body.items.filter((i) => i.effective.status === 'verified')).toHaveLength(0);
  });

  it('detail includes the audit history, oldest first', async () => {
    expect((await put(SUBJECT, verifyBody())).status).toBe(200);
    expect(
      (await put(SUBJECT, verifyBody({ expectedRevision: 1, evidence: [ownerStatement()] }))).status,
    ).toBe(200);
    const d = await json<View & { history: { action: string; outcome: string; id: number }[] }>(
      await asOwner(k, 'GET', assocPath(SUBJECT)),
    );
    expect(d.decision).toMatchObject({ revision: 2, note: PRIVATE_NOTE });
    const mine = d.history.filter((h) => h.id > auditBase);
    expect(mine.map((h) => [h.action, h.outcome])).toEqual([
      ['artwork.put', 'success'],
      ['artwork.put', 'success'],
    ]);
    expect(d.history.every((h, i) => i === 0 || h.id > d.history[i - 1]!.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Writes: verify, approximate, unresolved, reset
// ---------------------------------------------------------------------------

describe('PUT: setting an association', () => {
  it('verifies with evidence: stored, audited with before/after, published (public fields only), ETag bumped', async () => {
    const v0 = await pubVersion();
    const res = await put(SUBJECT, verifyBody({ evidence: [siteSign(), officialDoc()] }));
    expect(res.status).toBe(200);
    const view = await json<View>(res);
    expect(view.decision).toMatchObject({
      status: 'verified',
      buildingId: BUILDING,
      note: PRIVATE_NOTE,
      revision: 1,
      createdBy: 'owner@example.org',
      updatedBy: 'owner@example.org',
    });
    expect(view.effective).toMatchObject({
      status: 'verified',
      buildingId: BUILDING,
      unconfirmedMatchId: null,
      source: 'owner',
      revision: 1,
    });

    const rows = await newAudit(SUBJECT);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'artwork.put', outcome: 'success', entity_type: 'artwork' });
    expect(rows[0]!.before_json).toBeNull();
    expect(JSON.parse(String(rows[0]!.after_json))).toMatchObject({
      status: 'verified',
      buildingId: BUILDING,
    });

    const pub = await publication(k);
    expect(pub.res.status).toBe(200);
    const parsed = publicationSchema.parse(pub.body);
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.publicationVersion).toBe(v0 + 1);
    expect(parsed.artworkAssociations).toEqual([
      {
        subjectId: SUBJECT,
        status: 'verified',
        buildingId: BUILDING,
        evidence: [siteSign(), officialDoc()],
        revision: 1,
        updatedAt: '2026-10-24T09:00:00.000Z',
      },
    ]);
    // Public fields only: never the private note, actors or creation data.
    const raw = (pub.body.artworkAssociations as Record<string, unknown>[])[0]!;
    expect(Object.keys(raw).sort()).toEqual([
      'buildingId',
      'evidence',
      'revision',
      'status',
      'subjectId',
      'updatedAt',
    ]);
    expect(pub.text).not.toContain('PRIVATE-ARTWORK-NOTE');
    expect(pub.text).not.toContain('owner@example.org');
  });

  it('approximate: needs a note (422); with one it is stored and shown only as an unconfirmed match', async () => {
    const noNote = await put(SUBJECT, {
      expectedRevision: null,
      status: 'approximate',
      buildingId: BUILDING,
      evidence: [],
    });
    expect(noNote.status).toBe(422);
    expect((await json<{ error: { issues: { path: string }[] } }>(noNote)).error.issues[0]!.path).toBe(
      'note',
    );

    const ok = await put(SUBJECT, {
      expectedRevision: null,
      status: 'approximate',
      buildingId: BUILDING,
      evidence: [],
      note: 'Looks like the drawn block from the road; not checked on site.',
    });
    expect(ok.status).toBe(200);
    expect((await json<View>(ok)).effective).toMatchObject({
      status: 'approximate',
      buildingId: null,
      unconfirmedMatchId: BUILDING,
    });
  });

  it('unresolved overrides an approximate baseline whole (no building, no evidence)', async () => {
    const approx = approximateBaseline();
    const res = await put(approx.subjectId, {
      expectedRevision: null,
      status: 'unresolved',
      buildingId: null,
      evidence: [],
      note: 'Candidate rejected after the site visit.',
    });
    expect(res.status).toBe(200);
    expect((await json<View>(res)).effective).toMatchObject({
      status: 'unresolved',
      buildingId: null,
      unconfirmedMatchId: null,
      source: 'owner',
    });
  });

  it.each([
    ['verified without evidence', verifyBody({ evidence: [] }), 'evidence'],
    [
      'official document without URL',
      verifyBody({ evidence: [officialDoc({ url: undefined })] }),
      'evidence.0.url',
    ],
    [
      'evidence dated in the future',
      verifyBody({ evidence: [siteSign({ date: '2026-10-25' })] }),
      'evidence.0.date',
    ],
    [
      'impossible calendar date',
      verifyBody({ evidence: [siteSign({ date: '2026-02-30' })] }),
      'evidence.0.date',
    ],
    [
      'evidence on an unresolved link',
      { expectedRevision: null, status: 'unresolved', buildingId: null, evidence: [siteSign()] },
      'evidence',
    ],
    ['verified on a building that does not exist', verifyBody({ buildingId: 'osm:way/1' }), 'buildingId'],
    [
      'approximate on a building that does not exist',
      { expectedRevision: null, status: 'approximate', buildingId: 'osm:way/1', evidence: [], note: 'n' },
      'buildingId',
    ],
    ['an unpublished studio id', verifyBody({ buildingId: `stu:${'a'.repeat(26)}` }), 'buildingId'],
    [
      'unresolved with a building',
      { expectedRevision: null, status: 'unresolved', buildingId: BUILDING, evidence: [] },
      'buildingId',
    ],
    ['verified without a building', verifyBody({ buildingId: null }), 'buildingId'],
  ])('%s → 422 with the field, audited as rejected, nothing stored', async (_label, body, path) => {
    const v0 = await pubVersion();
    const res = await put(SUBJECT, body);
    expect(res.status).toBe(422);
    const err = await json<{ error: { code: string; issues: { path: string }[] } }>(res);
    expect(err.error.code).toBe('invalid');
    expect(err.error.issues.map((i) => i.path)).toContain(path);
    expect(await t.count('artwork_associations')).toBe(0);
    expect(await pubVersion()).toBe(v0);
    const rows = await newAudit(SUBJECT);
    expect(rows.map((r) => [r.action, r.outcome])).toEqual([['artwork.put', 'rejected']]);
  });

  it.each([
    ['unknown key', verifyBody({ official: 'Block 34' })],
    ['bad status', verifyBody({ status: 'confirmed' })],
    ['bad evidence kind', verifyBody({ evidence: [{ ...siteSign(), kind: 'rumour' }] })],
    ['bad date format', verifyBody({ evidence: [siteSign({ date: '24/10/2026' })] })],
    ['javascript: URL', verifyBody({ evidence: [officialDoc({ url: 'javascript:alert(1)' })] })],
    ['missing expectedRevision', { status: 'unresolved', buildingId: null, evidence: [] }],
    ['not an object', [1, 2, 3]],
  ])('malformed body (%s) → 400, audited as rejected', async (_label, body) => {
    const res = await put(SUBJECT, body);
    expect(res.status).toBe(400);
    expect(await t.count('artwork_associations')).toBe(0);
    expect((await newAudit(SUBJECT)).map((r) => r.outcome)).toEqual(['rejected']);
  });

  it('accepts a published studio building, refuses a draft one', async () => {
    const c = studioClock();
    const { head } = studioBuildingDetailSchema.parse(
      await createStudioBuilding(t.db, { targetId: null, draft: newDraft() }, c.owner()),
    );
    const draftOnly = await put(SUBJECT, verifyBody({ buildingId: head.id }));
    expect(draftOnly.status).toBe(422);
    await publishStudioBuilding(t.db, head.id, publishBody(head.revision), c.owner());
    const ok = await put(SUBJECT, verifyBody({ buildingId: head.id }));
    expect(ok.status).toBe(200);
    expect((await json<View>(ok)).effective.buildingId).toBe(head.id);
  });
});

describe('optimistic concurrency (409)', () => {
  it('create when a decision exists, a stale revision, or an update after a reset → 409 with current; nothing written', async () => {
    expect((await put(SUBJECT, verifyBody())).status).toBe(200);
    const v1 = await pubVersion();
    const audit1 = (await newAudit(SUBJECT)).length;

    const again = await put(SUBJECT, verifyBody());
    expect(again.status).toBe(409);
    const body = await json<{ error: { code: string; details?: unknown } }>(again);
    expect(body.error.code).toBe('conflict');

    const stale = await put(SUBJECT, verifyBody({ expectedRevision: 7 }));
    expect(stale.status).toBe(409);

    const staleReset = await del(SUBJECT, { expectedRevision: 9 });
    expect(staleReset.status).toBe(409);

    const row = await t.rows<{ revision: number }>('artwork_associations');
    expect(row).toHaveLength(1);
    expect(row[0]!.revision).toBe(1);
    expect(await pubVersion()).toBe(v1);
    // Only rejected rows were added: no success trace of a stale write.
    const after = await newAudit(SUBJECT);
    expect(after.slice(audit1).map((r) => r.outcome)).toEqual(['rejected', 'rejected', 'rejected']);

    expect((await del(SUBJECT, { expectedRevision: 1 })).status).toBe(200);
    const afterReset = await put(SUBJECT, verifyBody({ expectedRevision: 1 }));
    expect(afterReset.status).toBe(409);
  });

  it('the conflict body carries the current decision so the UI can show it', async () => {
    expect((await put(SUBJECT, verifyBody())).status).toBe(200);
    const res = await put(SUBJECT, verifyBody({ expectedRevision: null }));
    // errorResponse adds details for authenticated callers.
    const err = await json<{ error: { details?: { current?: { revision?: number; subjectId?: string } } } }>(
      res,
    );
    expect(err.error.details?.current).toMatchObject({ subjectId: SUBJECT, revision: 1 });
  });
});

describe('DELETE: reset to the curated baseline', () => {
  it('removes the decision, audits it (before = the decision), bumps the publication, and the baseline applies again', async () => {
    const approx = approximateBaseline();
    expect((await put(approx.subjectId, verifyBody({ buildingId: approx.buildingId }))).status).toBe(200);
    const v1 = await pubVersion();
    const res = await del(approx.subjectId, { expectedRevision: 1 });
    expect(res.status).toBe(200);
    const view = await json<View>(res);
    expect(view.decision).toBeNull();
    expect(view.effective).toMatchObject({
      status: 'approximate',
      source: 'curated',
      unconfirmedMatchId: approx.buildingId,
    });
    expect(await pubVersion()).toBe(v1 + 1);
    expect((await publication(k)).body.artworkAssociations).toEqual([]);
    const rows = await newAudit(approx.subjectId);
    expect(rows.map((r) => [r.action, r.outcome])).toEqual([
      ['artwork.put', 'success'],
      ['artwork.reset', 'success'],
    ]);
    expect(JSON.parse(String(rows[1]!.before_json))).toMatchObject({
      status: 'verified',
      note: PRIVATE_NOTE,
    });
    expect(rows[1]!.after_json).toBeNull();
  });

  it('reset with nothing to reset → 404; malformed reset body → 400', async () => {
    expect((await del(SUBJECT, { expectedRevision: 1 })).status).toBe(404);
    expect((await del(SUBJECT, { expectedRevision: 0 })).status).toBe(400);
    expect((await del(SUBJECT, { expectedRevision: 1, extra: true })).status).toBe(400);
  });
});

describe('dates and clock', () => {
  it('evidence dated today (server UTC date) is accepted', async () => {
    const res = await put(SUBJECT, verifyBody({ evidence: [ownerStatement({ date: TODAY })] }));
    expect(res.status).toBe(200);
  });
});
