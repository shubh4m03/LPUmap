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
  // `mjs`: the MapLibre worker is emitted as an .mjs asset (src/app/maplibre-worker.ts);
  // without it the map cannot render offline.
  '**/*.{js,mjs,css,html,svg,png,ico,webmanifest,woff2}',
  'data/*.json',
  'data/*.geojson',
  'fonts/**/*.pbf',
  // Isometric artwork (public/isometric-art, scripts/build-isometric-art.ts): only the light
  // files are precached — the manifest and the uniformly downscaled preview of the master.
  'isometric-art/manifest.json',
  'isometric-art/derived/*/preview-*.webp',
] as const;

/**
 * Heavy artwork kept OUT of the precache (the shell glob would otherwise take
 * every vignette PNG): unchanged originals (5.2 MB master + 2.4 MB vignettes),
 * the full-size web copy and the zoom tiles. They are fetched on demand and
 * kept by ART_RUNTIME_CACHING instead. The first entry is Workbox's default.
 */
export const PRECACHE_IGNORES = [
  '**/node_modules/**/*',
  'isometric-art/original/**',
  'isometric-art/derived/*/tiles/**',
  'isometric-art/derived/*/web-full.*',
  // vite-plugin-pwa adds the web manifest itself (revisioned from its content); globbing it
  // as well listed it twice in the precache.
  'manifest.webmanifest',
] as const;

/** Cache of on-demand artwork (originals, web-full, tiles); separate from the precache. */
export const ART_RUNTIME_CACHE_NAME = `${APP_CONFIG.storage.prefix}-isometric-art`;

/**
 * The ONLY runtime route: same-origin artwork files under /isometric-art/
 * (original/ or derived/). `sameOrigin` is required explicitly, so no
 * third-party request (satellite imagery, API) can ever match. The function is
 * serialized into sw.js by workbox-build, so it must stay self-contained.
 * StaleWhileRevalidate: shown from cache (also offline) and refreshed in the
 * background, so a re-derived file (same URL) is picked up on the next view.
 * At most 96 entries (today 51 tiles + web-full + 28 originals = 80) and 30
 * days; purged first when the browser runs out of quota.
 */
type RuntimeCachingEntry = NonNullable<NonNullable<VitePWAOptions['workbox']>['runtimeCaching']>[number];

export const ART_RUNTIME_CACHING: RuntimeCachingEntry = {
  urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
    sameOrigin && /\/isometric-art\/(?:original|derived)\/[^?#]+\.(?:png|jpe?g|webp)$/.test(url.pathname),
  handler: 'StaleWhileRevalidate',
  method: 'GET',
  options: {
    cacheName: ART_RUNTIME_CACHE_NAME,
    expiration: { maxEntries: 96, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true },
    cacheableResponse: { statuses: [200] },
  },
};

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
  // No includeAssets / manifest icons: PRECACHE_GLOBS already matches favicon.svg and every
  // icons/*.png, and listing them again made duplicate precache entries. robots.txt is
  // for crawlers only and is not needed offline.
  includeManifestIcons: false,
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
    globIgnores: [...PRECACHE_IGNORES],
    // The published build has no source maps (vite.config.ts), and neither has sw.js.
    sourcemap: false,
    // The dataset files are large GeoJSON; fail the build rather than silently skip one.
    maximumFileSizeToCacheInBytes: 8 * MB,
    navigateFallback: 'index.html',
    // Generated data/fonts are never HTML navigations, and neither is the API: without
    // /api/ here, an API URL opened as a navigation would get index.html, not the server.
    navigateFallbackDenylist: [/^\/data\//, /^\/fonts\//, /^\/api\//],
    cleanupOutdatedCaches: true,
    // The data loader appends `?v=<datasetVersion>` to every dataset file (an HTTP
    // cache-buster). The precache stores those files without a query string, so `v`
    // must be ignored when matching — otherwise every data request misses the cache
    // and the app cannot start offline. The precached copy always belongs to this
    // worker's build, so it is the dataset version the cached app expects.
    // Workbox's defaults (utm_*, fbclid) are kept.
    ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^v$/],
    cacheId: APP_CONFIG.storage.prefix,
    // One runtime route only, for same-origin artwork (ART_RUNTIME_CACHING); everything else
    // first-party is in the versioned precache. Third-party satellite imagery
    // (ibasemaps-api.arcgis.com, tiles.maps.eox.at; src/map/providers) must never be cached or
    // stored for offline use — Esri's terms forbid storing Data, and the atlas keeps one rule
    // for every provider: the artwork route requires sameOrigin, so the worker never touches
    // those requests (tests/unit/map-providers). The owner publication (/api/locations) is
    // never handled here: the app fetches it network-first and keeps its own last good copy
    // (src/app/data/publication.ts); /api/admin/** is never cached.
    runtimeCaching: [ART_RUNTIME_CACHING],
  },
  devOptions: { enabled: false },
};
