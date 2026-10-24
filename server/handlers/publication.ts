/**
 * GET /api/locations — the published layer (active locations + overrides +
 * studio buildings). Weak ETag from the publication SCHEMA version and the
 * publication version; `no-cache` so clients always revalidate and never show
 * a stale publication after an edit.
 *
 * A matching If-None-Match is answered with 304 from one cheap version read,
 * before any row is read or the body is built. The full path reads the body
 * as one consistent snapshot and takes the ETag from the version IN that
 * snapshot, so a write between the two reads can never label new rows with
 * an old ETag.
 *
 * Why the schema version is in the ETag: the body's shape changes with
 * PUBLICATION_SCHEMA_VERSION (v1 → v2 added `buildings`). Without it, a
 * deploy or rollback across schema versions would serve 304 for a cached body
 * of the other shape, because publication_version is unchanged by a deploy.
 * The base dataset version is deliberately NOT in the ETag: the body never
 * depends on the base dataset (no base data is read; the client merges against
 * whatever dataset it has), so a data refresh does not change it.
 */
import { PUBLICATION_SCHEMA_VERSION } from '../../src/community/schema.ts';
import { parseEnv } from '../env.ts';
import { HttpError } from '../http/errors.ts';
import { log } from '../http/log.ts';
import { empty, errorResponse, json, methodNotAllowed } from '../http/response.ts';
import type { HandlerDeps } from './deps.ts';

export function publicationEtag(version: number, schemaVersion: number = PUBLICATION_SCHEMA_VERSION): string {
  return `W/"pub-v${schemaVersion}-${version}"`;
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
    const domain = deps.services.domain;
    const ifNoneMatch = request.headers.get('If-None-Match');
    const current = ifNoneMatch === null ? null : publicationEtag(await domain.getPublicationVersion(env.db));
    if (current !== null && etagMatches(ifNoneMatch, current)) {
      res = empty(304, { cache: 'no-cache', headers: { ETag: current } });
    } else {
      const pub = await domain.getPublication(env.db);
      res = json(pub, { cache: 'no-cache', headers: { ETag: publicationEtag(pub.publicationVersion) } });
    }
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
