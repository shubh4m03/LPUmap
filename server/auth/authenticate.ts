/** Resolves the request's actor or throws 401/403/503. Never trusts client-supplied identity fields. */
import type { SqlDatabase } from '../db/types.ts';
import type { AuthConfig } from '../env.ts';
import { HttpError } from '../http/errors.ts';
import { verifyAccessJwt } from './access.ts';
import type { FetchLike } from './access.ts';
import type { Actor } from './authorize.ts';
import type { SessionRepo } from './ports.ts';
import { findSession, sessionBinding } from './session.ts';

export interface AuthenticateDeps {
  db: SqlDatabase;
  sessions: SessionRepo;
  fetch: FetchLike;
  now: Date;
}

export async function authenticate(
  request: Request,
  auth: AuthConfig,
  deps: AuthenticateDeps,
): Promise<Actor> {
  if (auth.mode === 'access') {
    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!token) throw new HttpError('unauthenticated', 'Sign-in required');
    const { email } = await verifyAccessJwt(token.trim(), auth.access, { fetch: deps.fetch, now: deps.now });
    return { id: email, role: 'owner', mode: 'access' };
  }
  if (auth.mode === 'password') {
    const session = await findSession(
      request,
      deps.db,
      deps.sessions,
      deps.now,
      sessionBinding(auth.passwordHash),
    );
    if (!session) throw new HttpError('unauthenticated', 'Sign-in required');
    return {
      id: session.actor,
      role: 'owner',
      mode: 'password',
      session: { idHash: session.idHash, csrfToken: session.csrfToken, expiresAt: session.expiresAt },
    };
  }
  throw new HttpError('not-configured', 'Administration is not configured');
}
