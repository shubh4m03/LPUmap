/**
 * Binds the HTTP layer's ports to the real data layer (server/db,
 * server/domain, server/base-data). This is the only file that knows the
 * data layer's exact function signatures.
 */
import type { RateLimitRepo, SessionRepo } from '../auth/ports.ts';
import { d1SaltRepo } from '../auth/salt.ts';
import { loadBaseData } from '../base-data.ts';
import { hit } from '../db/rate-limits.ts';
import { createSession, deleteSession, getSession, purgeExpiredSessions } from '../db/sessions.ts';
import { domainAdapter } from './domain-adapter.ts';
import type { Services } from './ports.ts';

export const d1Sessions: SessionRepo = {
  async create(db, record, now) {
    await createSession(db, {
      idHash: record.idHash,
      actor: record.actor,
      csrfToken: record.csrfToken,
      now,
      expiresAt: new Date(record.expiresAt),
    });
  },
  async get(db, idHash, now) {
    const s = await getSession(db, idHash, now);
    return s
      ? {
          idHash: s.idHash,
          actor: s.actor,
          csrfToken: s.csrfToken,
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
        }
      : null;
  },
  async delete(db, idHash) {
    await deleteSession(db, idHash);
  },
  async purgeExpired(db, now) {
    await purgeExpiredSessions(db, now);
  },
};

export const d1RateLimits: RateLimitRepo = {
  async hit(db, bucket, limit, windowS, now) {
    const r = await hit(db, bucket, limit, windowS, now);
    return { allowed: r.allowed, retryAfterS: r.retryAfterS };
  },
};

export const realServices: Services = {
  domain: domainAdapter,
  sessions: d1Sessions,
  rateLimits: d1RateLimits,
  salts: d1SaltRepo,
  loadBase: loadBaseData,
};
