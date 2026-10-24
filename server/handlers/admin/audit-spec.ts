/**
 * Audit tagging for admin write routes (see AdminAuditSpec in context.ts).
 * Kept apart from routes.ts so routes.ts and studio-routes.ts can both use it
 * without an import cycle.
 */
import type { AuditEntityType } from '../../db/records.ts';
import { PARAM_PATTERNS } from '../../http/router.ts';
import type { ParamName } from '../../http/router.ts';
import type { AdminRoute } from './context.ts';

const isParamName = (name: string): name is ParamName => Object.hasOwn(PARAM_PATTERNS, name);

/**
 * Tags a write route with the audit action/entity its domain operation uses,
 * so a body the HTTP layer rejects (413/415/400) is audited as 'rejected'
 * too. The entity id is the route's path parameter, if it has one.
 */
export function auditAs(action: string, entityType: AuditEntityType, r: AdminRoute): AdminRoute {
  const name = /:([A-Za-z]+)/.exec(r.pattern)?.[1];
  const param = name !== undefined && isParamName(name) ? name : undefined;
  return {
    ...r,
    handler: { ...r.handler, audit: { action, entityType, ...(param ? { param } : {}) } },
  };
}
