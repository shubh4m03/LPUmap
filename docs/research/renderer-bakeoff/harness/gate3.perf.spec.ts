/**
 * Gate 3 bake-off (S1): the three studio-model render paths on the same data,
 * the same 50 instances and the same camera script.
 *
 * Writes JSON to BAKEOFF_RESULTS and JPEG screenshots to BAKEOFF_SHOTS. Frame
 * timings run under a 4× CDP CPU throttle. Headless Chromium draws WebGL on
 * SwiftShader (CPU), so (a)/(b) frame times are a relative comparison on this
 * machine, not device numbers (docs/ISOMETRIC_AND_3D_DESIGN.md §9.1).
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type CDPSession, type Page } from '@playwright/test';

const RESULTS = process.env.BAKEOFF_RESULTS ?? path.resolve('docs/research/renderer-bakeoff/results');
const SHOTS = process.env.BAKEOFF_SHOTS ?? path.resolve('docs/research/renderer-bakeoff/screenshots');
/** CDP CPU throttle for frame timings (default 4×; BAKEOFF_THROTTLE=1 gives an unthrottled reference run). */
const THROTTLE = Number(process.env.BAKEOFF_THROTTLE ?? 4);
const SUFFIX = THROTTLE === 4 ? '' : `-throttle${THROTTLE}`;
const ORBIT_MS = 4000;

fs.mkdirSync(RESULTS, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

type Renderer = 'baseline' | 'extrusion' | 'custom' | 'iso';

interface FrameStats {
  frames: number;
  p50: number;
  p95: number;
  max: number;
  over50Pct: number;
}

function stats(values: readonly number[]): FrameStats {
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]! : 0);
  return {
    frames: s.length,
    p50: +q(50).toFixed(2),
    p95: +q(95).toFixed(2),
    max: +(s.at(-1) ?? 0).toFixed(2),
    over50Pct: s.length ? +((100 * s.filter((v) => v > 50).length) / s.length).toFixed(1) : 0,
  };
}

function save(name: string, data: unknown): void {
  fs.writeFileSync(path.join(RESULTS, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
}

async function open(page: Page, renderer: Renderer, extra = ''): Promise<void> {
  await page.goto(`/?renderer=${renderer}&n=50&e2e=1${extra}`);
  await page.waitForFunction(() => Boolean(window.__BAKEOFF__ || window.__BAKEOFF_ERROR__), null, {
    timeout: 120_000,
  });
  const err = await page.evaluate(() => window.__BAKEOFF_ERROR__ ?? null);
  expect(err, 'harness started').toBeNull();
  await page.evaluate(() => window.__BAKEOFF__!.idle());
}

async function heapMB(cdp: CDPSession): Promise<number> {
  await cdp.send('HeapProfiler.collectGarbage');
  const { metrics } = await cdp.send('Performance.getMetrics');
  return +((metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0) / 1048576).toFixed(2);
}

async function shot(page: Page, name: string): Promise<string> {
  const file = path.join(SHOTS, `${name}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 78 });
  return path.basename(file);
}

async function mapOrbit(page: Page, cdp: CDPSession) {
  await page.evaluate(() => window.__BAKEOFF__!.view('overview'));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await page.evaluate((ms) => window.__BAKEOFF__!.orbit(ms), 1500); // warm-up, discarded
  const runs = [];
  for (let i = 0; i < 2; i++) runs.push(await page.evaluate((ms) => window.__BAKEOFF__!.orbit(ms), ORBIT_MS));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  return {
    frames: stats(runs.flatMap((r) => r.intervals)),
    layerCpuMs: stats(runs.flatMap((r) => r.layerMs)),
  };
}

/** Pan the overview with a real pointer drag (its cached-bitmap gesture path), recording rAF intervals. */
async function isoGesture(page: Page, cdp: CDPSession, width: number, height: number) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await page.evaluate(() => {
    const t: number[] = [];
    let last = performance.now();
    const w = window as unknown as { __REC__?: number[]; __REC_ON__?: boolean };
    w.__REC__ = t;
    w.__REC_ON__ = true;
    const tick = (now: number) => {
      t.push(now - last);
      last = now;
      if (w.__REC_ON__) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const cx = width / 2;
  const cy = height / 2;
  for (let pass = 0; pass < 2; pass++) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 60; i++) await page.mouse.move(cx + (pass ? -1 : 1) * i * 3, cy + i * 1.5);
    await page.mouse.up();
  }
  const intervals = await page.evaluate(() => {
    const w = window as unknown as { __REC__?: number[]; __REC_ON__?: boolean };
    w.__REC_ON__ = false;
    return (w.__REC__ ?? []).slice(1);
  });
  // A full redraw at 4×: rotate the overview (scene build + static redraw).
  await page.getByRole('button', { name: 'Rotate view right' }).click();
  await page.waitForTimeout(800);
  const afterRotate = await page.evaluate(() => window.__ATLAS_ISO__?.getFrameStats() ?? null);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  return { frames: stats(intervals), afterRotate };
}

async function picking(page: Page, count: number, pitch?: number) {
  const results: Array<{ key: string; expected: string; got: string | null }> = [];
  const instances = await page.evaluate(() => window.__BAKEOFF__!.instances);
  for (let i = 0; i < Math.min(count, instances.length); i++) {
    const pt = await page.evaluate(([idx, p]) => window.__BAKEOFF__!.pickTarget(idx, p), [i, pitch] as const);
    if (pt) await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(30);
    results.push({
      key: instances[i]!.key,
      expected: instances[i]!.id,
      got: pt ? await page.evaluate(() => window.__BAKEOFF__!.lastSelected()) : null,
    });
  }
  return { correct: results.filter((r) => r.got === r.expected).length, total: results.length, results };
}

for (const vp of [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false },
  { name: 'mobile', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true },
] as const) {
  test.describe(`${vp.name}`, () => {
    test.use({
      viewport: vp.viewport,
      deviceScaleFactor: vp.deviceScaleFactor,
      isMobile: vp.isMobile,
      hasTouch: vp.isMobile,
    });

    for (const renderer of ['baseline', 'extrusion', 'custom'] as const) {
      test(`${renderer}: frames at ${THROTTLE}× throttle, memory, screenshots`, async ({ page }) => {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Performance.enable');
        await open(page, renderer, '&watchdog=off');
        const heap = await heapMB(cdp);
        const shots = SUFFIX ? [] : [await shot(page, `${vp.name}-${renderer}-overview`)];
        if (!SUFFIX && vp.name === 'desktop' && renderer !== 'baseline')
          for (const key of ['A', 'B', 'C', 'D']) {
            await page.evaluate((k) => window.__BAKEOFF__!.view(k), key);
            shots.push(await shot(page, `${vp.name}-${renderer}-${key}`));
          }
        const orbit = await mapOrbit(page, cdp);
        const debug = await page.evaluate(() => window.__BAKEOFF__!.debug());
        save(`${vp.name}-${renderer}${SUFFIX}`, {
          renderer,
          viewport: vp,
          throttle: THROTTLE,
          orbitMs: ORBIT_MS,
          heapMB: heap,
          ...orbit,
          debug,
          shots,
        });
      });
    }

    test('iso: gesture frames and full redraw at 4×, screenshots', async ({ page }) => {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Performance.enable');
      await open(page, 'iso');
      await page.waitForTimeout(500);
      const heap = await heapMB(cdp);
      const initial = await page.evaluate(() => window.__ATLAS_ISO__?.getFrameStats() ?? null);
      const shots = [await shot(page, `${vp.name}-iso-overview`)];
      if (vp.name === 'desktop')
        for (const key of ['A', 'B', 'C', 'D']) {
          await page.evaluate((k) => window.__BAKEOFF__!.view(k), key);
          await page.waitForTimeout(400);
          shots.push(await shot(page, `${vp.name}-iso-${key}`));
        }
      await page.evaluate(() => window.__BAKEOFF__!.view('overview'));
      await page.waitForTimeout(400);
      const gesture = await isoGesture(page, cdp, vp.viewport.width, vp.viewport.height);
      save(`${vp.name}-iso`, {
        renderer: 'iso',
        viewport: vp,
        throttle: THROTTLE,
        heapMB: heap,
        initial,
        ...gesture,
        shots,
      });
    });
  });
}

test.describe('desktop checks', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const renderer of ['extrusion', 'custom', 'iso'] as const) {
    test(`${renderer}: picking every instance at its roof centre`, async ({ page }) => {
      await open(page, renderer, '&watchdog=off');
      const tilted = await picking(page, 50);
      // Top-down (map modes): nothing can stand in front of the roof, so every miss here is a real error.
      const topDown = renderer === 'iso' ? null : await picking(page, 50, 0);
      save(`picking-${renderer}`, { tilted, topDown });
    });
  }

  test('custom: context loss → fallback → restore (one retry) → second loss stays on fallback', async ({
    page,
  }) => {
    await open(page, 'custom', '&watchdog=off');
    await page.evaluate(() => window.__BAKEOFF__!.view('D'));
    const d = () =>
      page.evaluate(
        () =>
          window.__BAKEOFF__!.debug() as {
            r3d: {
              studio: string;
              fallbackReason: string | null;
              excludedIds: string[];
              layer: { drawCalls: number } | null;
            } | null;
            notices: string[];
          },
      );
    const before = await d();
    const events: Array<{ step: string; ms: number; state: unknown }> = [];
    const t0 = Date.now();
    expect(await page.evaluate(() => window.__BAKEOFF__!.loseContext())).toBe(true);
    await page.waitForTimeout(300);
    events.push({ step: 'lost', ms: Date.now() - t0, state: await d() });
    const tRestore = Date.now();
    await page.evaluate(() => window.__BAKEOFF__!.restoreContext());
    await expect.poll(async () => (await d()).r3d?.studio, { timeout: 15_000 }).toBe('custom');
    await page.evaluate(() => window.__BAKEOFF__!.idle());
    const recoveredMs = Date.now() - tRestore;
    events.push({ step: 'restored', ms: recoveredMs, state: await d() });
    const shotRecovered = await shot(page, 'desktop-custom-after-context-restore');
    const pickAfterRestore = await picking(page, 4);

    await page.evaluate(() => window.__BAKEOFF__!.loseContext());
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__BAKEOFF__!.restoreContext());
    await expect.poll(async () => (await d()).r3d?.studio, { timeout: 15_000 }).toBe('fallback');
    await page.evaluate(() => window.__BAKEOFF__!.view('D'));
    const second = await d();
    events.push({ step: 'second-restore', ms: Date.now() - t0, state: second });
    expect(second.r3d?.fallbackReason).toBe('context-lost');
    expect(second.r3d?.excludedIds).toEqual([]);
    const shotFallback = await shot(page, 'desktop-custom-fallback-after-second-loss');
    const pickOnFallback = await picking(page, 4);
    save('context-loss-custom', {
      before,
      events,
      recoveredMs,
      pickAfterRestore,
      pickOnFallback,
      notices: second.notices,
      shots: [shotRecovered, shotFallback],
    });
  });

  test('detections: attribution names Microsoft and Google only while the layer is shown', async ({
    page,
  }) => {
    await open(page, 'extrusion');
    await page.evaluate(() => window.__BAKEOFF__!.view('overview'));
    const before = await page.evaluate(() => window.__BAKEOFF__!.showDetections(false));
    const shown = await page.evaluate(() => window.__BAKEOFF__!.showDetections(true));
    const shot1 = await shot(page, 'desktop-detections-layer');
    const hidden = await page.evaluate(() => window.__BAKEOFF__!.showDetections(false));
    expect(before).not.toMatch(/Microsoft|Open Buildings/);
    expect(shown).toMatch(/Microsoft/);
    expect(shown).toMatch(/Google Open Buildings/);
    expect(hidden).not.toMatch(/Microsoft|Open Buildings/);
    save('detections-attribution', { before, shown, hidden, shots: [shot1] });
  });

  test('custom: the watchdog degrades to the extrusion fallback under 4× throttle and says so', async ({
    page,
  }) => {
    const cdp = await page.context().newCDPSession(page);
    await open(page, 'custom');
    await page.evaluate(() => window.__BAKEOFF__!.view('overview'));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    for (let i = 0; i < 3; i++) await page.evaluate((ms) => window.__BAKEOFF__!.orbit(ms), 2500);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const debug = await page.evaluate(() => window.__BAKEOFF__!.debug());
    save('watchdog-custom', debug);
  });
});
