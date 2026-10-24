/**
 * Map modes and imagery providers end to end (docs/MAP_PROVIDER_CONFIGURATION.md §Modes).
 *
 * Third-party imagery is NEVER fetched: every request to the provider hosts is
 * answered by route interception with SYNTHETIC tiles (a generated grid
 * pattern, not imagery) or with an injected failure, and any other
 * non-local request is aborted and fails the test. Run against the build you
 * want to check (PW_PORT, see docs):
 *
 *   - default build (no key):            Satellite "not configured", no third-party request at all;
 *   - VITE_ARCGIS_API_KEY=TEST_ONLY_…:   Esri path (synthetic tiles, attribution, date, fallbacks, SW);
 *   - VITE_EOX_BACKDROP=true:            EOX path (10 m warning, zoom cap).
 *
 * The configuration is detected from the UI, so one spec covers all three.
 * Screenshots of every mode are attached (test-results/, git-ignored).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { expect, test as base, type BrowserContext, type Page, type Route } from '@playwright/test';
import { PHOTOREAL_UNAVAILABLE_DETAIL, PHOTOREAL_UNAVAILABLE_REASON } from '../../src/map/providers/types.ts';

const ESRI_HOST = 'ibasemaps-api.arcgis.com';
const EOX_HOST = 'tiles.maps.eox.at';
const FAKE_KEY = 'TEST_ONLY_fake_arcgis_key_0123456789abcdef';

// ------------------------------------------------------------------ synthetic tiles

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** A 256×256 synthetic tile: muted ground colour from the tile address, a grid and a border. Not imagery. */
function syntheticTile(z: number, x: number, y: number): Buffer {
  const size = 256;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const base: [number, number, number] = [70 + ((x * 37) % 50), 90 + ((y * 53) % 40), 60 + ((z * 29) % 30)];
  for (let r = 0; r < size; r++) {
    const row = r * (size * 3 + 1);
    raw[row] = 0;
    for (let c = 0; c < size; c++) {
      const grid = r % 32 === 0 || c % 32 === 0;
      const edge = r < 2 || c < 2;
      const i = row + 1 + c * 3;
      raw[i] = edge ? 200 : grid ? base[0] + 25 : base[0];
      raw[i + 1] = edge ? 200 : grid ? base[1] + 25 : base[1];
      raw[i + 2] = edge ? 200 : grid ? base[2] + 25 : base[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ provider routes

type TileBehaviour = 'synthetic' | 403 | 429 | 'network' | 'token-required';

interface ProviderTraffic {
  /** Every request to a provider host (URL), in order. */
  readonly requests: string[];
  /** Non-local requests to anything else (must stay empty). */
  readonly unexpected: string[];
  tiles: TileBehaviour;
  probe: 'ok' | 'invalid-token';
}

async function routeProviders(context: BrowserContext): Promise<ProviderTraffic> {
  const traffic: ProviderTraffic = { requests: [], unexpected: [], tiles: 'synthetic', probe: 'ok' };
  const answer = async (route: Route) => {
    const url = new URL(route.request().url());
    traffic.requests.push(url.href);
    // Esri service metadata (the capability probe): JSON, no imagery.
    if (url.host === ESRI_HOST && url.pathname.endsWith('/MapServer')) {
      const body =
        traffic.probe === 'ok'
          ? { currentVersion: 10.6, copyrightText: 'synthetic' }
          : { error: { code: 498, message: 'Invalid token.', details: [] } };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    }
    const m = /\/(\d+)\/(\d+)\/(\d+)(\.jpg)?$/.exec(url.pathname);
    const [z, a, b] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
    switch (traffic.tiles) {
      case 'synthetic':
        return route.fulfill({ status: 200, contentType: 'image/png', body: syntheticTile(z, a, b) });
      case 'token-required':
        return route.fulfill({
          status: 200,
          contentType: 'text/plain',
          body: '{"error":{"code":499,"message":"Token Required"}}',
        });
      case 'network':
        return route.abort('internetdisconnected');
      default:
        return route.fulfill({ status: traffic.tiles, contentType: 'application/json', body: '{}' });
    }
  };
  await context.route(`https://${ESRI_HOST}/**`, answer);
  await context.route(`https://${EOX_HOST}/**`, answer);
  await context.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, async (route) => {
    const host = new URL(route.request().url()).host;
    if (host === ESRI_HOST || host === EOX_HOST) return route.fallback();
    traffic.unexpected.push(route.request().url());
    return route.abort();
  });
  return traffic;
}

// ------------------------------------------------------------------ fixtures and helpers

type Config = 'none' | 'esri' | 'eox';

const test = base.extend<{ traffic: ProviderTraffic }>({
  // Service workers on, as for users (Chromium routes their requests through context.route too).
  serviceWorkers: 'allow',
  // Automatic, so the routes exist before ANY navigation, including beforeEach hooks: no request
  // may ever reach a real provider.
  traffic: [
    async ({ context }, provide) => {
      const traffic = await routeProviders(context);
      await provide(traffic);
      expect(traffic.unexpected, 'requests to hosts other than the app and the imagery providers').toEqual(
        [],
      );
    },
    { auto: true },
  ],
});

async function open(page: Page, params: Record<string, string> = {}): Promise<void> {
  const qs = new URLSearchParams({ e2e: '1', ...params });
  await page.goto(`/?${qs.toString()}`);
  await waitForMap(page);
}

async function waitForMap(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__ATLAS_MAP__?.isStyleLoaded() === true, null, { timeout: 30_000 });
}

const modes = (page: Page) => page.getByRole('radiogroup', { name: 'View mode' });
const radio = (page: Page, name: string) => modes(page).getByRole('radio', { name, exact: true });

async function detectConfig(page: Page): Promise<Config> {
  if ((await radio(page, 'Satellite map').getAttribute('aria-disabled')) === 'true') return 'none';
  await choose(page, 'Satellite map');
  const text = (await page.getByTestId('imagery-notice').textContent()) ?? '';
  await choose(page, '2D map');
  return text.includes('Esri') ? 'esri' : 'eox';
}

async function choose(page: Page, name: string): Promise<void> {
  await radio(page, name).click();
  await expect(radio(page, name)).toHaveAttribute('aria-checked', 'true');
  if (name !== 'Isometric overview') await waitForMap(page);
}

const imageryLayer = (page: Page) =>
  page.evaluate(() => window.__ATLAS_MAP__!.getLayerVisibility('imagery-raster'));
const tileRequests = (t: ProviderTraffic) =>
  t.requests.filter((u) => !u.endsWith('/MapServer') && !u.includes('/MapServer?'));

async function settle(page: Page): Promise<void> {
  // The overview has no MapLibre hook; a map mode waits for its style.
  await page.waitForFunction(
    () => window.__ATLAS_ISO__ !== undefined || window.__ATLAS_MAP__?.isStyleLoaded() === true,
  );
  await page.waitForTimeout(600);
}

async function shot(page: Page, name: string): Promise<void> {
  await settle(page);
  const body = await page.screenshot();
  await test.info().attach(name, { body, contentType: 'image/png' });
  // For review outside the repo (synthetic tiles only): MAP_MODES_SHOTS_DIR=<scratch dir>.
  const dir = process.env.MAP_MODES_SHOTS_DIR;
  if (dir) {
    const file = `${test.info().project.name}-${PORT_TAG}-${name.replace(/[^a-z0-9]+/gi, '-')}.png`;
    writeFileSync(join(dir, file), body);
  }
}
const PORT_TAG = process.env.PW_PORT ?? 'default';

// ------------------------------------------------------------------ every configuration

test.describe('map modes (every configuration)', () => {
  test('five modes; Photorealistic 3D is visibly unavailable and explains why; ?view=earth is ignored', async ({
    page,
    traffic,
  }) => {
    await open(page, { view: 'earth' });
    await expect(page).not.toHaveURL(/view=earth/);
    expect(
      await modes(page)
        .getByRole('radio')
        .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))),
    ).toEqual(['Satellite map', 'Photorealistic 3D', '3D map', 'Isometric overview', '2D map']);
    const earth = radio(page, 'Photorealistic 3D');
    await expect(earth).toHaveAttribute('aria-disabled', 'true');
    await expect(earth).toHaveAccessibleDescription(PHOTOREAL_UNAVAILABLE_REASON);
    // aria-disabled options stay operable (they explain themselves); Playwright treats them as disabled.
    await earth.click({ force: true });
    await expect(earth).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('listitem').filter({ hasText: PHOTOREAL_UNAVAILABLE_DETAIL })).toBeVisible();
    await shot(page, 'photoreal unavailable notice');
    // Nothing photoreal is ever requested.
    expect(traffic.requests.filter((u) => /3dtiles|googleapis/.test(u))).toEqual([]);
  });

  test('Campus map 2D and the overview never contact an imagery provider', async ({ page, traffic }) => {
    await open(page, { view: '2d' });
    expect(await imageryLayer(page)).toBeNull();
    await shot(page, 'campus map 2D');
    await choose(page, 'Isometric overview');
    await page.waitForFunction(() => (window.__ATLAS_ISO__?.getFrameStats().fullRedraws ?? 0) > 0);
    await shot(page, 'isometric overview');
    expect(traffic.requests).toEqual([]);
  });
});

test.describe('return to campus', () => {
  test('appears when the campus is off screen and glides back to it', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, 'mouse drag on the desktop layout');
    await open(page, { view: '2d' });
    const back = page.getByRole('button', { name: 'Back to campus' });
    await expect(back).toHaveCount(0);
    const canvas = page.getByTestId('atlas-map').locator('canvas');
    await canvas.focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('+');
    await settle(page);
    const box = (await canvas.boundingBox())!;
    const y = box.y + box.height / 2;
    // Drag west until no part of the (concave) campus outline is on screen. A narrow window moves
    // less ground per drag, so the number of drags depends on the viewport (bounded).
    for (let i = 0; i < 12 && (await back.count()) === 0; i++) {
      await page.mouse.move(box.x + 200, y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 200, y, { steps: 8 });
      await page.mouse.up();
      await settle(page);
    }
    await expect(back).toBeVisible();
    await shot(page, 'return to campus offered');
    await back.click();
    await expect(back).toHaveCount(0);
    const cam = await page.evaluate(() => window.__ATLAS_MAP__!.getCamera());
    expect(Math.abs(cam.center[0] - 75.7032)).toBeLessThan(0.002);
  });
});

// ------------------------------------------------------------------ no provider configured

test.describe('no imagery configured (default build)', () => {
  test('Satellite stays visible as "not configured"; its deep link is dropped; no third-party request', async ({
    page,
    traffic,
  }) => {
    await open(page);
    test.skip((await detectConfig(page)) !== 'none', 'this build has an imagery provider');
    const sat = radio(page, 'Satellite map');
    await expect(sat).toHaveAttribute('aria-disabled', 'true');
    await expect(sat).toHaveAccessibleDescription(/^Not configured/);
    await sat.click({ force: true });
    await expect(page.getByText(/^Satellite map: Not configured/).first()).toBeVisible();
    await open(page, { view: 'satellite' });
    await expect(page).not.toHaveURL(/view=satellite/);
    expect(await imageryLayer(page)).toBeNull();
    await choose(page, '3D map');
    expect(await imageryLayer(page)).toBeNull();
    await shot(page, 'campus 3D without imagery');
    expect(traffic.requests).toEqual([]);
  });
});

// ------------------------------------------------------------------ Esri (fake key, synthetic tiles)

test.describe('Esri World Imagery (synthetic tiles)', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    test.skip((await detectConfig(page)) !== 'esri', 'build without VITE_ARCGIS_API_KEY');
  });

  test('Satellite 2D: tiles from the documented endpoint, attribution, date and readable overlays', async ({
    page,
    traffic,
  }) => {
    await choose(page, 'Satellite map');
    await expect(page).toHaveURL(/view=satellite/);
    await expect.poll(() => imageryLayer(page)).toBe('visible');
    await expect.poll(() => tileRequests(traffic).length).toBeGreaterThan(0);
    for (const u of tileRequests(traffic)) {
      expect(u).toMatch(
        /^https:\/\/ibasemaps-api\.arcgis\.com\/arcgis\/rest\/services\/World_Imagery\/MapServer\/tile\/\d+\/\d+\/\d+\?token=/,
      );
      expect(new URL(u).searchParams.get('token')).toBe(FAKE_KEY);
      expect(Number(/\/tile\/(\d+)\//.exec(u)?.[1])).toBeLessThanOrEqual(19);
    }
    const notice = page.getByTestId('imagery-notice');
    await expect(notice).toContainText('Esri World Imagery · not live · Powered by Esri');
    await expect(notice).toContainText(
      'Imagery captured 2023-12-18 according to Esri World Imagery Wayback metadata (retrieved 2026-10-24).',
    );
    const attrib = page.locator('.maplibregl-ctrl-attrib');
    await expect(attrib).toContainText('Powered by');
    await expect(attrib).toContainText('Esri, Vantor, Earthstar Geographics');
    await expect(attrib).toContainText('OpenStreetMap');
    // Overlays stay: buildings are still drawn and pickable; our basemap fills are hidden.
    expect(
      (await page.evaluate(() => window.__ATLAS_MAP__!.queryRenderedBuildingIds())).length,
    ).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__ATLAS_MAP__!.getLayerVisibility('landuse'))).toBe('none');
    expect(await page.evaluate(() => window.__ATLAS_MAP__!.getLayerVisibility('path'))).toBe('visible');
    await shot(page, 'satellite 2D (synthetic tiles)');

    await choose(page, '3D map');
    await expect.poll(() => imageryLayer(page)).toBe('visible');
    expect(await page.evaluate(() => window.__ATLAS_MAP__!.getCamera().pitch)).toBeGreaterThan(0);
    await shot(page, 'campus 3D on imagery (synthetic tiles)');

    const before = traffic.requests.length;
    await choose(page, '2D map');
    expect(await imageryLayer(page)).toBeNull();
    expect(await page.evaluate(() => window.__ATLAS_MAP__!.getLayerVisibility('landuse'))).toBe('visible');
    await page.waitForTimeout(500);
    expect(traffic.requests.length, 'Campus map 2D requests no imagery').toBe(before);
  });

  for (const [behaviour, reason] of [
    [403, /refused this site’s key/],
    ['token-required', /refused this site’s key/],
    [429, /free limit has been reached/],
    ['network', /could not be loaded/],
  ] as const) {
    test(`tile failure (${behaviour}) falls back to the campus map with a notice — never a blank map`, async ({
      page,
      traffic,
    }) => {
      traffic.tiles = behaviour;
      // Click without waiting for the mode: the fallback may come before the mode is observed.
      await radio(page, 'Satellite map').click();
      await expect(radio(page, '2D map')).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 });
      // The visible notice (a toast), not only the switcher's description.
      await expect(page.getByRole('listitem').filter({ hasText: reason })).toBeVisible();
      await waitForMap(page);
      expect(await imageryLayer(page)).toBeNull();
      expect(
        (await page.evaluate(() => window.__ATLAS_MAP__!.queryRenderedBuildingIds())).length,
      ).toBeGreaterThan(0);
      const sat = radio(page, 'Satellite map');
      await expect(sat).toHaveAttribute('aria-disabled', 'true');
      await expect(sat).toHaveAccessibleDescription(reason);
      if (behaviour === 403) await shot(page, 'fallback after 403');
    });
  }

  test('a key the provider rejects at the metadata probe falls back at once', async ({ page, traffic }) => {
    traffic.probe = 'invalid-token';
    // A fresh page: the probe runs once per page, the first time imagery is shown.
    await open(page);
    if ((await radio(page, '3D map').getAttribute('aria-checked')) === 'true') {
      // Wide screens start in Campus 3D, which already shows imagery when a key is set: it stays
      // in Campus 3D and drops the imagery, saying so.
      await expect(
        page.getByText(/refused this site’s key\. Campus 3D continues without imagery\./).first(),
      ).toBeVisible();
      await expect.poll(() => imageryLayer(page)).toBeNull();
    } else {
      // Click without waiting for the mode: the fallback may come before the mode is observed.
      await radio(page, 'Satellite map').click();
      await expect(radio(page, '2D map')).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 });
      await expect(page.getByText(/refused this site’s key/).first()).toBeVisible();
    }
    await expect(radio(page, 'Satellite map')).toHaveAttribute('aria-disabled', 'true');
  });

  test('going offline leaves Satellite 2D for the campus map and says why', async ({ page, context }) => {
    await choose(page, 'Satellite map');
    await context.setOffline(true);
    await expect(radio(page, '2D map')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText(/offline or unreachable/).first()).toBeVisible();
    await context.setOffline(false);
    await expect(radio(page, 'Satellite map')).not.toHaveAttribute('aria-disabled', 'true');
  });
});

// The service worker must never store provider responses.
test.describe('service worker and imagery', () => {
  test('no provider URL is ever in Cache Storage', async ({ page, traffic }) => {
    await open(page);
    const config = await detectConfig(page);
    test.skip(config === 'none', 'no imagery in this build');
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null || true);
    await page.evaluate(async () => {
      await navigator.serviceWorker?.ready;
    });
    await page.reload();
    await waitForMap(page);
    await choose(page, 'Satellite map');
    await expect.poll(() => tileRequests(traffic).length).toBeGreaterThan(0);
    await settle(page);
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const req of await cache.keys()) urls.push(req.url);
      }
      return urls;
    });
    expect(cached.length, 'the precache exists').toBeGreaterThan(0);
    expect(cached.filter((u) => u.includes(ESRI_HOST) || u.includes(EOX_HOST))).toEqual([]);
  });
});

// ------------------------------------------------------------------ EOX backdrop (synthetic tiles)

test.describe('EOX Sentinel-2 2016 backdrop (synthetic tiles)', () => {
  test('low zoom only, the 10 m warning is visible, attribution shown', async ({ page, traffic }) => {
    await open(page);
    test.skip((await detectConfig(page)) !== 'eox', 'build without VITE_EOX_BACKDROP');
    await choose(page, 'Satellite map');
    await expect.poll(() => imageryLayer(page)).toBe('visible');
    await expect(page.getByTestId('imagery-warning')).toHaveText('10 m imagery — buildings not visible');
    await expect
      .poll(() => page.evaluate(() => window.__ATLAS_MAP__!.getCamera().zoom))
      .toBeLessThanOrEqual(14);
    await page.keyboard.press('Escape');
    await page.getByTestId('atlas-map').locator('canvas').focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('+');
    await settle(page);
    expect(await page.evaluate(() => window.__ATLAS_MAP__!.getCamera().zoom)).toBeLessThanOrEqual(14);
    for (const u of tileRequests(traffic)) {
      expect(u).toMatch(
        /^https:\/\/tiles\.maps\.eox\.at\/wmts\/1\.0\.0\/s2cloudless_3857\/default\/g\/\d+\/\d+\/\d+\.jpg$/,
      );
      expect(Number(/\/g\/(\d+)\//.exec(u)?.[1])).toBeLessThanOrEqual(13);
    }
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('EOxCloudless');
    await shot(page, 'satellite 2D EOX backdrop (synthetic tiles)');
    // Campus 3D never uses 10 m imagery.
    await choose(page, '3D map');
    expect(await imageryLayer(page)).toBeNull();
  });
});
