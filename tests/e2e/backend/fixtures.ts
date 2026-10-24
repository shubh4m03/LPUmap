/**
 * Playwright fixtures for specs that need the REAL server (admin, public
 * suggestions): every request goes to the e2e backend (tests/e2e/backend/
 * server.ts — the production build plus the real handlers over a fresh local
 * D1), same origin. Nothing is mocked.
 *
 * - `client`: a per-test client address (sent as `x-e2e-client`, which the
 *   backend turns into CF-Connecting-IP), so rate limits are per test.
 * - `atlas`: the public-app page object, on the backend.
 * - `admin`: sign-in / navigation helpers for /admin.
 * - `api`: a request context on the backend (same client address) for setup
 *   and for checking what the server stored.
 * - `shot(name)`: saves test-results/admin/<project>-<name>.png (and attaches it).
 * - `problems`: page errors and console errors other than expected HTTP
 *   statuses; the test fails if any occurred.
 *
 * The database is shared by all tests of a run, so every test creates its
 * own uniquely named records (`unique()`).
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import { Atlas } from '../fixtures/atlas.ts';
import type { Health } from '../fixtures/test.ts';
import { adminPassword, BACKEND_URL, CLIENT_HEADER } from './config.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const SCREENSHOT_DIR = join(here, '../../../test-results/admin');

export interface AdminHelpers {
  /** Opens /admin (or a sub-path) and signs in with the run's password; waits for the shell. */
  signIn(path?: string): Promise<void>;
  signOut(): Promise<void>;
  /** The section navigation. */
  nav(): ReturnType<Page['getByRole']>;
  goto(path: string): Promise<void>;
}

export const test = base.extend<{
  client: string;
  problems: string[];
  atlas: Atlas;
  admin: AdminHelpers;
  api: APIRequestContext;
  shot: (name: string) => Promise<void>;
  unique: (prefix: string) => string;
}>({
  baseURL: BACKEND_URL,

  // eslint-disable-next-line no-empty-pattern
  client: async ({}, provide) => {
    const b = randomBytes(3);
    await provide(`10.${b[0]}.${b[1]}.${b[2]}`);
  },

  page: async ({ page, client }, provide) => {
    await page.setExtraHTTPHeaders({ [CLIENT_HEADER]: client });
    await provide(page);
  },

  problems: [
    async ({ page }, provide, testInfo) => {
      const problems: string[] = [];
      page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        // Expected answers the UI handles (session checks, rate limits, refused writes) log as resource errors.
        if (/Failed to load resource: the server responded with a status of (401|404|409|422|429)/.test(text))
          return;
        problems.push(`console.error: ${text}`);
      });
      await provide(problems);
      if (problems.length > 0) await testInfo.attach('problems', { body: problems.join('\n') });
      expect(problems, 'page errors or unexpected console errors').toEqual([]);
    },
    { auto: true },
  ],

  atlas: async ({ page }, provide, testInfo) => {
    const health: Health = { problems: [] };
    await provide(new Atlas(page, testInfo, health));
  },

  api: async ({ playwright, client }, provide) => {
    const ctx = await playwright.request.newContext({
      baseURL: BACKEND_URL,
      extraHTTPHeaders: { [CLIENT_HEADER]: client, Origin: BACKEND_URL },
    });
    await provide(ctx);
    await ctx.dispose();
  },

  admin: async ({ page }, provide) => {
    const nav = () => page.getByRole('navigation', { name: 'Admin sections' });
    await provide({
      async signIn(path = '/admin') {
        await page.goto(path);
        await page.getByLabel('Owner password').fill(adminPassword());
        await page.getByRole('button', { name: 'Sign in' }).click();
        await expect(nav()).toBeVisible();
      },
      async signOut() {
        await page.getByRole('button', { name: 'Sign out' }).click();
        await expect(page.getByLabel('Owner password')).toBeVisible();
      },
      nav,
      async goto(path: string) {
        await page.goto(path);
        await expect(nav()).toBeVisible();
      },
    });
  },

  shot: async ({ page }, provide, testInfo) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await provide(async (name: string) => {
      const path = join(SCREENSHOT_DIR, `${testInfo.project.name}-${name}.png`);
      await page.screenshot({ path, animations: 'disabled' });
      await testInfo.attach(name, { path, contentType: 'image/png' });
    });
  },

  // eslint-disable-next-line no-empty-pattern
  unique: async ({}, provide, testInfo) => {
    await provide((prefix: string) => `${prefix} ${testInfo.project.name} ${randomBytes(3).toString('hex')}`);
  },
});

export { expect };

/** A point on campus next to walkable paths (has access-point candidates within 60 m). */
export const NEAR_PATHS: readonly [number, number] = [75.70333, 31.253634];

/** True for the phone projects (centre-pin placement, bottom sheet). */
export const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1024) < 768;

/** Logs in through the API (for setup and checks) and returns the CSRF token. */
export async function apiLogin(api: APIRequestContext): Promise<string> {
  const r = await api.post('/api/admin/session', { data: { password: adminPassword() } });
  expect(r.status(), await r.text()).toBe(200);
  return ((await r.json()) as { csrfToken: string }).csrfToken;
}

/** Submits a public suggestion through the real endpoint; returns the reference. */
export async function submitViaApi(
  api: APIRequestContext,
  body: { name: string; categoryId: string; location: readonly [number, number]; description?: string },
): Promise<string> {
  const r = await api.post('/api/contributions/locations', { data: body });
  expect(r.status(), await r.text()).toBe(201);
  return ((await r.json()) as { reference: string }).reference;
}
