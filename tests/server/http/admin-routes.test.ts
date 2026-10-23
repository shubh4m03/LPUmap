/**
 * End-to-end wiring of every admin route: HTTP request → schema → domain → D1,
 * verified through the public publication and the audit log.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetJwksCache } from '../../../server/auth/access.ts';
import { resetSaltMemo } from '../../../server/auth/salt.ts';
import type { Env } from '../../../server/env.ts';
import { handleAdmin } from '../../../server/handlers/admin/index.ts';
import { handleContribution } from '../../../server/handlers/contributions.ts';
import { handlePublication } from '../../../server/handlers/publication.ts';
import { publicationSchema } from '../../../src/community/schema.ts';
import type { Publication } from '../../../src/community/schema.ts';
import { accessEnvVars, claims, jwksFetch, makeKey, sign } from '../auth/jwt-fixtures.ts';
import type { TestKey } from '../auth/jwt-fixtures.ts';
import { ON_CAMPUS, RATE_KEY, errorCode, fileAssets, makeDeps, req, validSuggestion } from './fixtures.ts';
import { createTestDb, resetTables } from './harness.ts';
import type { TestDb } from './harness.ts';

let t: TestDb;
let env: Env;
let key: TestKey;
const now = new Date('2026-10-24T07:00:00.000Z');
const TARGET = 'cur:central-library';
const TARGET_PATH = `/overrides/${encodeURIComponent(TARGET)}`;

beforeAll(async () => {
  t = await createTestDb();
  key = await makeKey('k1');
  env = { DB: t.db, ASSETS: fileAssets, RATE_LIMIT_KEY: RATE_KEY, ...accessEnvVars };
});
afterAll(async () => t.dispose());
beforeEach(async () => {
  await resetTables(t.db);
  resetSaltMemo();
  resetJwksCache();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

const deps = () => makeDeps({ env, now: () => now, fetch: jwksFetch([key]) });
async function admin(method: string, path: string, body?: unknown) {
  const res = await handleAdmin(
    req(method, `/api/admin${path}`, {
      headers: { 'Cf-Access-Jwt-Assertion': await sign(key, claims(now)) },
      ...(body !== undefined ? { body } : {}),
    }),
    deps(),
  );
  return { res, status: res.status, json: (await res.clone().json()) as Record<string, unknown> };
}
const pub = async (): Promise<Publication> =>
  publicationSchema.parse(await (await handlePublication(req('GET', '/api/locations'), deps())).json());

const ownerFields = (over: Record<string, unknown> = {}) => ({
  name: 'Night Canteen',
  categoryId: 'food',
  location: ON_CAMPUS,
  wheelchair: 'yes',
  verificationStatus: 'verified',
  openingHours: '20:00-02:00',
  ...over,
});

describe('owner locations via HTTP', () => {
  it('create → patch (partial) → hide → restore → hide → delete, all reflected publicly', async () => {
    const created = await admin('POST', '/locations', {
      fields: ownerFields(),
      isAdmin: true,
      createdBy: 'mallory',
    });
    expect(created.status).toBe(201);
    const loc = created.json as { id: string; revision: number; createdBy: string };
    expect(loc.id).toMatch(/^own:[a-z2-7]{26}$/);
    expect(loc.createdBy).toBe('owner@example.org');
    expect((await pub()).locations.map((l) => l.id)).toEqual([loc.id]);

    // Partial PATCH must keep wheelchair/verification (no schema defaults) and null clears openingHours.
    const patched = await admin('PATCH', `/locations/${loc.id}`, {
      revision: 1,
      fields: { name: 'Night Canteen (Block 34)', openingHours: null },
    });
    expect(patched.status).toBe(200);
    const pl = (await pub()).locations[0]!;
    expect(pl).toMatchObject({
      name: 'Night Canteen (Block 34)',
      wheelchair: 'yes',
      verificationStatus: 'verified',
    });
    expect(pl.openingHours).toBeUndefined();

    const stale = await admin('PATCH', `/locations/${loc.id}`, {
      revision: 1,
      fields: { name: 'Lost update' },
    });
    expect(stale.status).toBe(409);
    expect(await errorCode(stale.res)).toBe('conflict');

    expect((await admin('POST', `/locations/${loc.id}/hide`, { revision: 2 })).status).toBe(200);
    expect((await pub()).locations).toEqual([]);
    const hidden = await admin('GET', '/locations?status=hidden');
    expect((hidden.json.items as Array<{ id: string }>).map((l) => l.id)).toEqual([loc.id]);
    expect((await admin('POST', `/locations/${loc.id}/restore`, { revision: 3 })).status).toBe(200);
    expect((await pub()).locations).toHaveLength(1);
    expect((await admin('POST', `/locations/${loc.id}/hide`, { revision: 4 })).status).toBe(200);

    const wrongName = await admin('DELETE', `/locations/${loc.id}`, {
      revision: 5,
      confirmName: 'Night Canteen',
    });
    expect(wrongName.status).toBe(400);
    expect(await errorCode(wrongName.res)).toBe('invalid');
    expect(await t.count('locations')).toBe(1);
    const del = await admin('DELETE', `/locations/${loc.id}`, {
      revision: 5,
      confirmName: 'Night Canteen (Block 34)',
    });
    expect(del.status).toBe(200);
    expect(await t.count('locations')).toBe(0);
  });

  it('rejects an access point that is not a real walkable graph node (no fabricated routing)', async () => {
    const res = await admin('POST', '/locations', {
      fields: ownerFields(),
      accessPoint: { nodeId: 99_999_999 },
    });
    expect(res.status).toBe(422);
    expect((res.json.error as { issues: Array<{ path: string }> }).issues[0]!.path).toBe(
      'accessPoint.nodeId',
    );
    expect(await t.count('locations')).toBe(0);
  });

  it('revert restores the before snapshot of an edit as a new revision', async () => {
    const created = await admin('POST', '/locations', { fields: ownerFields() });
    const id = (created.json as { id: string }).id;
    await admin('PATCH', `/locations/${id}`, { revision: 1, fields: { name: 'Renamed Canteen' } });
    const audit = await admin('GET', `/audit?entity=location&entityId=${encodeURIComponent(id)}`);
    const items = audit.json.items as Array<{ id: number; action: string; outcome: string }>;
    const edit = items.find((e) => e.action === 'location.update' && e.outcome === 'success')!;
    expect(edit).toBeDefined();
    const rev = await admin('POST', '/revert', { auditEventId: edit.id });
    expect(rev.status).toBe(200);
    const l = (await pub()).locations.find((x) => x.id === id)!;
    expect(l.name).toBe('Night Canteen');
    expect(l.revision).toBe(3);
  });
});

describe('overrides of base places via HTTP', () => {
  it('put → hide → unhide → delete; publication follows; unknown base id → 404', async () => {
    const put = await admin('PUT', TARGET_PATH, {
      revision: null,
      fields: { name: 'Central Library (Main Reading Hall)' },
      hidden: false,
      note: 'private reviewer note',
    });
    expect(put.status).toBe(200);
    let p = await pub();
    expect(p.overrides).toHaveLength(1);
    expect(p.overrides[0]).toMatchObject({ targetId: TARGET, hidden: false });
    expect(JSON.stringify(p)).not.toContain('private reviewer note');

    const got = await admin('GET', TARGET_PATH);
    expect(got.status).toBe(200);
    expect(await admin('GET', '/overrides')).toMatchObject({ status: 200 });

    expect((await admin('POST', `${TARGET_PATH}/hide`, { revision: 1 })).status).toBe(200);
    p = await pub();
    expect(p.overrides[0]!.hidden).toBe(true);
    expect((await admin('POST', `${TARGET_PATH}/unhide`, { revision: 2 })).status).toBe(200);
    expect((await admin('DELETE', TARGET_PATH, { revision: 3 })).status).toBe(200);
    expect((await pub()).overrides).toEqual([]);

    const unknown = await admin('PUT', `/overrides/${encodeURIComponent('osm:way/1')}`, {
      revision: null,
      fields: { name: 'Ghost' },
      hidden: false,
    });
    expect(unknown.status).toBe(404);
    expect(await t.count('overrides')).toBe(0);
  });
});

describe('suggestion moderation + read-only views via HTTP', () => {
  async function submit(over: Record<string, unknown> = {}) {
    const res = await handleContribution(
      req('POST', '/api/contributions/locations', {
        body: validSuggestion({ landmark: 'Near gate 2', ...over }),
        ip: '192.0.2.8',
      }),
      deps(),
    );
    return ((await res.json()) as { reference: string }).reference;
  }

  it('list/get/edit (null clears)/request-info/reopen/duplicate/reject', async () => {
    const id = await submit();
    const list = await admin('GET', '/suggestions?status=pending&sort=created_asc&limit=10');
    expect((list.json.items as Array<{ id: string }>).map((s) => s.id)).toEqual([id]);
    const one = await admin('GET', `/suggestions/${id}`);
    expect(one.json).toHaveProperty('possibleDuplicates');
    expect(one.json).toHaveProperty('history');

    const edit = await admin('PATCH', `/suggestions/${id}`, {
      revision: 1,
      fields: { name: 'Quiet Study Room', landmark: null },
    });
    expect(edit.status).toBe(200);
    const row = (await t.db
      .prepare('SELECT name, landmark, status FROM suggestions WHERE id = ?')
      .bind(id)
      .first())!;
    expect(row).toEqual({ name: 'Quiet Study Room', landmark: null, status: 'pending' });

    expect(
      (await admin('POST', `/suggestions/${id}/request-info`, { revision: 2, note: 'Which floor?' })).status,
    ).toBe(200);
    expect((await admin('POST', `/suggestions/${id}/reopen`, { revision: 3 })).status).toBe(200);
    expect(
      (await admin('POST', `/suggestions/${id}/duplicate`, { revision: 4, duplicateOf: TARGET })).status,
    ).toBe(200);
    expect((await admin('POST', `/suggestions/${id}/reopen`, { revision: 5 })).status).toBe(200);
    expect(
      (await admin('POST', `/suggestions/${id}/reject`, { revision: 6, reason: 'Not a real place' })).status,
    ).toBe(200);
    const final = (await t.db.prepare('SELECT status FROM suggestions WHERE id = ?').bind(id).first())!;
    expect(final.status).toBe('rejected');
    expect(await t.count('locations')).toBe(0);
    expect((await pub()).locations).toEqual([]);
  });

  it('approve with partial owner corrections publishes the corrected record', async () => {
    const id = await submit();
    const res = await admin('POST', `/suggestions/${id}/approve`, {
      revision: 1,
      fields: { name: 'Study Corner B' },
    });
    expect(res.status).toBe(200);
    expect((await pub()).locations.map((l) => l.name)).toEqual(['Study Corner B']);
  });

  it('overview, quality and audit respond', async () => {
    await submit();
    const overview = await admin('GET', '/overview');
    expect(overview.status).toBe(200);
    expect(JSON.stringify(overview.json)).toContain('pending');
    expect((await admin('GET', '/quality')).status).toBe(200);
    const audit = await admin('GET', '/audit?limit=5');
    expect(audit.status).toBe(200);
    expect(Array.isArray(audit.json.items)).toBe(true);
    expect((await admin('GET', '/audit?cursor=abc')).status).toBe(400);
    expect((await admin('GET', '/suggestions?status=approved&status=pending')).status).toBe(400);
  });
});
