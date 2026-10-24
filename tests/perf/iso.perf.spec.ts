/**
 * D8 budget harness for the isometric overview (docs/ISOMETRIC_AND_3D_DESIGN.md §9).
 * Chromium + CDP CPU throttling (4× = the mid-range-phone proxy) + rAF timing.
 * The overview is driven only through the UI (keyboard, mouse, wheel); the
 * read-only __ATLAS_ISO__ hook supplies internal timings. Every number is
 * written to test-results/perf/iso.json before the budgets are asserted.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import os from 'node:os';
import { expect, test, type CDPSession, type Page } from '@playwright/test';

interface Stats {
  sceneBuildMs: number;
  fullRedrawMs: number;
  dynamicRedrawMs: number;
  hitTestMs: number;
  cycles: number;
  fullRedraws: number;
  buildings: number;
  faces: number;
}

const OUT = resolve(process.cwd(), 'test-results/perf');
const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;
};
const summary = (xs: number[]) => ({
  n: xs.length,
  p50: pct(xs, 0.5),
  p95: pct(xs, 0.95),
  max: xs.length ? Math.max(...xs) : Number.NaN,
  over50: xs.filter((x) => x > 50).length / Math.max(1, xs.length),
});

const stats = (page: Page) => page.evaluate(() => window.__ATLAS_ISO__!.getFrameStats() as Stats);
const frames = (page: Page, n = 2) =>
  page.evaluate(
    (k) =>
      new Promise<void>((res) => {
        let left = k;
        const tick = () => (--left <= 0 ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );

async function startRecorder(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __REC__: number[]; __REC_ON__: boolean };
    w.__REC__ = [];
    w.__REC_ON__ = true;
    let last = performance.now();
    const tick = (now: number) => {
      w.__REC__.push(now - last);
      last = now;
      if (w.__REC_ON__) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
async function stopRecorder(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __REC__: number[]; __REC_ON__: boolean };
    w.__REC_ON__ = false;
    return w.__REC__.slice(1); // the first interval spans the recorder's own start
  });
}
async function heapMB(cdp: CDPSession): Promise<number> {
  await cdp.send('HeapProfiler.collectGarbage');
  const { metrics } = await cdp.send('Performance.getMetrics');
  return metrics.find((m) => m.name === 'JSHeapUsedSize')!.value / 2 ** 20;
}
async function ready(page: Page) {
  await page.waitForFunction(() => (window.__ATLAS_ISO__?.getFrameStats().fullRedraws ?? 0) > 0, undefined, {
    timeout: 60_000,
  });
}

test('isometric overview budgets (D8)', async ({ page }) => {
  await page.goto('/?e2e=1&perf=1');
  await ready(page);
  const canvas = page.getByRole('img', { name: /isometric campus overview/i });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const result: Record<string, unknown> = {
    measuredAt: new Date().toISOString(),
    host: {
      cpus: os.cpus()[0]?.model ?? 'unknown',
      cores: os.cpus().length,
      platform: `${os.platform()} ${os.release()}`,
    },
    viewport: page.viewportSize(),
    note: 'Production build of tests/perf/iso-harness (IsoStage + DirectoryPanel, real public/data). Headless Chromium.',
  };

  // --- Unthrottled: scene build (rotation) and full redraw.
  const scene1: number[] = [];
  const redraw1: number[] = [];
  await canvas.focus();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('r');
    await frames(page);
    const s = await stats(page);
    scene1.push(s.sceneBuildMs);
    redraw1.push(s.fullRedrawMs);
  }
  result.unthrottled = { sceneBuildMs: summary(scene1), fullRedrawMs: summary(redraw1) };

  // --- 4× CPU throttle from here on.
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  // Mode switch → first overview frame (chunk cached): unmount, then mount and time to the first drawn frame.
  const toggle = page.getByRole('button', { name: 'Hide overview' });
  await toggle.click();
  await page.waitForFunction(() => window.__ATLAS_ISO__ === undefined);
  const heapBefore = await heapMB(cdp);
  const switchMs = await page.evaluate(
    () =>
      new Promise<number>((res) => {
        const button = [...document.querySelectorAll('button')].find(
          (b) => b.textContent === 'Show overview',
        )!;
        const t0 = performance.now();
        button.click();
        const tick = () => {
          if ((window.__ATLAS_ISO__?.getFrameStats().fullRedraws ?? 0) > 0)
            requestAnimationFrame(() => res(performance.now() - t0));
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  result.modeSwitchToFirstFrameMs = switchMs;

  // Scene build and full redraw at 4×.
  const scene4: number[] = [];
  const redraw4: number[] = [];
  await canvas.focus();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('r');
    await frames(page);
    const s = await stats(page);
    scene4.push(s.sceneBuildMs);
    redraw4.push(s.fullRedrawMs);
  }
  for (const key of ['+', '+', '-', 'ArrowLeft', 'ArrowUp', '0']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(450); // animated moves settle, then one full redraw
    redraw4.push((await stats(page)).fullRedrawMs);
  }
  const s4 = await stats(page);
  result.throttled4x = {
    sceneBuildMs: summary(scene4),
    fullRedrawMs: summary(redraw4),
    cycles: s4.cycles,
    buildings: s4.buildings,
    faces: s4.faces,
  };

  // Gesture frames over the cached bitmap (§9.1: rAF p95 ≤ 20 ms, ≤ 2 % > 50 ms at 4×).
  // Gated run: the gesture's DOM events are dispatched in the page at a steady 16 ms cadence
  // (like a real drag or trackpad), and the recorder stops at release, before the one settle
  // redraw (budgeted separately as a full redraw). Playwright's CDP input awaits a renderer
  // round trip per event, which at 4× stretches a wheel "gesture" into one commit per notch;
  // that run is recorded too (`cdpDriven`) but not gated.
  const inPageGesture = (kind: 'pan' | 'wheel') =>
    page.evaluate(
      (k) =>
        new Promise<number[]>((res) => {
          const el = document.querySelector<HTMLElement>('[role="img"][aria-label^="Isometric"]')!;
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const w = window as unknown as { __REC__: number[]; __REC_ON__: boolean };
          w.__REC__ = [];
          w.__REC_ON__ = true;
          let last = performance.now();
          const tick = (now: number) => {
            w.__REC__.push(now - last);
            last = now;
            if (w.__REC_ON__) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          const pointer = (type: string, x: number, y: number) =>
            el.dispatchEvent(
              new PointerEvent(type, {
                pointerId: 7,
                clientX: x,
                clientY: y,
                button: 0,
                buttons: type === 'pointerup' ? 0 : 1,
                pointerType: 'mouse',
                bubbles: true,
              }),
            );
          if (k === 'pan') pointer('pointerdown', cx, cy);
          const t0 = performance.now();
          let i = 0;
          const id = setInterval(() => {
            i++;
            const a = (i / 30) * Math.PI;
            if (k === 'pan') pointer('pointermove', cx + Math.cos(a) * 150, cy + Math.sin(a) * 90);
            else
              el.dispatchEvent(
                new WheelEvent('wheel', {
                  deltaY: i % 60 < 30 ? -20 : 20,
                  clientX: cx,
                  clientY: cy,
                  bubbles: true,
                  cancelable: true,
                }),
              );
            if (performance.now() - t0 > 2000) {
              clearInterval(id);
              w.__REC_ON__ = false;
              const frames = w.__REC__.slice(1);
              if (k === 'pan') pointer('pointerup', cx, cy);
              res(frames);
            }
          }, 16);
        }),
      kind,
    );
  const before = (await stats(page)).fullRedraws;
  const pan = await inPageGesture('pan');
  await page.waitForTimeout(300);
  const afterPan = await stats(page);
  const wheel = await inPageGesture('wheel');
  await page.waitForTimeout(400);
  const afterWheel = await stats(page);
  const gestureFrames = [...pan, ...wheel];

  // CDP-driven (Playwright mouse) for comparison, not gated.
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await startRecorder(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const t0 = Date.now();
  for (let i = 0; Date.now() - t0 < 2000; i++) {
    const a = (i / 30) * Math.PI;
    await page.mouse.move(cx + Math.cos(a) * 150, cy + Math.sin(a) * 90);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  const cdpPan = await stopRecorder(page);
  const redrawsBeforeWheel = (await stats(page)).fullRedraws;
  await startRecorder(page);
  for (let i = 0; i < 24; i++) {
    await page.mouse.wheel(0, i < 12 ? -60 : 60);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(300);
  const cdpWheel = await stopRecorder(page);
  const cdpWheelCommits = (await stats(page)).fullRedraws - redrawsBeforeWheel;
  result.gestures4x = {
    pan: summary(pan),
    wheel: summary(wheel),
    all: summary(gestureFrames),
    commitsDuringGatedGestures: afterWheel.fullRedraws - before,
    settleRedrawMs: { afterPan: afterPan.fullRedrawMs, afterWheel: afterWheel.fullRedrawMs },
    cdpDriven: { pan: summary(cdpPan), wheel: summary(cdpWheel), wheelCommits: cdpWheelCommits },
  };

  // Select: clicks on buildings (hit-test at 4×).
  await page.keyboard.press('0');
  await page.waitForTimeout(450);
  const buildings = (await (await page.request.get('/data/buildings.geojson')).json()) as {
    features: { properties: { id: string; anchorLon: number; anchorLat: number; renderHeightM: number } }[];
  };
  const order: string[] = await page.evaluate(() => window.__ATLAS_ISO__!.getDrawOrder());
  const hits: number[] = [];
  const selectFrames: number[] = [];
  for (const id of order.slice(-10)) {
    const p = buildings.features.find((f) => f.properties.id === id)!.properties;
    const pt = await page.evaluate(({ lngLat, z }) => window.__ATLAS_ISO__!.projectToViewport(lngLat, z), {
      lngLat: [p.anchorLon, p.anchorLat] as [number, number],
      z: p.renderHeightM,
    });
    if (!pt) continue;
    const before = (await stats(page)).dynamicRedrawMs;
    await page.mouse.click(pt.x, pt.y + 1);
    await frames(page);
    const s = await stats(page);
    hits.push(s.hitTestMs);
    if (s.dynamicRedrawMs !== before) selectFrames.push(s.dynamicRedrawMs);
  }
  result.select4x = { hitTestMs: summary(hits), selectionRedrawMs: summary(selectFrames) };

  // Heap growth after opening and using the overview (after GC).
  const heapAfter = await heapMB(cdp);
  result.heapMB = { before: heapBefore, after: heapAfter, growth: heapAfter - heapBefore };
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'iso.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));

  // --- Budgets (§9.1). Soft, so every miss is reported together.
  const sum = (o: unknown) => o as ReturnType<typeof summary>;
  const un = result.unthrottled as { sceneBuildMs: unknown; fullRedrawMs: unknown };
  const th = result.throttled4x as { sceneBuildMs: unknown; fullRedrawMs: unknown; cycles: number };
  expect.soft(sum(un.sceneBuildMs).max, 'scene build ≤ 30 ms unthrottled').toBeLessThanOrEqual(30);
  expect.soft(sum(un.fullRedrawMs).p95, 'full redraw ≤ 8 ms unthrottled').toBeLessThanOrEqual(8);
  expect.soft(sum(th.sceneBuildMs).max, 'scene build ≤ 120 ms at 4×').toBeLessThanOrEqual(120);
  expect.soft(sum(th.fullRedrawMs).p95, 'full redraw ≤ 25 ms at 4×').toBeLessThanOrEqual(25);
  expect.soft(summary(gestureFrames).p95, 'gesture rAF p95 ≤ 20 ms at 4×').toBeLessThanOrEqual(20);
  expect.soft(summary(gestureFrames).over50, '≤ 2 % of gesture frames > 50 ms').toBeLessThanOrEqual(0.02);
  expect.soft(summary(hits).max, 'hit-test ≤ 1 ms at 4×').toBeLessThanOrEqual(1);
  expect.soft(switchMs, 'mode switch → first frame ≤ 300 ms at 4×').toBeLessThanOrEqual(300);
  expect.soft(heapAfter - heapBefore, 'heap growth ≤ 8 MB').toBeLessThanOrEqual(8);
  expect.soft(th.cycles, 'no unresolved depth cycles').toBe(0);
});
