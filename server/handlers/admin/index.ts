/**
 * /api/admin/** dispatcher. Order of checks (each fails closed):
 *   1. auth configuration valid            → else 503 not-configured
 *   2. database bound                       → else 503 unavailable
 *   3. route lookup (ids regex-validated before any DB access)
 *   4. authentication (except login)        → 401 — before 404/405 so
 *      unauthenticated callers cannot enumerate routes
 *   5. unknown path 404 / wrong method 405 / malformed id 400
 *   6. mutating: same-origin Origin (403 csrf), password mode X-CSRF-Token
 *   7. authorization (permission)           → 403
 *   8. handler: JSON content type (415), body ≤ 32 KB (413), schema (400)
 */
import { authenticate } from '../../auth/authenticate.ts';
import { authorize } from '../../auth/authorize.ts';
import type { Actor } from '../../auth/authorize.ts';
import { checkCsrf } from '../../auth/session.ts';
import { parseEnv } from '../../env.ts';
import { HttpError } from '../../http/errors.ts';
import { log } from '../../http/log.ts';
import { MUTATING_METHODS, checkSameOrigin } from '../../http/origin.ts';
import { errorResponse, methodNotAllowed } from '../../http/response.ts';
import { ROUTER_METHODS, Router } from '../../http/router.ts';
import { fetchOf, nowOf } from '../deps.ts';
import type { HandlerDeps } from '../deps.ts';
import { AdminCtx } from './context.ts';
import type { AdminHandler } from './context.ts';
import { ADMIN_ROUTES } from './routes.ts';

export const ADMIN_PREFIX = '/api/admin';
export const adminRouter = new Router<AdminHandler>(ADMIN_ROUTES);

export async function handleAdmin(request: Request, deps: HandlerDeps): Promise<Response> {
  const started = Date.now();
  const method = request.method.toUpperCase();
  let routeLabel = 'unmatched';
  let actor: Actor | null = null;
  let res: Response;
  try {
    const pathname = new URL(request.url).pathname;
    if (pathname !== ADMIN_PREFIX && !pathname.startsWith(`${ADMIN_PREFIX}/`)) {
      throw new HttpError('not-found', 'Not found');
    }
    // OPTIONS (CORS preflight), HEAD, TRACE…: never served — same-origin JSON API only.
    if (!ROUTER_METHODS.has(method)) throw methodNotAllowed([...ROUTER_METHODS]);
    const env = parseEnv(deps.env);
    if (env.auth.mode === 'not-configured') {
      throw new HttpError('not-configured', 'Administration is not configured');
    }
    if (!env.db) throw new HttpError('unavailable', 'Database is unavailable');
    const db = env.db;
    const now = nowOf(deps);

    const match = adminRouter.match(method, pathname.slice(ADMIN_PREFIX.length));
    if (match.kind === 'match') routeLabel = match.route.pattern;
    const handler = match.kind === 'match' ? match.route.handler : null;

    if (handler?.permission !== null) {
      actor = await authenticate(request, env.auth, {
        db,
        sessions: deps.services.sessions,
        fetch: fetchOf(deps),
        now,
      });
    }
    if (match.kind === 'not-found') throw new HttpError('not-found', 'Not found');
    if (match.kind === 'invalid-param') throw new HttpError('invalid', 'Invalid identifier in path');
    if (match.kind === 'method-not-allowed') throw methodNotAllowed(match.allowed);

    if (actor) {
      if (MUTATING_METHODS.has(method)) {
        checkSameOrigin(request, env.publicOrigin, { requireOrigin: true });
        if (actor.session) checkCsrf(request, actor.session);
      }
      authorize(actor, match.route.handler.permission!);
    }

    const ctx = new AdminCtx({ request, params: match.params, env, db, deps, now, actor });
    res = await match.route.handler.run(ctx);
  } catch (err) {
    res = errorResponse(err, {
      cache: 'no-store',
      includeDetails: actor !== null,
      route: routeLabel,
      method,
    });
  }
  log(res.status >= 500 ? 'error' : 'info', {
    event: 'admin-request',
    method,
    route: routeLabel,
    status: res.status,
    ms: Date.now() - started,
  });
  return res;
}
