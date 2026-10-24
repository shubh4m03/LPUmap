/**
 * /api/admin/session — password-mode login, session introspection, logout.
 * In Access mode there is no login endpoint (404): identity comes from the
 * Cloudflare Access JWT on every request.
 */
import { APP_CONFIG } from '../../../src/config/index.ts';
import { expiredSessionCookie, sessionCookie } from '../../auth/cookies.ts';
import { verifyPassword } from '../../auth/password.ts';
import { enforceRateLimits } from '../../auth/rate-limit.ts';
import type { RateRule } from '../../auth/rate-limit.ts';
import { endSession, sessionBinding, startSession } from '../../auth/session.ts';
import { HttpError } from '../../http/errors.ts';
import { log } from '../../http/log.ts';
import { checkSameOrigin } from '../../http/origin.ts';
import { json } from '../../http/response.ts';
import type { AdminHandler } from './context.ts';
import { loginBody } from './schemas.ts';

export function loginRateRule(): RateRule {
  const r = APP_CONFIG.contributions.loginRateLimit;
  return { scope: 'admin:login', limit: r.perWindow, windowS: r.windowMinutes * 60 };
}

/**
 * Login rate rules: the per-client limit first, then (when
 * ADMIN_LOGIN_GLOBAL_LIMIT is set) one bucket shared by every client over the
 * same window. A client already over its own limit stops at the first rule
 * and does not consume the global budget.
 */
export function loginRateRules(globalLimit: number | null): RateRule[] {
  const perClient = loginRateRule();
  return globalLimit === null
    ? [perClient]
    : [
        perClient,
        { scope: 'admin:login:global', limit: globalLimit, windowS: perClient.windowS, global: true },
      ];
}

export const loginRoute: AdminHandler = {
  permission: null,
  async run(c) {
    if (c.env.auth.mode !== 'password') throw new HttpError('not-found', 'Not found');
    const passwordHash = c.env.auth.passwordHash;
    checkSameOrigin(c.request, c.env.publicOrigin, { requireOrigin: true });
    await enforceRateLimits(c.request, loginRateRules(c.env.loginGlobalLimit), {
      db: c.db,
      repo: c.deps.services.rateLimits,
      salts: c.deps.services.salts,
      rateLimitKey: c.env.rateLimitKey,
      now: c.now,
    });
    const { password } = await c.body(loginBody);
    if (!(await verifyPassword(password, passwordHash))) {
      log('warn', { event: 'login-failed', route: '/session', method: 'POST' });
      throw new HttpError('unauthenticated', 'Incorrect password');
    }
    const { token, record } = await startSession(
      c.db,
      c.deps.services.sessions,
      c.now,
      sessionBinding(passwordHash),
    );
    log('info', { event: 'login-succeeded', route: '/session', method: 'POST' });
    return json(
      { actor: record.actor, csrfToken: record.csrfToken, expiresAt: record.expiresAt },
      { status: 200, cache: 'no-store', headers: { 'Set-Cookie': sessionCookie(token) } },
    );
  },
};

export const getSessionRoute: AdminHandler = {
  permission: 'admin:read',
  async run(c) {
    const actor = c.actor!;
    return json(
      {
        actor: actor.id,
        mode: actor.mode,
        ...(actor.session ? { csrfToken: actor.session.csrfToken, expiresAt: actor.session.expiresAt } : {}),
      },
      { cache: 'no-store' },
    );
  },
};

export const logoutRoute: AdminHandler = {
  permission: 'admin:read',
  async run(c) {
    const actor = c.actor!;
    if (actor.session) {
      await endSession(c.db, c.deps.services.sessions, actor.session);
      return json({ ok: true }, { cache: 'no-store', headers: { 'Set-Cookie': expiredSessionCookie() } });
    }
    // Access mode: the Access session is ended at <team>/cdn-cgi/access/logout by the browser.
    return json({ ok: true }, { cache: 'no-store' });
  },
};
