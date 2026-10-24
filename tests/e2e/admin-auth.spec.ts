/**
 * Owner admin sign-in against the REAL server (password mode, throwaway
 * password; tests/e2e/backend): unauthenticated visitors see the login and
 * nothing else, a wrong password is refused, sign-out ends the session on the
 * server.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './backend/fixtures.ts';

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();

test.describe('Admin sign-in', () => {
  test('unauthenticated /admin shows only the login, and the API refuses data', async ({
    page,
    api,
    shot,
  }) => {
    await page.goto('/admin/locations');
    await expect(page.getByRole('heading', { name: 'Sign in to Campus Atlas admin' })).toBeVisible();
    await expect(page.getByLabel('Owner password')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Admin sections' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Locations' })).toHaveCount(0);
    await expect(page).toHaveTitle('Admin · LPU Campus Atlas');
    expect(await page.locator('meta[name="robots"]').getAttribute('content')).toBe('noindex, nofollow');
    for (const path of ['/api/admin/suggestions', '/api/admin/locations', '/api/admin/audit'])
      expect((await api.get(path)).status(), path).toBe(401);
    expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
    await shot('auth-1-login');
  });

  test('wrong password is refused; sign in, then sign out ends the session', async ({
    page,
    admin,
    shot,
  }) => {
    await page.goto('/admin');
    await page.getByLabel('Owner password').fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Incorrect password.' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Admin sections' })).toHaveCount(0);

    await admin.signIn('/admin');
    await expect(page.getByText('Signed in as')).toContainText('owner');
    await expect(page.getByRole('heading', { name: 'Moderation queue' })).toBeVisible();
    expect((await page.request.get('/api/admin/session')).status()).toBe(200);
    expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
    await shot('auth-2-signed-in');

    await admin.signOut();
    await expect(page.getByRole('alert').filter({ hasText: 'You have signed out.' })).toBeVisible();
    expect((await page.request.get('/api/admin/session')).status()).toBe(401);
    await page.reload();
    await expect(page.getByLabel('Owner password')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Admin sections' })).toHaveCount(0);
  });

  test('admin screens pass axe', async ({ page, admin }) => {
    await admin.signIn('/admin/queue');
    for (const [path, heading] of [
      ['/admin/queue', 'Moderation queue'],
      ['/admin/locations/new', 'New location'],
      ['/admin/overrides?tab=orphans', 'Base-place overrides'],
      ['/admin/audit', 'History'],
      ['/admin/quality', 'Quality'],
    ] as const) {
      await admin.goto(path);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      const r = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        // MapLibre's own canvas/controls are covered by the public map's accessibility suite.
        .exclude('.maplibregl-map')
        .analyze();
      expect(
        r.violations.map((v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
      ).toEqual([]);
    }
  });

  test('no horizontal page scroll in the admin shell', async ({ page, admin }) => {
    await admin.signIn('/admin/quality');
    await expect(page.getByRole('heading', { name: 'Quality' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
