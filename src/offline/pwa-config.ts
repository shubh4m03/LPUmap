/**
 * vite-plugin-pwa options. Imported by vite.config.ts and therefore executed
 * in Node at build time: import only ../config/index.ts and types.
 *
 * Cache-versioning strategy (see ./README.md): precache only. The app shell,
 * the generated dataset (public/data) and self-hosted glyphs (public/fonts) are
 * all listed in ONE Workbox precache manifest with per-file content revisions.
 * A new deploy therefore installs a new service worker that swaps JS and data
 * together, so a cached app never runs against an incompatible dataset (the
 * loader additionally refuses a dataset whose schemaVersion differs).
 */
import type { VitePWAOptions } from 'vite-plugin-pwa';
import { APP_CONFIG } from '../config/index.ts';

const MB = 1024 * 1024;

/** Service-worker file name; sw-controller.ts registers `${BASE_URL}${SW_FILENAME}`. */
export const SW_FILENAME = 'sw.js';

/** Paths are relative to the build output (dist/), which mirrors public/. */
export const PRECACHE_GLOBS = [
  '**/*.{js,css,html,svg,png,ico,webmanifest,woff2}',
  'data/*.json',
  'data/*.geojson',
  'fonts/**/*.pbf',
] as const;

export const MANIFEST_ICONS = [
  { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
] as const;

export const pwaOptions: Partial<VitePWAOptions> = {
  // The user decides when to reload into a new version (useServiceWorkerUpdate).
  registerType: 'prompt',
  strategies: 'generateSW',
  filename: SW_FILENAME,
  // Registration is done by sw-controller.ts (workbox-window), so the plugin injects nothing.
  injectRegister: false,
  includeAssets: ['favicon.svg', 'robots.txt', 'icons/apple-touch-icon-180.png'],
  manifest: {
    name: APP_CONFIG.brand.name,
    short_name: APP_CONFIG.brand.shortName,
    description: APP_CONFIG.brand.description,
    theme_color: APP_CONFIG.brand.themeColor,
    background_color: APP_CONFIG.brand.backgroundColor,
    display: 'standalone',
    start_url: '.',
    scope: '.',
    orientation: 'any',
    lang: 'en',
    dir: 'ltr',
    categories: ['navigation', 'education'],
    icons: MANIFEST_ICONS.map((icon) => ({ ...icon })),
  },
  workbox: {
    globPatterns: [...PRECACHE_GLOBS],
    // The dataset files are large GeoJSON; fail the build rather than silently skip one.
    maximumFileSizeToCacheInBytes: 8 * MB,
    navigateFallback: 'index.html',
    // Generated data/fonts are never HTML navigations.
    navigateFallbackDenylist: [/^\/data\//, /^\/fonts\//],
    cleanupOutdatedCaches: true,
    cacheId: APP_CONFIG.storage.prefix,
    // No runtime caching: the app makes no third-party requests, and everything
    // first-party is already in the versioned precache.
    runtimeCaching: [],
  },
  devOptions: { enabled: false },
};
