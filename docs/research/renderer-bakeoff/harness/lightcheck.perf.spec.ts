/**
 * Lighting parity check: the same 30 × 30 × 20 m box as a MapLibre
 * fill-extrusion and through the studio custom layer, same colour, same
 * map-anchored light. For each bearing it centres each box, samples the wall
 * facing the camera and the roof, and writes the RGB values to BAKEOFF_RESULTS.
 * (Extrusions are drawn at opacity 0.92, the custom layer opaque, so the
 * extrusion samples are lifted slightly towards the ground colour.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const RESULTS = process.env.BAKEOFF_RESULTS ?? path.resolve('docs/research/renderer-bakeoff/results');
const LAT = 31.2475;
const BOXES = { extrusion: 75.6995, custom: 75.70013 } as const;

test.use({ viewport: { width: 1000, height: 700 } });

test('extrusion and custom layer shade the same faces alike', async ({ page }) => {
  await page.goto('/?renderer=lightcheck&e2e=1');
  await page.waitForFunction(() => Boolean(window.__BAKEOFF__ || window.__BAKEOFF_ERROR__), null, {
    timeout: 120_000,
  });
  expect(await page.evaluate(() => window.__BAKEOFF_ERROR__ ?? null)).toBeNull();
  await page.evaluate(() => window.__BAKEOFF__!.idle());
  const dLon = 15 / (111320 * Math.cos((LAT * Math.PI) / 180));
  const dLat = 15 / 110574;
  // The wall facing a camera at this bearing (the camera looks towards the bearing).
  const facing = {
    0: ['south', 0, -1],
    90: ['west', -1, 0],
    180: ['north', 0, 1],
    270: ['east', 1, 0],
  } as const;
  const out: Record<string, Record<string, unknown>> = {};
  for (const bearing of [0, 90, 180, 270] as const) {
    const [face, ex, ny] = facing[bearing];
    const row: Record<string, unknown> = {};
    for (const [name, lon] of Object.entries(BOXES)) {
      const pts: Array<[number, number, number]> = [
        [lon + ex * dLon * 1.002, LAT + ny * dLat * 1.002, 8],
        [lon, LAT, 20.05],
      ];
      const [wall, roof] = await page.evaluate(([p, b, c]) => window.__BAKEOFF__!.sample(p, b, c), [
        pts,
        bearing,
        [lon, LAT] as [number, number],
      ] as const);
      row[name] = { [face]: wall, roof };
    }
    out[`bearing${bearing}`] = row;
    await page.screenshot({ path: path.join(RESULTS, `lightcheck-bearing${bearing}.png`) });
  }
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, 'lightcheck.json'), `${JSON.stringify(out, null, 2)}\n`);
});
