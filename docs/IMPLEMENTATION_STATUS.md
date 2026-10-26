# Implementation status

**As of 2026-10-24.** Commit `2407afe` holds the final UI wave (owner specs A, B and C), server
hardening and the first QA fixes. Commit `6050e91` holds the **fix wave** (§1.9): D3 off-campus
routing, D4, D5, the honeypot decoy, the Zod CSP violation, the Studio leave prompt, access-point
picking on the map and new e2e coverage. On top of `6050e91`, the working tree holds the
**campus-illustration (artwork) integration** (§1.10). **It is not committed yet**; the project lead
commits.

Every result in this file is from a real run. The gate in [§2](#2-how-it-was-verified) was re-run in
full by the verification agent after the fixers finished. Anything that was not run, or could not be
tested, says so.

## At a glance

| Area                                       | State                                                                                                                                    |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Community: "Suggest a missing place"       | Built, tested end to end against the real server handlers                                                                                |
| Owner admin (`/admin`): moderation, editor | Built, tested end to end against the real server handlers                                                                                |
| Building Studio (Creative Mode)            | Built, tested end to end (save, reload, second browser, publish, archive, restore, model existing, template, duplicate, delete, 409)     |
| Map engine (free sources only)             | Built: five view modes, optional Esri imagery, optional EOX backdrop, fallbacks. Tested with synthetic tiles only                        |
| Photorealistic 3D                          | **Not implemented, by owner decision** (no billing). Shown as unavailable with the reason                                                |
| Full gate (types, lint, format, all tests) | **All green** on the fix-wave tree (see [§2](#2-how-it-was-verified))                                                                    |
| Acceptance checklist                       | **56 PASS** (one of them, D3, after a fix), **0 FAIL, 1 NOT TESTABLE** of 57 items (see [§3](#3-acceptance-checklist-summary))           |
| Off-campus routing (D3)                    | **Fixed**: off-campus places are never routing endpoints; verified in the real app                                                       |
| Campus illustration (Illustrated overview) | Built and integrated (§1.10): renderer, directory/search/details, admin Artwork section, migration 0003. 0 verified links (owner action) |
| Artwork gate (working tree and clean tree) | **Green** (§1.10): Vitest 2508 passed / 1 skipped, server 1536 / 4 skipped; clean tree Playwright 324 passed, 0 failed, 106 skipped      |
| Performance (D8)                           | Overview budgets met in 3 of 3 runs; one heavy-scene budget still over (§4); phone numbers still missing (owner action 4)                |

## 1. What exists

Paths are relative to the repository root.

§1.1 was committed in `e8f313a`; §1.2–§1.8 were committed in `2407afe`; §1.9 (the fix wave) was
committed in `6050e91`; §1.10 (the artwork integration) is uncommitted.

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
- Fix wave (§1.9): new e2e specs `csp`, `studio-records` and `admin-approve-map`; `studio-workflow`
  and `studio-records` also run on the tablet project.

### 1.9 Fix wave on top of `2407afe` (committed in `6050e91`)

Each fix has a regression test. The fixers proved each test fails without its fix by reverting the fix
temporarily. Not proven by a revert: the new e2e flows in `studio-records.spec.ts` and
`admin-approve-map.spec.ts` (they cover flows that already worked or depend on the new picker) and the
unit tests of new pure helpers (they cannot exist without the new code). The verification agent
repeated the revert check on 12 fix files (D3, the decoy, the Zod CSP fix, the name rule, the
unnamed-building wording, D4, the toast part of D5 and `StudioSection.tsx`) and restored each one byte
for byte (checked with `cmp`).

- **D3, off-campus routing (fixed).** `isRoutablePlace` (`src/facilities/directory.ts`) and
  `placeEndpoint` (`src/app/place-actions.ts`) now require `campusZone === 'on-campus'`.
  `routeBlockReason` returns "Outside campus — directions cover campus paths only." The place panel,
  saved places, the search palette and the directions endpoint search use it. Map picking
  (`src/app/map-picking.ts`, `MapStage.tsx`, `IsoStage.tsx`) has a new `outside-campus` outcome with
  its own message, and picking stays on. "Choose a nearby point on the map" is hidden for off-campus
  places. Off-campus places keep their `graphNodeId` in the data, so the owner still sees the validated
  access node. `tests/unit/community/merge-integrity.test.ts` now cites the rule and checks that none
  of the real context places with a path node is routable. The verification agent checked it in the
  real app at 1440 px and 390 px: "Green valley main gate" (`osm:node/12031088561`, graph node 965)
  shows "Directions to here" disabled with that reason, and no "nearby point" button. Every code path
  that sets a route endpoint goes through `placeEndpoint` or `routeBlockReason`.
- **D4, approve dialog outside the boundary (fixed).** `src/admin/map/OutsideCampusNotice.tsx` shows
  "Outside the campus boundary" above "Approve and publish" (and in the location editor) when the point
  is off campus. It says the place appears only in the opt-in "Nearby, outside campus" layer and is not
  routable. The check (`src/admin/map/campus-zone.ts`) is the boundary test the public merge uses.
  For an off-campus point the approve dialog no longer offers path nodes: it states that no access point
  is saved and approves without one (regression test in `tests/unit/admin/outside-campus.test.tsx`,
  shown to fail without the fix). The decoy timing test now asserts only the lower bound (decoy not
  visibly faster than a real write); the upper side is bounded by `DECOY_TIMING.maxMs`, which is
  unit-tested, so the test no longer fails on loaded hosts.
- **D5, phone clipping (fixed, except the icon-only switcher).** The Studio state chip wraps instead
  of truncating (`StateBadge.tsx`). Toasts sit above the measured top edge of the map attribution
  (`src/components/layout/toast-offset.ts`, `MobileLayout.tsx`, `DesktopLayout.tsx`), so a three-line
  Esri credit is no longer covered. The admin header and tab row on a 390×844 phone are about 105 px
  (122 px on the build without the fix). The phone view-mode switcher is still icons only.
- **Tablet Studio layout (found and fixed).** At 768 px the section links, library and inspector left
  the Studio map almost no width. Below 1024 px the section links are now a tab row, the two Studio
  side panels open one at a time, and Appearance and Info open the inspector.
- **Honeypot decoy (fixed).** The decoy used to differ from a real acceptance in four ways (202 instead
  of 201, no duplicates, a 202 even for invalid bodies, about 5× faster). It now runs the same
  validation and area check, does the same reads through `decoySuggestion` (which writes nothing), and
  answers 201 with the same headers, body shape, real duplicates and a `sug_` id. It then waits to
  about the moving average of recent real acceptances in that isolate (±15 % jitter, 2 s cap).
  Measured locally, n = 200 each: real median 42.8 ms vs decoy 51.9 ms (before: 40.5 vs 7.8 ms).
  Documented in [`COMMUNITY_MODULE_CONTRACTS.md`](COMMUNITY_MODULE_CONTRACTS.md) §"Honeypot decoy".
  Accepted difference: the decoy never checks or counts rate limits (§4).
- **Zod CSP violation (fixed).** Zod's `new Function` probe broke `script-src` (1 violation on each of
  `/`, `/?view=2d`, `/admin` and `/admin/studio` at 1440 and 390 px, 8 in total, under the real
  `public/_headers` CSP). `vite.config.ts` aliases the bare `zod` import to `src/csp/zod.ts`, which
  first sets `jitless` (`src/csp/zod-jitless.ts`); the server still imports Zod directly. Fixed build:
  0 violations. Bundle: +20 bytes of JS. Regression: `tests/e2e/csp.spec.ts` (failed 4 of 4 on a build
  without the alias, in the fixer's and the verifier's runs) and `tests/unit/csp/zod-jitless.test.ts`.
- **Studio name rule.** Studio names, aliases, template and variant names reject more than 5 combining
  marks in a row (`MARK_FLOOD_MESSAGE` now in `src/building-studio/text.ts`, reused by
  `src/community/schema.ts`). Documented in `BUILDING_STUDIO_DESIGN.md` §5 and the contracts' "Text
  rules".
- **Wording of unnamed buildings (fixed).** The place panel wording depends on the record's source: an
  unnamed `stu:` building says the site owner added it without a name because none is confirmed; OSM
  records keep the OpenStreetMap wording.
- **Leave prompt in the Studio (fixed).** In-app navigation to another admin section with unsaved
  changes asks "Leave the Building Studio?" (Keep editing / Leave without saving). Leaving saves the
  edits to crash recovery first (`setAdminNavigationGuard` in `src/admin/router.ts`). Moving between
  Studio records is not held.
- **Access point picked on the map (new).** In the Studio, the approve dialog and the location editor,
  "Choose on the map" highlights the valid walkable nodes. A click lists the valid nodes within 25 m
  (at most 4) with distances; nothing is chosen until the owner presses "Use path node N", and the
  place or building never moves. On phones the properties sheet steps aside while picking.
- **README.** States that the app makes no third-party request unless `VITE_ARCGIS_API_KEY` or
  `VITE_EOX_BACKDROP` is set (enforced by the CSP), and links the admin, deployment, studio, community,
  map-provider, security and status docs.
- **New e2e** (real-handler backend): model an existing building (same public id); apply a template
  with the server's preview diff; access point chosen on the map, duplicate, archive and permanent
  delete with a typed id; the 409 conflict flow across two browsers; the approve-dialog notice and
  map picking on every viewport; phone layout, leave prompt and tap picking.
- **Performance re-measure** (no code change): see [`PERFORMANCE.md`](PERFORMANCE.md) §"Isometric
  overview budgets (D8)", "Re-measure", and the
  [bake-off report addendum](research/renderer-bakeoff/REPORT.md#addendum-2026-10-24-re-measure-on-a-quieter-machine).
  All D8 overview budgets were met in 3 of 3 runs (hit-test max 0.3–0.4 ms; full redraw at 4× p95
  6.7–16.0 ms; gesture p95 16.8 ms, 0 % of frames over 50 ms; mode switch 147–197 ms; heap growth
  2.19 MB). The machine was not fully idle (17–30 % CPU before the runs). In the bake-off, the overview
  with 50 studio models now builds within budget at 4× (70.0 / 89.5 ms, desktop / mobile; before
  173.8 / 190.0 ms). The custom 3D layer's own CPU p95 at 4× is 4.4 / 3.5 ms (≤ 5 ms). Two numbers are
  still over budget; see §4.

### 1.10 Campus-illustration (artwork) integration on top of `6050e91` (uncommitted)

Contract and reconciliation record: [LPU_ISOMETRIC_ASSET_INTEGRATION.md](LPU_ISOMETRIC_ASSET_INTEGRATION.md)
(§10 lists every competing implementation the integration owner merged into one; §11 is the owner's
verification guide; §14 the limitations). Files and exact labels:
[LPU_ISOMETRIC_ASSET_INVENTORY.md](LPU_ISOMETRIC_ASSET_INVENTORY.md); per-subject links:
[LPU_ISOMETRIC_ASSET_MAPPING.md](LPU_ISOMETRIC_ASSET_MAPPING.md) (generated); provenance and the owner's
ownership statement: [GEODATA_SOURCES_AND_LICENSES.md §14](GEODATA_SOURCES_AND_LICENSES.md#14-lpu-isometric-map-design-owner-supplied-campus-illustration).
Results below are from real runs on 2026-10-24.

- **What was built.** The owner's 29 files are shown unchanged as the **Illustrated overview**, the
  default `?view=iso` variant (`&iso=map` keeps the footprint-based drawing). 65 clickable outlines on
  the master, named by their exact printed labels. 82 depicted subjects (55 numbered, 7 scenes, 20
  areas) appear in the directory (grouped by the printed block headings), search and place details.
  Associations: **0 verified, 19 approximate** ("Unconfirmed match", never routed, never merged),
  **63 unresolved**. The owner links items to buildings in `/admin/artwork` (migration 0003, audited,
  publication v3). Only a verified link joins the illustration and the map; with none today, the two
  modes share no building selection. Re-checked by the documentation agent: `npm run art:check` OK
  (28 originals, 65 hotspots, 82 subjects, 81 published files, 53 derived; 0 / 19 / 63).

- **Assets (gate 1).** The 29 originals in `lpu-isometric-map-design/` match their inventory sha256 (29/29)
  before and after every step. `public/isometric-art/` holds the 28 canonical originals byte-identical
  (`iso-art-115` is a duplicate of `iso-art-111`), 53 derived lossless WebP copies of the master and the
  manifest. All are committable: no path is git-ignored, `.gitattributes` now marks `*.jpg`, `*.jpeg` and
  `*.webp` binary, and git stores every image byte for byte (tested). `npm run art:build` twice: outputs
  byte-identical to each other and to the tree. `npm run art:verify` (Chromium): 53/53 derived files
  byte-identical across two derivations and to the committed copies; native maxAbs 0 for all five groups;
  the three negative controls rejected.
- **Hotspots (gate 2).** 65 outlines in normalized source coordinates; one transform for image and
  outlines. `isometric-art.spec.ts` checks image and outline registration within ±1 device px after open,
  wheel zoom, drag/touch pan, pinch, keyboard zoom and resize at 1440×900, 1280×800, 768×1024, 390×844 and
  360×800. 44 outlines are flagged `needs-manual-verification` (drawn dashed); none was guessed.
- **Fidelity against the original.** `art-evidence.spec.ts` draws the ORIGINAL master JPEG with the
  renderer's transform next to the rendered overview for 4 regions (pins 58, 50, 1, 2): PSNR 47.9–53.1 dB
  and mean error 0.07–0.38 / 255 on mobile and desktop, no pixel off by more than 32 except 1 sample
  in 324 000. Side-by-side images were inspected (composition, colour and printed labels identical).
- **Migration 0003 (gate 4).** On isolated local databases only: `migration-0003.test.ts` and
  `tests/server/artwork/persistence.test.ts` (fresh, populated 0002→0003, failing-atomic, rollback,
  re-apply, three cycles); plus a wrangler CLI rehearsal (`d1 migrations apply --local --persist-to
<scratch>`): 0001+0002 with an audit row → 0003 → a verified and an approximate decision with
  `artwork` audit rows → `docs/db/0003_down.sql` (decisions kept, audit rows kept as `system`, 0003
  forgotten, `artwork` inserts refused) → re-apply (decisions and audit rows identical to before the
  rollback, audit sequence unchanged) ; the file-level recovery copy reproduced the pre-rollback state.
  `wrangler d1 export --local` crashed in this environment (libuv assertion), so the local recovery copy
  was a copy of the persisted database directory. No remote database was touched.
- **Identity.** A VERIFIED association (created through the admin API in the in-memory e2e database,
  then reset) selects the same building id in the illustration and on the 2D map, where the camera
  frames the building; an unresolved item selects no building and has no map position.
- **Clean checkout (gate 5).** A tree of exactly the files to be committed (git `write-tree` of the
  working tree in a scratch clone, extracted with `git archive`) in a scratch directory: `npm ci`,
  `npm run build` (data:check with `public/data` unchanged, art:check, tsc, vite build, art:check-dist:
  manifest and 81 published files byte-identical in `dist/`), `node scripts/smoke.ts` (10/10), Vitest
  2501 passed / 8 skipped (the git test skips outside a git checkout), lint, format and both tsc clean,
  and the full Playwright suite: **324 passed, 0 failed, 106 skipped** (project-specific skips; the
  evidence spec runs on desktop and mobile only).
- **Gate in the working tree.** `tsc` (both configs), `eslint .`, `prettier --check .`: clean. Vitest
  2508 passed / 1 skipped (201 files). Server suite 1536 passed / 4 skipped (40 files).
  `npm run data:check`: 0 errors, 0 warnings, `public/data` byte-identical.
- **Screenshots** (`test-results/evidence/art/`, desktop 1440×900 and mobile 390×844, all inspected):
  full overview, 4 regions, vignettes of 4 block captions in the detail card (details sheet on the
  phone), block-wise directory, selection highlight, verified item in the illustration and on the map,
  unresolved item in both, admin Artwork list and item.
- **Open (owner):** no association is verified; 44 outlines and the inventory's manual-verification list
  need review; the `art:scene-103` caption is withheld pending a decision. **Open (engineering):** map
  modes do not outline an "Unconfirmed match" candidate (it is only framed and named); on desktop the
  detail card and the details panel can show the same item side by side; the public details panel
  quotes the internal research file path in the curated reason; on a DPR-2 phone the overview downloads
  about 2.1 MB of images on opening; Safari, Firefox and real touch hardware were not tested.

## 2. How it was verified

The verification agent re-ran the whole gate on 2026-10-24 (13:47–14:03 IST) on the shared working
tree (`2407afe` plus the fix wave), from the repository root. Builds went to a scratch directory,
never `dist/`. Per the agents' reports, the owner's preview on port 4410 was not touched. No
`.env.local` and no `VITE_*` variable was set for the default build. After the gate, the verifier
reverted some fixes temporarily to re-check their regression tests and restored each file byte for
byte (checked with `cmp`).

| Command                                                                                                            | Result                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx tsc --noEmit -p .`                                                                                            | exit 0, no output                                                                                                                                                |
| `npx tsc --noEmit -p tsconfig.server.json`                                                                         | exit 0, no output                                                                                                                                                |
| `npx eslint . --max-warnings=0`                                                                                    | exit 0                                                                                                                                                           |
| `npx prettier --check .`                                                                                           | exit 0, "All matched files use Prettier code style!"                                                                                                             |
| `npx vitest run`                                                                                                   | **175 files passed, 2261 tests passed, 0 failed**                                                                                                                |
| `npx vitest run -c vitest.server.config.ts`                                                                        | **36 files passed, 1 skipped; 1447 tests passed, 4 skipped, 0 failed** (the skips are the opt-in rollback drill in `tests/server/compat/rollback-drill.test.ts`) |
| `npm run data:check`                                                                                               | exit 0; "0 warnings, 0 errors"; dataset `62e807e6d444`; `git status public/data docs/DATA_QUALITY_REPORT.md` empty afterwards                                    |
| `npx vite build --outDir <scratch> --emptyOutDir`                                                                  | exit 0; public entry `index-Bv6Ek_2J.js` 261.46 kB (84.28 kB gzip)                                                                                               |
| `node scripts/smoke.ts --dist <scratch>`                                                                           | "Smoke OK: 10 checks passed" (precache 99 files, 4.6 MiB; no secrets in dist, 167 text files scanned; real search and real route)                                |
| Admin strings in the public entry of that build                                                                    | 0 matches each for "X-CSRF-Token", "/api/admin", "Owner password", "Moderation queue", "cdn-cgi/access", "Approve and publish"                                   |
| `npx playwright test` (all specs, 5 projects: desktop 1440, laptop 1280, tablet 768, mobile 390, mobile-small 360) | **340 tests: 261 passed, 79 skipped, 0 failed** (8.8 min). Skips are viewport- or configuration-specific by design                                               |
| `tests/e2e/csp.spec.ts` on a build **without** the Zod alias                                                       | failed 4 of 4 (desktop and mobile; `"blocked": "eval"`, `"directive": "script-src"`), as expected; it passed in the full run above on the fixed build            |
| `npx playwright test tests/e2e/map-modes.spec.ts` on a build with the spec's fake Esri key (synthetic tiles)       | **53 passed, 12 skipped, 0 failed** (previous wave, on the tree committed as `2407afe`; not re-run for the fix wave)                                             |
| `npx playwright test tests/e2e/map-modes.spec.ts` on a build with `VITE_EOX_BACKDROP=true` (synthetic tiles)       | **23 passed, 42 skipped, 0 failed** (previous wave, on the tree committed as `2407afe`; not re-run for the fix wave)                                             |

Notes:

- The Playwright runs used scratch builds and their own ports, not the owner's preview on 4410. The
  verifier's manual checks (off-campus place panel, decoy curl) ran against a real-handler backend on
  port 4493 serving its scratch build.
- The imagery e2e runs intercept every request to the providers and answer with synthetic tiles; no real
  Esri or EOX imagery was fetched in these runs.
- The verifier also checked the decoy with curl against the real handlers: a real submission and a
  decoy both got 201 with the same headers apart from `Date`, the same body shape, the same real
  duplicates and a `sug_` reference of the same format; a too-short name got the same 400 and a Delhi
  location the same 422 with or without the honeypot.
- Earlier, a QA pass looked at screenshots for every checklist item and ran extra scratch specs (axe on
  Studio and Templates, studio handle drags, moderation conflicts, off-campus behaviour). Those results
  are summarised in §3; the scratch QA specs were not re-run for the fix wave. The fixers looked at the
  screenshots of their new e2e specs (the 409 conflict screen on desktop only).

## 3. Acceptance checklist summary

Source: the QA acceptance checklist of 2026-10-24 (57 items, tested on the real app with the
real-handler backend), updated with the fix-wave results.

| Section                           | PASS   | FAIL  | NOT TESTABLE |
| --------------------------------- | ------ | ----- | ------------ |
| Building Studio (owner lists A–E) | 26     | 0     | 0            |
| Community                         | 9      | 0     | 0            |
| Map engine (free sources)         | 8      | 0     | 1            |
| Regression list                   | 8      | 0     | 0            |
| Earlier gates                     | 5      | 0     | 0            |
| **Total**                         | **56** | **0** | **1**        |

Some PASS items carry a qualification: "Off-campus never a routing destination" passes after fix D3;
"Numeric fields and limits" and "Accessibility of Studio and Templates" pass after fixes D1 and D2
below; "Both 3D modes render studio models" passes, and the Gate 3 frame times were re-measured once
(§1.9) but the device criterion D8 is still open; Esri Satellite 2D and the EOX backdrop pass with
synthetic tiles only; "Attribution always visible" passes, and the D5 toast overlap is fixed. The
original QA scratch specs were not re-run for the fix wave; the D3 item was re-checked in the real app
by the verification agent and by the repo e2e and unit tests listed in §1.9.

### Fixed in the fix wave (was FAIL)

- **Off-campus never a routing destination (defect D3).** With the opt-in "Nearby, outside campus"
  layer on, base context places (for example "Green valley main gate", `osm:node/12031088561`) and
  approved off-campus community locations showed an enabled "Directions to here" / "From here",
  because the routing checks looked only at `graphNodeId`. They now also require
  `campusZone === 'on-campus'`; see §1.9 for the fix and how it was verified.
  `tests/unit/community/merge-integrity.test.ts`, which used to assert the old behaviour, now asserts
  the rule.

### NOT TESTABLE

- **Geographic consistency of overlays on real imagery.** No real imagery key is configured (no billing;
  no free Esri key set up), so only synthetic tiles were used. This needs a look with a real free-tier
  key (see owner action 3).

### Defects fixed (D1 and D2 during QA, D3–D5 in the fix wave)

- **D1** (Studio coordinate fields rounded to 0.001°, about 100 m; an arrow key moved a model about
  45 m): fixed in `src/admin/studio/controls.tsx`; regression tests in
  `tests/unit/studio-ui/number-field.test.tsx`; the e2e metre-offset assertion was tightened to 8–12 m.
- **D2** (axe `label-content-name-mismatch` on step buttons): fixed in
  `src/admin/studio/GeometryPanel.tsx`; axe re-run gave 0 violations on Studio and Templates (desktop
  and phone).
- **D3** (off-campus places were routable): fixed in the fix wave, see above and §1.9.
- **D4** (the moderation approve dialog did not warn that a suggestion is outside the campus
  boundary): fixed in the fix wave; the dialog and the location editor show "Outside the campus
  boundary" before publishing. Regression: `tests/unit/admin/outside-campus.test.tsx` and
  `tests/e2e/admin-approve-map.spec.ts`.
- **D5** (phone clipping): the state chip now wraps and toasts clear the attribution (fix wave).
  Regression: `tests/unit/shell/toast-attribution.test.tsx` and the chip and chrome-height checks in
  `tests/e2e/studio-mobile.spec.ts`.

### Open low-severity notes

- **D5, remainder**: the phone view-mode switcher shows icons only (names and reasons are in
  accessible labels and the toast). Unchanged.

## 4. Known gaps

- **Photorealistic 3D is not implemented** (owner decision, no billing). It is shown as unavailable.
- **GLB / glTF import is not enabled.** A file validator exists (`src/building-studio/glb-validator.ts`),
  but storing models needs an R2 binding and drawing them needs the Three.js adoption gate. The
  Templates screen says so.
- **Real imagery has not been seen in this project's test runs**; only synthetic tiles. Esri answered a
  malformed token with normal tiles, so a bad key may not be caught by the probe. Esri's answer when the
  free tier is exhausted has not been observed.
- **Device frame-time criterion (D8)** for 3D studio models is still open: headless Chromium draws WebGL
  on the CPU, so no phone numbers exist (`docs/3D_BUILDING_FIDELITY.md` §6). In the re-measure the 3D
  map's p95 at 4× CPU throttle was 66.7 ms on every path (baseline, extrusion, custom layer), over the
  33 ms device budget; this is a CPU-rendering proxy, not a phone verdict. Extrusion and the custom
  layer tie at p95 on this proxy, so only a phone run can decide whether phones should switch to the
  extrusion path.
- **Overview with 50 studio models: unthrottled full redraw is over budget**: 9.4 ms against ≤ 8 ms on
  desktop (DPR 1) and mobile (DPR 2), one sample each (before: 11.0 / 10.9 ms). The applicable
  fallback ("lower the DPR cap to 1.5, then 1") helps only on high-density screens; there is no specific
  fallback for DPR 1 desktops yet. The gesture budgets it would protect all pass.
- **E2E covers password mode only.** Cloudflare Access mode and its logout redirect are covered by unit
  tests only. The e2e backend runs the handlers in Node with miniflare's D1, not inside workerd.
- **Not covered by e2e**: orphaned overrides (cannot be created through the UI). The Studio record
  flows (model existing, apply template, duplicate, delete, 409) are now covered by
  `tests/e2e/studio-records.spec.ts` on desktop, laptop and tablet, not on the phone projects.
- **Studio leave prompt covers in-app navigation only.** Browser Back/Forward and Sign out are not
  intercepted; Sign out deletes the recovery copy on purpose. With Back, edits reach crash recovery only
  after the existing 400 ms debounce, so a change made just before Back can be lost.
- **Phone and tablet Studio chrome**: on a phone the admin header and tabs are about 105 px, but the
  Studio's own bar adds about 57 px (about 163 px above the map in all), and a transient notice banner
  adds about 80 px for up to 10 s. On a 768 px tablet the Studio toolbar wraps into three rows (about
  150 px). (This file earlier said "about 240 px"; the UI fixer measured the header and tabs at 122 px
  on the build without the fix, and about 105 px with it, read from a 2× screenshot at 390×844. The new
  e2e check fails above 120 px.)
- **Honeypot decoy**: it never checks or counts rate limits, so a bot sending more than 5 decoys in
  10 minutes never sees a 429 (accepted and documented). Its timing match was measured only locally
  (Node and miniflare D1 on Windows; the decoy was about 20 % slower at the median); real Cloudflare D1
  latency was not measured, and a fresh isolate starts from a 60 ms default.
- **Stricter Studio name rule**: a stored draft or version whose name or alias has more than 5
  combining marks in a row would no longer parse in the admin (`readDraft` returns null), as with any
  schema tightening (documented in `BUILDING_STUDIO_DESIGN.md` §5).
- **Wording**: the overlap message can show a `stu:` id twice when the other building has no name; in
  the isometric overview some studio models appear grey rather than in their chosen wall colour. (The
  unnamed studio-building wording is fixed, §1.9.)
- **Admin chunks are precached** by the service worker for every public visitor (no secrets, wasted
  bytes), and `public/_headers` has no `X-Robots-Tag` for `/admin` (the page adds a `noindex` meta at
  runtime only). `src/app/App.tsx` prefetches the public shell chunk, so `/admin` downloads it too.
- **Bake-off report §6** (open item 2) is left as written; its addendum says the item is now narrowed
  to the unthrottled full redraw.
- **Campus illustration** (§1.10; full list in
  [LPU_ISOMETRIC_ASSET_INTEGRATION.md §9 and §14](LPU_ISOMETRIC_ASSET_INTEGRATION.md#9-open-items)):
  it is a 2D schematic drawing from 2019, so it cannot be rotated or tilted, is not geographically
  exact, and may be out of date. Map modes do not outline an "Unconfirmed match" candidate; on desktop
  the detail card and the details panel can show the same item side by side; the public details panel
  quotes an internal research file path in the curated reason; a DPR-2 phone downloads about 2.1 MB of
  images on opening; Safari, Firefox and real touch hardware were not tested. The generated
  `LPU_ISOMETRIC_ASSET_MAPPING.md` has no "evidence that would verify it" column (the guide is in the
  integration doc §11).

## 5. Owner actions

1. **Block numbers.** None are applied; the app shows its own map keys (for example "E2-05"), labelled as
   not official. Record each block number only with your own first-hand evidence (a sign photo or an
   official LPU document that names the building). The campus illustration is never evidence of a block
   number or a position. For buildings shown in the campus illustration, use the walks in owner
   action 10, which replace `docs/research/block-leads/OWNER_CHECKLIST.md`.
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
   The laptop proxy numbers from the re-measure are in §1.9 and §4.
5. **D3 is fixed, no decision needed**: off-campus places (opt-in layer) are never routing
   destinations, following the rule in the QA brief (§1.9). Tell the lead only if you want off-campus
   routing after all.
6. **Google photoreal is not implemented**, by your decision of 2026-10-24 (no billing; Google 3D
   coverage at LPU unverified and likely absent). Nothing to do unless that decision changes.
7. **GLB import is not enabled.** Enabling it needs an R2 binding and a decision on the Three.js
   dependency; nothing to do unless you want imported models.
8. **Delete `C:\lpuw014438`.** It is a leftover folder outside the repository (about 2.2 MB, holding a
   `v3` directory). The project does not use it. I did not delete it.
9. **Commit**: the lead commits the working tree; the fix wave (§1.9) is committed in `6050e91`, the
   artwork integration (§1.10) is not committed yet.
10. **Campus illustration links** (§1.10). In `/admin/artwork`, link illustration items to buildings,
    following the walks in
    [LPU_ISOMETRIC_ASSET_INTEGRATION.md §11](LPU_ISOMETRIC_ASSET_INTEGRATION.md#11-owner-verification-guide).
    "Verified" needs evidence: a site sign, an official document or your own statement. A link never
    sets an official block number. Also decide whether the `art:scene-103` caption may be displayed,
    and review the 44 outlines and the inventory items marked for manual verification.

## 6. Decisions made autonomously

These were made by the build agents within the owner's rules, not by the owner. Each can be revisited.

| Decision                                                                                               | Reason                                                                                               |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Esri World Imagery (free tier, PAYG off) as the only high-resolution imagery, opt-in by key            | Free source with documented attribution and a no-bill free tier; Google needs billing                |
| EOX Sentinel-2 2016 backdrop opt-in only, Satellite 2D only, camera capped at zoom 14                  | CC BY 4.0 and keyless, but 10 m imagery shows no buildings; it must not pretend otherwise            |
| Imagery date shown only inside the verified area and never as "live"                                   | The Wayback date was verified for the campus only                                                    |
| No terrain                                                                                             | Measured relief of about 4.7 m across the campus would not be visible                                |
| No 3D-tiles renderer, no new npm dependency                                                            | No billing-free photoreal source exists, so the dependency is not justified                          |
| The store refuses unavailable modes; deep links to them are dropped; fallbacks end at the overview     | Otherwise `?view=earth` would have drawn the 2D map under a "Photorealistic" label; no blank screen  |
| Accessible name "Satellite map" instead of "Satellite 2D map"                                          | "Satellite 2D map" contains "2D map" and broke role queries for the 2D map                           |
| `maxPitch` 60                                                                                          | MapLibre marks higher values experimental                                                            |
| Imagery never cached offline; CSP allows exactly the two provider hosts                                | Esri's terms forbid storing data; one rule for every provider                                        |
| `/admin` as a lazy chunk; CSRF token in memory only; logout clears all Studio crash recovery           | No admin code or text in the public bundle; nothing sensitive left in the browser after logout       |
| Approve corrections cannot clear the submitted description (the form points to Edit instead)           | Approve corrections are override fields and cannot clear it; silently keeping old text would mislead |
| Hidden locations shown by a client-side filter                                                         | The server lists all locations including hidden ones and has no GET by id                            |
| The Studio's server check runs on its own request and counts only for the exact draft it checked       | A check must never block a save, and a stale result must not count for a changed draft               |
| "Apply template" previews on the server for a saved record and applies locally for a draft with edits  | Keeps unsaved edits; the server stays the authority for saved records                                |
| E2E runs the real handlers over an in-memory local D1                                                  | Tests the real server without mocks and without touching any remote database                         |
| Off-campus places are never routing endpoints; they keep their `graphNodeId` in the data (D3)          | The QA brief's rule; the owner can still see the validated access node                               |
| The honeypot decoy mirrors a real acceptance (201, real duplicates, padded timing), no rate limits     | A bot must not tell a decoy from a real answer; counting decoys against limits was left out          |
| The bare `zod` import in the client is aliased to a shim that sets `jitless` first                     | Removes the CSP `script-src` eval violation without loosening the CSP; the server is unchanged       |
| The Studio leave prompt saves the edits to crash recovery before leaving                               | Leaving should never lose work silently; moving between Studio records is not held                   |
| Access points picked on the map only from validated walkable nodes within 25 m; nothing moves          | A click must never invent an access point or move the place                                          |
| Below 1024 px the admin section links are a tab row and the Studio side panels open one at a time      | At 768 px the side columns left the Studio map almost no width                                       |
| The Illustrated overview is the default `?view=iso` variant; the footprint drawing stays as `&iso=map` | The owner made the artwork the authoritative visual source; the map-accurate drawing stays available |
| Artwork links belong to depicted subjects, not files                                                   | One vignette captions 14 numbered buildings and the master shows 45                                  |
| Curated baseline: the 19 leads reviewed "confirm-on-site" are approximate; everything else unresolved  | Only reviewed candidates may be shown, and only as "Unconfirmed match"; nothing is verified by us    |
| Layered DOM renderer (one CSS transform for image and outlines), not Canvas2D                          | Measured at 4× CPU throttle: 16.7 ms p95 frames vs 50–67 ms; 0.5 s vs 3.2–3.6 s first paint          |
| Lossless WebP derived copies of the master (53 files), not lossy                                       | Lossy q0.9 visibly softened window grids and coloured text at 1:1                                    |
| The `0003` rollback keeps the decisions table and every audit row                                      | A destructive rollback would lose the owner's decisions; re-applying restores them exactly           |
| The `art:scene-103` caption is held from display; the file and its exact transcription are kept        | Its meaning is unclear; only the owner can decide whether it may be shown                            |

## 7. Deployment checklist

Full details: [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) and [`docs/ADMIN_OPERATIONS.md`](ADMIN_OPERATIONS.md).

1. **Commit** the working tree (lead) and confirm `git status` is clean. Make sure no `.env.local`,
   `.dev.vars` or key is staged.
2. **Run the gate** locally or in CI (all green on 2026-10-24, §2):
   `npx tsc --noEmit -p .`, `npx tsc --noEmit -p tsconfig.server.json`, `npx eslint . --max-warnings=0`,
   `npx prettier --check .`, `npx vitest run`, `npx vitest run -c vitest.server.config.ts`,
   `npm run data:check`, `npm run art:check`, `npx vite build`, `npm run art:check-dist`,
   `npm run smoke`, `npx playwright test` (`npm run build` runs the data, art, type and dist checks
   around `vite build`).
3. **Cloudflare Pages project**: build command `npm run build`, output `dist`, `NODE_VERSION=24` for
   Production and Preview.
4. **D1**: `npx wrangler d1 create lpu-atlas`, then replace the placeholder `database_id` in
   `wrangler.toml` (or bind `DB` in the dashboard).
5. **Migrations before code**: back up first (`npx wrangler d1 export lpu-atlas --remote --output=<outside-the-repo>/before-migrate.sql`),
   then `npx wrangler d1 migrations list lpu-atlas --remote` and
   `npx wrangler d1 migrations apply lpu-atlas --remote` (applies `0001`, `0002` and `0003`). Apply
   `0003` before deploying the artwork code: its publication read needs the `artwork_associations`
   table. Rollback of `0003` is non-destructive (`docs/db/0003_down.sql`, `docs/DEPLOYMENT.md`).
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
