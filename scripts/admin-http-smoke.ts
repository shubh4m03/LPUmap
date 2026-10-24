/**
 * Real-HTTP end-to-end smoke test of the community/admin backend against a
 * running `wrangler pages dev` (password auth mode, local D1 with migrations).
 *
 *   ADMIN_SMOKE_PASSWORD=<the test password> node scripts/admin-http-smoke.ts [baseUrl]
 *
 * Full local run (bash, from the repo root; STATE must be a SHORT, EMPTY dir —
 * on Windows a long --persist-to path pushes miniflare's D1 file past MAX_PATH
 * and wrangler fails with "internal error"):
 *   npx vite build --outDir "$OUT"
 *   PW=$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")
 *   printf 'AUTH_MODE=password\nOWNER_PASSWORD_HASH=%s\nRATE_LIMIT_KEY=%s\n' \
 *     "$(printf '%s' "$PW" | node scripts/admin-hash-password.ts)" \
 *     "$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")" > .dev.vars
 *   npx wrangler d1 migrations apply DB --local --persist-to "$STATE"
 *   npx wrangler pages dev "$OUT" --port 8790 --ip 127.0.0.1 --persist-to "$STATE" &
 *   ADMIN_SMOKE_PASSWORD="$PW" node scripts/admin-http-smoke.ts http://127.0.0.1:8790
 *   # then stop wrangler (and its workerd child) and delete .dev.vars
 *
 * After the community flow it runs the Building Studio flow (create draft →
 * save → validate → publish with an acknowledgement → public publication v2
 * → archive → gone → restore), then the hardening checks (schema-versioned
 * ETag, audited body rejections, prohibited-source and invisible-character
 * rules over real HTTP). The studio flow needs public/data served at /data/
 * (the vite build output includes it; for the API alone, a directory holding
 * a copy of public/data under data/ is enough).
 *
 * baseUrl defaults to http://127.0.0.1:8790. Use a FRESH local D1 state: the
 * script expects the login rate-limit bucket to be empty and asserts exact
 * publication-version deltas. It prints one line per step (status codes and
 * non-secret facts only: never the password, cookie, CSRF token or IPs) and
 * exits 1 on the first failed assertion.
 */
import { argv, env, exit, stdout } from 'node:process';

const BASE = (argv[2] ?? 'http://127.0.0.1:8790').replace(/\/+$/, '');
const PASSWORD = env.ADMIN_SMOKE_PASSWORD ?? '';
if (PASSWORD.length < 12) {
  stdout.write('ADMIN_SMOKE_PASSWORD (>= 12 chars) is required\n');
  exit(2);
}

type Json = Record<string, unknown>;
interface Res {
  status: number;
  headers: Headers;
  body: Json;
}

let step = 0;
function report(name: string, detail: string): void {
  step += 1;
  stdout.write(`[${String(step).padStart(2, '0')}] PASS ${name} — ${detail}\n`);
}
function check(cond: unknown, name: string, detail: string): asserts cond {
  if (!cond) {
    stdout.write(`[${String(step + 1).padStart(2, '0')}] FAIL ${name} — ${detail}\n`);
    exit(1);
  }
}

async function call(
  method: string,
  path: string,
  opts: {
    body?: unknown;
    raw?: string;
    cookie?: string;
    csrf?: string;
    origin?: boolean;
    headers?: Json;
  } = {},
): Promise<Res> {
  const headers = new Headers();
  if (opts.body !== undefined || opts.raw !== undefined) headers.set('Content-Type', 'application/json');
  if (opts.origin !== false && method !== 'GET') headers.set('Origin', BASE);
  if (opts.cookie) headers.set('Cookie', opts.cookie);
  if (opts.csrf) headers.set('X-CSRF-Token', opts.csrf);
  for (const [k, v] of Object.entries(opts.headers ?? {})) headers.set(k, String(v));
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    redirect: 'manual',
  });
  const text = await res.text();
  let body: Json = {};
  if (text) {
    try {
      body = JSON.parse(text) as Json;
    } catch {
      body = { nonJson: text.slice(0, 80) };
    }
  }
  return { status: res.status, headers: res.headers, body };
}

const errCode = (r: Res): string => String((r.body.error as Json | undefined)?.code ?? '-');
const ids = (r: Res): string[] => ((r.body.locations as Json[] | undefined) ?? []).map((l) => String(l.id));

async function main(): Promise<void> {
  // 1. Health
  const health = await call('GET', '/api/health');
  check(
    health.status === 200 && health.body.db === 'ok' && health.body.auth === 'password',
    'health',
    `status ${health.status} body ${JSON.stringify(health.body)}`,
  );
  report('health', `200 ${JSON.stringify(health.body)}`);

  const pub0 = await call('GET', '/api/locations');
  check(pub0.status === 200, 'publication baseline', `status ${pub0.status}`);
  const v0 = Number(pub0.body.publicationVersion);
  const etag0 = pub0.headers.get('ETag');
  report('publication baseline', `200 version=${v0} ETag=${etag0} locations=${ids(pub0).length}`);

  // 2. Public contribution — client tries to self-publish; must still be pending.
  const name = `Smoke Test Kiosk ${Date.now().toString(36)}`;
  const contrib = await call('POST', '/api/contributions/locations', {
    body: {
      name,
      categoryId: 'food',
      location: [75.7032, 31.2533],
      description: 'HTTP smoke test entry',
      status: 'approved',
      approved: true,
      isAdmin: true,
      publishedLocationId: 'com:evil',
    },
  });
  check(
    contrib.status === 201 && contrib.body.status === 'pending' && typeof contrib.body.reference === 'string',
    'contribution',
    `status ${contrib.status} body ${JSON.stringify(contrib.body)}`,
  );
  const reference = String(contrib.body.reference);
  report(
    'contribution',
    `201 status=pending reference=${reference} message="${String(contrib.body.message)}"`,
  );

  // 3. Not public yet
  const pub1 = await call('GET', '/api/locations');
  check(
    pub1.status === 200 &&
      Number(pub1.body.publicationVersion) === v0 &&
      !JSON.stringify(pub1.body).includes(name),
    'not published before approval',
    `version ${String(pub1.body.publicationVersion)}`,
  );
  report('not published before approval', `version still ${v0}, name absent`);

  // 4. Admin without a session → 401
  for (const [m, p] of [
    ['GET', '/api/admin/suggestions'],
    ['GET', '/api/admin/overview'],
    ['GET', '/api/admin/audit'],
    ['POST', `/api/admin/suggestions/${reference}/approve`],
  ] as const) {
    const r = await call(m, p, m === 'POST' ? { body: { revision: 1 } } : {});
    check(r.status === 401, `no session ${m} ${p}`, `status ${r.status} code ${errCode(r)}`);
    report(`no session ${m} ${p}`, `401 ${errCode(r)}`);
  }

  // 5. Login: wrong → 401, right → cookie + csrf, then exhaust the 5/15min window → 429.
  const wrong1 = await call('POST', '/api/admin/session', { body: { password: 'definitely-not-it-1' } });
  check(wrong1.status === 401, 'wrong password', `status ${wrong1.status}`);
  report('wrong password (attempt 1)', `401 ${errCode(wrong1)}`);

  const noOrigin = await call('POST', '/api/admin/session', { body: { password: PASSWORD }, origin: false });
  check(noOrigin.status === 403, 'login without Origin', `status ${noOrigin.status}`);
  report('login without Origin header', `403 ${errCode(noOrigin)} (rejected before rate limiting)`);

  const login = await call('POST', '/api/admin/session', { body: { password: PASSWORD } });
  const setCookie = login.headers.get('Set-Cookie') ?? '';
  check(
    login.status === 200 &&
      typeof login.body.csrfToken === 'string' &&
      setCookie.includes('__Host-atlas_session='),
    'login',
    `status ${login.status}`,
  );
  check(
    /HttpOnly/i.test(setCookie) && /Secure/i.test(setCookie) && /SameSite=Strict/i.test(setCookie),
    'cookie flags',
    'missing HttpOnly/Secure/SameSite=Strict',
  );
  const cookie = setCookie.split(';')[0]!;
  const csrf = String(login.body.csrfToken);
  report(
    'login (attempt 2)',
    `200 actor=${String(login.body.actor)} cookie HttpOnly;Secure;SameSite=Strict, csrf issued`,
  );

  const statuses: number[] = [];
  for (let i = 0; i < 3; i++) {
    statuses.push(
      (await call('POST', '/api/admin/session', { body: { password: `wrong-password-${i}` } })).status,
    );
  }
  check(
    statuses.every((s) => s === 401),
    'wrong passwords 3-5',
    statuses.join(','),
  );
  report('wrong password (attempts 3-5)', statuses.join(','));
  const limited = await call('POST', '/api/admin/session', { body: { password: 'wrong-password-x' } });
  check(
    limited.status === 429 && limited.headers.get('Retry-After'),
    'rate limited',
    `status ${limited.status}`,
  );
  report(
    'wrong password (attempt 6)',
    `429 ${errCode(limited)} Retry-After=${limited.headers.get('Retry-After')}`,
  );
  const limitedRight = await call('POST', '/api/admin/session', { body: { password: PASSWORD } });
  check(limitedRight.status === 429, 'correct password while locked', `status ${limitedRight.status}`);
  report('correct password while locked out', '429 (lockout not bypassed by a correct password)');

  const auth = { cookie };
  const sess = await call('GET', '/api/admin/session', auth);
  check(sess.status === 200 && sess.body.actor === 'owner', 'session', `status ${sess.status}`);
  report('GET session', `200 actor=owner mode=${String(sess.body.mode)}`);

  // 6. Moderation queue sees the pending suggestion
  const list = await call('GET', '/api/admin/suggestions?status=pending', auth);
  const items = (list.body.items as Json[] | undefined) ?? [];
  const sug = items.find((s) => s.id === reference);
  check(list.status === 200 && sug && sug.status === 'pending', 'list pending', `status ${list.status}`);
  check(
    sug.publishedLocationId === null && sug.reviewedBy === null,
    'client fields ignored',
    JSON.stringify(sug),
  );
  report(
    'list pending',
    `200 found ${reference} status=pending revision=${String(sug.revision)} publishedLocationId=null`,
  );
  const sugRev = Number(sug.revision);

  // 7. Approve without CSRF → 403; foreign Origin → 403; with CSRF → published
  const noCsrf = await call('POST', `/api/admin/suggestions/${reference}/approve`, {
    ...auth,
    body: { revision: sugRev },
  });
  check(
    noCsrf.status === 403 && errCode(noCsrf) === 'csrf',
    'approve without csrf',
    `status ${noCsrf.status}`,
  );
  report('approve without CSRF token', `403 ${errCode(noCsrf)}`);
  const foreign = await call('POST', `/api/admin/suggestions/${reference}/approve`, {
    ...auth,
    csrf,
    body: { revision: sugRev },
    headers: { Origin: 'https://evil.example' },
  });
  check(foreign.status === 403, 'approve foreign origin', `status ${foreign.status}`);
  report('approve with foreign Origin', `403 ${errCode(foreign)}`);

  const pubMid = await call('GET', '/api/locations');
  check(Number(pubMid.body.publicationVersion) === v0, 'still unpublished after rejected approvals', '');
  report('still unpublished after rejected approvals', `version ${v0}`);

  const approve = await call('POST', `/api/admin/suggestions/${reference}/approve`, {
    ...auth,
    csrf,
    body: { revision: sugRev },
  });
  const loc = approve.body.location as Json | undefined;
  check(
    approve.status === 200 && loc && typeof loc.id === 'string',
    'approve',
    `status ${approve.status} ${JSON.stringify(approve.body)}`,
  );
  const locId = String(loc.id);
  report(
    'approve with CSRF',
    `200 suggestion=${String((approve.body.suggestion as Json).status)} location=${locId} accessNodeId=${String(loc.accessNodeId)}`,
  );
  const again = await call('POST', `/api/admin/suggestions/${reference}/approve`, {
    ...auth,
    csrf,
    body: { revision: sugRev },
  });
  check(again.status === 409, 'approve twice', `status ${again.status}`);
  report('approve again with stale revision', `409 ${errCode(again)}`);

  // 8. Published, new ETag, conditional GET
  const pub2 = await call('GET', '/api/locations');
  const etag2 = pub2.headers.get('ETag');
  check(
    pub2.status === 200 &&
      ids(pub2).includes(locId) &&
      Number(pub2.body.publicationVersion) === v0 + 1 &&
      etag2 !== etag0,
    'published',
    `version ${String(pub2.body.publicationVersion)} etag ${etag2}`,
  );
  report(
    'GET /api/locations after approve',
    `200 contains ${locId}, version=${v0 + 1}, ETag ${etag0} -> ${etag2}, Cache-Control=${pub2.headers.get('Cache-Control')}`,
  );
  const cond = await call('GET', '/api/locations', { headers: { 'If-None-Match': etag2 ?? '' } });
  check(cond.status === 304, 'conditional GET', `status ${cond.status}`);
  report('conditional GET with current ETag', '304');

  // 9. Hide → gone; restore → back
  const hide = await call('POST', `/api/admin/locations/${locId}/hide`, {
    ...auth,
    csrf,
    body: { revision: Number(loc.revision) },
  });
  check(
    hide.status === 200 && hide.body.status === 'hidden',
    'hide',
    `status ${hide.status} ${JSON.stringify(hide.body)}`,
  );
  report('hide', `200 status=hidden revision=${String(hide.body.revision)}`);
  const pub3 = await call('GET', '/api/locations');
  check(
    !ids(pub3).includes(locId) && Number(pub3.body.publicationVersion) === v0 + 2,
    'hidden gone',
    ids(pub3).join(','),
  );
  report('GET /api/locations after hide', `absent, version=${v0 + 2}, ETag=${pub3.headers.get('ETag')}`);

  const restore = await call('POST', `/api/admin/locations/${locId}/restore`, {
    ...auth,
    csrf,
    body: { revision: Number(hide.body.revision) },
  });
  check(restore.status === 200 && restore.body.status === 'active', 'restore', `status ${restore.status}`);
  report('restore', `200 status=active revision=${String(restore.body.revision)}`);
  const pub4 = await call('GET', '/api/locations');
  check(
    ids(pub4).includes(locId) && Number(pub4.body.publicationVersion) === v0 + 3,
    'restored back',
    ids(pub4).join(','),
  );
  report('GET /api/locations after restore', `present, version=${v0 + 3}, ETag=${pub4.headers.get('ETag')}`);

  // 10. Audit lists each action with its actor
  const audit = await call('GET', '/api/admin/audit?limit=100', auth);
  const events = (audit.body.items as Json[] | undefined) ?? [];
  check(audit.status === 200, 'audit', `status ${audit.status}`);
  const want: [string, string, string][] = [
    ['suggestion.create', reference, 'public'],
    ['suggestion.approve', reference, 'owner'],
    ['location.create', locId, 'owner'],
    ['location.hide', locId, 'owner'],
    ['location.restore', locId, 'owner'],
  ];
  for (const [action, entityId, actor] of want) {
    const ev = events.find((e) => e.action === action && e.entityId === entityId && e.outcome === 'success');
    check(ev && ev.actor === actor, `audit ${action}`, `found ${JSON.stringify(ev ?? null)}`);
    report(`audit ${action}`, `event #${String(ev.id)} actor=${actor} entity=${entityId} outcome=success`);
  }
  const auditText = JSON.stringify(audit.body);
  check(!auditText.includes(PASSWORD) && !auditText.includes(csrf), 'audit leaks', 'secret found in audit');
  report('audit contains no password/CSRF token', `${events.length} events`);

  // 10b. Building Studio: login session → draft → save → validate → publish (warning needs an
  // acknowledgement) → public v2 → archive → gone → restore. The fixture is a generic illustrative
  // box on an empty on-campus spot; its private note must never reach the public publication.
  await studioFlow(auth.cookie, csrf, Number(pub4.body.publicationVersion));

  // 10c. Hardening (docs/BUILDING_STUDIO_DESIGN.md §5, §7, §10).
  await hardeningChecks(auth.cookie, csrf);

  // 11. Logout → 401 afterwards (cookie replay rejected)
  const logout = await call('DELETE', '/api/admin/session', { ...auth, csrf });
  check(
    logout.status === 200 && /Max-Age=0/.test(logout.headers.get('Set-Cookie') ?? ''),
    'logout',
    `status ${logout.status}`,
  );
  report('logout', '200, cookie cleared (Max-Age=0)');
  const after = await call('GET', '/api/admin/suggestions', auth);
  check(after.status === 401, 'replay after logout', `status ${after.status}`);
  report('replayed cookie after logout', `401 ${errCode(after)}`);

  stdout.write(`ALL ${step} STEPS PASSED against ${BASE}\n`);
}

/** An empty spot inside the campus boundary (tests/server/studio/helpers.ts SITE_A). */
const STUDIO_SITE = [75.7015, 31.2495];
const STUDIO_NOTE = 'SMOKE-PRIVATE-NOTE: never public';
const ACK = { code: 'height-floors-conflict', reason: 'Smoke test: tall ground floor on purpose' };

function studioDraft(heightM: number): Json {
  return {
    identity: {
      name: `Smoke Studio Pavilion ${Date.now().toString(36)}`,
      aliases: [],
      categoryId: 'building',
      subtype: null,
      description: null,
      notes: STUDIO_NOTE,
      directoryVisible: true,
    },
    model: {
      modelConfigVersion: 1,
      generatorId: 'box',
      generatorVersion: 1,
      anchor: STUDIO_SITE,
      rotationDeg: 0,
      widthM: 20,
      lengthM: 20,
      heightM,
      floors: 3,
      floorHeightM: 3.2,
      baseOffsetM: 0,
      shape: { kind: 'box' },
      roof: { shape: 'flat', colour: '#8a8a8a', material: 'concrete' },
      facade: {
        material: 'plaster',
        wallColour: '#d9d4c7',
        windowPattern: 'punched',
        windowDensity: 0.4,
        balconies: false,
        entranceSide: 'front',
      },
      detailLevel: 'facade',
    },
    verification: { status: 'unverified' },
    accessNodeId: null,
    templateRef: null,
    positionCorrection: null,
  };
}

const buildingIds = (r: Res): string[] =>
  ((r.body.buildings as Json[] | undefined) ?? []).map((b) => String(b.id));
const head = (r: Res): Json => ((r.body.building as Json | undefined)?.head ?? r.body.head ?? {}) as Json;

async function studioFlow(cookie: string, csrf: string, v: number): Promise<void> {
  const auth = { cookie };
  const lib = await call('GET', '/api/admin/studio/library', auth);
  const templates = (lib.body.templates as Json[] | undefined) ?? [];
  check(lib.status === 200 && templates.length >= 17, 'studio library', `status ${lib.status}`);
  report('studio library', `200 ${templates.length} templates`);

  const noCsrf = await call('POST', '/api/admin/studio/buildings', {
    ...auth,
    body: { targetId: null, draft: studioDraft(9.6) },
  });
  check(noCsrf.status === 403, 'studio create without CSRF', `status ${noCsrf.status}`);
  report('studio create without CSRF token', `403 ${errCode(noCsrf)}`);

  const footprint = await call('POST', '/api/admin/studio/buildings', {
    ...auth,
    csrf,
    body: {
      targetId: null,
      draft: { ...studioDraft(9.6), footprint: { type: 'Polygon', coordinates: [] } },
    },
  });
  check(footprint.status === 400, 'client footprint rejected', `status ${footprint.status}`);
  report(
    'studio create with a client footprint',
    `400 ${errCode(footprint)} (footprints are server-derived)`,
  );

  const created = await call('POST', '/api/admin/studio/buildings', {
    ...auth,
    csrf,
    body: { targetId: null, draft: studioDraft(9.6) },
  });
  const id = String(head(created).id ?? '');
  check(
    created.status === 201 && /^stu:[a-z2-7]{20,32}$/.test(id),
    'studio create',
    `status ${created.status}`,
  );
  report('studio create draft', `201 ${id} status=${String(head(created).status)} rev=1`);

  const saved = await call('PUT', `/api/admin/studio/buildings/${id}/draft`, {
    ...auth,
    csrf,
    body: { revision: 1, draft: studioDraft(15) },
  });
  check(saved.status === 200 && head(saved).draftRevision === 2, 'studio save', `status ${saved.status}`);
  report('studio save draft', `200 draftRevision=2 revision=${String(head(saved).revision)}`);

  const validated = await call('POST', '/api/admin/studio/validate', {
    ...auth,
    csrf,
    body: { targetId: null, recordId: id, draft: studioDraft(15) },
  });
  const required = (validated.body.requiredAcknowledgements as string[] | undefined) ?? [];
  check(
    validated.status === 200 && validated.body.errorCount === 0 && required.includes(ACK.code),
    'studio validate',
    `status ${validated.status} ${JSON.stringify(validated.body).slice(0, 200)}`,
  );
  report('studio validate (dry run)', `200 errors=0 warnings needing acknowledgement=${required.join(',')}`);

  const unacked = await call('POST', `/api/admin/studio/buildings/${id}/publish`, {
    ...auth,
    csrf,
    body: { revision: 2, acknowledgements: [], changeSummary: 'Smoke test publication' },
  });
  check(
    unacked.status === 422 && errCode(unacked) === 'validation-failed',
    'publish without acknowledgement',
    `status ${unacked.status}`,
  );
  report('studio publish without acknowledgement', `422 ${errCode(unacked)}`);

  const pub = await call('POST', `/api/admin/studio/buildings/${id}/publish`, {
    ...auth,
    csrf,
    body: { revision: 2, acknowledgements: [ACK], changeSummary: 'Smoke test publication' },
  });
  check(
    pub.status === 200 && Number(pub.body.publicationVersion) === v + 1,
    'studio publish',
    `status ${pub.status} ${JSON.stringify(pub.body).slice(0, 200)}`,
  );
  report('studio publish with acknowledgement', `200 version=1 publicationVersion=${v + 1}`);

  const live = await call('GET', '/api/locations');
  const liveText = JSON.stringify(live.body);
  check(
    live.status === 200 &&
      live.body.schemaVersion === 2 &&
      buildingIds(live).includes(id) &&
      !liveText.includes(STUDIO_NOTE) &&
      !liveText.includes(ACK.reason),
    'public publication v2',
    `status ${live.status}`,
  );
  report(
    'GET /api/locations after studio publish',
    `200 schemaVersion=2 buildings include ${id}; private note and acknowledgement absent; ETag=${live.headers.get('ETag')}`,
  );

  const archived = await call('POST', `/api/admin/studio/buildings/${id}/archive`, {
    ...auth,
    csrf,
    body: { revision: 3, reason: 'Smoke test archive' },
  });
  check(
    archived.status === 200 && head(archived).status === 'archived',
    'studio archive',
    `status ${archived.status}`,
  );
  const gone = await call('GET', '/api/locations');
  check(
    !buildingIds(gone).includes(id) && Number(gone.body.publicationVersion) === v + 2,
    'archived gone',
    buildingIds(gone).join(','),
  );
  report('studio archive', `200; GET /api/locations: ${id} absent, version=${v + 2}`);

  const restored = await call('POST', `/api/admin/studio/buildings/${id}/restore`, {
    ...auth,
    csrf,
    body: { revision: 4, acknowledgements: [ACK] },
  });
  check(
    restored.status === 200 && head(restored).status === 'published',
    'studio restore',
    `status ${restored.status}`,
  );
  const back = await call('GET', '/api/locations');
  check(
    buildingIds(back).includes(id) && Number(back.body.publicationVersion) === v + 3,
    'restored back',
    buildingIds(back).join(','),
  );
  report('studio restore', `200 status=published; GET /api/locations: ${id} present, version=${v + 3}`);

  const audit = await call(
    'GET',
    `/api/admin/audit?entity=building&entityId=${encodeURIComponent(id)}`,
    auth,
  );
  const actions = ((audit.body.items as Json[] | undefined) ?? [])
    .map((e) => `${String(e.action)}:${String(e.outcome)}`)
    .reverse();
  const expected = [
    'building.create:success',
    'building.save-draft:success',
    'building.publish:rejected',
    'building.publish:success',
    'building.archive:success',
    'building.restore:success',
  ];
  check(
    audit.status === 200 && JSON.stringify(actions) === JSON.stringify(expected),
    'studio audit',
    actions.join(','),
  );
  report('studio audit trail', actions.join(' → '));
}

/** The newest audit event for `action`, read through the admin API. */
async function newestAudit(cookie: string, action: string): Promise<Json | null> {
  const r = await call('GET', `/api/admin/audit?action=${encodeURIComponent(action)}&limit=1`, { cookie });
  check(r.status === 200, `audit ${action}`, `status ${r.status}`);
  return ((r.body.items as Json[] | undefined) ?? [])[0] ?? null;
}

async function hardeningChecks(cookie: string, csrf: string): Promise<void> {
  const auth = { cookie, csrf };

  // ETag carries the publication schema version; a schema-less validator never gets a false 304.
  const pub = await call('GET', '/api/locations');
  const etag = pub.headers.get('ETag') ?? '';
  const n = Number(pub.body.publicationVersion);
  check(
    pub.status === 200 && etag === `W/"pub-v${String(pub.body.schemaVersion)}-${n}"`,
    'schema-versioned ETag',
    `ETag ${etag}`,
  );
  const old = await call('GET', '/api/locations', { headers: { 'If-None-Match': `W/"pub-${n}"` } });
  const same = await call('GET', '/api/locations', { headers: { 'If-None-Match': etag } });
  check(
    old.status === 200 && same.status === 304,
    'ETag validators',
    `old ${old.status} current ${same.status}`,
  );
  report('ETag', `${etag}; schema-less W/"pub-${n}" → 200, current → 304`);

  // A body rejected while being read is audited as 'rejected' for the session actor (never the body).
  const bad = await call('POST', '/api/admin/locations', { ...auth, raw: '{"fields": SMOKE-BODY' });
  check(bad.status === 400, 'malformed JSON', `status ${bad.status}`);
  const ev = await newestAudit(cookie, 'location.create');
  check(
    ev !== null &&
      ev.outcome === 'rejected' &&
      ev.actor === 'owner' &&
      String(ev.detail).startsWith('invalid (HTTP 400)') &&
      !JSON.stringify(ev).includes('SMOKE-BODY'),
    'malformed JSON audited',
    JSON.stringify(ev),
  );
  report('malformed JSON body', `400; audit #${String(ev.id)} location.create rejected actor=owner`);

  const wrongType = await call('POST', '/api/admin/studio/buildings', {
    ...auth,
    raw: '{}',
    headers: { 'Content-Type': 'text/plain' },
  });
  check(wrongType.status === 415, 'wrong content type', `status ${wrongType.status}`);
  const ev415 = await newestAudit(cookie, 'building.create');
  check(
    ev415 !== null && ev415.outcome === 'rejected' && String(ev415.detail).startsWith('invalid (HTTP 415)'),
    'wrong content type audited',
    JSON.stringify(ev415),
  );
  report('text/plain body', `415; audit #${String(ev415.id)} building.create rejected`);

  // Prohibited sources in free text (trailing-dot host, Maps photo) and invisible characters in names.
  const base = studioDraft(9.6);
  const identity = base.identity as Json;
  const cases: [string, Json][] = [
    [
      'description citing www.google.com./maps',
      { ...identity, description: 'From www.google.com./maps/place/x' },
    ],
    [
      'notes citing a Google Maps photo',
      { ...identity, notes: 'Photo lh3.googleusercontent.com/p/AF1QipSmoke' },
    ],
    ['name with a zero-width space', { ...identity, name: 'Smoke\u200bPavilion' }],
    ['alias with U+2028', { ...identity, aliases: ['Block\u202834'] }],
  ];
  for (const [label, id] of cases) {
    const r = await call('POST', '/api/admin/studio/buildings', {
      ...auth,
      body: { targetId: null, draft: { ...base, identity: id } },
    });
    check(r.status === 400 && errCode(r) === 'invalid', label, `status ${r.status}`);
    report(`studio create with ${label}`, `400 ${errCode(r)}`);
  }
}

main().catch((err: unknown) => {
  stdout.write(`FAIL unexpected error: ${err instanceof Error ? err.message : 'unknown'}\n`);
  exit(1);
});
