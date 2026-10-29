# QA strategy

How LPU Campus Atlas is tested, what each layer is responsible for, and what can only be verified by
a person or a real device. The quality bar is the same everywhere: **a test must protect behaviour
a user relies on, or a truthfulness rule**. Never weaken a meaningful assertion to make a run pass.

## Test pyramid

```text
                    ┌──────────────────────────────────────┐
                    │  Manual / on-device checks           │  GPS walk on phones, screen readers, phone frame time (D8), SW update in production
                    ├──────────────────────────────────────┤
                    │  E2E: Playwright × 5 viewports       │  workflows A–F + admin, suggest, Studio, artwork, map modes, CSP, against
                    │  (+ imagery builds, skip policy)     │  vite preview and the REAL server handlers on a local in-memory D1; axe
                    ├──────────────────────────────────────┤
                    │  Build checks                        │  smoke (dist: shell, manifest, SW, data, real search + route, secret scan),
                    │                                      │  art:check-dist, bundle budgets (perf:bundle)
                    ├──────────────────────────────────────┤
                    │  Server (Vitest, node, local D1)     │  handlers, auth, domain, studio, artwork, migrations + down scripts,
                    │                                      │  integrity, compat/rollback, red-team attacks
                    ├──────────────────────────────────────┤
                    │  Integration (Vitest, node)          │  pipeline on synthetic + real snapshot, artwork derive/dist/git, smoke helpers;
                    │                                      │  coverage suite on the real processed dataset
                    ├──────────────────────────────────────┤
                    │  Unit + component (Vitest, jsdom)    │  pure modules, store slices, React components with RTL + axe;
                    │  (+ serial wall-clock budget step)   │  CI/doc integrity (gates, skip policy, bundle budgets, docs)
                    ├──────────────────────────────────────┤
                    │  Static gates                        │  tsc strict (app + server configs), ESLint (0 warnings), Prettier,
                    │                                      │  data:validate, art:check
                    └──────────────────────────────────────┘
```

## Suites and what they cover

The latest counts from a full run are in [IMPLEMENTATION_STATUS.md §2](IMPLEMENTATION_STATUS.md#2-how-it-was-verified);
they change with every wave, so this page names what each suite covers, not how many tests it has.

| Suite                                                                                                                                                   | Command                              | Covers                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/data`, `tests/unit/geo`                                                                                                                     | `npm test`                           | OSM parsing, geometry, membership and boundary review, heights, graph and access rules, curated files, places and relations, detections, validator and count guard, fetchers (mocked `fetch`), loader and schema version, v2 schema                                     |
| `tests/integration`                                                                                                                                     | `npm test`                           | Full pipeline on `synthetic-campus` (byte-identical rebuild) and on the **real committed snapshot** (truthfulness rules); artwork derive (Chromium), dist (opt-in `ART_DIST_DIR`) and git (byte-for-byte committable); smoke helpers                                    |
| `tests/coverage`                                                                                                                                        | `npm test`                           | Building coverage on the real processed dataset: every footprint of the raw snapshot is classified once, the inventory matches, and nothing routable in the committed baseline is silently lost                                                                         |
| `tests/unit/distance`, `routing`, `geolocation`, `navigation`, `search`, `facilities`, `utils`                                                          | `npm test` (+ `test:perf`)           | Pure domain modules: haversine and grid index against brute force, A* against Dijkstra, profiles and failures, the GPS filter and watcher, route progress and tracking, ranking tiers and fuzzy matching, opening hours in IST, relation validation, safe URLs, storage |
| `tests/unit/directory`, `community`, `building-studio`, `isometric`, `isometric-art*`, `csp`                                                            | `npm test` (+ `test:perf`)           | Building directory and artwork join, publication merge (off-campus never routable), Studio schema, meshes, validation, history and recovery, overview projection and hit-testing, artwork schema, associations, registry and hotspots, the jitless Zod entry            |
| `tests/unit/map`, `buildings3d`, `map-providers`, `studio-render`                                                                                       | `npm test`                           | Style from our own GeoJSON (validated with the MapLibre style spec), overlays, controller maths, extrusion LOD, watchdog, imagery providers and fallbacks, the Studio WebGL layer                                                                                       |
| `tests/unit/components`, `accessibility`, `app`, `shell`, `directions`, `navigation-ui`, `platform-ui`, `directory-ui`, `suggest`, `admin`, `studio-ui` | `npm test`                           | Design-system primitives, focus and live region, token contrast, store slices, deep links, palette, panels, directions and navigation HUD, the Suggest flow, the admin client, sections and Studio UI                                                                   |
| `tests/unit/ci`, `tests/unit/docs`                                                                                                                      | `npm test`                           | The gates themselves: `npm run check` and CI run the same gates (server suites included), the skip policy, the bundle-budget checker, and documentation integrity (dataset numbers, links and anchors, storage keys, deep links, budgets)                               |
| Wall-clock budget files (search, routing, Studio, overview, merge timings)                                                                              | `npm run test:perf`                  | The files the parallel run excludes, run serially (`--no-file-parallelism`) so dozens of jsdom suites cannot steal their CPU. Thresholds are never relaxed; `tests/unit/ci/gates.test.ts` fails if a file that times code with a wall clock is left in the parallel run |
| `tests/server/**`                                                                                                                                       | `npm run test:server`                | See [Server suites](#server-suites-npm-run-testserver)                                                                                                                                                                                                                  |
| `tests/e2e` (Playwright)                                                                                                                                | `npm run test:e2e`                   | See [End-to-end workflows](#end-to-end-workflows); `npm run test:a11y` runs only the specs tagged `@a11y`                                                                                                                                                               |
| `tests/perf` (Playwright, own config)                                                                                                                   | see [PERFORMANCE.md](PERFORMANCE.md) | Overview frame budgets (D8) under a 4× CPU throttle: `npx playwright test -c tests/perf/playwright.iso.config.ts --project=perf`. Not part of `check` (it measures; one loaded machine is not a verdict)                                                                |

### Server suites (`npm run test:server`)

`vitest.server.config.ts` runs `tests/server/**` in Node, one file at a time, against a **local
in-memory D1** created by wrangler's `getPlatformProxy` with `migrations/*.sql` applied
(`tests/server/helpers/test-db.ts`). No account, secret or remote database is involved; the suites
are typechecked by `npm run typecheck:server` (`tsconfig.server.json`). Both are part of
`npm run check` and CI.

| Folder                      | Covers                                                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/server/http`         | Router, body limits, Origin checks, logging, the Pages Functions entry points, contributions (rate limits, 413/415, honeypot and decoy parity), admin routes and guard |
| `tests/server/auth`         | Cloudflare Access JWT verification (fixtures), password hashing, sessions and cookies                                                                                  |
| `tests/server/domain`, `db` | Suggestions, approval, locations, overrides, repositories, schema                                                                                                      |
| `tests/server/studio`       | Studio buildings and templates over HTTP, base models, atomicity, red-team integrity                                                                                   |
| `tests/server/artwork`      | Artwork associations over HTTP, persistence across migration 0003, rollback and re-apply                                                                               |
| `tests/server/migrations`   | 0002 and 0003 on fresh and populated databases, failing-atomic application, the down scripts in `docs/db/`, re-apply                                                   |
| `tests/server/integrity`    | Atomicity, concurrency (revision conflicts), recovery, routing safety (off-campus never routable)                                                                      |
| `tests/server/compat`       | v1/v2 base data, override survival across dataset versions, rollback invariants; the full `git revert` drill is opt-in (`rollback-drill.test.ts`, the 4 skipped tests) |
| `tests/server/security`     | Public, admin, Studio and artwork attack suites, hardening regressions, no secrets in responses or logs                                                                |

**Migrations.** Every D1 migration ships with a down script in `docs/db/` and a test in
`tests/server/migrations/` that applies it to a fresh and to a populated database, checks that a
failing statement leaves nothing applied, runs the down script and re-applies. The compat suite
checks that the v1 migration files are an unchanged prefix of the current set. Never test against a
remote database.

### E2E backend

The admin, suggestion, Studio and artwork specs run against `tests/e2e/backend/server.ts`: the
**real** server handlers over a fresh in-memory local D1 with `migrations/*.sql` applied, in
password mode with a throwaway password generated per run (never written to disk), serving the same
build as `vite preview`. `playwright.config.ts` starts it on a port picked per run in 4440–4499
(`E2E_BACKEND_PORT` fixes it). Specs that only need owner data use the `syntheticPublication`
fixture instead. Cloudflare Access mode is covered by unit tests only.

## Fixture policy

- **Invented data is named `synthetic-*`**: `tests/fixtures/osm/synthetic-campus/`,
  `tests/fixtures/graphs/synthetic-*.json`, `tests/unit/*/synthetic-*.ts`. It must never be mistaken
  for, or copied into, real LPU data.
- Synthetic graphs are generated reproducibly by `tests/fixtures/graphs/generate-synthetic.ts`.
- Real-data tests read the committed snapshot or `public/data/` directly and assert truthfulness
  rules, not exact counts that legitimately change on a refresh. The exception is the smoke test,
  which checks the shipped files against their own manifest.
- No test touches the network. The fetchers are tested with an injected `fetch`.
- Geolocation is always a fake (`tests/unit/geolocation/fake-geolocation.ts`) in unit tests and
  Playwright's `setGeolocation` in e2e. No real coordinates of a person are ever used.

## Browser matrix

`playwright.config.ts` runs Chromium (desktop Chrome device profile) against the production build
served by `vite preview` on port 4173. That way the service worker, code-splitting and data files
are exercised as they are deployed.

| Project        | Viewport   | Touch / mobile | DPR |
| -------------- | ---------- | -------------- | --- |
| `desktop`      | 1440 × 900 | no             | 1   |
| `laptop`       | 1280 × 800 | no             | 1   |
| `tablet`       | 768 × 1024 | yes            | 1   |
| `mobile`       | 390 × 844  | yes            | 2   |
| `mobile-small` | 360 × 800  | yes            | 2   |

Firefox and WebKit are not in the matrix, because only Chromium is installed in this environment.
Safari and iOS behaviour (bottom sheet, safe areas, geolocation prompt, PWA install) needs a manual
check; see below.

## End-to-end workflows

These workflows are the acceptance paths for the UI. Each runs in every viewport unless a step is
viewport-specific. The map is inspected through the read-only hook `window.__ATLAS_MAP__`, available
when the URL has `?e2e=1`. It provides `getCamera()`, `getSelectedId()`, `getRouteCoordinateCount()`,
`isStyleLoaded()`, `queryRenderedBuildingIds()`, `getLayerVisibility(id)` and `isUserLocationShown()`.
It never exposes user coordinates.

**A. Find and inspect a place**

1. Open the palette with <kbd>Ctrl</kbd>+<kbd>K</kbd> or <kbd>/</kbd> (or the search button on
   touch).
2. Type a real name from the dataset and choose the result.
3. Expect:
   - the details panel opens with the name as heading
   - `getSelectedId()` equals the place id
   - provenance shows "Imported" and the source
   - the URL carries `?place=`
4. Reload with that URL and expect the same place to be restored.
5. Load an invalid `?place=` and expect a polite message, no crash.

**B. Plan a route**

1. From a place, choose Directions and set the start by search or by picking on the map.
2. Expect:
   - a route is drawn (`getRouteCoordinateCount() > 0`)
   - distance and time are shown
   - steps are listed
3. Switch to cycle and then to step-free. Expect the route to update and step-free to show
   "accessibility unverified".
4. Choose two places in different graph components. Expect the "no path" explanation and no line
   drawn.

**C. Live navigation and tracking**

1. Grant geolocation and set positions along a route.
2. Expect:
   - `isUserLocationShown()` is true
   - remaining distance decreases
   - after the configured consecutive fixes away from the route, an off-route notice appears
   - near the end, arrival is announced
3. With permission denied, expect a clear message and no hang.
4. "Track my walk": start, move, stop, and expect the summary. Nothing is stored afterwards.

**D. Browse categories, layers and 3D**

1. Open a populated category and expect places listed. Open an empty one (for example "Drinking
   water") and expect the honest empty state.
2. Toggle a layer group and check `getLayerVisibility` for its layer.
3. Toggle 3D and check the camera pitch (`getCamera().pitch`) and the extrusion layer visibility.
4. Toggle labels.

**E. Offline and updates**

1. Load once online and wait until the service worker reports it is ready for offline use.
2. Set the context offline and reload. Expect the app shell and map to load from the precache, and
   search and routing to still work.
3. Expect the offline banner to be shown.
4. The update prompt cannot be reproduced with a single build. It is covered by unit tests of the
   update state machine, plus a manual check (below).

**F. Accessibility, keyboard and resilience**

1. Use only the keyboard: skip link, palette, result selection, panel navigation, Escape closing the
   topmost layer, and focus returning to the trigger.
2. Run axe (`@axe-core/playwright`) on the home view and each main panel. No serious or critical
   violations are allowed.
3. Disable WebGL (or make it fail). Expect the list view message, and search, details, categories and
   directions to still work.
4. Saved places, settings ("Save search history" off clears recents; "Clear all local data"), and a
   correction report (copy or download; it contains no coordinates).

**Status (2026-10-26).** All six workflows have Playwright specs in `tests/e2e/`, alongside the
admin (`admin-*.spec.ts`), suggestion, Studio (`studio-*.spec.ts`), artwork (`isometric-art`,
`art-evidence`, `admin-artwork`), view-mode, map-mode and CSP specs.

G-24 (2026-10-29): arrival and the walk summary (`tracking-workflows.spec.ts`), a start on a
separate network component (`routing-no-path.spec.ts`), and settings history-off and "Clear all
local data" (`settings-privacy.spec.ts`) now have e2e specs on all five viewports. They use
deterministic geolocation (`fixtures/fake-geolocation.ts`): a stand-in `navigator.geolocation` and
a frozen page clock, so every fix has a timestamp the test chose. The expected numbers come from the
app's own progress and tracker modules, run on the same samples. Still missing: an e2e for
correction copy and download (unit tests cover it).

**No screenshot baselines.** `toHaveScreenshot` is still not used, deliberately, for three reasons:

- CI runs on `ubuntu-latest`, while development runs on Windows. Playwright baselines are specific
  to the OS and font rasteriser, so a baseline recorded on one machine fails on the other.
- The map is WebGL rendered on the CPU (SwiftShader), and its pixels differ between machines.
- Recording Linux baselines in a container would also need a Linux build of the e2e backend
  (`workerd`).

The specs attach screenshots of each key state instead (`atlas.screenshot`): arrived, walk summary,
no path, history off, and data cleared. Pixel baselines need a pinned Linux image for both recording
and CI.

## Accessibility checks

| Check                                                                                                | Where                                                             |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Token contrast (text, controls, focus ring) ≥ WCAG AA for every declared pair, light and dark        | `tests/unit/accessibility/contrast.test.ts` (parses `tokens.css`) |
| Map palette contrast (markers, route, labels)                                                        | `tests/unit/map/theme-colors.test.ts`                             |
| axe on the primitives (jsdom; colour-contrast rule off, because jsdom has no layout)                 | `tests/unit/accessibility/axe-kitchen-sink.test.tsx`              |
| axe on real pages (layout and contrast included)                                                     | e2e workflow F                                                    |
| Accessible names, roles, `aria-pressed`/`aria-selected`, live announcements, focus moves and restore | component tests (role and name queries throughout)                |
| Keyboard: palette shortcuts, roving tabindex, sheet handle, Escape layering                          | `tests/unit/components/*`, `tests/unit/shell/*`                   |
| Reduced motion (camera jumps instead of flying)                                                      | `tests/unit/map/controller.test.ts`                               |

## Performance budgets

From `APP_CONFIG.performance` and [PERFORMANCE.md](PERFORMANCE.md), which records the measurements.

| Budget                                                               | Value                                                                    | Enforced by                                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Search query p95                                                     | < 50 ms                                                                  | `tests/unit/search/performance.test.ts` (5,000 synthetic docs), serial step `npm run test:perf` |
| Route computation                                                    | < 150 ms                                                                 | `tests/unit/routing/robustness.test.ts` and `astar.test.ts`, serial step                        |
| Bundle: chunks, entry, start-up JS and CSS, overview chunk, precache | [PERFORMANCE.md §Bundle budgets](PERFORMANCE.md#bundle-budgets-enforced) | `npm run perf:bundle` on the production build (`check` and CI)                                  |
| Single precached file                                                | ≤ 8 MB                                                                   | Workbox build fails above this                                                                  |
| Overview frame budgets (D8)                                          | ISOMETRIC_AND_3D_DESIGN §9.1                                             | `tests/perf/iso.perf.spec.ts` (separate config, run by hand)                                    |

Wall-clock budget tests are sensitive to machine load: in one full parallel run on 2026-10-23 the two
search performance tests failed while dozens of jsdom suites ran at once. Since 2026-10-26 those
files no longer run in the parallel step: `npm test` excludes them and `npm run test:perf` runs them
serially (in `check` and CI). Each budget test also takes a median or best-of-N timing
(`tests/unit/perf-timing.ts`), so one scheduler hiccup cannot fail it. The thresholds are never
relaxed.

## CI stages

`.github/workflows/ci.yml` runs on every push and pull request, with no secrets.
`tests/unit/ci/gates.test.ts` fails if CI and `npm run check` drift apart.

**Job `verify`** (ubuntu-latest), ordered so that cheap failures stop early:

1. `npm ci`, with Node from `.nvmrc`
2. Static: `format:check`, `lint`, `typecheck`, `typecheck:server`
3. `npx playwright install --with-deps chromium`, then `npm run test:browsers`, which **fails** if
   Chromium is missing (the Chromium Vitest suite would otherwise skip itself)
4. `npm run test` (parallel), `npm run test:perf` (wall-clock budgets, serial), `npm run test:server`
   (server suites on a local in-memory D1)
5. Data: `npm run data:check`, the map-key lock check, then a **sync guard**: `git diff --exit-code`
   on `public/data`, the generated reports, the JSON Schemas and the key lock must be clean
6. `npm run art:check`
7. Build: `npx vite build`, `npm run art:check-dist`, `npm run smoke`, `npm run perf:bundle`; `dist`
   is uploaded as an artifact
8. `npm run art:verify` (derived artwork reproducible and visually equivalent, in Chromium)
9. E2E: `npx playwright test` with `E2E_IMAGERY=none` (all five projects; `forbidOnly` is on and
   failures get 1 retry). On failure the report is uploaded.

**Job `imagery-e2e`** (matrix `esri`, `eox`): builds with the test-only key
`VITE_ARCGIS_API_KEY=TEST_ONLY_…` or with `VITE_EOX_BACKDROP=true`, and runs
`tests/e2e/map-modes.spec.ts` on all five projects with `E2E_IMAGERY` set. Every provider request is
intercepted and answered with synthetic tiles; nothing is fetched from Esri or EOX.

**Job `audit`**: `npm audit --omit=dev --audit-level=high` **blocks**; a report-only audit covers the
full tree.

`.github/workflows/data-refresh.yml` is a manual (`workflow_dispatch`) job. It fetches a fresh OSM
snapshot, rebuilds and validates, and uploads the diff for a human to review. It never commits.

**CI has never run.** The local repository has no Git remote (owner action in
[IMPLEMENTATION_STATUS.md §5](IMPLEMENTATION_STATUS.md#5-owner-actions)). Until it has one, every
gate result in the status file is a local run on Windows; the first CI run will also be the first
time the server suites run on Linux.

### Skipped browser tests

CI must never skip a browser test silently. Two mechanisms enforce it:

- **Missing browsers fail.** Chromium is installed before the unit tests and `npm run test:browsers`
  fails without it; Playwright itself fails every test when its browser is missing.
- **Every Playwright skip is explained, counted and checked.** The reporter
  `scripts/ci/playwright-skip-reporter.ts` (registered in `playwright.config.ts`) collects every
  skipped test with its reason and project, prints a summary table (also to the GitHub job summary and
  `test-results/skip-summary.json`) and applies the rules in `scripts/ci/skip-policy.ts`. A skip is
  allowed only with a listed reason, on a listed project and, for imagery skips, in a build where that
  path is covered by another job (`E2E_IMAGERY`: `none`, `esri` or `eox`). A skip without a reason,
  with an unlisted reason or on the wrong project, a `fixme`, or a test that did not run because an
  earlier one failed is a **violation**: in CI (or with `E2E_SKIP_POLICY=enforce`) the run fails.
  `tests/unit/ci/skip-policy.test.ts` keeps the rules and the specs' skip reasons in step.

The allowed skips are by design: viewport-specific tests (phone-only and desktop-only layouts),
evidence and cost measurements recorded on one desktop and one phone profile, the imagery paths
(covered by the `imagery-e2e` job) and one data-dependent empty-category check.

In Vitest, the only skips are explicit and opt-in: `tests/integration/isometric-art-dist.test.ts`
needs `ART_DIST_DIR` (CI runs the same check as `npm run art:check-dist`), and the server's
`git revert` rollback drill is opt-in. The git-dependent artwork and compat tests skip only outside a
git checkout.

The required local gate before any merge is `npm run check` (see
[DEPLOYMENT.md §Before deploying](DEPLOYMENT.md#before-deploying)).

## What needs human or on-device verification

Automated tests cannot establish the items below. They must be reported as **unverified** until a
person checks them.

- **GPS on real phones** (Android Chrome, iOS Safari):
  - the permission prompt, and recovery after a denial
  - accuracy and the first-fix time on campus
  - behaviour when the tab is in the background or the screen is locked
  - off-route and arrival thresholds with real multipath error near tall blocks
  - tracker distance while standing still and walking. G-25 smoothing keeps synthetic tracks within
    the tolerances in [geolocation-navigation.md](modules/geolocation-navigation.md), but
    real-receiver noise is unverified
  - the insecure-context message over plain HTTP
- **Screen readers** (NVDA/JAWS with Chrome, VoiceOver on iOS and macOS, TalkBack):
  - announcement wording and verbosity
  - bottom-sheet semantics
  - palette listbox navigation
  - the toast also reading its "Dismiss" button
- **Service-worker update in production:**
  - deploy version N, visit, deploy N+1
  - the update banner appears, "Update now" reloads into N+1 with matching data, and "Later" keeps N
    working
  - offline after the update
  - also on a Cloudflare preview URL
- **Real-browser touch:**
  - dragging the bottom sheet, pinch, rotate and tilt in 3D
  - Web Share
  - clipboard and download on iOS
- **Visual quality:**
  - dark-theme shadows, label collisions, extrusion appearance on low-end GPUs
  - attribution layout on small screens
- **Data truth on the ground:**
  - the School of Design anchor
  - whether "unnamed" buildings match the real blocks
  - whether mapped paths are really walkable
- **Low-end devices:** search, route and load times on an inexpensive Android phone. The numbers in
  [PERFORMANCE.md](PERFORMANCE.md) are from a fast laptop.
