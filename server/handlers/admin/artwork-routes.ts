/**
 * Artwork verification admin routes (/api/admin/artwork/**,
 * docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §4.2; the table is
 * ARTWORK_ADMIN_ROUTE_SPECS in server/domain/artwork/associations.ts).
 * They run through the same dispatcher as every admin route (authentication,
 * Origin + CSRF on writes, permission, no-store). Write bodies are size- and
 * structure-bounded here, read BEFORE the manifest or base data is loaded,
 * and passed raw to the domain, which parses them inside its audit wrapper.
 */
import type { Permission } from '../../auth/authorize.ts';
import type { ArtworkDomainContext } from '../../domain/artwork/associations.ts';
import { ARTWORK_ADMIN_ROUTE_SPECS, ARTWORK_AUDIT_ACTIONS } from '../../domain/artwork/associations.ts';
import {
  buildingExistsIn,
  campusBuildingIdSet,
  publishedStudioBuildingIds,
} from '../../domain/artwork/buildings.ts';
import type { HttpMethod } from '../../http/router.ts';
import { json } from '../../http/response.ts';
import { loadArtManifestFor, loadStudioBaseFor } from '../deps.ts';
import type { ArtworkPort } from '../ports.ts';
import { auditAs } from './audit-spec.ts';
import type { AdminCtx, AdminRoute } from './context.ts';

const ok = (body: unknown) => json(body, { status: 200, cache: 'no-store' });

/** The artwork domain context: actor, clock, this deployment's manifest and the current campus building set. */
export async function artworkCtx(c: AdminCtx): Promise<ArtworkDomainContext> {
  if (!c.actor) throw new Error('artworkCtx requires an authenticated actor');
  const [manifest, studio, studioIds] = await Promise.all([
    loadArtManifestFor(c.request, c.env, c.deps),
    loadStudioBaseFor(c.request, c.env, c.deps),
    publishedStudioBuildingIds(c.db),
  ]);
  return {
    now: c.now,
    actor: c.actor.id,
    manifest,
    buildingExists: buildingExistsIn(campusBuildingIdSet(studio, studioIds)),
  };
}

const port = (c: AdminCtx): ArtworkPort => c.deps.services.artwork;

function route(
  method: HttpMethod,
  pattern: string,
  permission: Permission,
  run: (c: AdminCtx) => Promise<unknown>,
): AdminRoute {
  return { method, pattern, handler: { permission, run: async (c) => ok(await run(c)) } };
}

/** Write: bounded raw body first (rejections audited), then the context, then the domain. */
function write(
  method: HttpMethod,
  pattern: string,
  permission: Permission,
  call: (
    p: ArtworkPort,
    c: AdminCtx,
    subjectId: string,
    body: unknown,
    ctx: ArtworkDomainContext,
  ) => Promise<unknown>,
): AdminRoute {
  return route(method, pattern, permission, async (c) => {
    const body = await c.rawBody();
    return call(port(c), c, c.param('subjectId'), body, await artworkCtx(c));
  });
}

const [LIST, GET, PUT, RESET] = ARTWORK_ADMIN_ROUTE_SPECS;

export const ARTWORK_ROUTES: readonly AdminRoute[] = [
  route(LIST.method, LIST.pattern, LIST.permission, async (c) => port(c).list(c.db, await artworkCtx(c))),
  route(GET.method, GET.pattern, GET.permission, async (c) =>
    port(c).get(c.db, c.param('subjectId'), await artworkCtx(c)),
  ),
  auditAs(
    ARTWORK_AUDIT_ACTIONS.put,
    'artwork',
    write(PUT.method, PUT.pattern, PUT.permission, (p, c, id, b, ctx) => p.put(c.db, id, b, ctx)),
  ),
  auditAs(
    ARTWORK_AUDIT_ACTIONS.reset,
    'artwork',
    write(RESET.method, RESET.pattern, RESET.permission, (p, c, id, b, ctx) => p.reset(c.db, id, b, ctx)),
  ),
];
