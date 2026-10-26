/**
 * Route coverage: every server admin route (server/handlers/admin/routes.ts,
 * including every studio route) is reachable through exactly the client method
 * that targets it, with ids the server's router accepts (encoded segments).
 */
import { describe, expect, it } from 'vitest';
import { ADMIN_ROUTES } from '../../../server/handlers/admin/routes.ts';
import { STUDIO_ROUTES } from '../../../server/handlers/admin/studio-routes.ts';
import { Router } from '../../../server/http/router.ts';
import { createAdminApi } from '../../../src/admin/api/index.ts';
import { STU_ID } from '../building-studio/fixtures.ts';
import { json, mockFetch, OWN_ID, studioDetail, STV_ID, SUG_ID, TARGET } from './fetch-mock.ts';

const router = new Router(ADMIN_ROUTES);
const draft = studioDetail().draft!;

async function recordAll() {
  const m = mockFetch(json({}));
  const api = createAdminApi({ fetch: m.fetch });
  const c = api.community;
  const s = api.studio;
  const called: Record<string, () => Promise<unknown>> = {
    'community.overview': () => c.overview(),
    'community.quality': () => c.quality(),
    'community.listSuggestions': () => c.listSuggestions({ status: 'pending', sort: 'created_asc' }),
    'community.getSuggestion': () => c.getSuggestion(SUG_ID),
    'community.editSuggestion': () =>
      c.editSuggestion(SUG_ID, { revision: 1, fields: { description: null } }),
    'community.approveSuggestion': () =>
      c.approveSuggestion(SUG_ID, { revision: 1, accessPoint: { nodeId: 12 } }),
    'community.rejectSuggestion': () => c.rejectSuggestion(SUG_ID, { revision: 1 }),
    'community.markDuplicate': () => c.markDuplicate(SUG_ID, { revision: 1, duplicateOf: TARGET }),
    'community.requestInformation': () => c.requestInformation(SUG_ID, { revision: 1, note: 'Which floor?' }),
    'community.reopenSuggestion': () => c.reopenSuggestion(SUG_ID, { revision: 2 }),
    'community.listLocations': () => c.listLocations({ status: 'hidden' }),
    'community.createLocation': () =>
      c.createLocation({ fields: { name: 'Photocopy shop', categoryId: 'shop', location: [75.7, 31.25] } }),
    'community.updateLocation': () => c.updateLocation(OWN_ID, { revision: 1, fields: { website: null } }),
    'community.hideLocation': () => c.hideLocation(OWN_ID, { revision: 1 }),
    'community.restoreLocation': () => c.restoreLocation(OWN_ID, { revision: 2 }),
    'community.deleteLocation': () =>
      c.deleteLocation(OWN_ID, { revision: 3, confirmName: 'Photocopy shop' }),
    'community.listOverrides': () => c.listOverrides(),
    'community.getOverride': () => c.getOverride(TARGET),
    'community.putOverride': () =>
      c.putOverride(TARGET, { revision: null, fields: { name: 'Block 32' }, hidden: false }),
    'community.hideOverride': () => c.hideOverride(TARGET, { revision: null }),
    'community.unhideOverride': () => c.unhideOverride('cur:main-gate', { revision: 2 }),
    'community.deleteOverride': () => c.deleteOverride(TARGET, { revision: 3 }),
    'community.listAudit': () => c.listAudit({ entity: 'building', cursor: 40 }),
    'community.revert': () => c.revert(17),
    'studio.library': () => s.library(),
    'studio.createTemplate': () => s.createTemplate({} as never),
    'studio.updateTemplate': () => s.updateTemplate(STV_ID, { revision: 1, definition: {} as never }),
    'studio.retireTemplate': () => s.retireTemplate(STV_ID, { revision: 1 }),
    'studio.unretireTemplate': () => s.unretireTemplate(STV_ID, { revision: 2 }),
    'studio.listBuildings': () => s.listBuildings({ status: 'draft', targetId: TARGET }),
    'studio.getBuilding': () => s.getBuilding(STU_ID),
    'studio.createBuilding': () => s.createBuilding({ targetId: TARGET, draft }),
    'studio.saveDraft': () => s.saveDraft(STU_ID, { revision: 1, draft }),
    'studio.discardDraft': () => s.discardDraft(STU_ID, { revision: 2 }),
    'studio.validate': () => s.validate({ targetId: null, draft, recordId: null }),
    'studio.publish': () =>
      s.publish(STU_ID, { revision: 2, acknowledgements: [], changeSummary: 'First version' }),
    'studio.archive': () => s.archive(STU_ID, { revision: 3, reason: null }),
    'studio.restore': () => s.restore(STU_ID, { revision: 4, acknowledgements: [] }),
    'studio.deleteBuilding': () => s.deleteBuilding(STU_ID, { revision: 5, confirmId: STU_ID }),
    'studio.duplicate': () => s.duplicate(STU_ID, { offsetM: null }),
    'studio.applyTemplate': () =>
      s.applyTemplate(STU_ID, {
        revision: 1,
        templateId: 'hostel-block',
        templateVersion: 1,
        variantId: 'default',
        dryRun: true,
      }),
    'studio.quality': () => s.quality(),
    'artwork.listAssociations': () => api.artwork.listAssociations(),
    'artwork.getAssociation': () => api.artwork.getAssociation('art:num-25'),
    'artwork.putAssociation': () =>
      api.artwork.putAssociation('art:area-scene-pavilion', {
        expectedRevision: null,
        status: 'unresolved',
        buildingId: null,
        evidence: [],
      }),
    'artwork.resetAssociation': () => api.artwork.resetAssociation('art:num-21a', { expectedRevision: 2 }),
    'session.getSession': () => api.session.getSession(),
    'session.login': () => api.session.login('pw'),
    'session.logout': () => api.session.logout(),
  };
  const byName = new Map<string, { method: string; path: string; search: string }>();
  for (const [name, call] of Object.entries(called)) {
    const before = m.calls.length;
    await call();
    expect(m.calls.length, name).toBe(before + 1);
    const rec = m.calls[before]!;
    byName.set(name, { method: rec.method, path: rec.path, search: rec.search });
  }
  return { api, byName };
}

describe('admin API client covers every admin route', () => {
  it('calls every client method, each once', async () => {
    const { api, byName } = await recordAll();
    const methods = [
      ...Object.keys(api.community).map((k) => `community.${k}`),
      ...Object.keys(api.artwork).map((k) => `artwork.${k}`),
      ...Object.keys(api.studio).map((k) => `studio.${k}`),
      ...['getSession', 'login', 'logout'].map((k) => `session.${k}`),
    ].sort();
    expect([...byName.keys()].sort()).toEqual(methods);
  });

  it('every request matches a server route with valid ids, and every server route is used', async () => {
    const { byName } = await recordAll();
    const used = new Set<string>();
    for (const [name, rec] of byName) {
      expect(rec.path.startsWith('/api/admin/'), name).toBe(true);
      const match = router.match(rec.method, rec.path.slice('/api/admin'.length));
      expect(match.kind, `${name} → ${rec.method} ${rec.path}`).toBe('match');
      if (match.kind === 'match') used.add(`${match.route.method} ${match.route.pattern}`);
    }
    const all = ADMIN_ROUTES.map((r) => `${r.method} ${r.pattern}`).sort();
    expect([...used].sort()).toEqual(all);
    expect(all.filter((r) => r.includes(' /studio/'))).toHaveLength(STUDIO_ROUTES.length);
  });

  it('sends list filters as query parameters', async () => {
    const { byName } = await recordAll();
    expect(byName.get('community.listSuggestions')!.search).toBe('?status=pending&sort=created_asc');
    expect(byName.get('community.listAudit')!.search).toBe('?entity=building&cursor=40');
    expect(byName.get('studio.listBuildings')!.search).toBe(
      `?status=draft&targetId=${encodeURIComponent(TARGET)}`,
    );
  });

  it('reads the public health check outside /api/admin', async () => {
    const m = mockFetch(json({ ok: true, db: 'ok', auth: 'password' }));
    const r = await createAdminApi({ fetch: m.fetch }).session.health();
    expect(m.calls[0]!.path).toBe('/api/health');
    expect(r).toMatchObject({ ok: true, data: { auth: 'password' } });
  });
});
