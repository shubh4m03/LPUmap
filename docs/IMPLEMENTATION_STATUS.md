# Implementation status

**As of 2026-10-24.** This covers the working tree on top of commit `e8f313a`: the final UI wave
(owner specs A, B and C) plus server hardening and QA fixes. **None of it is committed yet**; the
project lead commits.

Every result in this file is from a real run. The gate in [§2](#2-how-it-was-verified) was re-run in
full after the last code change. Anything that was not run, or could not be tested, says so.

## At a glance

| Area                                       | State                                                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Community: "Suggest a missing place"       | Built, tested end to end against the real server handlers                                                              |
| Owner admin (`/admin`): moderation, editor | Built, tested end to end against the real server handlers                                                              |
| Building Studio (Creative Mode)            | Built, tested end to end (save, reload, second browser, publish, archive, restore)                                     |
| Map engine (free sources only)             | Built: five view modes, optional Esri imagery, optional EOX backdrop, fallbacks. Tested with synthetic tiles only      |
| Photorealistic 3D                          | **Not implemented, by owner decision** (no billing). Shown as unavailable with the reason                              |
| Full gate (types, lint, format, all tests) | **All green** (see [§2](#2-how-it-was-verified))                                                                       |
| Acceptance checklist                       | **55 PASS, 1 FAIL, 1 NOT TESTABLE** of 57 items (see [§3](#3-acceptance-checklist-summary))                            |
| Open decision                              | Off-campus places can be routed to when the opt-in layer is on (D3). Needs an owner/lead decision before it is changed |

## 1. What exists

Paths are relative to the repository root.

### 1.1 Already committed in `e8f313a` (unchanged in scope)

- Schema-v2 campus-only dataset: `public/data/**`, built by `scripts/build-data.ts` from the committed
  snapshot. The current build reports 131 campus buildings (128 inside, 3 crossing the boundary, 128
  unnamed), 13 held for review, 390 outside and excluded, 227 campus places, 261 context places, and a
  graph of 1636 nodes / 1770 edges.
- Building Studio core: `src/building-studio/**` (schema, asset library, mesh generators, geometry,
  validation, history, editor state, local recovery, thumbnails, template compatibility, merge, labels,
  MapLibre custom layer in `src/building-studio/render/maplibre/`).
- Server: `server/**`, `functions/api/**`, migrations `migrations/0001_initial.sql` and
  `migrations/0002_building_studio.sql`, publication v2.
- Isometric overview `src/isometric/**` and building directory `src/components/directory/**`.

### 1.2 View modes and map providers (owner spec C)

- **Five view modes**, always listed in the owner's order: Satellite map, Photorealistic 3D, 3D map,
  Isometric overview, 2D map. Model and deep links (`?view=satellite`, `?view=earth`, plus the older
  `3d`, `iso`, `2d`) are in `src/app/view-mode.ts`. The switcher is
  `src/components/map-controls/ViewModeSwitcher.tsx`. Choosing an unavailable mode changes nothing and
  shows the reason; a deep link to an unavailable mode is ignored and removed from the URL
  (`src/app/hooks/useViewMode.ts`, `src/app/store/map-slice.ts`).
- **Provider layer** `src/map/providers/`: `types.ts` (contract), `config.ts` (env parsing; warnings
  name a variable, never its value), `esri.ts`, `eox.ts`, `registry.ts`, `failure.ts` (error
  classification and the key probe), `attribution.ts`, `camera.ts` (`MAX_PITCH = 60`, campus bounds),
  `imagery-layer.ts` (adds and removes the raster without rebuilding the map style), `runtime.ts`.
- **Esri World Imagery** (Satellite 2D, and under the 3D map) — only when `VITE_ARCGIS_API_KEY` is set
  at build time. Attribution "Powered by Esri | Source: Esri, Vantor, Earthstar Geographics, and the GIS
  User Community". The capture date (2023-12-18, from Esri World Imagery Wayback metadata) is shown only
  while the view centre is inside the area where it was verified, never as "live"
  (`src/components/map-controls/ImageryNotice.tsx`).
- **EOX Sentinel-2 cloudless 2016** (CC BY 4.0) — keyless, off unless `VITE_EOX_BACKDROP=true`, Satellite
  2D only, and only when no Esri key is set. 10 m resolution; the notice "10 m imagery — buildings not
  visible" stays on screen and the camera is capped at zoom 14.
- **Photorealistic 3D**: a permanently unavailable option with the billing and coverage explanation.
  No 3D-tiles renderer and no new npm dependency.
- **Terrain**: none. Campus relief measured from Copernicus GLO-30 is about 4.7 m, which would not be
  visible.
- **Fallbacks** (`src/app/hooks/useImageryRuntime.ts`): a missing or refused key, quota error, network
  failure or going offline moves Satellite 2D to the 2D campus map with a notice; the 3D map stays in 3D
  without imagery. There is never a blank map.
- **Return to campus** control: `src/components/map-controls/ReturnToCampusButton.tsx`.
- **CSP and offline**: `public/_headers` allows exactly the two imagery hosts; imagery is never
  precached or cached (`src/offline/pwa-config.ts` has no runtime route). Privacy text names a provider
  only when one is configured (`src/privacy/privacy-facts.ts`).
- Docs: `docs/MAP_PROVIDER_CONFIGURATION.md` (§Modes, §Free providers), `docs/IMAGERY_COVERAGE_AND_FRESHNESS.md`,
  `docs/GOOGLE_EARTH_STYLE_MAP_ASSESSMENT.md`, `.env.example`.

### 1.3 Map editing contract (shared by Suggest, Locations and the Studio)

- `src/map/editing/` (`types.ts`, `controller.ts`, `layers.ts`, `EditReticle.tsx`, `index.ts`) and the
  `editing` prop on `src/map/MapView.tsx`.
- While editing, map clicks go to the editor and never select a place; desktop handle drags report
  positions; pan and rotate are suspended only during a handle drag; phones use a centre reticle drawn at
  the centre of the padded viewport (so it stays under the pin when a bottom sheet is open); editing
  layers survive basemap changes; `editing = null` restores normal navigation.

### 1.4 Community: public "Suggest a missing place" (owner spec A)

- `src/components/suggest/` (`SuggestPanel.tsx`, `submit.ts`, `suggest-model.ts`, `suggest-store.ts`,
  `useSuggestEditing.ts`), opened from the app menu (`src/components/layout/MoreMenu.tsx`) and the place
  panel (`src/components/place/PlaceActions.tsx`).
- Step 1 places the point (desktop click/drag, phone centre pin, "Use the map centre" from the keyboard).
  Step 2: name, category, description, landmark, evidence link and a hidden honeypot, validated with the
  server's own schema.
- "Submitted for review" appears only after the server's documented pending answer; it never says the
  place is published. Rate limit, outside-area, no API on this host, unavailable, refused and unknown
  outcomes each have their own message stating whether anything was saved.

### 1.5 Owner admin `/admin` (owner spec A)

- Lazy chunk: `src/main.tsx` imports only `src/admin/AdminRoot.tsx` and `src/admin/is-admin-path.ts`.
  The public entry of the final build contains none of "X-CSRF-Token", "/api/admin", "Owner password",
  "Moderation queue", "cdn-cgi/access" or "Approve and publish" (checked, see §2).
- Shell: `src/admin/AdminApp.tsx`, `routes.ts`, `router.ts`, `layout/`, `session/` (session gate, login
  form; Cloudflare Access or password mode). Logout clears every Studio crash-recovery entry.
- Typed API client `src/admin/api/` covering all 45 admin routes in `server/handlers/admin/routes.ts`
  (27 community/session, 18 studio) plus `/api/health`; CSRF token in memory only; every 2xx response is
  schema-checked; conflicts, rate limits, unknown outcomes and missing configuration are reported as such.
- Sections (`src/admin/sections/`):
  - **Queue** (`QueueSection.tsx`, `queue/`): status tabs pending / needs_information / approved /
    rejected / duplicate with counts, search, paging; detail with duplicate candidates, history and the
    actions the server's transition table allows; approve with an explicitly chosen, server-validated
    access point (or explicitly none).
  - **Locations** (`LocationsSection.tsx`, `locations/`): owner map editor — add, edit, move (click/drag,
    phone pin with 1 m steps, typed coordinates), hide, restore, permanent delete with typed name; Hidden
    filter; unsaved-changes guard.
  - **Overrides** (`OverridesSection.tsx`, `overrides/`): rename, recategorise, hide/unhide, access point,
    note, back to base values; All / Hidden / Orphans tabs with `orphanReason` and rollback advice.
  - **History** (`AuditSection.tsx`, `audit/`): filters, field-level before/after, revert only where the
    server allows it.
  - **Quality** (`QualitySection.tsx`): warnings grouped by kind, linked to records.
  - **Studio** and **Templates**: see §1.6.

### 1.6 Building Studio UI (owner spec B)

- Logic: `src/building-studio/ui/` (`store.ts`, `actions.ts`, `handles.ts`, `preview.ts`, `fields.ts`,
  `text.ts`, `library.ts`, `snap-targets.ts`, `iso-preview.ts`).
- Screens: `src/admin/studio/` (`StudioSection.tsx`, `TemplatesSection.tsx`, `StudioToolbar.tsx`,
  `StateBadge.tsx`, `StudioMap.tsx`, `AssetBrowser.tsx`, `RecordList.tsx`, `PlacementBar.tsx`,
  `Inspector.tsx`, `GeometryPanel.tsx`, `AppearancePanel.tsx`, `InfoPanel.tsx`, `TemplatePanel.tsx`,
  `SnapSection.tsx`, `ValidationPanel.tsx`, `StudioDialogs.tsx`, `StudioBanners.tsx`, `IsoCheck.tsx`,
  `controls.tsx` and hooks).
- Tools Add / Select / Move / Rotate / Resize / Appearance / Info, Duplicate, Undo / Redo, Save draft,
  Publish, Cancel, Archive / Restore / permanent Delete (typed id). State badge always visible (unsaved,
  saved draft with revision, published version, archived).
- Searchable, categorised asset browser with generated thumbnails and preview; translucent placement
  preview by click, drag, typed coordinates or metre offsets; live server placement check with reasons;
  optional, visible snapping proposals.
- Inspector: identity and private notes, dimensions with height/floors conflict warnings, roof limited to
  what the generator can build, façade/colour presets, reset, before/after, detail level, evidence fields
  that refuse Google URLs, access point by node id or an explicitly accepted nearest node.
- Checks panel with per-warning acknowledgement and reason; publish dialog with change list, warnings and
  change summary; beforeunload guard; crash recovery in this browser; "Model this building" for existing
  base buildings (same public id).
- Phones: centre-reticle placement, 44 px step buttons, bottom-sheet inspector, large Save/Cancel.
- Templates screen: built-in and owner templates, variants, versions, retire / bring back. GLB import is
  shown as not enabled, with the reason.

### 1.7 Server hardening

Changed: `server/env.ts`, `server/handlers/admin/*` (new `audit-spec.ts`), `server/handlers/publication.ts`,
`server/domain/publication.ts`, `server/domain/studio/*`, `server/db/*`, `scripts/admin-http-smoke.ts`.
Regression tests in `tests/server/security/hardening.test.ts` cover: bodies rejected while being read are
audited as `rejected`; `GET /api/locations` answers `If-None-Match` with 304 and reads one consistent
batch; the ETag carries the publication schema version; public accuracy class from the stored template
version; Google Maps photo hosts, trailing-dot hosts and free-text fields follow the prohibited-source
rule; the delete-snapshot limit is counted in UTF-8 bytes; zero-width characters and U+2028/2029 are
rejected in names; an optional global login cap (`ADMIN_LOGIN_GLOBAL_LIMIT`).

### 1.8 Test infrastructure

- `tests/e2e/backend/` runs the **real** server handlers over a fresh in-memory local D1 (wrangler
  `getPlatformProxy`, migrations applied) in password mode with a throwaway password. It never touches a
  remote database. `playwright.config.ts` starts it next to `vite preview`.
- New e2e specs: `admin-auth`, `admin-moderation`, `admin-overrides`, `suggest`, `studio-workflow`,
  `studio-mobile`, `map-modes`.
- New unit test folders: `tests/unit/admin/`, `tests/unit/suggest/`, `tests/unit/studio-ui/`,
  `tests/unit/map-providers/`, plus `tests/unit/map/MapView-editing.test.tsx`,
  `tests/unit/map/edit-reticle.test.tsx`, `tests/unit/app/map-picking.test.tsx`.

## 2. How it was verified

I re-ran the whole gate on 2026-10-24 after the last code change, from the repository root. Builds went
to a scratch directory, never `dist/`, and the owner's preview on port 4410 was not touched. No
`.env.local` and no `VITE_*` variable was set for the default build.

| Command                                                                                                            | Result                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx tsc --noEmit -p .`                                                                                            | exit 0, no output                                                                                                                                                |
| `npx tsc --noEmit -p tsconfig.server.json`                                                                         | exit 0, no output                                                                                                                                                |
| `npx eslint . --max-warnings=0`                                                                                    | exit 0                                                                                                                                                           |
| `npx prettier --check .`                                                                                           | exit 0, "All matched files use Prettier code style!"                                                                                                             |
| `npx vitest run`                                                                                                   | **171 files passed, 2234 tests passed, 0 failed**                                                                                                                |
| `npx vitest run -c vitest.server.config.ts`                                                                        | **36 files passed, 1 skipped; 1443 tests passed, 4 skipped, 0 failed** (the skips are the opt-in rollback drill in `tests/server/compat/rollback-drill.test.ts`) |
| `npm run data:check`                                                                                               | exit 0; "0 warnings, 0 errors"; dataset `62e807e6d444`; `git status public/data docs/DATA_QUALITY_REPORT.md` empty afterwards                                    |
| `npx vite build --outDir <scratch> --emptyOutDir`                                                                  | exit 0; public entry `index-DxpDBkj1.js` 261.43 kB (84.26 kB gzip)                                                                                               |
| `node scripts/smoke.ts --dist <scratch>`                                                                           | "Smoke OK: 10 checks passed" (precache 96 files, 4.6 MiB; no secrets in dist, 161 text files scanned; real search and real route)                                |
| Admin strings in the public entry                                                                                  | 0 matches each for "X-CSRF-Token", "/api/admin", "Owner password", "Moderation queue", "cdn-cgi/access", "Approve and publish"                                   |
| `npx playwright test` (all specs, 5 projects: desktop 1440, laptop 1280, tablet 768, mobile 390, mobile-small 360) | **226 passed, 69 skipped, 0 failed** (5.9 min). Skips are viewport- or configuration-specific by design                                                          |
| `npx playwright test tests/e2e/map-modes.spec.ts` on a build with the spec's fake Esri key (synthetic tiles)       | **53 passed, 12 skipped, 0 failed**                                                                                                                              |
| `npx playwright test tests/e2e/map-modes.spec.ts` on a build with `VITE_EOX_BACKDROP=true` (synthetic tiles)       | **23 passed, 42 skipped, 0 failed**                                                                                                                              |

Notes:

- The Playwright runs used `E2E_DIST=<scratch build>` and their own ports (5451–5453 for the preview,
  4471–4473 for the real-handler backend). All of those ports were free afterwards; only 4410 was still
  listening. The fake-key and EOX builds were deleted after the runs.
- The imagery e2e runs intercept every request to the providers and answer with synthetic tiles; no real
  Esri or EOX imagery was fetched in these runs.
- Earlier, a QA pass looked at screenshots for every checklist item and ran extra scratch specs (axe on
  Studio and Templates, studio handle drags, moderation conflicts, off-campus behaviour). Those results
  are summarised in §3; I did not re-run the scratch QA specs.

## 3. Acceptance checklist summary

Source: the QA acceptance checklist of 2026-10-24 (57 items, tested on the real app with the
real-handler backend).

| Section                           | PASS   | FAIL  | NOT TESTABLE |
| --------------------------------- | ------ | ----- | ------------ |
| Building Studio (owner lists A–E) | 26     | 0     | 0            |
| Community                         | 8      | 1     | 0            |
| Map engine (free sources)         | 8      | 0     | 1            |
| Regression list                   | 8      | 0     | 0            |
| Earlier gates                     | 5      | 0     | 0            |
| **Total**                         | **55** | **1** | **1**        |

Some PASS items carry a qualification: "Numeric fields and limits" and "Accessibility of Studio and
Templates" pass after fixes D1 and D2 below; "Both 3D modes render studio models" passes, but Gate 3
frame times were not re-measured; Esri Satellite 2D and the EOX backdrop pass with synthetic tiles
only; "Attribution always visible" passes with the D5 note.

### FAIL

- **Off-campus never a routing destination (defect D3).** With the opt-in "Nearby, outside campus"
  layer on, base context places (for example "Green valley main gate", `osm:node/12031088561`) and
  approved off-campus community locations show an enabled "Directions to here" / "From here".
  Cause: `isRoutablePlace` (`src/facilities/directory.ts`), `placeEndpoint` and `routeBlockReason`
  (`src/app/place-actions.ts`) check only `graphNodeId`, which all 261 context places have, and
  `mergePublication` keeps it for outside locations (`src/community/merge.ts`). This is a **contract
  conflict**: `tests/unit/community/merge-integrity.test.ts` deliberately asserts that an off-campus
  location with a valid access node is routable, so QA did not change it. Suggested fix, if you confirm
  that off-campus places must never be routed to: require `campusZone === 'on-campus'` in
  `isRoutablePlace` and `placeEndpoint`, give `routeBlockReason` the reason "Outside the campus:
  directions cover campus places only", give map-picking an outside-campus message, stop offering
  "Choose a nearby point" for off-campus places, and update that test.

### NOT TESTABLE

- **Geographic consistency of overlays on real imagery.** No real imagery key is configured (no billing;
  no free Esri key set up), so only synthetic tiles were used. This needs a look with a real free-tier
  key (see owner action 3).

### Defects found and fixed during QA

- **D1** (Studio coordinate fields rounded to 0.001°, about 100 m; an arrow key moved a model about
  45 m): fixed in `src/admin/studio/controls.tsx`; regression tests in
  `tests/unit/studio-ui/number-field.test.tsx`; the e2e metre-offset assertion was tightened to 8–12 m.
- **D2** (axe `label-content-name-mismatch` on step buttons): fixed in
  `src/admin/studio/GeometryPanel.tsx`; axe re-run gave 0 violations on Studio and Templates (desktop
  and phone).

### Open low-severity notes

- **D4**: the moderation approve dialog does not warn that a suggestion is outside the campus boundary;
  it is reported only afterwards on the Quality page.
- **D5**: on phones the Studio state chip is truncated ("Unsaved local changes (not…"); the "Ready to
  work offline" toast briefly covers the bottom attribution line until dismissed; the phone view-mode
  switcher shows icons only (names and reasons are in accessible labels and the toast).

## 4. Known gaps

- **Photorealistic 3D is not implemented** (owner decision, no billing). It is shown as unavailable.
- **GLB / glTF import is not enabled.** A file validator exists (`src/building-studio/glb-validator.ts`),
  but storing models needs an R2 binding and drawing them needs the Three.js adoption gate. The
  Templates screen says so.
- **Real imagery has not been seen in this project's test runs**; only synthetic tiles. Esri answered a
  malformed token with normal tiles, so a bad key may not be caught by the probe. Esri's answer when the
  free tier is exhausted has not been observed.
- **Device frame-time criterion (D8)** for 3D studio models is still open: headless Chromium draws WebGL
  on the CPU, so no phone numbers exist (`docs/3D_BUILDING_FIDELITY.md` §6).
- **E2E covers password mode only.** Cloudflare Access mode and its logout redirect are covered by unit
  tests only. The e2e backend runs the handlers in Node with miniflare's D1, not inside workerd.
- **Not covered by e2e** (unit/RTL tests only): Studio "model existing building" (QA did it by hand),
  apply template, duplicate, permanent delete, 409 conflict flow; orphaned overrides (cannot be created
  through the UI).
- **Studio**: no confirm dialog when navigating to another admin section with unsaved changes (edits are
  kept in crash recovery and the beforeunload prompt covers reloads); access point cannot be picked on
  the map yet; neither studio spec runs on the tablet project.
- **Wording**: the public place panel says "OpenStreetMap has no name for this building yet…" for an
  unnamed owner-placed studio building; the overlap message can show a `stu:` id twice when the other
  building has no name; in the isometric overview some studio models appear grey rather than in their
  chosen wall colour.
- **Admin chunks are precached** by the service worker for every public visitor (no secrets, wasted
  bytes), and `public/_headers` has no `X-Robots-Tag` for `/admin` (the page adds a `noindex` meta at
  runtime only). `src/app/App.tsx` prefetches the public shell chunk, so `/admin` downloads it too.
- On phones the admin header and tab row take about 240 of 844 px, which leaves the Studio map small.

## 5. Owner actions

1. **Block numbers.** None are applied; the app shows its own map keys (for example "E2-05"), labelled as
   not official. Work through
   [`docs/research/block-leads/OWNER_CHECKLIST.md`](research/block-leads/OWNER_CHECKLIST.md) and record
   each block number only with your own first-hand evidence (a sign photo or an official LPU document
   that names the building). The Behance illustration is never evidence.
2. **Crossing buildings.** Three footprints that cross the OSM campus boundary are in the campus
   inventory under rule R6 (inside fraction ≥ 0.5, no conflicting evidence): `osm:way/422550525`
   (76.67 % inside), `osm:way/422738888` (83.69 %) and `osm:way/422738894` (99.15 %). Please accept or
   reject them. Thirteen more are held for review and stay out of the inventory until a dated decision is
   added to `data/curated/boundary-review.json` ([`docs/CAMPUS_BUILDING_COVERAGE.md`](CAMPUS_BUILDING_COVERAGE.md)).
3. **Optional: free Esri key** for real satellite imagery. Follow
   [`docs/MAP_PROVIDER_CONFIGURATION.md` §Esri World Imagery](MAP_PROVIDER_CONFIGURATION.md#esri-world-imagery-arcgis-location-platform-free-tier):
   ArcGIS Location Platform with **pay-as-you-go left off**, Basemaps privilege only, referrer
   restrictions to your origins. Put it in `.env.local` locally and in the Cloudflare Pages build
   environment; never commit it. It is public once built. With a key, the desktop start view contacts
   Esri at page load. Afterwards, check that overlays line up with the imagery (the NOT TESTABLE item).
4. **Device performance check** on a mid-range phone: open the 3D map with studio models, move the
   camera for a few seconds, and note whether the app falls back to plain blocks or suggests the
   Overview (the watchdog triggers at rAF p95 > 50 ms; the device budget is 33 ms). This closes D8.
5. **Decide D3**: may off-campus places (opt-in layer) be routing destinations? See §3.
6. **Google photoreal is not implemented**, by your decision of 2026-10-24 (no billing; Google 3D
   coverage at LPU unverified and likely absent). Nothing to do unless that decision changes.
7. **GLB import is not enabled.** Enabling it needs an R2 binding and a decision on the Three.js
   dependency; nothing to do unless you want imported models.
8. **Delete `C:\lpuw014438`.** It is a leftover folder outside the repository (about 2.2 MB, holding a
   `v3` directory). The project does not use it. I did not delete it.
9. **Commit**: the lead commits the working tree; nothing is committed yet.

## 6. Decisions made autonomously

These were made by the build agents within the owner's rules, not by the owner. Each can be revisited.

| Decision                                                                                              | Reason                                                                                               |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Esri World Imagery (free tier, PAYG off) as the only high-resolution imagery, opt-in by key           | Free source with documented attribution and a no-bill free tier; Google needs billing                |
| EOX Sentinel-2 2016 backdrop opt-in only, Satellite 2D only, camera capped at zoom 14                 | CC BY 4.0 and keyless, but 10 m imagery shows no buildings; it must not pretend otherwise            |
| Imagery date shown only inside the verified area and never as "live"                                  | The Wayback date was verified for the campus only                                                    |
| No terrain                                                                                            | Measured relief of about 4.7 m across the campus would not be visible                                |
| No 3D-tiles renderer, no new npm dependency                                                           | No billing-free photoreal source exists, so the dependency is not justified                          |
| The store refuses unavailable modes; deep links to them are dropped; fallbacks end at the overview    | Otherwise `?view=earth` would have drawn the 2D map under a "Photorealistic" label; no blank screen  |
| Accessible name "Satellite map" instead of "Satellite 2D map"                                         | "Satellite 2D map" contains "2D map" and broke role queries for the 2D map                           |
| `maxPitch` 60                                                                                         | MapLibre marks higher values experimental                                                            |
| Imagery never cached offline; CSP allows exactly the two provider hosts                               | Esri's terms forbid storing data; one rule for every provider                                        |
| `/admin` as a lazy chunk; CSRF token in memory only; logout clears all Studio crash recovery          | No admin code or text in the public bundle; nothing sensitive left in the browser after logout       |
| Approve corrections cannot clear the submitted description (the form points to Edit instead)          | Approve corrections are override fields and cannot clear it; silently keeping old text would mislead |
| Hidden locations shown by a client-side filter                                                        | The server lists all locations including hidden ones and has no GET by id                            |
| The Studio's server check runs on its own request and counts only for the exact draft it checked      | A check must never block a save, and a stale result must not count for a changed draft               |
| "Apply template" previews on the server for a saved record and applies locally for a draft with edits | Keeps unsaved edits; the server stays the authority for saved records                                |
| E2E runs the real handlers over an in-memory local D1                                                 | Tests the real server without mocks and without touching any remote database                         |
| D3 (off-campus routing) left unchanged                                                                | An existing test asserts the current behaviour on purpose; the change needs an owner/lead decision   |

## 7. Deployment checklist

Full details: [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) and [`docs/ADMIN_OPERATIONS.md`](ADMIN_OPERATIONS.md).

1. **Commit** the working tree (lead) and confirm `git status` is clean. Make sure no `.env.local`,
   `.dev.vars` or key is staged.
2. **Run the gate** locally or in CI (all green on 2026-10-24, §2):
   `npx tsc --noEmit -p .`, `npx tsc --noEmit -p tsconfig.server.json`, `npx eslint . --max-warnings=0`,
   `npx prettier --check .`, `npx vitest run`, `npx vitest run -c vitest.server.config.ts`,
   `npm run data:check`, `npx vite build`, `npm run smoke`, `npx playwright test`.
3. **Cloudflare Pages project**: build command `npm run build`, output `dist`, `NODE_VERSION=24` for
   Production and Preview.
4. **D1**: `npx wrangler d1 create lpu-atlas`, then replace the placeholder `database_id` in
   `wrangler.toml` (or bind `DB` in the dashboard).
5. **Migrations before code**: back up first (`npx wrangler d1 export lpu-atlas --remote --output=<outside-the-repo>/before-migrate.sql`),
   then `npx wrangler d1 migrations list lpu-atlas --remote` and
   `npx wrangler d1 migrations apply lpu-atlas --remote` (applies `0001` and `0002`).
6. **Authentication** (without it every `/api/admin/**` answers 503, fail closed). Choose one:
   - `AUTH_MODE=access` with `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `OWNER_EMAILS`, and one Access
     application protecting both `/admin*` and `/api/admin/*` (leave `/api/locations`,
     `/api/contributions/*` and `/api/health` public); or
   - `AUTH_MODE=password` with the secret `OWNER_PASSWORD_HASH` from `npm run admin:hash-password`.
7. **Secrets and variables**: `RATE_LIMIT_KEY` (secret, ≥ 32 random characters, recommended);
   optional `PUBLIC_ORIGIN` (custom domain) and `ADMIN_LOGIN_GLOBAL_LIMIT`. Secrets only through
   `npx wrangler pages secret put` or the dashboard, never in `wrangler.toml` or git.
8. **Optional imagery** (build-time): `VITE_ARCGIS_API_KEY` (see owner action 3) and/or
   `VITE_EOX_BACKDROP=true`. Leave both unset for a build that makes no third-party request.
9. **Deploy**, then check:
   - `curl -s https://<host>/api/health` → `{"ok":true,"db":"ok","auth":"access"}` (or `"password"`);
   - `curl -sI https://<host>/ | grep -iE 'content-security|permissions|cache-control'` and
     `curl -sI https://<host>/sw.js | grep -i cache-control`;
   - open the site: map, search, a route, each view mode; `/admin` sign-in; send one test suggestion
     and reject it in the queue.
10. **Rollback** if needed: Pages → Deployments → "Rollback to this deployment" (no database change
    needed; see `docs/DEPLOYMENT.md` §D1 migrations: rollback for the schema).
