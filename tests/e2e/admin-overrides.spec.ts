/**
 * Base-place overrides end to end against the REAL server: rename a campus
 * place, hide it, check the public app after each change, read the history,
 * then return it to its base values. Each project edits a different place
 * (the database is shared by the whole run).
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './backend/fixtures.ts';
import type { Atlas } from './fixtures/atlas.ts';

interface BasePlace {
  id: string;
  name: string | null;
  displayName: string;
  location: [number, number] | null;
  kind: string;
}

const places = (
  JSON.parse(readFileSync(new URL('../../public/data/places.json', import.meta.url), 'utf8')) as {
    places: BasePlace[];
  }
).places;

/** Named, located campus places whose name is unique in the dataset (unambiguous search). */
const candidates = places.filter(
  (p) =>
    p.name &&
    p.location &&
    p.name === p.displayName &&
    places.filter((q) => q.displayName === p.displayName).length === 1 &&
    /^[\w &'-]+$/.test(p.name),
);

const PROJECTS = ['desktop', 'laptop', 'tablet', 'mobile', 'mobile-small'];

async function publicHas(page: Page, atlas: Atlas, name: string): Promise<boolean> {
  await atlas.open({ view: '2d' });
  const palette = await atlas.openSearch();
  await palette.getByRole('combobox').fill(name);
  const found = await atlas
    .paletteOption(name)
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  await page.keyboard.press('Escape');
  return found;
}

test.describe.configure({ timeout: 150_000 });

test('override: rename, hide, history, back to base values', async ({
  page,
  admin,
  atlas,
  shot,
  unique,
}, info) => {
  const target = candidates[((PROJECTS.indexOf(info.project.name) + 1) * 7) % candidates.length]!;
  const baseName = target.name!;
  const renamed = unique('E2E renamed');
  expect(await publicHas(page, atlas, baseName)).toBe(true);

  await admin.signIn('/admin/overrides');
  await page.getByLabel('Find a campus place by name or id').fill(target.id);
  await page.getByRole('list', { name: 'Matching campus places' }).getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: target.displayName, level: 1 })).toBeVisible();
  await expect(page.getByText('Base values', { exact: true })).toBeVisible();

  // Rename.
  await page.getByLabel('Name', { exact: true }).fill(renamed);
  await page.getByRole('button', { name: 'Save override' }).click();
  await expect(page.getByText('Has an override')).toBeVisible();
  await shot('overrides-1-renamed');
  expect(await publicHas(page, atlas, renamed)).toBe(true);
  expect(await publicHas(page, atlas, baseName)).toBe(false);

  // Hide.
  await admin.goto(`/admin/overrides/${encodeURIComponent(target.id)}`);
  await page.getByRole('button', { name: 'Hide from the public map' }).click();
  await expect(page.getByText('Hidden', { exact: true }).first()).toBeVisible();
  expect(await publicHas(page, atlas, renamed)).toBe(false);

  // Listed under "Hidden"; the history records both changes.
  await admin.goto('/admin/overrides?tab=hidden');
  await expect(page.getByRole('list', { name: 'Overrides' }).getByText(target.id)).toBeVisible();
  await shot('overrides-2-hidden-list');
  await admin.goto(`/admin/audit?entity=override&entityId=${encodeURIComponent(target.id)}`);
  const events = page.getByRole('list', { name: 'History events' });
  await expect(events.getByText('Override saved', { exact: true })).toBeVisible();
  await expect(events.getByText('Base place hidden', { exact: true })).toBeVisible();

  // Back to base values: the base name is public again.
  await admin.goto(`/admin/overrides/${encodeURIComponent(target.id)}`);
  await page.getByRole('button', { name: 'Back to base values…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Return to the base values?' });
  await dialog.getByRole('button', { name: 'Return to base values' }).click();
  await expect(page.getByText('Base values', { exact: true })).toBeVisible();
  expect(await publicHas(page, atlas, baseName)).toBe(true);
});
