/**
 * GET /api/locations — the published layer (active locations + overrides).
 * Weak ETag from the publication version; `no-cache` so clients always
 * revalidate and never show a stale publication after an edit.
 */
import { parseEnv } from '../env.ts';
import { HttpError } from '../http/errors.ts';
import { log } from '../http/log.ts';
import { empty, errorResponse, json, methodNotAllowed } from '../http/response.ts';
import type { HandlerDeps } from './deps.ts';

export function publicationEtag(version: number): string {
  return `W/"pub-${version}"`;
}

/** RFC 9110 weak comparison against an If-None-Match list. */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const strip = (t: string) => t.trim().replace(/^W\//, '');
  const target = strip(etag);
  return ifNoneMatch.split(',').some((t) => t.trim() === '*' || strip(t) === target);
}

export async function handlePublication(request: Request, deps: HandlerDeps): Promise<Response> {
  const started = Date.now();
  let res: Response;
  try {
    if (request.method !== 'GET') throw methodNotAllowed(['GET']);
    const env = parseEnv(deps.env);
    if (!env.db) throw new HttpError('unavailable', 'Community updates are unavailable');
    const pub = await deps.services.domain.getPublication(env.db);
    const etag = publicationEtag(pub.publicationVersion);
    res = etagMatches(request.headers.get('If-None-Match'), etag)
      ? empty(304, { cache: 'no-cache', headers: { ETag: etag } })
      : json(pub, { cache: 'no-cache', headers: { ETag: etag } });
  } catch (err) {
    res = errorResponse(err, { cache: 'no-store', route: '/api/locations', method: request.method });
  }
  log('info', {
    event: 'request',
    method: request.method,
    route: '/api/locations',
    status: res.status,
    ms: Date.now() - started,
  });
  return res;
}
