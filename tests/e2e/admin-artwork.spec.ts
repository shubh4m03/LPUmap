/**
 * Artwork verification end to end against the REAL server (tests/e2e/backend:
 * the production build + the real handlers over a fresh in-memory local D1):
 *
 *  1. Public app, before: the illustration item is an artwork-only directory
 *     row, "Not linked to a map building", not routable, no map location.
 *  2. Admin → Artwork: the item page shows the exact printed label and the
 *     original overview with its outline; the owner picks the first reviewed
 *     candidate footprint, marks it VERIFIED with evidence (site sign + date)
 *     and saves (audited, published).
 *  3. Public app after a refresh: the label now finds the BUILDING row (same
 *     stable building id), marked "Verified link to the illustration"; choosing
 *     it selects that building and the map focuses it.
 *  4. Admin reset to the curated baseline (unresolved) → after a refresh the
 *     item is artwork-only again, with no map location.
 *
 * Each project uses a different item and building (the database is shared by
 * the whole run).
 */
import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './backend/fixtures.ts';
import type { Atlas } from './fixtures/atlas.ts';

interface Subject {
  subjectId: string;
  kind: string;
  displayLabel: { text: string } | null;
  displayHold: unknown;
  hotspotIds: string[];
}
interface Assoc {
  subjectId: string;
  status: string;
  buildingId: string | null;
  candidateFootprints: { buildingId: string }[];
}
const manifest = JSON.parse(
  readFileSync(new URL('../../public/isometric-art/manifest.json', import.meta.url), 'utf8'),
) as { subjects: Subject[]; associations: Assoc[] };
const buildings = (
  JSON.parse(readFileSync(new URL('../../public/data/buildings.geojson', import.meta.url), 'utf8')) as {
    features: { properties: { id: string; anchorLon: number; anchorLat: number } }[];
  }
).features.map((f) => f.properties);

const assocOf = (id: string) => manifest.associations.find((a) => a.subjectId === id)!;
const usedByBaseline = new Set(manifest.associations.map((a) => a.buildingId).filter(Boolean));
const labelCount = (t: string) => manifest.subjects.filter((s) => s.displayLabel?.text === t).length;

/** Unresolved numbered items with a unique, simple printed caption and a reviewed candidate nobody else points at. */
const CHOICES = manifest.subjects
  .filter((s) => {
    const a = assocOf(s.subjectId);
    const label = s.displayLabel?.text ?? '';
    return (
      s.kind === 'numbered' &&
      !s.displayHold &&
      s.hotspotIds.length > 0 &&
      a.status === 'unresolved' &&
      a.candidateFootprints.length > 0 &&
      !usedByBaseline.has(a.candidateFootprints[0]!.buildingId) &&
      labelCount(label) === 1 &&
      /^[A-Z ,]+$/.test(label)
    );
  })
  .filter(
    (s, i, all) =>
      all.findIndex(
        (o) =>
          assocOf(o.subjectId).candidateFootprints[0]!.buildingId ===
          assocOf(s.subjectId).candidateFootprints[0]!.buildingId,
      ) === i,
  );

const PROJECTS = ['desktop', 'laptop', 'tablet', 'mobile', 'mobile-small'];

async function openDirectory(page: Page, atlas: Atlas): Promise<Locator> {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page
    .getByRole('dialog', { name: 'Menu' })
    .getByRole('button', { name: 'Building directory' })
    .click();
  const panel = atlas.panel('Building directory');
  await expect(panel).toBeVisible();
  return panel;
}

async function searchDirectory(page: Page, atlas: Atlas, label: string): Promise<Locator> {
  await atlas.open({ view: '2d' });
  const panel = await openDirectory(page, atlas);
  await panel
    .getByRole('searchbox', { name: 'Search buildings or map keys' })
    .or(panel.getByRole('textbox', { name: 'Search buildings or map keys' }))
    .fill(label);
  return panel;
}

const metres = (a: [number, number], b: [number, number]) => {
  const k = Math.PI / 180;
  const x = (b[0] - a[0]) * k * Math.cos(((a[1] + b[1]) / 2) * k);
  const y = (b[1] - a[1]) * k;
  return Math.hypot(x, y) * 6_371_000;
};

test.describe.configure({ timeout: 180_000 });

test('artwork link: verify with evidence → public directory and map; reset → no map location', async ({
  page,
  admin,
  atlas,
  shot,
}, info) => {
  expect(CHOICES.length).toBeGreaterThanOrEqual(PROJECTS.length);
  const subject = CHOICES[Math.max(0, PROJECTS.indexOf(info.project.name))]!;
  const label = subject.displayLabel!.text;
  const buildingId = assocOf(subject.subjectId).candidateFootprints[0]!.buildingId;
  const b = buildings.find((x) => x.id === buildingId)!;
  expect(b, `building ${buildingId} is in the campus dataset`).toBeTruthy();

  // --- 1. Public, before: artwork-only, not linked, not routable ---
  let panel = await searchDirectory(page, atlas, label);
  const artRow = panel.getByRole('button', { name: new RegExp(label) }).first();
  await expect(artRow).toBeVisible();
  await expect(artRow).toContainText('Not linked to a map building');
  await expect(artRow).toContainText('Not routable');
  await expect(panel.getByText('Verified link to the illustration')).toHaveCount(0);

  // --- 2. Admin: verify with evidence ---
  await admin.signIn(`/admin/artwork/${encodeURIComponent(subject.subjectId)}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(label);
  await expect(page.getByTestId('artwork-hotspot-overview')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Printed labels (exact)' })).toContainText(label);
  // The original overview must have finished loading before the evidence shot.
  await expect
    .poll(() =>
      page
        .getByTestId('artwork-original-image')
        .first()
        .evaluate((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0),
    )
    .toBe(true);
  await shot('artwork-0-item');
  const form = page.getByRole('form', { name: 'Artwork link decision' });
  await form.getByRole('radio', { name: /^Verified/ }).check();
  const cands = form.getByRole('list', { name: /Candidate footprints/ });
  await cands.scrollIntoViewIfNeeded();
  await expect(
    page.getByRole('region', { name: 'Candidate footprints on the campus map' }).locator('canvas'),
  ).toBeVisible({ timeout: 30_000 });
  await shot('artwork-0b-candidates');
  await cands.getByRole('listitem').first().getByRole('button', { name: 'Use this building' }).click();
  await expect(form.getByRole('textbox', { name: 'Campus building id' })).toHaveValue(buildingId);
  await form.getByRole('button', { name: 'Add evidence' }).click();
  const ev = form.getByRole('group', { name: 'Evidence 1' });
  await ev
    .getByRole('textbox', { name: 'What the sign photo shows' })
    .fill(`E2E ${info.project.name}: sign photo at the entrance`);
  await form.getByRole('button', { name: 'Save as verified' }).click();
  await expect(page.getByText(/Saved and published/).first()).toBeVisible();
  const current = page.getByRole('region', { name: 'Current link' });
  await expect(current).toContainText('Verified');
  await expect(current).toContainText(buildingId);
  await expect(page.getByRole('list', { name: 'Change history (oldest first)' })).toContainText(
    'Artwork link decided',
  );
  await shot('artwork-1-verified');

  // --- 3. Public, after a refresh: the building row carries the label; choosing it focuses the building ---
  panel = await searchDirectory(page, atlas, label);
  // The printed label now finds exactly the linked BUILDING (no separate artwork-only row).
  await expect(panel.getByRole('status')).toHaveText('1 building matches');
  const buildingRow = panel.getByRole('button').filter({ hasText: 'Verified link to the illustration' });
  await expect(buildingRow).toHaveCount(1);
  await expect(panel.getByText('Not linked to a map building')).toHaveCount(0);
  await buildingRow.click();
  await expect.poll(() => atlas.selectedId(), { timeout: 15_000 }).toBe(buildingId);
  await expect
    .poll(async () => metres((await atlas.camera()).center as [number, number], [b.anchorLon, b.anchorLat]), {
      timeout: 15_000,
    })
    .toBeLessThan(150);
  await shot('artwork-2-public-verified');

  // --- 4. Admin reset → public: artwork-only again, no map location ---
  await admin.goto(`/admin/artwork/${encodeURIComponent(subject.subjectId)}`);
  await page.getByRole('button', { name: /Reset to the curated baseline/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByRole('region', { name: 'Current link' })).toContainText('Unresolved');

  panel = await searchDirectory(page, atlas, label);
  const again = panel.getByRole('button', { name: new RegExp(label) }).first();
  await expect(again).toContainText('Not linked to a map building');
  await expect(panel.getByText('Verified link to the illustration')).toHaveCount(0);
  await again.click();
  await page.waitForTimeout(500);
  expect(await atlas.selectedId()).not.toBe(buildingId);
});
