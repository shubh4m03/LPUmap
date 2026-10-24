import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';
import { loadCampusData } from '../../../src/data/loader.ts';
import { MANIFEST_ICONS, PRECACHE_GLOBS, SW_FILENAME, pwaOptions } from '../../../src/offline/pwa-config.ts';

const publicDir = join(process.cwd(), 'public');

function pngSize(file: string): [number, number] {
  const buf = readFileSync(file);
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe('pwaOptions', () => {
  const manifest = pwaOptions.manifest;
  const workbox = pwaOptions.workbox;

  it('prompts for updates instead of reloading automatically', () => {
    expect(pwaOptions.registerType).toBe('prompt');
    // sw-controller.ts registers the worker itself, at this exact file name.
    expect(pwaOptions.injectRegister).toBe(false);
    expect(pwaOptions.filename).toBe(SW_FILENAME);
  });

  it('builds the manifest from APP_CONFIG.brand', () => {
    expect(manifest).toBeTruthy();
    if (!manifest) return;
    expect(manifest.name).toBe(APP_CONFIG.brand.name);
    expect(manifest.short_name).toBe(APP_CONFIG.brand.shortName);
    expect(manifest.description).toBe(APP_CONFIG.brand.description);
    expect(manifest.theme_color).toBe(APP_CONFIG.brand.themeColor);
    expect(manifest.background_color).toBe(APP_CONFIG.brand.backgroundColor);
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('.');
    expect(manifest.scope).toBe('.');
    expect(manifest.categories).toEqual(['navigation', 'education']);
  });

  it('references icons that exist on disk with the declared sizes', () => {
    const icons = manifest ? (manifest.icons ?? []) : [];
    expect(icons.length).toBe(MANIFEST_ICONS.length);
    const purposes = icons.map((i) => `${i.sizes}:${i.purpose}`);
    expect(purposes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
    for (const icon of icons) {
      const file = join(publicDir, icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      if (icon.type === 'image/png') {
        const [w, h] = pngSize(file);
        expect(`${w}x${h}`).toBe(icon.sizes);
      }
    }
    expect(pngSize(join(publicDir, 'icons', 'apple-touch-icon-180.png'))).toEqual([180, 180]);
  });

  it('precaches the app shell, dataset and glyphs in one versioned manifest', () => {
    const globs = workbox?.globPatterns ?? [];
    expect(globs.some((g) => g.includes('js') && g.includes('html'))).toBe(true);
    expect(globs).toContain('data/*.json');
    expect(globs).toContain('data/*.geojson');
    expect(globs).toContain('fonts/**/*.pbf');
    expect(workbox?.maximumFileSizeToCacheInBytes).toBe(8 * 1024 * 1024);
    expect(workbox?.navigateFallback).toBe('index.html');
    expect(workbox?.cleanupOutdatedCaches).toBe(true);
  });

  it('serves the dataset from the precache although the loader adds a version query', async () => {
    // Regression: data files were requested as `graph.json?v=<datasetVersion>`, which never
    // matched the precached `data/graph.json`, so the app could not start offline.
    const requested: string[] = [];
    await loadCampusData({
      baseUrl: 'https://atlas.test/data/',
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        requested.push(url.href);
        const file = join(publicDir, 'data', url.pathname.replace(/^\/data\//, ''));
        return new Response(readFileSync(file, 'utf8'), { headers: { 'content-type': 'application/json' } });
      },
    });
    const ignored = workbox?.ignoreURLParametersMatching ?? [];
    const paramNames = requested.flatMap((href) => [...new URL(href).searchParams.keys()]);
    expect(paramNames).toContain('v');
    for (const name of paramNames) expect(ignored.some((re) => re.test(name))).toBe(true);
    // Only the cache-buster is ignored; the Workbox defaults stay.
    expect(ignored.some((re) => re.test('utm_source'))).toBe(true);
    expect(ignored.some((re) => re.test('place'))).toBe(false);
  });

  it('precaches every asset type the app loads by URL, including the MapLibre worker', () => {
    // Regression: the worker is emitted as `.mjs`, which the shell glob did not cover, so
    // offline the map failed with "Worker failed to load".
    const shellGlob = PRECACHE_GLOBS[0];
    const extensions = /\{([^}]+)\}/.exec(shellGlob)?.[1]?.split(',') ?? [];
    const workerSource = readFileSync(join(process.cwd(), 'src', 'app', 'maplibre-worker.ts'), 'utf8');
    const urlImports = [...workerSource.matchAll(/from '([^']+)\?url'/g)].map((m) => m[1]!);
    expect(urlImports.length).toBeGreaterThan(0);
    for (const spec of urlImports) expect(extensions).toContain(spec.split('.').pop());
  });

  it('never serves index.html for /api/ (or data and font) requests', () => {
    const deny = workbox?.navigateFallbackDenylist ?? [];
    for (const path of ['/api/locations', '/api/admin/session', '/data/places.json', '/fonts/x/0-255.pbf'])
      expect(
        deny.some((re) => re.test(path)),
        path,
      ).toBe(true);
    expect(deny.some((re) => re.test('/'))).toBe(false);
  });

  it('never precaches API responses (none can contain drafts): only build files are matched', () => {
    for (const glob of PRECACHE_GLOBS) expect(glob).not.toMatch(/api/);
    expect(JSON.stringify(workbox?.additionalManifestEntries ?? [])).not.toMatch(/api/);
  });

  it('does no runtime caching (so never caches third-party origins)', () => {
    expect(workbox?.runtimeCaching ?? []).toEqual([]);
  });

  it('only imports config and types, so vite.config.ts can load it in Node', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'offline', 'pwa-config.ts'), 'utf8');
    const imports = [...source.matchAll(/^import\s+(type\s+)?.*from\s+'([^']+)'/gm)].map((m) => ({
      typeOnly: Boolean(m[1]),
      from: m[2],
    }));
    for (const imp of imports) {
      expect(imp.typeOnly || imp.from === '../config/index.ts', imp.from).toBe(true);
    }
  });
});

describe('deployment files', () => {
  it('sets a strict CSP and security headers', () => {
    const headers = readFileSync(join(publicDir, '_headers'), 'utf8');
    expect(headers).toMatch(/Content-Security-Policy: default-src 'self';.*frame-ancestors 'none'/);
    expect(headers).toContain("object-src 'none'");
    expect(headers).toContain('Permissions-Policy: geolocation=(self), camera=(), microphone=()');
    expect(headers).toContain('X-Content-Type-Options: nosniff');
    expect(headers).toMatch(/\/sw\.js\n\s+Cache-Control: no-cache/);
    expect(headers).toMatch(/\/data\/manifest\.json\n\s+Cache-Control: no-cache/);
    expect(headers).toMatch(/\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/);
  });

  it('has an original SVG favicon without external references', () => {
    const svg = readFileSync(join(publicDir, 'favicon.svg'), 'utf8');
    expect(svg).toContain('<svg');
    expect(svg).not.toMatch(/href=|<image|<script/);
    expect(svg).toContain(APP_CONFIG.brand.themeColor);
  });
});
