# Module: platform (favourites, privacy, feedback, offline, storage)

**Paths:**

- `src/favorites/`
- `src/privacy/`
- `src/feedback/`
- `src/offline/` (with [README](../../src/offline/README.md))
- `src/utils/storage.ts`

## Purpose

The cross-cutting services that make the app usable day to day without a backend:

- saved and recent places
- privacy settings and "clear everything"
- correction reports that the user shares themselves
- offline support with a user-controlled update prompt
- one validated, versioned wrapper around web storage

## Public interface

### `src/utils/storage.ts` (no barrel)

```ts
createStorage<T>(key, schema: ZodType<T>, fallback: T, opts?: { area?: 'local' | 'session' }):
  { get(): T; set(v: T): boolean; clear(): void; fullKey: string }   // key → 'lpu-atlas:v1:<key>'
listKeys(area), clearAll(): number, STORAGE_NAMESPACE, namespacedKey
```

### `src/favorites`

- `useFavorites()` (Zustand) provides:
  - `ids`: newest first, de-duplicated
  - `isFavorite(id)`
  - `toggle(id)`: returns the new state
  - `clear()`
  - `isFull`: adding past `FAVORITES_MAX` (200) is refused, never silently dropped
- `useRecents()` provides `ids`, `push(id)` and `clear()`. It keeps at most
  `APP_CONFIG.search.maxRecent` (8) and does nothing while history is off.
- `resolveIds(ids, getPlace)` drops ids that are no longer in the dataset and keeps the order. Also
  `normalizeIds`.

### `src/privacy`

- `usePrivacySettings()` provides:
  - `saveHistory`: persisted, default true
  - `setSaveHistory(v)`: turning it off clears recents in memory and on disk immediately
  - `clearAllLocalData()`: clears every `lpu-atlas:` key, runs the reset handlers, then clears again
- `registerLocalDataReset(handler)` returns an unregister function.
- `PRIVACY_FACTS` holds the plain-language statements shown in Settings.

### `src/feedback`

- The correction model: `CORRECTION_KINDS`, `CORRECTION_KIND_LABELS`, `correctionDraftSchema`, and
  `validateCorrection(unknown)`, which returns `{ ok, value } | { ok: false, errors }` (trimmed;
  blank optional fields become absent).
- Report text: `correctionToText(draft, datasetVersion)` (plain text with **no location or device
  data**) and `correctionTitle`.
- Issue URLs:
  - `correctionIssueUrl(draft, datasetVersion, configuredUrl = import.meta.env.VITE_CORRECTIONS_URL)`
    returns `null` unless the configured URL is `https:`. It appends `title` and `body`, keeps the
    existing query parameters, and stays under `ISSUE_URL_MAX_LENGTH` (6,000) by shortening the
    details first.
  - `correctionsBaseUrl` is also exported.
- Sharing helpers: `copyText(text)` (clipboard, with an `execCommand` fallback), `downloadText`,
  `safeFilename`.
- `useCorrectionDraft()`: the half-written form, kept in **session** storage only.

### `src/offline`

- `pwaOptions` for vite-plugin-pwa:
  - `generateSW`, prompt mode, `injectRegister: false`, file name `sw.js`
  - the manifest comes from `APP_CONFIG.brand`
  - precache only: the app shell, `data/*.json`, `data/*.geojson` and `fonts/**/*.pbf`
  - an 8 MB per-file limit, `navigateFallback: 'index.html'`, `cleanupOutdatedCaches`
  - **no runtime caching**
- Also exported: `PRECACHE_GLOBS`, `MANIFEST_ICONS`, `SW_FILENAME`.
- `useOnlineStatus()` uses `useSyncExternalStore` on the `online` and `offline` events.
- `useServiceWorkerUpdate()` returns `{ supported, updateAvailable, offlineReady, applyUpdate(),
dismiss(), error }`. Registration goes through `workbox-window` in `sw-controller.ts`, and happens
  only in production builds.

## Invariants

- Every storage access is wrapped in try/catch. Corrupt JSON or a schema mismatch returns the
  fallback and deletes the entry. The app must work when storage is blocked, as in private mode.
- Location never enters storage. Correction reports never include coordinates or device data.
- Nothing is sent anywhere by the platform modules. Reports leave the device only when the user
  copies, downloads or opens them.
- App and data update atomically: one precache, versioned per file, and a reload only after the user
  accepts the update. See the [offline README](../../src/offline/README.md).
- `PRIVACY_FACTS` must stay literally true for the build.

## Tests

`tests/unit/favorites`, `privacy`, `feedback`, `offline` and `utils/storage.test.ts` cover:

- the favourites limit and order, recents with history off, and clear-all across both storage areas
- correction validation, text, URL length limits and https-only, with `vi.stubEnv` for the env path
- copy and download fallbacks
- the session draft
- the service-worker update state machine against a fake workbox
- the PWA config
- storage corruption, quota errors and blocked storage

The UI is tested in `tests/unit/platform-ui/*`.

## Known limitations

- `useServiceWorkerUpdate` uses `workbox-window` directly rather than
  `virtual:pwa-register/react`, because the virtual module cannot be resolved under Vitest. It
  mirrors the plugin's prompt-mode logic. **The real update prompt across two production deploys is
  unverified**; it is on the manual checklist in [QA_STRATEGY.md](../QA_STRATEGY.md).
- `navigateFallbackDenylist` (`/data/`, `/fonts/`) assumes deployment at the site root.
- A dataset file over 8 MB would fail the build. That is intended; the largest is 0.5 MB.
- "Clear all local data" does not remove the Cache Storage precache or the service-worker
  registration, which contain no personal data. The browser's "Clear site data" does.
- Real clipboard and download behaviour on iOS, and "Open prefilled report" with
  `VITE_CORRECTIONS_URL` set at build time, have been unit-tested only.
