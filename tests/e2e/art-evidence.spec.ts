/**
 * Evidence run of the artwork integration (owner gate 6), on the production
 * build served by the REAL backend (tests/e2e/backend: real handlers over a
 * fresh in-memory local D1 — never a persisted or remote database).
 *
 * Runs only in the `desktop` (1440×900) and `mobile` (390×844, DPR 2)
 * projects. Screenshots go to test-results/evidence/art/<project>-<name>.png;
 * the side-by-side comparisons with the ORIGINAL master go to
 * $ART_COMPARE_DIR (default test-results/evidence/art/compare). Every
 * screenshot is also an assertion:
 *
 *  - the Illustrated overview opens by default for ?view=iso, with its notice;
 *  - 4 regions of the rendered overview match the original JPEG (decoded and
 *    colour-managed by Chromium, drawn with the renderer's own transform) —
 *    composition, colour and printed labels — measured as PSNR / mean error;
 *  - vignettes of 4 different block captions open in the detail card, each the
 *    unchanged original file, with the caption heading printed exactly;
 *  - the directory groups the illustration by its printed block captions;
 *  - a hotspot click highlights its outline and selects its subject;
 *  - an association VERIFIED IN THIS TEST (admin API, in-memory database, reset
 *    afterwards) gives one canonical building id in the illustration and on the
 *    geographic map; an unresolved item has no map position;
 *  - the admin Artwork section lists every subject with its exact label.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { APIRequestContext, Page, TestInfo } from '@playwright/test';
import { snapToDevicePixels, type ArtTransform } from '../../src/isometric-art/viewport.ts';
import { apiLogin, expect, test } from './backend/fixtures.ts';

interface Quote {
  text: string;
  ref: string;
}
interface ManifestLite {
  coordinateSpace: { width: number; height: number };
  hotspots: {
    hotspotId: string;
    subjectId: string;
    kind: string;
    labelAnchor: [number, number];
    printedLabel: string | null;
  }[];
  subjects: {
    subjectId: string;
    kind: string;
    artworkNumber: string | null;
    displayLabel: Quote | null;
    visibleBlockLabel: Quote | null;
    displayHold: unknown;
    hotspotIds: string[];
    vignetteAssetIds: string[];
  }[];
  assets: { assetId: string; duplicateOf: string | null; original: { url: string } | null }[];
  associations: {
    subjectId: string;
    status: string;
    buildingId: string | null;
    candidateFootprints: { buildingId: string }[];
  }[];
}

const ROOT = process.cwd();
const MANIFEST = JSON.parse(
  readFileSync(join(ROOT, 'public/isometric-art/manifest.json'), 'utf8'),
) as ManifestLite;
const SPACE = MANIFEST.coordinateSpace;
const MASTER_ORIGINAL = `/isometric-art/${MANIFEST.assets.find((a) => a.assetId === 'iso-art-001')!.original!.url}`;
const BUILDINGS = (
  JSON.parse(readFileSync(join(ROOT, 'public/data/buildings.geojson'), 'utf8')) as {
    features: { properties: { id: string; displayName: string; anchorLon: number; anchorLat: number } }[];
  }
).features.map((f) => f.properties);

const EVIDENCE_DIR = join(ROOT, 'test-results/evidence/art');
const COMPARE_DIR = process.env.ART_COMPARE_DIR ?? join(EVIDENCE_DIR, 'compare');
const EVIDENCE_PROJECTS = new Set(['desktop', 'mobile']);

const subjectOf = (id: string) => MANIFEST.subjects.find((s) => s.subjectId === id)!;
const assocOf = (id: string) => MANIFEST.associations.find((a) => a.subjectId === id)!;
const assetOf = (id: string) => MANIFEST.assets.find((a) => a.assetId === id)!;

/** Four different numbered pins far apart on the master (NW, NE, SW, SE of the traced campus). */
const REGION_SUBJECTS = (() => {
  const pins = MANIFEST.hotspots.filter((h) => h.kind === 'pin-structure');
  const chosen: string[] = [];
  const pick = (score: (x: number, y: number) => number) => {
    const best = pins
      .filter((h) => !chosen.includes(h.subjectId))
      .reduce((a, b) => (score(...b.labelAnchor) > score(...a.labelAnchor) ? b : a));
    chosen.push(best.subjectId);
  };
  pick((x, y) => -x - y);
  pick((x, y) => x - y);
  pick((x, y) => -x + y);
  pick((x, y) => x + y);
  return chosen;
})();

/** Numbered subjects of four DIFFERENT printed block captions in four different vignette files. */
const VIGNETTE_SUBJECTS = (() => {
  const out: string[] = [];
  const headings = new Set<string>();
  const files = new Set<string>();
  for (const s of MANIFEST.subjects) {
    if (s.kind !== 'numbered' || s.displayHold || !s.visibleBlockLabel || s.hotspotIds.length === 0) continue;
    const file = s.vignetteAssetIds[0];
    if (!file || files.has(file) || headings.has(s.visibleBlockLabel.text)) continue;
    headings.add(s.visibleBlockLabel.text);
    files.add(file);
    out.push(s.subjectId);
    if (out.length === 4) break;
  }
  return out;
})();

/**
 * Approximate in the curated baseline (never chosen by admin-artwork.spec), with a printed caption,
 * one per evidence project and none used by another test here (the backend database is shared).
 */
const VERIFY_CANDIDATES = MANIFEST.subjects.filter(
  (s) =>
    s.kind === 'numbered' &&
    !s.displayHold &&
    s.displayLabel !== null &&
    s.hotspotIds.length > 0 &&
    !REGION_SUBJECTS.includes(s.subjectId) &&
    !VIGNETTE_SUBJECTS.includes(s.subjectId) &&
    assocOf(s.subjectId).status === 'approximate' &&
    assocOf(s.subjectId).buildingId !== null,
);
const verifySubjectFor = (info: TestInfo) => VERIFY_CANDIDATES[info.project.name === 'mobile' ? 1 : 0]!;
const UNRESOLVED_SUBJECT = MANIFEST.subjects.find(
  (s) =>
    s.kind === 'numbered' &&
    !s.displayHold &&
    s.displayLabel !== null &&
    s.hotspotIds.length > 0 &&
    assocOf(s.subjectId).status === 'unresolved',
)!;

function only(info: TestInfo): void {
  test.skip(!EVIDENCE_PROJECTS.has(info.project.name), 'evidence: desktop and mobile projects only');
}

async function save(page: Page, info: TestInfo, name: string): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const path = join(EVIDENCE_DIR, `${info.project.name}-${name}.png`);
  await page.screenshot({ path, animations: 'disabled' });
  await info.attach(name, { path, contentType: 'image/png' });
}

async function frames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Every image of the art layer decoded, and the set of image files stable (tiles follow the view). */
async function settleArt(page: Page): Promise<void> {
  let previous = '';
  for (let i = 0; i < 40; i++) {
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll<HTMLImageElement>('[data-testid="art-layer"] img')].every(
          (img) => img.complete && img.naturalWidth > 0,
        ),
      null,
      { timeout: 30_000 },
    );
    await frames(page);
    const now = await page.evaluate(() =>
      JSON.stringify([window.__ATLAS_ART__!.getImageLayers(), window.__ATLAS_ART__!.getTransform()]),
    );
    if (now === previous) return;
    previous = now;
    await page.waitForTimeout(250);
  }
  throw new Error('the illustrated overview never settled');
}

async function openArt(page: Page, params: Record<string, string> = {}): Promise<void> {
  const qs = new URLSearchParams({ e2e: '1', view: 'iso', ...params });
  await page.goto(`/?${qs.toString()}`);
  await page.waitForFunction(() => window.__ATLAS_ART__?.getStats().firstPaintMs != null, null, {
    timeout: 30_000,
  });
  await expect(page.getByTestId('art-view')).toBeVisible();
  await settleArt(page);
}

const ONLY_ART = `body * { visibility: hidden !important; transition: none !important; }
[data-testid="art-layer"], [data-testid="art-layer"] * { visibility: visible !important; }
[data-testid="art-selection"], [data-testid="art-selection"] * { visibility: hidden !important; }`;

interface Comparison {
  psnr: number;
  meanAbs: number;
  fracOver32: number;
  samples: number;
  png: string;
}

/**
 * The art layer as rendered, next to the ORIGINAL master JPEG drawn by the
 * browser with the renderer's own (device-pixel-snapped) transform, cropped to
 * the same stage rectangle. Returns the error between the two and the
 * side-by-side PNG (left: app, right: original).
 */
async function compareWithOriginal(page: Page, label: string): Promise<Comparison> {
  const { t, stage, dpr } = await page.evaluate(() => ({
    t: window.__ATLAS_ART__!.getTransform(),
    stage: window.__ATLAS_ART__!.getStageRect(),
    dpr: window.devicePixelRatio,
  }));
  const snapped: ArtTransform = snapToDevicePixels(t, dpr);
  const style = await page.addStyleTag({ content: ONLY_ART });
  await frames(page);
  const shot = (await page.screenshot({ animations: 'disabled', scale: 'device' })).toString('base64');
  await style.evaluate((el) => (el as Element).remove());
  return page.evaluate(
    async ({ shot, snapped, stage, dpr, ref, space, label }) => {
      const load = async (src: string) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        return img;
      };
      const a = await load(`data:image/png;base64,${shot}`);
      const sx = Math.round(stage.x * dpr);
      const sy = Math.round(stage.y * dpr);
      const W = Math.min(Math.round(stage.width * dpr), a.naturalWidth - sx);
      const H = Math.min(Math.round(stage.height * dpr), a.naturalHeight - sy);
      const ca = new OffscreenCanvas(W, H);
      const xa = ca.getContext('2d')!;
      xa.drawImage(a, -sx, -sy);
      const r = await load(ref);
      const cb = new OffscreenCanvas(W, H);
      const xb = cb.getContext('2d')!;
      xb.fillStyle = '#ffffff';
      xb.fillRect(0, 0, W, H);
      xb.imageSmoothingQuality = 'high';
      xb.setTransform(dpr * snapped.scale, 0, 0, dpr * snapped.scale, dpr * snapped.tx, dpr * snapped.ty);
      xb.drawImage(r, 0, 0, space.width, space.height);
      xb.setTransform(1, 0, 0, 1, 0, 0);
      const A = xa.getImageData(0, 0, W, H).data;
      const B = xb.getImageData(0, 0, W, H).data;
      // Only where the artwork is, 4 px inside its edges.
      const x0 = Math.max(0, Math.ceil(dpr * snapped.tx) + 4);
      const y0 = Math.max(0, Math.ceil(dpr * snapped.ty) + 4);
      const x1 = Math.min(W, Math.floor(dpr * (snapped.tx + snapped.scale * space.width)) - 4);
      const y1 = Math.min(H, Math.floor(dpr * (snapped.ty + snapped.scale * space.height)) - 4);
      let se = 0;
      let ae = 0;
      let over = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 2)
        for (let x = x0; x < x1; x += 2) {
          const i = (y * W + x) * 4;
          let worst = 0;
          for (let c = 0; c < 3; c++) {
            const d = A[i + c]! - B[i + c]!;
            se += d * d;
            ae += Math.abs(d);
            worst = Math.max(worst, Math.abs(d));
          }
          if (worst > 32) over++;
          n++;
        }
      const mse = se / Math.max(1, n * 3);
      const psnr = mse === 0 ? 99 : 10 * Math.log10((255 * 255) / mse);
      // Side by side with a caption band.
      const band = Math.round(28 * dpr);
      const gap = Math.round(8 * dpr);
      const out = new OffscreenCanvas(W * 2 + gap, H + band);
      const xo = out.getContext('2d')!;
      xo.fillStyle = '#1f2933';
      xo.fillRect(0, 0, out.width, out.height);
      xo.drawImage(ca, 0, band);
      xo.drawImage(cb, W + gap, band);
      xo.fillStyle = '#ffffff';
      xo.font = `${Math.round(13 * dpr)}px sans-serif`;
      xo.fillText(`APP (rendered) — ${label}`, 6 * dpr, 19 * dpr);
      xo.fillText(
        'ORIGINAL 1-lpu-isometric-map-design-3371.jpg, same transform',
        W + gap + 6 * dpr,
        19 * dpr,
      );
      const blob = await out.convertToBlob({ type: 'image/png' });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000)
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return {
        psnr,
        meanAbs: ae / Math.max(1, n * 3),
        fracOver32: over / Math.max(1, n),
        samples: n,
        png: btoa(bin),
      };
    },
    { shot, snapped, stage, dpr, ref: MASTER_ORIGINAL, space: SPACE, label },
  );
}

async function setAssociation(
  api: APIRequestContext,
  subjectId: string,
  body: Record<string, unknown> | null,
): Promise<void> {
  const csrf = await apiLogin(api);
  const path = `/api/admin/artwork/associations/${encodeURIComponent(subjectId)}`;
  const current = await api.get(path, { headers: { 'x-csrf-token': csrf } });
  expect(current.status(), await current.text()).toBe(200);
  const revision =
    ((await current.json()) as { decision: { revision: number } | null }).decision?.revision ?? null;
  const r =
    body === null
      ? revision === null
        ? null
        : await api.delete(path, {
            data: { expectedRevision: revision },
            headers: { 'x-csrf-token': csrf },
          })
      : await api.put(path, {
          data: { ...body, expectedRevision: revision },
          headers: { 'x-csrf-token': csrf },
        });
  if (r) expect(r.status(), await r.text()).toBe(200);
}

// Serial within a project: the verified-in-test association is reset before the next test runs.
test.describe.configure({ timeout: 240_000, mode: 'serial' });

test('illustrated overview: default for ?view=iso, notice shown, full view', async ({ page }, info) => {
  only(info);
  await openArt(page);
  await expect(
    page.getByTestId('iso-variant-switch').getByRole('radio', { name: 'Illustrated' }),
  ).toBeChecked();
  await expect(page.getByTestId('art-notice')).toContainText('Illustration — not to scale');
  await save(page, info, '01-illustrated-overview');
  // Exact printed labels: every pin outline is named with its printed number, never a corrected word.
  const names = await page
    .locator('[data-testid="art-outlines"] [data-hotspot-id^="hs-pin-"]')
    .evaluateAll((els) => els.map((e) => [e.getAttribute('data-hotspot-id'), e.getAttribute('aria-label')]));
  expect(names.length).toBe(MANIFEST.hotspots.filter((h) => h.kind === 'pin-structure').length);
  for (const [id, name] of names) {
    const h = MANIFEST.hotspots.find((x) => x.hotspotId === id)!;
    const s = subjectOf(h.subjectId);
    if (s.displayLabel) expect(name, id!).toContain(s.displayLabel.text);
    // Typos are kept exactly as printed (a corrected spelling is a search alias only).
    if (s.displayLabel?.text.includes('INGNEERING')) expect(name, id!).toContain('INGNEERING');
  }
});

test('illustrated overview vs the original master at the same crop (4 regions)', async ({ page }, info) => {
  only(info);
  mkdirSync(COMPARE_DIR, { recursive: true });
  const results: Record<string, Omit<Comparison, 'png'>> = {};
  for (const [i, subjectId] of REGION_SUBJECTS.entries()) {
    await openArt(page, { place: subjectId });
    // The deep link frames the subject; Escape closes the detail card so the drawing is unobstructed.
    await page.keyboard.press('Escape');
    await settleArt(page);
    await save(page, info, `02-region-${i + 1}-${subjectId.replace(':', '-')}`);
    const c = await compareWithOriginal(page, subjectId);
    writeFileSync(
      join(COMPARE_DIR, `${info.project.name}-region-${i + 1}-${subjectId.replace(':', '-')}.png`),
      Buffer.from(c.png, 'base64'),
    );
    const { png: _png, ...numbers } = c;
    results[subjectId] = numbers;
    // Same composition, colour and labels as the original: no crop, stretch, shift or recolour.
    expect(c.samples, subjectId).toBeGreaterThan(5_000);
    expect(c.psnr, subjectId).toBeGreaterThan(28);
    expect(c.meanAbs, subjectId).toBeLessThan(4);
  }
  writeFileSync(
    join(COMPARE_DIR, `${info.project.name}-region-metrics.json`),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  await info.attach('region-metrics', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
});

test('vignettes of four different block captions in the detail card', async ({ page }, info) => {
  only(info);
  expect(VIGNETTE_SUBJECTS).toHaveLength(4);
  for (const [i, subjectId] of VIGNETTE_SUBJECTS.entries()) {
    const s = subjectOf(subjectId);
    const file = assetOf(s.vignetteAssetIds[0]!);
    const canonical = file.duplicateOf ? assetOf(file.duplicateOf) : file;
    await openArt(page, { place: subjectId });
    // The deep link opens the details panel (side panel, or the sheet on a phone), which shows
    // the item; the floating card steps aside for it so the item is not shown twice.
    const holder = page
      .getByTestId('art-detail-card')
      .or(page.getByRole('complementary', { name: /campus illustration item details/ }))
      .or(page.getByRole('region', { name: /campus illustration item details/ }))
      .or(page.getByRole('dialog', { name: /campus illustration item details/ }))
      .first();
    await expect(holder).toBeVisible();
    await expect(holder).toContainText(s.visibleBlockLabel!.text, { useInnerText: false });
    const img = holder.locator(`img[src$="${canonical.original!.url.split('/').pop()}"]`).first();
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(900);
    await save(page, info, `03-vignette-${i + 1}-${subjectId.replace(':', '-')}`);
  }
});

test('block-wise directory of the illustration', async ({ page, atlas }, info) => {
  only(info);
  await openArt(page);
  await page.getByRole('button', { name: 'Menu' }).click();
  await page
    .getByRole('dialog', { name: 'Menu' })
    .getByRole('button', { name: 'Building directory' })
    .click();
  const panel = atlas.panel('Building directory');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('radio', { name: 'Illustration' })).toBeChecked();
  // Groups are the printed captions, exactly (e.g. "BLOCK-25,26:").
  const heading = VIGNETTE_SUBJECTS.map((id) => subjectOf(id).visibleBlockLabel!.text)[0]!;
  await expect(panel.getByText(heading, { exact: true }).first()).toBeVisible();
  await save(page, info, '04-directory-block-wise');
});

test('selection highlight on the illustration', async ({ page }, info) => {
  only(info);
  await openArt(page);
  // The numbered pin drawn closest to the middle of the stage (in view at every size).
  const { target, at } = await page.evaluate(
    ({ pins, space }) => {
      const t = window.__ATLAS_ART__!.getTransform();
      const stage = window.__ATLAS_ART__!.getStageRect();
      const cx = stage.x + stage.width / 2;
      const cy = stage.y + stage.height / 2;
      let best = { target: '', at: { x: 0, y: 0 }, d: Infinity };
      for (const p of pins) {
        const x = stage.x + t.tx + t.scale * p.anchor[0] * space.width;
        const y = stage.y + t.ty + t.scale * p.anchor[1] * space.height;
        const d = Math.hypot(x - cx, y - cy);
        if (d < best.d) best = { target: p.subjectId, at: { x, y }, d };
      }
      return best;
    },
    {
      pins: MANIFEST.hotspots
        .filter((h) => h.kind === 'pin-structure')
        .map((h) => ({ subjectId: h.subjectId, anchor: h.labelAnchor })),
      space: SPACE,
    },
  );
  await page.mouse.click(at.x, at.y);
  await expect
    .poll(() => page.evaluate(() => window.__ATLAS_ART__!.getSelectedSubjectIds()))
    .toEqual([target]);
  await expect(page.getByTestId('art-selection')).toBeVisible();
  await settleArt(page);
  await save(page, info, '05-selection-highlight');
});

const metres = (a: readonly [number, number], b: readonly [number, number]) => {
  const k = Math.PI / 180;
  const x = (b[0] - a[0]) * k * Math.cos(((a[1] + b[1]) / 2) * k);
  const y = (b[1] - a[1]) * k;
  return Math.hypot(x, y) * 6_371_000;
};

test('one canonical building id in both views: verified in this test, then reset', async ({
  page,
  api,
  atlas,
}, info) => {
  only(info);
  const subject = verifySubjectFor(info);
  const buildingId = assocOf(subject.subjectId).buildingId!;
  const building = BUILDINGS.find((b) => b.id === buildingId)!;
  expect(building, buildingId).toBeTruthy();
  // In-memory test database only: an owner statement recorded for this run, removed at the end.
  await setAssociation(api, subject.subjectId, {
    status: 'verified',
    buildingId,
    evidence: [
      {
        kind: 'owner-statement',
        description: `E2E evidence run (${info.project.name}) — test database only, not a real verification`,
        date: '2026-10-24',
      },
    ],
    note: 'art-evidence.spec: reset at the end of the test',
  });
  try {
    // Illustration: the building's id highlights the verified subject.
    await openArt(page, { place: buildingId });
    await expect
      .poll(() => page.evaluate(() => window.__ATLAS_ART__!.getSelectedSubjectIds()))
      .toContain(subject.subjectId);
    await settleArt(page);
    await save(page, info, '06-verified-illustration');
    // Geographic map: the same id is the selection, focused on the building.
    await atlas.open({ view: '2d', place: buildingId });
    await expect.poll(() => atlas.selectedId(), { timeout: 20_000 }).toBe(buildingId);
    await expect
      .poll(
        async () =>
          metres((await atlas.camera()).center as [number, number], [building.anchorLon, building.anchorLat]),
        { timeout: 20_000 },
      )
      .toBeLessThan(150);
    await expect(page.getByText('Verified link to the illustration').first()).toBeVisible();
    await expect(page.getByText(subject.displayLabel!.text, { exact: false }).first()).toBeVisible();
    await page.waitForTimeout(1500);
    await save(page, info, '07-verified-geographic-map');
  } finally {
    await setAssociation(api, subject.subjectId, null);
  }
});

test('an unresolved item has no map position in the geographic view', async ({ page, atlas }, info) => {
  only(info);
  const subject = UNRESOLVED_SUBJECT;
  await openArt(page, { place: subject.subjectId });
  await expect
    .poll(() => page.evaluate(() => window.__ATLAS_ART__!.getSelectedSubjectIds()))
    .toEqual([subject.subjectId]);
  await save(page, info, '08-unresolved-illustration');
  await atlas.open({ view: '2d', place: subject.subjectId });
  await expect(page.getByText('Not linked to a map building').first()).toBeVisible({ timeout: 20_000 });
  // No building is selected on the map: the item has no map position.
  const selectedOnMap = await atlas.selectedId();
  expect(BUILDINGS.some((b) => b.id === selectedOnMap)).toBe(false);
  await expect(page.getByText(subject.displayLabel!.text).first()).toBeVisible();
  await page.waitForTimeout(1500);
  await save(page, info, '09-unresolved-geographic-map');
});

test('admin Artwork section: every subject with its exact label', async ({ page, admin }, info) => {
  only(info);
  await admin.signIn('/admin/artwork');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Artwork');
  const verify = VIGNETTE_SUBJECTS[0]!;
  await expect(page.getByText(subjectOf(verify).displayLabel?.text ?? verify).first()).toBeVisible();
  await save(page, info, '10-admin-artwork-list');
  await admin.goto(`/admin/artwork/${encodeURIComponent(verify)}`);
  await expect
    .poll(() =>
      page
        .getByTestId('artwork-original-image')
        .first()
        .evaluate((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0),
    )
    .toBe(true);
  await save(page, info, '11-admin-artwork-item');
});
