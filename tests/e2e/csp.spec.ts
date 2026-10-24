/**
 * The production Content-Security-Policy (public/_headers, `script-src 'self'`
 * with no 'unsafe-eval') must never be violated. `vite preview` and the e2e
 * backend do not apply _headers, so every document response here gets the
 * real policy added, and the page records each `securitypolicyviolation`.
 *
 * Regression: Zod 4 probes `new Function` when the first object schema is
 * created; the caught throw still reported one script-src violation per page
 * (public and admin). src/csp/zod.ts (aliased in vite.config.ts) switches
 * Zod's JIT off first, so the probe never runs.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from './backend/fixtures.ts';

const here = dirname(fileURLToPath(import.meta.url));

/** The Content-Security-Policy that public/_headers applies to every path (`/*`). */
function productionCsp(): string {
  let inAll = false;
  for (const line of readFileSync(join(here, '../../public/_headers'), 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) inAll = line.trim() === '/*';
    else if (inAll && /^\s*Content-Security-Policy:/i.test(line))
      return line.split(':').slice(1).join(':').trim();
  }
  throw new Error('public/_headers has no Content-Security-Policy for /*');
}

interface Violation {
  directive: string;
  blocked: string;
  source: string;
}

async function withProductionCsp(page: Page): Promise<() => Promise<Violation[]>> {
  const csp = productionCsp();
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain('unsafe-eval');
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } });
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __cspViolations: unknown[] };
    w.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      w.__cspViolations.push({ directive: e.violatedDirective, blocked: e.blockedURI, source: e.sourceFile }),
    );
  });
  return () => page.evaluate(() => (window as unknown as { __cspViolations: Violation[] }).__cspViolations);
}

test.describe('Content-Security-Policy', () => {
  test('the public app reports no CSP violation', async ({ page }) => {
    const violations = await withProductionCsp(page);
    const response = await page.goto('/');
    expect(response?.headers()['content-security-policy']).toContain("script-src 'self'");
    await expect(page.getByRole('button', { name: /Search places/ }).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await violations()).toEqual([]);
  });

  test('the admin sign-in and the signed-in Studio report no CSP violation', async ({ page, admin }) => {
    const violations = await withProductionCsp(page);
    await page.goto('/admin');
    await expect(page.getByLabel('Owner password')).toBeVisible();
    expect(await violations()).toEqual([]);
    await admin.signIn('/admin/studio');
    await page.waitForLoadState('networkidle');
    expect(await violations()).toEqual([]);
  });
});
