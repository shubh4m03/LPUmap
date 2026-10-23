# Offline and PWA strategy

LPU Campus Atlas is a static app with no backend. Everything it needs — the
app shell, the generated campus dataset and the map glyphs — is first-party,
so offline support is a single, versioned **precache**. There is no runtime
caching and no request to any third-party origin.

## What is cached

`pwa-config.ts` configures `vite-plugin-pwa` (Workbox `generateSW`) to precache:

| Glob (relative to `dist/`)                         | Contents                                         |
| -------------------------------------------------- | ------------------------------------------------ |
| `**/*.{js,css,html,svg,png,ico,webmanifest,woff2}` | App shell, icons, manifest                       |
| `data/*.json`, `data/*.geojson`                    | Generated dataset from `public/data/`            |
| `fonts/**/*.pbf`                                   | Self-hosted MapLibre glyphs from `public/fonts/` |

`maximumFileSizeToCacheInBytes` is 8 MB. If a dataset file grows beyond that,
the build fails loudly rather than shipping a service worker that silently
leaves the file out.

## Cache versioning: app and data update together

Workbox records a content revision (hash) for every precached file in one
manifest embedded in `sw.js`. Any change to code or data produces a new
`sw.js`, which installs in the background and fetches only the changed files.
Until the user accepts the update, the old worker keeps serving the old
**matching** set of JS and data; after `applyUpdate()` the new set is served
as a whole. A cached app therefore never runs against a newer or older dataset
than the one it was built with.

As a second guard, `loadCampusData()` reads `data/manifest.json` first and
refuses a dataset whose `schemaVersion` differs from `DATA_SCHEMA_VERSION`
(error code `schema-version`), showing an error instead of misreading data.

`cleanupOutdatedCaches` deletes precaches left by older Workbox versions.
Deployment headers (`public/_headers`) serve `sw.js`, `index.html` and
`data/manifest.json` with `no-cache`, so browsers always check for a new
version, while hashed files under `/assets/` are cached as immutable.

## Update flow

`registerType: 'prompt'`: a new version never reloads the page by itself.
`useServiceWorkerUpdate()` exposes `supported`, `updateAvailable`,
`offlineReady`, `applyUpdate()` (tells the waiting worker to skip waiting; the
page reloads once it takes control), `dismiss()` and `error` (registration
failures are surfaced, not swallowed, so the UI can say offline mode is
unavailable). `useOnlineStatus()` reports the browser's `online`/`offline`
events.

Registration lives in `sw-controller.ts`, built directly on `workbox-window`
and mirroring the prompt-mode logic of vite-plugin-pwa's `registerSW`. The
plugin's `virtual:pwa-register/react` module is deliberately not used: it only
exists inside a Vite build with the PWA plugin, so importing it makes every
Vitest suite that touches `src/offline` fail to resolve. `injectRegister` is
therefore `false`. Development builds (`import.meta.env.PROD === false`) have
no service worker, and the hook reports `supported: false` there.

## What works offline (after one complete online visit)

- Opening the app and browsing the cached map, buildings and basemap.
- Search, categories and place details — the index is built locally.
- Walking and cycling routes — the routing graph is part of the dataset and
  routes are computed on the device.
- Favourites and recent places (stored in local storage).
- Device location, where the device can get a fix without network
  assistance. Location is processed on-device and never sent anywhere.

## What does not work offline

- Getting a newer dataset or app version (needs network; the cached version
  keeps working and is replaced as a whole when an update is installed).
- Opening a configured corrections link (`VITE_CORRECTIONS_URL`); copying or
  downloading the report still works.
- External links (official websites, OpenStreetMap).
- GPS may take longer to get a first fix without network-assisted positioning.

## Freshness

Opening hours come from the dataset and can go out of date. Places carry
`retrievedAt` provenance, and hours older than
`APP_CONFIG.cache.hoursFreshnessDays` are shown with a freshness warning
(`state: 'stale'` from `evaluateHours`) rather than as current fact. Being
offline does not change this — the warning is based on the data's age, not on
the network.
