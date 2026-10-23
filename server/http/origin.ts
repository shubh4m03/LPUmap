/**
 * Same-origin enforcement for state-changing requests (CSRF defence in depth
 * alongside SameSite=Strict cookies and the per-session CSRF token).
 */
import { HttpError } from './errors.ts';

export const MUTATING_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface OriginCheckOptions {
  /** When true a missing Origin header is rejected (admin). */
  requireOrigin: boolean;
}

export function checkSameOrigin(
  request: Request,
  publicOrigin: string | null,
  opts: OriginCheckOptions,
): void {
  const origin = request.headers.get('Origin');
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite !== null && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new HttpError('csrf', 'Cross-site request rejected');
  }
  if (origin === null) {
    if (opts.requireOrigin) throw new HttpError('csrf', 'Origin header required');
    return;
  }
  const allowed = new Set<string>([new URL(request.url).origin]);
  if (publicOrigin) allowed.add(publicOrigin);
  if (!allowed.has(origin)) throw new HttpError('csrf', 'Cross-origin request rejected');
}
