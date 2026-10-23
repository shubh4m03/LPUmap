/** GET /api/health — liveness plus configuration state; never reveals values. */
import { parseEnv } from '../env.ts';
import { methodNotAllowed, errorResponse, json } from '../http/response.ts';
import type { HandlerDeps } from './deps.ts';

export async function handleHealth(request: Request, deps: HandlerDeps): Promise<Response> {
  if (request.method !== 'GET') return errorResponse(methodNotAllowed(['GET']));
  const env = parseEnv(deps.env);
  let db: 'ok' | 'unavailable' = 'unavailable';
  if (env.db) {
    try {
      await env.db.prepare('SELECT 1 AS ok').first();
      db = 'ok';
    } catch {
      db = 'unavailable';
    }
  }
  return json({ ok: db === 'ok', db, auth: env.auth.mode }, { cache: 'no-store' });
}
