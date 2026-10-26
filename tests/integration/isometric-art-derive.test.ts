// @vitest-environment node
/**
 * Derived artwork in the real Playwright Chromium (the same code path as
 * `npm run art:derive` / `art:verify`): derivation is deterministic, the
 * committed copies are visually equivalent to the original (lossless: pixel-
 * identical at their own size), and the threshold rejects a shifted,
 * recoloured or cropped-and-stretched copy.
 *
 * Skipped when the Playwright Chromium is not installed (CI installs it only
 * for e2e; CI runs `npm run art:verify` after that install instead).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from '@playwright/test';
import { sha256Hex } from '../../scripts/lib/art-inventory-check.ts';
import {
  ART_MANIFEST_PATH,
  ART_PUBLIC_DIR,
  ART_REGISTRY_PATH,
} from '../../scripts/lib/art-registry-check.ts';
import {
  launchArtChromium,
  measureEquivalence,
  NEGATIVE_CONTROLS,
  renderDerived,
  type ImageSource,
} from '../../scripts/lib/isometric-art/chromium.ts';
import {
  EQUIVALENCE_REPORT_PATH,
  equivalenceFailures,
  equivalenceGroups,
  renderJobs,
  type EquivalenceReport,
} from '../../scripts/lib/isometric-art/integrity.ts';
import { isometricArtManifestSchema, isometricArtRegistrySchema } from '../../src/isometric-art/schema.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const json = (p: string): unknown => JSON.parse(readFileSync(join(root, p), 'utf8'));
const manifest = isometricArtManifestSchema.parse(json(ART_MANIFEST_PATH));
const registry = isometricArtRegistrySchema.parse(json(ART_REGISTRY_PATH));
const report = json(EQUIVALENCE_REPORT_PATH) as EquivalenceReport;
const master = manifest.assets.find((a) => a.assetId === 'iso-art-001')!;
const specs = registry.assets.find((a) => a.assetId === 'iso-art-001')!.derive;
const jobs = specs.flatMap((s) => renderJobs('iso-art-001', s, master.source.width, master.source.height));
const source: ImageSource = {
  bytes: new Uint8Array(readFileSync(join(root, master.source.originalPath))),
  mime: master.source.mime,
  width: master.source.width,
  height: master.source.height,
};

const hasChromium = await (async () => {
  try {
    const { chromium } = await import('@playwright/test');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

describe.skipIf(!hasChromium)('derived artwork in Chromium', { timeout: 180_000 }, () => {
  let browser: Browser;
  let page: Page;
  let version = '';
  let reproducesCommitted = false;
  beforeAll(async () => {
    ({ browser, page, version } = await launchArtChromium());
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  it('is deterministic: two derivations in separate browsers are byte-identical', async () => {
    const a = await renderDerived(page, source, jobs);
    const second = await launchArtChromium();
    try {
      const b = await renderDerived(second.page, source, jobs);
      expect(b.map((f) => sha256Hex(f.bytes))).toEqual(a.map((f) => sha256Hex(f.bytes)));
    } finally {
      await second.browser.close();
    }
    const committed = a.map((f) => sha256Hex(readFileSync(join(root, ART_PUBLIC_DIR, f.url))));
    // With the Chromium (and CPU path) that made them, the committed copies are reproduced exactly
    // (true on the machine that derived them). Another Chromium/OS may decode or encode differently;
    // then visual equivalence (below) is what counts.
    reproducesCommitted =
      version === report.renderer.version &&
      JSON.stringify(a.map((f) => sha256Hex(f.bytes))) === JSON.stringify(committed);
    console.log(`derive test: Chromium ${version}; reproduces committed bytes: ${reproducesCommitted}`);
  });

  it('the committed copies are visually equivalent to the original; perturbed copies are rejected', async () => {
    const outputs = jobs.map((j) => ({
      url: j.url,
      bytes: new Uint8Array(readFileSync(join(root, ART_PUBLIC_DIR, j.url))),
    }));
    const { results, controls } = await measureEquivalence(
      page,
      source,
      equivalenceGroups(jobs, outputs, master.derived),
      { kinds: NEGATIVE_CONTROLS, mime: 'image/webp', quality: 1 },
    );
    expect(results.map((r) => r.label)).toEqual(['web-full', 'preview', 'tiles-0', 'tiles-1', 'tiles-2']);
    for (const r of results) {
      // Lossless copies must be pixel-identical wherever the committed bytes are reproduced.
      expect(equivalenceFailures(r, reproducesCommitted), r.label).toEqual([]);
      if (reproducesCommitted) expect(r.native.maxAbs, r.label).toBe(0);
    }
    expect(controls).toHaveLength(NEGATIVE_CONTROLS.length);
    for (const c of controls) {
      expect(equivalenceFailures(c, true).length, c.label).toBeGreaterThan(0);
      expect(equivalenceFailures(c, false).length, c.label).toBeGreaterThan(0);
    }
  });
});
