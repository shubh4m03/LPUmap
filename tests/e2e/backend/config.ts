/**
 * Shared settings of the e2e test backend (tests/e2e/backend/server.ts), read
 * by playwright.config.ts (to start it) and by the specs (to reach it).
 *
 * The admin password is a throwaway generated once per Playwright run (in the
 * runner process, inherited by the backend and the workers through the
 * environment). It is never written to disk and never committed.
 */
import { randomBytes } from 'node:crypto';

/**
 * Port of the backend (static build + real /api handlers): E2E_BACKEND_PORT, or one picked
 * per run in 4440–4499 (set in the runner's environment, so the workers and the
 * backend agree, and two runs on one machine do not collide). Never 4410 (the
 * owner's preview).
 */
function backendPort(): number {
  const fixed = Number(process.env.E2E_BACKEND_PORT);
  if (Number.isInteger(fixed) && fixed > 0 && fixed !== 4410) return fixed;
  const picked = 4440 + (randomBytes(1)[0]! % 60);
  process.env.E2E_BACKEND_PORT = String(picked);
  return picked;
}
export const BACKEND_PORT = backendPort();
export const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;

/** Header the backend turns into CF-Connecting-IP (what Cloudflare's edge sets), so each test is its own rate-limit client. */
export const CLIENT_HEADER = 'x-e2e-client';

const PASSWORD_ENV = 'ATLAS_E2E_ADMIN_PASSWORD';

/** The run's admin password (created on first use in the runner; workers inherit it). */
export function adminPassword(): string {
  const existing = process.env[PASSWORD_ENV];
  if (existing && existing.length >= 12) return existing;
  const fresh = `e2e-${randomBytes(18).toString('base64url')}`;
  process.env[PASSWORD_ENV] = fresh;
  return fresh;
}

export const ADMIN_PASSWORD_ENV = PASSWORD_ENV;
