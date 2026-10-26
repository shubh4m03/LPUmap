/**
 * The admin route table (paths relative to /api/admin). Tests enumerate this
 * table, so every route added here is automatically covered by the
 * unauthenticated → 401 and not-configured → 503 checks.
 */
import type { z } from 'zod';
import type { Permission } from '../../auth/authorize.ts';
import type { HttpMethod } from '../../http/router.ts';
import { json } from '../../http/response.ts';
import type { DomainCtx, DomainPort } from '../ports.ts';
import { auditAs } from './audit-spec.ts';
import type { AdminCtx, AdminRoute } from './context.ts';
import {
  approveBody,
  auditQuery,
  createLocationBody,
  deleteLocationBody,
  duplicateBody,
  editSuggestionBody,
  locationsQuery,
  nullableRevisionBody,
  putOverrideBody,
  rejectBody,
  requestInfoBody,
  revertBody,
  revisionBody,
  suggestionsQuery,
  updateLocationBody,
} from './schemas.ts';
import { getSessionRoute, loginRoute, logoutRoute } from './session.ts';
import { ARTWORK_ROUTES } from './artwork-routes.ts';
import { STUDIO_ROUTES } from './studio-routes.ts';

const ok = (body: unknown, status = 200) => json(body, { status, cache: 'no-store' });

/** Route whose handler takes (domain, ctx) and needs the domain context (base data + actor). */
function read(
  method: HttpMethod,
  pattern: string,
  permission: Permission,
  call: (d: DomainPort, c: AdminCtx, ctx: DomainCtx) => Promise<unknown>,
): AdminRoute {
  return {
    method,
    pattern,
    handler: { permission, run: async (c) => ok(await call(c.domain, c, await c.domainCtx())) },
  };
}

/** Mutating route on an entity id: validates the body, then calls the domain with (id, body, ctx). */
function mutate<S extends z.ZodType>(
  method: HttpMethod,
  pattern: string,
  param: 'id' | 'locationId' | 'targetId',
  permission: Permission,
  schema: S,
  call: (d: DomainPort, c: AdminCtx, id: string, body: z.infer<S>, ctx: DomainCtx) => Promise<unknown>,
): AdminRoute {
  return {
    method,
    pattern,
    handler: {
      permission,
      run: async (c) => {
        const body = await c.body(schema);
        return ok(await call(c.domain, c, c.param(param), body, await c.domainCtx()));
      },
    },
  };
}

export const ADMIN_ROUTES: readonly AdminRoute[] = [
  { method: 'POST', pattern: '/session', handler: loginRoute },
  { method: 'GET', pattern: '/session', handler: getSessionRoute },
  { method: 'DELETE', pattern: '/session', handler: logoutRoute },

  read('GET', '/overview', 'admin:read', (d, c, ctx) => d.getOverview(c.db, ctx)),
  read('GET', '/quality', 'admin:read', (d, c, ctx) => d.getQualityWarnings(c.db, ctx)),

  {
    method: 'GET',
    pattern: '/suggestions',
    handler: {
      permission: 'admin:read',
      run: async (c) => {
        const q = c.query(suggestionsQuery);
        return ok(
          await c.domain.listSuggestions(c.db, {
            status: q.status,
            category: q.category,
            q: q.q,
            sort: q.sort,
            limit: q.limit,
            cursor: q.cursor,
          }),
        );
      },
    },
  },
  read('GET', '/suggestions/:id', 'admin:read', (d, c, ctx) => d.getSuggestion(c.db, c.param('id'), ctx)),
  auditAs(
    'suggestion.edit',
    'suggestion',
    mutate('PATCH', '/suggestions/:id', 'id', 'suggestions:review', editSuggestionBody, (d, c, id, b, ctx) =>
      d.editSuggestion(c.db, id, b, ctx),
    ),
  ),
  auditAs(
    'suggestion.approve',
    'suggestion',
    mutate('POST', '/suggestions/:id/approve', 'id', 'suggestions:review', approveBody, (d, c, id, b, ctx) =>
      d.approveSuggestion(c.db, id, b, ctx),
    ),
  ),
  auditAs(
    'suggestion.reject',
    'suggestion',
    mutate('POST', '/suggestions/:id/reject', 'id', 'suggestions:review', rejectBody, (d, c, id, b, ctx) =>
      d.rejectSuggestion(c.db, id, b, ctx),
    ),
  ),
  auditAs(
    'suggestion.duplicate',
    'suggestion',
    mutate(
      'POST',
      '/suggestions/:id/duplicate',
      'id',
      'suggestions:review',
      duplicateBody,
      (d, c, id, b, ctx) => d.markDuplicate(c.db, id, b, ctx),
    ),
  ),
  auditAs(
    'suggestion.request-info',
    'suggestion',
    mutate(
      'POST',
      '/suggestions/:id/request-info',
      'id',
      'suggestions:review',
      requestInfoBody,
      (d, c, id, b, ctx) => d.requestInformation(c.db, id, b, ctx),
    ),
  ),
  auditAs(
    'suggestion.reopen',
    'suggestion',
    mutate('POST', '/suggestions/:id/reopen', 'id', 'suggestions:review', revisionBody, (d, c, id, b, ctx) =>
      d.reopenSuggestion(c.db, id, b, ctx),
    ),
  ),

  {
    method: 'GET',
    pattern: '/locations',
    handler: {
      permission: 'admin:read',
      run: async (c) => {
        const q = c.query(locationsQuery);
        return ok(await c.domain.listLocations(c.db, { status: q.status, origin: q.origin, q: q.q }));
      },
    },
  },
  {
    method: 'POST',
    pattern: '/locations',
    handler: {
      permission: 'locations:write',
      audit: { action: 'location.create', entityType: 'location' },
      run: async (c) => {
        const body = await c.body(createLocationBody);
        return ok(await c.domain.createLocation(c.db, body, await c.domainCtx()), 201);
      },
    },
  },
  auditAs(
    'location.update',
    'location',
    mutate(
      'PATCH',
      '/locations/:locationId',
      'locationId',
      'locations:write',
      updateLocationBody,
      (d, c, id, b, ctx) => d.updateLocation(c.db, id, b, ctx),
    ),
  ),
  auditAs(
    'location.hide',
    'location',
    mutate(
      'POST',
      '/locations/:locationId/hide',
      'locationId',
      'locations:write',
      revisionBody,
      (d, c, id, b, ctx) => d.hideLocation(c.db, id, b, ctx),
    ),
  ),
  auditAs(
    'location.restore',
    'location',
    mutate(
      'POST',
      '/locations/:locationId/restore',
      'locationId',
      'locations:write',
      revisionBody,
      (d, c, id, b, ctx) => d.restoreLocation(c.db, id, b, ctx),
    ),
  ),
  auditAs(
    'location.delete',
    'location',
    mutate(
      'DELETE',
      '/locations/:locationId',
      'locationId',
      'locations:delete',
      deleteLocationBody,
      (d, c, id, b, ctx) => d.deleteLocation(c.db, id, b, ctx),
    ),
  ),

  read('GET', '/overrides', 'admin:read', (d, c, ctx) => d.listOverrides(c.db, ctx)),
  read('GET', '/overrides/:targetId', 'admin:read', (d, c, ctx) =>
    d.getOverride(c.db, c.param('targetId'), ctx),
  ),
  auditAs(
    'override.put',
    'override',
    mutate(
      'PUT',
      '/overrides/:targetId',
      'targetId',
      'overrides:write',
      putOverrideBody,
      (d, c, id, b, ctx) => d.putOverride(c.db, id, b, ctx),
    ),
  ),
  auditAs(
    'override.hide',
    'override',
    mutate(
      'POST',
      '/overrides/:targetId/hide',
      'targetId',
      'overrides:write',
      nullableRevisionBody,
      (d, c, id, b, ctx) => d.hideOverride(c.db, id, b, ctx),
    ),
  ),
  auditAs(
    'override.unhide',
    'override',
    mutate(
      'POST',
      '/overrides/:targetId/unhide',
      'targetId',
      'overrides:write',
      revisionBody,
      (d, c, id, b, ctx) => d.unhideOverride(c.db, id, b, ctx),
    ),
  ),
  auditAs(
    'override.delete',
    'override',
    mutate(
      'DELETE',
      '/overrides/:targetId',
      'targetId',
      'overrides:write',
      revisionBody,
      (d, c, id, b, ctx) => d.deleteOverride(c.db, id, b, ctx),
    ),
  ),

  {
    method: 'POST',
    pattern: '/revert',
    handler: {
      permission: 'audit:revert',
      audit: { action: 'audit.revert', entityType: 'system' },
      run: async (c) => {
        const { auditEventId } = await c.body(revertBody);
        return ok(await c.domain.revertAuditEvent(c.db, auditEventId, await c.domainCtx()));
      },
    },
  },
  {
    method: 'GET',
    pattern: '/audit',
    handler: {
      permission: 'audit:read',
      run: async (c) => {
        const q = c.query(auditQuery);
        return ok(
          await c.domain.listAudit(c.db, {
            entity: q.entity,
            entityId: q.entityId,
            action: q.action,
            limit: q.limit,
            cursor: q.cursor,
          }),
        );
      },
    },
  },

  // Artwork verification (/artwork/**): additive; no path overlaps another route.
  ...ARTWORK_ROUTES,
  // Building Studio (/studio/**): additive; the routes above are unchanged.
  ...STUDIO_ROUTES,
];
