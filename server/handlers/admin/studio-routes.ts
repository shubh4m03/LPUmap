/**
 * Building Studio admin routes (/api/admin/studio/**, docs/BUILDING_STUDIO_DESIGN.md §7).
 * They run through the same dispatcher as every admin route (authentication,
 * Origin + CSRF on writes, permission, no-store). Bodies are size- and
 * structure-bounded here and passed raw to the studio domain, which parses
 * them with the strict schemas inside its audit wrapper.
 */
import type { Permission } from '../../auth/authorize.ts';
import type { StudioContext } from '../../domain/studio/context.ts';
import type { HttpMethod, ParamName } from '../../http/router.ts';
import { json } from '../../http/response.ts';
import type { StudioPort } from '../ports.ts';
import type { AdminCtx, AdminRoute } from './context.ts';

const ok = (body: unknown, status = 200) => json(body, { status, cache: 'no-store' });

type Call = (s: StudioPort, c: AdminCtx, ctx: StudioContext) => Promise<unknown>;

function route(
  method: HttpMethod,
  pattern: string,
  permission: Permission,
  call: Call,
  status = 200,
): AdminRoute {
  return {
    method,
    pattern: `/studio${pattern}`,
    handler: {
      permission,
      run: async (c) => ok(await call(c.deps.services.studio, c, await c.studioCtx()), status),
    },
  };
}

/** Write on an entity: bounded raw body → (id, body, ctx). The body is read before any base data is loaded. */
function write(
  method: HttpMethod,
  pattern: string,
  param: ParamName,
  permission: Permission,
  call: (s: StudioPort, c: AdminCtx, id: string, body: unknown, ctx: StudioContext) => Promise<unknown>,
  status = 200,
): AdminRoute {
  return {
    method,
    pattern: `/studio${pattern}`,
    handler: {
      permission,
      run: async (c) => {
        const body = await c.rawStudioBody();
        return ok(await call(c.deps.services.studio, c, c.param(param), body, await c.studioCtx()), status);
      },
    },
  };
}

/** Write without an entity id (create, validate). */
function post(
  pattern: string,
  permission: Permission,
  call: (s: StudioPort, c: AdminCtx, body: unknown, ctx: StudioContext) => Promise<unknown>,
  status = 200,
): AdminRoute {
  return {
    method: 'POST',
    pattern: `/studio${pattern}`,
    handler: {
      permission,
      run: async (c) => {
        const body = await c.rawStudioBody();
        return ok(await call(c.deps.services.studio, c, body, await c.studioCtx()), status);
      },
    },
  };
}

export const STUDIO_ROUTES: readonly AdminRoute[] = [
  route('GET', '/library', 'admin:read', (s, c, ctx) => s.getLibrary(c.db, ctx)),
  post('/templates', 'studio:templates', (s, c, b, ctx) => s.createTemplate(c.db, b, ctx), 201),
  write('PUT', '/templates/:templateId', 'templateId', 'studio:templates', (s, c, id, b, ctx) =>
    s.updateTemplate(c.db, id, b, ctx),
  ),
  write('POST', '/templates/:templateId/retire', 'templateId', 'studio:templates', (s, c, id, b, ctx) =>
    s.retireTemplate(c.db, id, b, ctx),
  ),
  write('POST', '/templates/:templateId/unretire', 'templateId', 'studio:templates', (s, c, id, b, ctx) =>
    s.unretireTemplate(c.db, id, b, ctx),
  ),

  route('GET', '/buildings', 'admin:read', (s, c, ctx) => s.listBuildings(c.db, c.rawQuery(), ctx)),
  route('GET', '/buildings/:buildingId', 'admin:read', (s, c, ctx) =>
    s.getBuilding(c.db, c.param('buildingId'), ctx),
  ),
  post('/buildings', 'studio:write', (s, c, b, ctx) => s.createBuilding(c.db, b, ctx), 201),
  write('PUT', '/buildings/:buildingId/draft', 'buildingId', 'studio:write', (s, c, id, b, ctx) =>
    s.saveDraft(c.db, id, b, ctx),
  ),
  write('DELETE', '/buildings/:buildingId/draft', 'buildingId', 'studio:write', (s, c, id, b, ctx) =>
    s.discardDraft(c.db, id, b, ctx),
  ),
  post('/validate', 'admin:read', (s, c, b, ctx) => s.validate(c.db, b, ctx)),
  write('POST', '/buildings/:buildingId/publish', 'buildingId', 'studio:publish', (s, c, id, b, ctx) =>
    s.publish(c.db, id, b, ctx),
  ),
  write('POST', '/buildings/:buildingId/archive', 'buildingId', 'studio:write', (s, c, id, b, ctx) =>
    s.archive(c.db, id, b, ctx),
  ),
  write('POST', '/buildings/:buildingId/restore', 'buildingId', 'studio:publish', (s, c, id, b, ctx) =>
    s.restore(c.db, id, b, ctx),
  ),
  write('DELETE', '/buildings/:buildingId', 'buildingId', 'studio:delete', (s, c, id, b, ctx) =>
    s.deleteBuilding(c.db, id, b, ctx),
  ),
  write(
    'POST',
    '/buildings/:buildingId/duplicate',
    'buildingId',
    'studio:write',
    (s, c, id, b, ctx) => s.duplicate(c.db, id, b, ctx),
    201,
  ),
  write('POST', '/buildings/:buildingId/apply-template', 'buildingId', 'studio:write', (s, c, id, b, ctx) =>
    s.applyTemplate(c.db, id, b, ctx),
  ),
  route('GET', '/quality', 'admin:read', (s, c, ctx) => s.getQuality(c.db, ctx)),
];
