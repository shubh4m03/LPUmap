/**
 * Illustrated overview, end to end on the production build (owner gate 2,
 * docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §3.1). Runs in every project, so the
 * alignment is checked at 1440×900, 1280×800, 768×1024, 390×844 and 360×800.
 *
 * Alignment is proved on REAL PIXELS, not on the code's own arithmetic:
 *  - image registration: the screenshot of the artwork layer is compared with
 *    the web copy of the artwork drawn independently on a canvas with the
 *    transform the renderer reports; the best match over ±3 device px shifts
 *    must be the unshifted one (±1 px);
 *  - outline registration: the pixels that change when "Show outlines" is
 *    switched on must lie on the hotspot polygons placed with that same
 *    transform (95th percentile ≤ 1.5 device px), and the polygons' edges must
 *    be drawn (coverage);
 *  - hit-testing: a click at the screen position of a hotspot's interior
 *    anchor selects that hotspot's subject.
 * Each check runs after opening, wheel zoom in, drag or touch pan, pinch
 * (touch projects), keyboard zoom out and a window resize.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { CDPSession, Page, TestInfo } from '@playwright/test';
import { snapToDevicePixels, type ArtTransform } from '../../src/isometric-art/viewport.ts';
import { expect, test } from './fixtures/test.ts';

interface ManifestLite {
  coordinateSpace: { width: number; height: number };
  hotspots: {
    hotspotId: string;
    subjectId: string;
    polygon: [number, number][];
    labelAnchor: [number, number];
    reviewStatus: string;
    kind: string;
    printedLabel: string | null;
  }[];
  subjects: {
    subjectId: string;
    displayLabel: { text: string } | null;
    visibleBlockLabel: { text: string } | null;
    displayHold: unknown;
  }[];
  assets: {
    assetId: string;
    derived: { purpose: string; url: string }[];
    original: { url: string } | null;
  }[];
  associations: { subjectId: string; status: string; buildingId: string | null }[];
}

const MANIFEST = JSON.parse(
  readFileSync(join(process.cwd(), 'public/isometric-art/manifest.json'), 'utf8'),
) as ManifestLite;
const MASTER = MANIFEST.assets.find((a) => a.assetId === 'iso-art-001')!;
/** The reference the screenshot is registered against: the sRGB web copy, else the original. */
const REFERENCE_URL = `/isometric-art/${MASTER.derived.find((d) => d.purpose === 'web-full')?.url ?? MASTER.original!.url}`;
const SPACE = MANIFEST.coordinateSpace;

/** Hides everything but the artwork layer (visibility: the layout and the transform are untouched). */
const ONLY_ART = `body * { visibility: hidden !important; transition: none !important; }
[data-testid="art-layer"], [data-testid="art-layer"] * { visibility: visible !important; }
[data-testid="art-selection"], [data-testid="art-selection"] * { visibility: hidden !important; }`;

async function openArt(page: Page, params: Record<string, string> = {}): Promise<void> {
  const qs = new URLSearchParams({ e2e: '1', view: 'iso', iso: 'art', ...params });
  await page.goto(`/?${qs.toString()}`);
  await page.waitForFunction(() => window.__ATLAS_ART__?.getStats().firstPaintMs != null, null, {
    timeout: 30_000,
  });
  await expect(page.getByTestId('art-view')).toBeVisible();
  await waitForImages(page);
}

/** The set of image files stops changing (tiles are planned after a gesture commits) and all are decoded. */
async function waitForStableImages(page: Page): Promise<void> {
  let previous = '';
  for (let i = 0; i < 30; i++) {
    await waitForImages(page);
    const now = await page.evaluate(() => JSON.stringify(window.__ATLAS_ART__!.getImageLayers()));
    if (now === previous) return;
    previous = now;
    await page.waitForTimeout(200);
  }
  throw new Error('the image files of the overview never settled');
}

/** Every image file of the layer decoded (tiles load as the view changes). */
async function waitForImages(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll<HTMLImageElement>('[data-testid="art-layer"] img')].every(
        (i) => i.complete && i.naturalWidth > 0,
      ),
    null,
    { timeout: 30_000 },
  );
  // Two frames so the decoded images are on screen.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function transformOf(
  page: Page,
): Promise<{ t: ArtTransform; stage: { x: number; y: number; width: number; height: number }; dpr: number }> {
  return page.evaluate(() => ({
    t: window.__ATLAS_ART__!.getTransform(),
    stage: window.__ATLAS_ART__!.getStageRect(),
    dpr: window.devicePixelRatio,
  }));
}

async function screenshotOnlyArt(page: Page): Promise<string> {
  const style = await page.addStyleTag({ content: ONLY_ART });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const png = await page.screenshot({ animations: 'disabled', scale: 'device' });
  await style.evaluate((el) => (el as Element).remove());
  return png.toString('base64');
}

interface ImageRegistration {
  best: { dx: number; dy: number };
  madAt0: number;
  madBest: number;
  madShift3: number;
  samples: number;
}

/** Registers the screenshot against the reference image drawn with the reported (snapped) transform. */
async function registerImage(
  page: Page,
  shot: string,
  t: ArtTransform,
  stage: { x: number; y: number; width: number; height: number },
  dpr: number,
): Promise<ImageRegistration> {
  const snapped = snapToDevicePixels(t, dpr);
  return page.evaluate(
    async ({ shot, snapped, stage, dpr, ref, space }) => {
      const load = async (src: string) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        return img;
      };
      const a = await load(`data:image/png;base64,${shot}`);
      const W = a.naturalWidth;
      const H = a.naturalHeight;
      const ca = new OffscreenCanvas(W, H);
      const xa = ca.getContext('2d')!;
      xa.drawImage(a, 0, 0);
      const A = xa.getImageData(0, 0, W, H).data;
      const r = await load(ref);
      const cb = new OffscreenCanvas(W, H);
      const xb = cb.getContext('2d')!;
      xb.imageSmoothingQuality = 'high';
      xb.setTransform(
        dpr * snapped.scale,
        0,
        0,
        dpr * snapped.scale,
        dpr * (stage.x + snapped.tx),
        dpr * (stage.y + snapped.ty),
      );
      xb.drawImage(r, 0, 0, space.width, space.height);
      const B = xb.getImageData(0, 0, W, H).data;
      // Central 70 % of the stage (device px), away from its edges, and only where the artwork is.
      const ax0 = Math.ceil(dpr * (stage.x + snapped.tx)) + 4;
      const ay0 = Math.ceil(dpr * (stage.y + snapped.ty)) + 4;
      const ax1 = Math.floor(dpr * (stage.x + snapped.tx + snapped.scale * space.width)) - 5;
      const ay1 = Math.floor(dpr * (stage.y + snapped.ty + snapped.scale * space.height)) - 5;
      const x0 = Math.max(4, ax0, Math.round(dpr * (stage.x + stage.width * 0.15)));
      const x1 = Math.min(W - 5, ax1, Math.round(dpr * (stage.x + stage.width * 0.85)));
      const y0 = Math.max(4, ay0, Math.round(dpr * (stage.y + stage.height * 0.15)));
      const y1 = Math.min(H - 5, ay1, Math.round(dpr * (stage.y + stage.height * 0.85)));
      const step = 3;
      const mad = (dx: number, dy: number) => {
        let s = 0;
        let n = 0;
        for (let y = y0; y < y1; y += step)
          for (let x = x0; x < x1; x += step) {
            const i = (y * W + x) * 4;
            const j = ((y + dy) * W + (x + dx)) * 4;
            s += Math.abs(A[i]! - B[j]!) + Math.abs(A[i + 1]! - B[j + 1]!) + Math.abs(A[i + 2]! - B[j + 2]!);
            n += 3;
          }
        return { m: s / n, n };
      };
      let best = { dx: 0, dy: 0 };
      let madBest = Infinity;
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const { m } = mad(dx, dy);
          if (m < madBest) {
            madBest = m;
            best = { dx, dy };
          }
        }
      const at0 = mad(0, 0);
      return { best, madAt0: at0.m, madBest, madShift3: mad(3, 3).m, samples: at0.n };
    },
    { shot, snapped, stage, dpr, ref: REFERENCE_URL, space: SPACE },
  );
}

interface OutlineRegistration {
  changed: number;
  /** Outline edge points the transform puts inside the stage (0: no outline is in view). */
  predictedEdgePoints: number;
  /** Shift of the predicted polygons (device px) that best fits the drawn outlines. */
  shift: { dx: number; dy: number };
  meanAt0: number;
  bestMean: number;
  p95: number;
  max: number;
  coverage: number;
  edgeSamples: number;
}

/** Pixels changed by "Show outlines" vs the polygons placed with the reported transform. */
async function registerOutlines(
  page: Page,
  off: string,
  off2: string,
  on: string,
  t: ArtTransform,
  stage: { x: number; y: number; width: number; height: number },
  dpr: number,
): Promise<OutlineRegistration> {
  const snapped = snapToDevicePixels(t, dpr);
  const polys = MANIFEST.hotspots.map((h) => ({ solid: h.reviewStatus === 'traced', pts: h.polygon }));
  return page.evaluate(
    async ({ off, off2, on, snapped, stage, dpr, polys, space }) => {
      const pixels = async (b64: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
        const x = c.getContext('2d')!;
        x.drawImage(img, 0, 0);
        return {
          d: x.getImageData(0, 0, img.naturalWidth, img.naturalHeight).data,
          W: img.naturalWidth,
          H: img.naturalHeight,
        };
      };
      const A = await pixels(off);
      const A2 = await pixels(off2);
      const B = await pixels(on);
      const W = A.W;
      const H = A.H;
      const toDev = ([nx, ny]: [number, number]) => [
        dpr * (stage.x + snapped.tx + snapped.scale * nx * space.width),
        dpr * (stage.y + snapped.ty + snapped.scale * ny * space.height),
      ];
      const rings = polys.map((p) => ({ solid: p.solid, pts: p.pts.map(toDev) }));
      const segs: [number, number, number, number][] = [];
      for (const r of rings)
        for (let i = 0; i < r.pts.length; i++) {
          const a = r.pts[i]!;
          const b = r.pts[(i + 1) % r.pts.length]!;
          segs.push([a[0]!, a[1]!, b[0]!, b[1]!]);
        }
      const dist = (x: number, y: number) => {
        let best = Infinity;
        for (const [ax, ay, bx, by] of segs) {
          const dx = bx - ax;
          const dy = by - ay;
          const l2 = dx * dx + dy * dy;
          const k = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
          const d = Math.hypot(x - (ax + k * dx), y - (ay + k * dy));
          if (d < best) best = d;
        }
        return best;
      };
      const inStage = (x: number, y: number) =>
        x >= dpr * stage.x + 2 &&
        y >= dpr * stage.y + 2 &&
        x < dpr * (stage.x + stage.width) - 2 &&
        y < dpr * (stage.y + stage.height) - 2 &&
        x < W - 2 &&
        y < H - 2;
      const mask = new Uint8Array(W * H);
      const ds: number[] = [];
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const diff =
            Math.abs(A.d[i]! - B.d[i]!) +
            Math.abs(A.d[i + 1]! - B.d[i + 1]!) +
            Math.abs(A.d[i + 2]! - B.d[i + 2]!);
          const unstable =
            Math.abs(A.d[i]! - A2.d[i]!) +
            Math.abs(A.d[i + 1]! - A2.d[i + 1]!) +
            Math.abs(A.d[i + 2]! - A2.d[i + 2]!);
          if (diff > 60 && unstable <= 30 && inStage(x, y)) {
            mask[y * W + x] = 1;
            if (ds.length < 60000) ds.push(dist(x + 0.5, y + 0.5));
          }
        }
      ds.sort((a, b) => a - b);
      // Registration: shift the predicted polygons by whole device px and find the best fit
      // (mean distance of up to 4000 changed pixels). Robust to the stroke's width and antialiasing.
      const changedPts: [number, number][] = [];
      const stride = Math.max(1, Math.floor(ds.length / 4000));
      let k = 0;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
          if (mask[y * W + x] && k++ % stride === 0) changedPts.push([x + 0.5, y + 0.5]);
      let shift = { dx: 0, dy: 0 };
      let bestMean = Infinity;
      let meanAt0 = Infinity;
      for (let sy = -2; sy <= 2; sy++)
        for (let sx = -2; sx <= 2; sx++) {
          let sum = 0;
          for (const [x, y] of changedPts) sum += dist(x - sx, y - sy);
          const mean = sum / Math.max(1, changedPts.length);
          if (sx === 0 && sy === 0) meanAt0 = mean;
          if (mean < bestMean - 1e-9) {
            bestMean = mean;
            shift = { dx: sx, dy: sy };
          }
        }
      // Coverage: points along SOLID outline edges (inside the stage) have a changed pixel within 2 device px.
      let hit = 0;
      let total = 0;
      for (const r of rings) {
        if (!r.solid) continue;
        for (let i = 0; i < r.pts.length; i++) {
          const a = r.pts[i]!;
          const b = r.pts[(i + 1) % r.pts.length]!;
          const len = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
          for (let s = 3; s < len - 3; s += 6) {
            const x = a[0]! + ((b[0]! - a[0]!) * s) / len;
            const y = a[1]! + ((b[1]! - a[1]!) * s) / len;
            if (!inStage(x, y)) continue;
            total += 1;
            let found = false;
            for (let oy = -2; oy <= 2 && !found; oy++)
              for (let ox = -2; ox <= 2 && !found; ox++) {
                const px = Math.round(x + ox);
                const py = Math.round(y + oy);
                if (px >= 0 && py >= 0 && px < W && py < H && mask[py * W + px]) found = true;
              }
            if (found) hit += 1;
          }
        }
      }
      // Outline edge points (every 6 device px, all outlines) that the transform puts inside the stage.
      let predicted = 0;
      for (const r of rings)
        for (let i = 0; i < r.pts.length; i++) {
          const a = r.pts[i]!;
          const b = r.pts[(i + 1) % r.pts.length]!;
          const len = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
          for (let d = 0; d < len; d += 6)
            if (inStage(a[0]! + ((b[0]! - a[0]!) * d) / len, a[1]! + ((b[1]! - a[1]!) * d) / len))
              predicted += 1;
        }
      return {
        changed: ds.length,
        predictedEdgePoints: predicted,
        shift,
        meanAt0,
        bestMean,
        p95: ds.length ? ds[Math.floor(ds.length * 0.95)]! : Infinity,
        max: ds.length ? ds[ds.length - 1]! : Infinity,
        coverage: total ? hit / total : 0,
        edgeSamples: total,
      };
    },
    { off, off2, on, snapped, stage, dpr, polys, space: SPACE },
  );
}

/** One full alignment check of the current view; returns the measurements for the report. */
async function checkAlignment(page: Page, testInfo: TestInfo, step: string): Promise<boolean> {
  await waitForStableImages(page);
  const { t, stage, dpr } = await transformOf(page);
  // Toggled programmatically: on a phone a toast may cover the checkbox (it is hidden for the screenshots anyway).
  const setOutlines = (on: boolean) =>
    page.getByTestId('art-show-outlines').evaluate((el: HTMLInputElement, want) => {
      if (el.checked !== want) el.click();
    }, on);
  await setOutlines(false);
  const off = await screenshotOnlyArt(page);
  const img = await registerImage(page, off, t, stage, dpr);
  // A second "off" shot: pixels that change without the outlines (late image decoding) are ignored.
  const off2 = await screenshotOnlyArt(page);
  await setOutlines(true);
  const on = await screenshotOnlyArt(page);
  await setOutlines(false);
  const ol = await registerOutlines(page, off, off2, on, t, stage, dpr);
  if (ol.p95 > 1.5 * dpr + 1 || Math.abs(ol.shift.dx) > 1 || Math.abs(ol.shift.dy) > 1) {
    const dump = testInfo.outputPath(`outline-diff-${step.replace(/\W+/g, '-')}`);
    writeFileSync(`${dump}-off.png`, Buffer.from(off, 'base64'));
    writeFileSync(`${dump}-on.png`, Buffer.from(on, 'base64'));
    writeFileSync(`${dump}.json`, JSON.stringify({ t, stage, dpr, ol }));
  }
  await testInfo.attach(`alignment ${step}`, {
    body: JSON.stringify({ transform: t, dpr, image: img, outlines: ol }, null, 2),
    contentType: 'application/json',
  });
  // Image: the unshifted overlay is the best match (±1 device px) and clearly better than a 3 px shift.
  expect(Math.abs(img.best.dx), `${step}: image x offset`).toBeLessThanOrEqual(1);
  expect(Math.abs(img.best.dy), `${step}: image y offset`).toBeLessThanOrEqual(1);
  expect(img.madShift3, `${step}: a 3 px shift is visibly worse`).toBeGreaterThan(img.madAt0 * 1.15);
  // Outlines: drawn where the transform puts the polygons (when any outline is in view at all).
  const outlinesInView = ol.predictedEdgePoints > 20;
  if (outlinesInView) {
    expect(ol.changed, `${step}: outlines visible`).toBeGreaterThan(100);
    // Best fit of the predicted polygons is the unshifted one (±1 device px)…
    expect(Math.abs(ol.shift.dx), `${step}: outline x offset`).toBeLessThanOrEqual(1);
    expect(Math.abs(ol.shift.dy), `${step}: outline y offset`).toBeLessThanOrEqual(1);
    // …and every drawn outline pixel is within the stroke (1.5 CSS px, antialiased) of a polygon edge.
    expect(ol.p95, `${step}: outline pixels on the polygons (p95, device px)`).toBeLessThanOrEqual(
      1.5 * dpr + 1,
    );
    if (ol.edgeSamples > 20) expect(ol.coverage, `${step}: polygon edges drawn`).toBeGreaterThan(0.9);
  } else expect(ol.changed, `${step}: no outline in view, none drawn`).toBeLessThan(50);

  // Hit-testing: a click on a hotspot's interior anchor selects it.
  const target = await page.evaluate(
    ({ hotspots, space }) => {
      const t = window.__ATLAS_ART__!.getTransform();
      const st = window.__ATLAS_ART__!.getStageRect();
      // A large traced pin outline fully on screen and clear of the overlays.
      const cands = hotspots
        .map((h) => {
          const x = st.x + t.tx + t.scale * h.labelAnchor[0] * space.width;
          const y = st.y + t.ty + t.scale * h.labelAnchor[1] * space.height;
          return { id: h.hotspotId, subject: h.subjectId, x, y };
        })
        .filter(
          (c) =>
            c.x > st.x + st.width * 0.25 &&
            c.x < st.x + st.width * 0.7 &&
            c.y > st.y + st.height * 0.3 &&
            c.y < st.y + st.height * 0.7,
        )
        .filter((c) => {
          const el = document.elementFromPoint(c.x, c.y);
          return el?.closest('[data-testid="art-stage"]') !== null;
        });
      return cands[0] ?? null;
    },
    { hotspots: MANIFEST.hotspots.filter((h) => h.kind === 'pin-structure'), space: SPACE },
  );
  if (target) {
    await page.mouse.click(target.x, target.y);
    await expect
      .poll(() => page.evaluate(() => window.__ATLAS_ART__!.getSelectedSubjectIds()))
      .toEqual([target.subject]);
    await page.getByTestId('art-stage').press('Escape');
    await expect.poll(() => page.evaluate(() => window.__ATLAS_ART__!.getSelectedSubjectIds())).toEqual([]);
  }
  return outlinesInView;
}

/** Screen point of the hotspot anchor nearest the stage centre (gestures centred there keep outlines in view). */
async function hotspotNearCentre(page: Page) {
  return page.evaluate(
    ({ anchors, space }) => {
      const t = window.__ATLAS_ART__!.getTransform();
      const st = window.__ATLAS_ART__!.getStageRect();
      const cx = st.x + st.width / 2;
      const cy = st.y + st.height / 2;
      let best = { x: cx, y: cy, d: Infinity };
      // Central region only, and a point (±80 px across, for two fingers) that reaches the stage itself.
      const onStage = (x: number, y: number) =>
        document.elementFromPoint(x, y)?.closest('[data-testid="art-stage"]') != null;
      for (const [nx, ny] of anchors) {
        const x = st.x + t.tx + t.scale * nx * space.width;
        const y = st.y + t.ty + t.scale * ny * space.height;
        if (x < st.x + st.width * 0.3 || x > st.x + st.width * 0.7) continue;
        if (y < st.y + st.height * 0.3 || y > st.y + st.height * 0.7) continue;
        if (!onStage(x - 80, y) || !onStage(x + 80, y) || !onStage(x, y)) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d < best.d) best = { x, y, d };
      }
      return { x: best.x, y: best.y };
    },
    { anchors: MANIFEST.hotspots.map((h) => h.labelAnchor), space: SPACE },
  );
}

async function stageCentre(page: Page) {
  const s = await page.evaluate(() => window.__ATLAS_ART__!.getStageRect());
  return { x: s.x + s.width / 2, y: s.y + s.height / 2 };
}

async function touch(
  cdp: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  points: { x: number; y: number }[],
) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })),
  });
}

test.describe('illustrated overview', () => {
  test('image, outlines and hit-testing stay aligned through zoom, pan, pinch and resize', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await openArt(page);
    const touchProject = (page.viewportSize()?.width ?? 1440) < 1000;
    const checked: boolean[] = [];
    checked.push(await checkAlignment(page, testInfo, 'open'));

    const h0 = await hotspotNearCentre(page);
    await page.mouse.move(h0.x, h0.y);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(300); // the wheel commit settles after 140 ms
    checked.push(await checkAlignment(page, testInfo, 'wheel zoom in'));

    if (touchProject) {
      const c = await hotspotNearCentre(page);
      const cdp = await page.context().newCDPSession(page);
      await touch(cdp, 'touchStart', [{ x: c.x, y: c.y }]);
      for (let i = 1; i <= 6; i++) await touch(cdp, 'touchMove', [{ x: c.x - 15 * i, y: c.y - 10 * i }]);
      await touch(cdp, 'touchEnd', []);
      checked.push(await checkAlignment(page, testInfo, 'touch pan'));
      const before = (await transformOf(page)).t.scale;
      const p = await hotspotNearCentre(page);
      await touch(cdp, 'touchStart', [
        { x: p.x - 30, y: p.y },
        { x: p.x + 30, y: p.y },
      ]);
      for (let i = 1; i <= 6; i++)
        await touch(cdp, 'touchMove', [
          { x: p.x - 30 - 3 * i, y: p.y },
          { x: p.x + 30 + 3 * i, y: p.y },
        ]);
      await touch(cdp, 'touchEnd', []);
      expect((await transformOf(page)).t.scale, 'pinch zooms in').toBeGreaterThan(before);
      checked.push(await checkAlignment(page, testInfo, 'pinch zoom'));
    } else {
      const c = await stageCentre(page);
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      await page.mouse.move(c.x - 120, c.y - 80, { steps: 8 });
      await page.mouse.up();
      checked.push(await checkAlignment(page, testInfo, 'drag pan'));
    }

    await page.getByTestId('art-stage').focus();
    await page.keyboard.press('-');
    await page.keyboard.press('-');
    checked.push(await checkAlignment(page, testInfo, 'keyboard zoom out'));

    const vp = page.viewportSize()!;
    await page.setViewportSize({ width: vp.height, height: vp.width });
    await page.waitForTimeout(300);
    checked.push(await checkAlignment(page, testInfo, 'resize'));
    await page.setViewportSize(vp);
    // Outlines were in view (and checked) in nearly every step; the image was checked in all.
    expect(checked.filter(Boolean).length, 'steps with outlines checked').toBeGreaterThanOrEqual(
      checked.length - 1,
    );
  });

  test('opens readable, says it is schematic, and shows the artwork legend crop', async ({
    page,
  }, testInfo) => {
    await openArt(page);
    const { t } = await transformOf(page);
    // Never shrunk to illegibility: pin numbers (about 18 source px) at least ~6.5 CSS px.
    expect(t.scale).toBeGreaterThanOrEqual(0.36);
    if ((page.viewportSize()?.width ?? 1440) < 800) expect(t.scale).toBeGreaterThanOrEqual(0.5);
    await expect(page.getByTestId('art-notice')).toHaveText(
      'Illustration — not to scale; positions are schematic',
    );
    await expect(page.getByRole('radiogroup', { name: 'Overview style' })).toBeVisible();
    const shot = testInfo.outputPath('art-open.png');
    await page.screenshot({ path: shot });
    await testInfo.attach('art-open', { path: shot, contentType: 'image/png' });

    await page
      .getByRole('region', { name: 'Illustration legend' })
      .getByRole('button', { name: 'Show legend' })
      .click();
    const crop = page.getByTestId('art-legend-crop');
    await expect(crop).toBeVisible();
    await expect(
      page.getByRole('img', {
        name: /GARDEN OR GROUND AREA, ROAD, PEDISTRIAN, PARKING AREA, LPU SURROUNDINGS/,
      }),
    ).toBeVisible();
    await page.waitForFunction(() => {
      const i = document.querySelector<HTMLImageElement>('[data-testid="art-legend-crop"]');
      return i?.complete && i.naturalWidth > 0;
    });
    const legendShot = testInfo.outputPath('art-legend.png');
    await page.getByTestId('art-legend').screenshot({ path: legendShot });
    await testInfo.attach('art-legend', { path: legendShot, contentType: 'image/png' });
  });

  test('keyboard: Tab walks the outlines in printed-number order, Enter selects, focus keeps the layer in place', async ({
    page,
  }, testInfo) => {
    await openArt(page);
    const stage = page.getByTestId('art-stage');
    await stage.focus();
    const pins = MANIFEST.hotspots
      .filter((h) => h.kind === 'pin-structure')
      .sort((a, b) => Number(a.printedLabel) - Number(b.printedLabel));
    for (const pin of pins.slice(0, 4)) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(
        () => document.activeElement?.getAttribute('data-hotspot-id') ?? null,
      );
      expect(focused).toBe(pin.hotspotId);
    }
    // Jump far down the order: the focused outline is panned into view, the stage is never scrolled.
    for (let i = 4; i < 40; i++) await page.keyboard.press('Tab');
    const id = await page.evaluate(() => document.activeElement?.getAttribute('data-hotspot-id') ?? null);
    expect(id).toBe(pins[39]!.hotspotId);
    await page.waitForTimeout(400);
    const geom = await page.evaluate((hid) => {
      const el = document.querySelector(`[data-hotspot-id="${hid}"]`)!.getBoundingClientRect();
      const st = document.querySelector('[data-testid="art-stage"]')!;
      return {
        box: { x: el.x, y: el.y, w: el.width, h: el.height },
        stage: st.getBoundingClientRect().toJSON() as DOMRect,
        scroll: [st.scrollLeft, st.scrollTop],
      };
    }, id!);
    expect(geom.scroll).toEqual([0, 0]);
    expect(geom.box.x).toBeGreaterThanOrEqual(geom.stage.x - 1);
    expect(geom.box.x + geom.box.w).toBeLessThanOrEqual(geom.stage.x + geom.stage.width + 1);
    await page.keyboard.press('Enter');
    const subject = MANIFEST.hotspots.find((h) => h.hotspotId === id)!.subjectId;
    await expect
      .poll(() => page.evaluate(() => window.__ATLAS_ART__!.getSelectedSubjectIds()))
      .toEqual([subject]);
    await expect(page.getByTestId('art-detail-card')).toBeVisible();
    // The outline's accessible name quotes the exact printed label.
    const s = MANIFEST.subjects.find((x) => x.subjectId === subject)!;
    const exact = s.displayHold ? null : (s.displayLabel?.text ?? s.visibleBlockLabel?.text ?? null);
    if (exact)
      await expect(page.locator(`[data-hotspot-id="${id}"]`)).toHaveAttribute(
        'aria-label',
        new RegExp(`^${exact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      );
    // Alignment holds after keyboard focus panning.
    await page.keyboard.press('Escape');
    await checkAlignment(page, testInfo, 'after keyboard focus');
  });

  test('detail card: exact artwork label, separate official fields, unconfirmed match without directions', async ({
    page,
  }, testInfo) => {
    const approx = MANIFEST.associations.find((a) => a.status === 'approximate')!;
    await openArt(page);
    const poly = page.locator(`[data-subject-id="${approx.subjectId}"]`).first();
    await poly.focus();
    await page.keyboard.press('Enter');
    const card = page.getByTestId('art-detail-card');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('art-association-badge')).toHaveText('Unconfirmed match');
    // The selected outline is not hidden by the card, the variant switch or the notice
    // (it is panned into the free part of the stage).
    await expect
      .poll(() =>
        page.evaluate(() => {
          const sel = document.querySelector('[data-selected-hotspot-id]')?.getBoundingClientRect();
          const st = document.querySelector('[data-testid="art-stage"]')?.getBoundingClientRect();
          if (!sel || !st) return 'missing';
          for (const id of ['art-detail-card', 'iso-variant-switch', 'art-notice']) {
            const c = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
            if (c && sel.left < c.right && sel.right > c.left && sel.top < c.bottom && sel.bottom > c.top)
              return `hidden by ${id}`;
          }
          const inside =
            sel.left >= st.left && sel.right <= st.right && sel.top >= st.top && sel.bottom <= st.bottom;
          return inside ? 'visible' : 'off stage';
        }),
      )
      .toBe('visible');
    await expect(card.getByTestId('art-official-name')).toHaveText('Not verified');
    await expect(card.getByTestId('art-official-block')).toHaveText('Not verified');
    await expect(card.getByRole('button', { name: 'Directions' })).toHaveCount(0);
    const s = MANIFEST.subjects.find((x) => x.subjectId === approx.subjectId)!;
    if (s.displayLabel)
      await expect(card.getByTestId('art-exact-label').first()).toHaveText(s.displayLabel.text);
    const vignette = card.getByTestId('art-vignette').first();
    if ((await vignette.count()) > 0) {
      await vignette.scrollIntoViewIfNeeded();
      await expect
        .poll(() => vignette.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0))
        .toBe(true);
      expect(await vignette.getAttribute('src')).toMatch(/^\/isometric-art\/original\//);
    }
    const shot = testInfo.outputPath('art-card.png');
    await page.screenshot({ path: shot });
    await testInfo.attach('art-card', { path: shot, contentType: 'image/png' });

    await card.getByRole('button', { name: 'Show unconfirmed match on map' }).click();
    await expect(page).not.toHaveURL(/view=iso/);
    // Framed, never selected and never routed.
    await expect
      .poll(() => page.evaluate(() => window.__ATLAS_MAP__?.getSelectedId() ?? null))
      .not.toBe(approx.buildingId);
    expect(await page.evaluate(() => window.__ATLAS_MAP__?.getRouteCoordinateCount() ?? 0)).toBe(0);
  });

  test('a shared art: id selects and frames the same outline (one id across search, links and views)', async ({
    page,
  }) => {
    await openArt(page, { place: 'art:num-25' });
    await expect
      .poll(() => page.evaluate(() => window.__ATLAS_ART__!.getSelectedSubjectIds()))
      .toEqual(['art:num-25']);
    await expect(page.locator('[data-selected-hotspot-id="hs-pin-25"]')).toHaveCount(1);
    // Framed inside the stage.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const r = document.querySelector('[data-selected-hotspot-id="hs-pin-25"]')!.getBoundingClientRect();
          const st = document.querySelector('[data-testid="art-stage"]')!.getBoundingClientRect();
          return r.left >= st.left && r.right <= st.right && r.top >= st.top && r.bottom <= st.bottom;
        }),
      )
      .toBe(true);
    await expect(page).toHaveURL(/place=art%3Anum-25|place=art:num-25/);
  });

  test('axe finds no serious violation with a selection and the legend open @a11y', async ({
    page,
  }, testInfo) => {
    await openArt(page);
    await page.locator('[data-hotspot-id="hs-pin-25"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('art-detail-card')).toBeVisible();
    await page
      .getByRole('region', { name: 'Illustration legend' })
      .getByRole('button', { name: 'Show legend' })
      .click();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .analyze();
    await testInfo.attach('axe', {
      body:
        results.violations
          .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
          .join(' | ') || 'no violations',
      contentType: 'text/plain',
    });
    console.log(
      `[art-axe ${test.info().project.name}] ` +
        (results.violations
          .map((v) => `${v.impact}:${v.id}(${v.nodes.map((n) => n.target.join(' ')).join(', ')})`)
          .join(' ') || 'none'),
    );
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });

  test('variant switch: map-accurate on request, back to the illustration, URL mirrors it', async ({
    page,
  }) => {
    await openArt(page);
    await page.getByRole('radio', { name: 'Map-accurate' }).click();
    await expect(page).toHaveURL(/iso=map/);
    await page.waitForFunction(() => (window.__ATLAS_ISO__?.getFrameStats().fullRedraws ?? 0) > 0);
    await expect(page.getByTestId('iso-view')).toBeVisible();
    await page.getByRole('radio', { name: 'Illustrated' }).click();
    await expect(page).toHaveURL(/iso=art/);
    await expect(page.getByTestId('art-view')).toBeVisible();
  });

  test('an unreadable manifest falls back to the map-accurate drawing and says why', async ({ page }) => {
    await page.route('**/isometric-art/manifest.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"schemaVersion":99}' }),
    );
    await page.goto('/?e2e=1&view=iso');
    await page.waitForFunction(() => (window.__ATLAS_ISO__?.getFrameStats().fullRedraws ?? 0) > 0, null, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('art-unavailable')).toContainText('could not be loaded');
    await expect(page.getByRole('radio', { name: 'Illustrated' })).toBeDisabled();
  });
});

test.describe('illustrated overview performance', () => {
  test('first paint, bytes and pan/zoom frame times under 4× CPU throttle', async ({ page }, testInfo) => {
    const project = testInfo.project.name;
    test.skip(project !== 'desktop' && project !== 'mobile', 'measured on the desktop and phone profiles');
    test.setTimeout(180_000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const bytes = new Map<string, number>();
    cdp.on('Network.loadingFinished', (e: { requestId: string; encodedDataLength: number }) => {
      bytes.set(e.requestId, e.encodedDataLength);
    });
    const urls = new Map<string, string>();
    cdp.on('Network.requestWillBeSent', (e: { requestId: string; request: { url: string } }) => {
      urls.set(e.requestId, e.request.url);
    });
    const t0 = Date.now();
    await page.goto('/?e2e=1&view=iso&iso=art');
    await page.waitForFunction(() => window.__ATLAS_ART__?.getStats().firstPaintMs != null, null, {
      timeout: 60_000,
    });
    const firstPaint = await page.evaluate(() => ({
      sinceNavigation: performance.getEntriesByName('art:first-paint')[0]?.startTime ?? null,
      sinceStageMount: window.__ATLAS_ART__!.getStats().firstPaintMs,
      baseImageBytes: window.__ATLAS_ART__!.getStats().baseImageBytes,
      layers: window.__ATLAS_ART__!.getImageLayers(),
    }));
    await waitForImages(page);
    const wall = Date.now() - t0;
    const sum = (filter: (u: string) => boolean) =>
      [...bytes.entries()].filter(([id]) => filter(urls.get(id) ?? '')).reduce((s, [, b]) => s + b, 0);
    const loadBytes = {
      total: sum(() => true),
      art: sum((u) => u.includes('/isometric-art/')),
      artOverview: sum((u) => /\/isometric-art\/(manifest\.json|derived\/iso-art-001\/)/.test(u)),
      artVignettes: sum((u) => /\/isometric-art\/original\/.*\.png/.test(u)),
      largest: [...bytes.entries()]
        .map(([id, b]) => ({ url: (urls.get(id) ?? '').replace(/^https?:\/\/[^/]+/, ''), bytes: b }))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 8),
    };

    // Frame times while panning and zooming (rAF intervals in the page).
    await page.evaluate(() => {
      const w = window as unknown as { __frames: number[] };
      w.__frames = [];
      let last = performance.now();
      const tick = (now: number) => {
        w.__frames.push(now - last);
        last = now;
        if (w.__frames.length < 100000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const c = await stageCentre(page);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x - 150, c.y - 100, { steps: 40 });
    await page.mouse.move(c.x + 50, c.y + 60, { steps: 40 });
    await page.mouse.up();
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, i < 6 ? -80 : 80);
      await page.waitForTimeout(30);
    }
    const frames = await page.evaluate(() => {
      const w = window as unknown as { __frames: number[] };
      const f = w.__frames.slice(2);
      w.__frames = [];
      return f;
    });
    const sorted = [...frames].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
    const work = await page.evaluate(() => window.__ATLAS_ART__!.getStats());
    const result = {
      project,
      cpuThrottle: 4,
      firstPaintMs: firstPaint,
      wallClockToImagesDecodedMs: wall,
      loadBytes,
      frames: { n: frames.length, median: q(0.5), p95: q(0.95), max: sorted[sorted.length - 1] ?? null },
      lastTransformWorkMs: work.lastFrameWorkMs,
    };
    console.log(`[art-perf] ${JSON.stringify(result)}`);
    await testInfo.attach('art-perf', {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    expect(firstPaint.sinceStageMount).not.toBeNull();
    // Opening never downloads the full-size copy or the 5 MB original: the preview and visible tiles only.
    const requested = [...urls.values()];
    expect(requested.filter((u) => /web-full\.|1-lpu-isometric-map-design-3371\.jpg/.test(u))).toEqual([]);
    expect(frames.length).toBeGreaterThan(20);
  });
});
