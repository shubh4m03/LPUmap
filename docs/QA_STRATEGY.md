# QA strategy

How LPU Campus Atlas is tested, what each layer is responsible for, and what can only be verified by
a person or a real device. The quality bar is the same everywhere: **a test must protect behaviour
a user relies on, or a truthfulness rule**. Never weaken a meaningful assertion to make a run pass.

## Test pyramid

```text
                    ┌───────────────────────────────┐
                    │  Manual / on-device checks    │  GPS on phones, screen readers, SW update in production
                    ├───────────────────────────────┤
                    │  E2E: Playwright × 5 viewports│  workflows A–F against `vite preview` + axe
                    ├───────────────────────────────┤
                    │  Smoke: scripts/smoke.ts      │  built dist/: shell, manifest, SW, data, real search + route, secret scan
                    ├───────────────────────────────┤
                    │  Integration (Vitest, node)   │  pipeline on synthetic + real snapshot, smoke-check helpers
                    ├───────────────────────────────┤
                    │  Unit + component (Vitest,    │  pure modules, store slices, React components with RTL + axe
                    │  jsdom)                       │
                    ├───────────────────────────────┤
                    │  Static gates                 │  tsc strict, ESLint (0 warnings), Prettier, data:validate
                    └───────────────────────────────┘
```

## Suites and what they cover

The per-suite counts below come from a full `npx vitest run` on 2026-10-23, around 21:30 IST: 85
files, 1,182 tests. Other agents were changing code in parallel at the time, and 4 tests were
failing mid-edit. A later full run at 21:53 IST passed **86 files and 1,201 tests**. Treat all of
these counts as a snapshot; the lead's acceptance report records the final run.

| Suite                                                                   | Files / tests | Covers                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/unit/data`                                                       | 10 / 161      | OSM XML parsing, geometry (rings, multipolygons, area, point-in-polygon), height classification, graph building and access rules, curated-file validation, places and relations, validator, fetcher (mocked `fetch`), loader errors and schema version, organizations file and refresher helpers |
| `tests/integration`                                                     | 3 / 33        | Full pipeline on `synthetic-campus` (determinism, byte-identical rebuild); the **real committed snapshot** (truthfulness rules: no invented names, the boundary from relation 21599790, unnamed stays unnamed); smoke-check helpers                                                              |
| `tests/unit/distance`                                                   | 4 / 55        | Haversine against reference values, bearings, polyline projection and slicing, the grid index exact against brute force, formatting                                                                                                                                                              |
| `tests/unit/routing`                                                    | 6 / 94        | A* optimality against Dijkstra, admissibility, deterministic ties, profiles (steps, push-bike, step-free), failures, steps text, caveats, alternatives, malformed graphs, a cold/warm timing budget                                                                                              |
| `tests/unit/geolocation`, `tests/unit/navigation`                       | 5 / 51        | Sample filter (invalid, accuracy, stale, order, jumps), watcher lifecycle with a fake Geolocation (denied, timeout, unsupported, insecure context), hook staleness on `visibilitychange`, route progress (off-route, arrival, windows), tracker jitter                                           |
| `tests/unit/search`                                                     | 6 / 96        | Normalisation, tier ranking, tie-breaks, fuzzy matching, highlights, docs from places and categories, unnamed exclusion, a performance budget on 5,000 synthetic docs                                                                                                                            |
| `tests/unit/facilities`, `tests/unit/utils`                             | 7 / 180       | `opening_hours` subset (supported and unsupported syntax, overnight spill, IST), stale hours, directory counts, nearest (route versus straight-line), relation validation, URL/tel/mail sanitising, validated storage                                                                            |
| `tests/unit/map`, `tests/unit/buildings3d`                              | 8 / 102       | Style built from project GeoJSON only (validated with the MapLibre style spec), layer filters and visibility, glyph hashes, controller camera maths, GeoJSON overlays, theme contrast, extrusion layers and height legend, MapView with a mocked MapLibre                                        |
| `tests/unit/components`, `tests/unit/accessibility`                     | 10 / 168      | Design-system primitives (Dialog, BottomSheet snaps and drag, buttons, controls, toasts, icons), focus trap, live region, theme store, token contrast for every declared pair, axe "kitchen sink"                                                                                                |
| `tests/unit/favorites`, `privacy`, `feedback`, `offline`                | 7 / 86        | Favourites and recents limits, history off clears recents, clear-all, correction validation and text, issue-URL limits, session draft, service-worker update state machine, PWA config                                                                                                           |
| `tests/unit/app`, `shell`, `directions`, `navigation-ui`, `platform-ui` | 19 / 156      | Store slices, deep links, command palette, data provider screens, place details, layers and categories, directions panel and endpoint editing, navigation HUD, settings, saved places, report dialog, about and info panels, history and Escape layering, focus moves                            |
| `tests/e2e` (Playwright)                                                | see below     | Workflows A–F in five viewports; `npm run test:a11y` runs only the specs tagged `@a11y`                                                                                                                                                                                                          |

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

**Status at the time of writing (2026-10-23):** `tests/e2e/` is empty in the working tree.
Another agent is writing the Playwright specs for these workflows in parallel. Until those specs land
and pass, workflows A–F count as **covered by unit and component tests plus the scripted browser
reviews from the UI stage**, not by an automated e2e suite. The final acceptance report states which
specs exist and their results.

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

From `APP_CONFIG.performance`, with measurements in [PERFORMANCE.md](PERFORMANCE.md).

| Budget              | Value    | Enforced by                                                    |
| ------------------- | -------- | -------------------------------------------------------------- |
| Search query p95    | < 50 ms  | `tests/unit/search/performance.test.ts` (5,000 synthetic docs) |
| Route computation   | < 150 ms | `tests/unit/routing/robustness.test.ts` (best of 5 warm runs)  |
| Precached file size | ≤ 8 MB   | Workbox build fails above this                                 |
| JS chunk warning    | 1,200 kB | `chunkSizeWarningLimit` in `vite.config.ts`                    |

Wall-clock budget tests are sensitive to machine load. In one full parallel run on 2026-10-23 (around 21:30 IST),
the two search performance tests failed while dozens of jsdom suites ran at once. The later run at
21:53 IST passed them. Run in isolation and
on the real index they are far inside the budget; see [PERFORMANCE.md](PERFORMANCE.md). A CI runner
should run these suites in a separate, non-parallel step rather than relax the thresholds.

## CI stages

`.github/workflows/ci.yml` runs on every push and pull request, with no secrets. Its `verify` job on
ubuntu-latest mirrors `npm run check`, ordered so that cheap failures stop early:

1. `npm ci`, with Node from `.nvmrc`
2. Static: `format:check`, `lint`, `typecheck`
3. Unit and integration: `npm run test`
4. Data: `npm run data:check`, then a **sync guard**. `git diff --exit-code` on `public/data` and
   `docs/DATA_QUALITY_REPORT.md` must be clean, which proves the build is deterministic and that the
   committed output is current.
5. Build: `npx vite build`, then `npm run smoke`; `dist` is uploaded as an artifact
6. E2E: `npx playwright install --with-deps chromium`, then `npx playwright test` (all five
   projects; `forbidOnly` is on and failures get 1 retry). On failure the report is uploaded.

A separate `audit` job runs `npm audit --omit=dev --audit-level=high`, which **blocks**, and a
report-only audit of the full tree.

`.github/workflows/data-refresh.yml` is a manual (`workflow_dispatch`) job. It fetches a fresh OSM
snapshot using the repository variable `DATA_FETCH_CONTACT`, rebuilds and validates, and uploads
the diff for a human to review. It never commits.

These workflows were added on 2026-10-23. The local repository has no Git remote, so at the time of
writing they had never run on GitHub Actions. The wall-clock performance suites run inside the normal parallel `test` step. If they prove
flaky on CI runners, move them into a serial step rather than relaxing the thresholds.

The required local gate before any merge is:

```sh
npx tsc --noEmit -p . && npx eslint . --max-warnings=0 && npx prettier --check . && npx vitest run && npm run -s data:check && npx vite build
```

## What needs human or on-device verification

Automated tests cannot establish the items below. They must be reported as **unverified** until a
person checks them.

- **GPS on real phones** (Android Chrome, iOS Safari):
  - the permission prompt, and recovery after a denial
  - accuracy and the first-fix time on campus
  - behaviour when the tab is in the background or the screen is locked
  - off-route and arrival thresholds with real multipath error near tall blocks
  - tracker over-counting while standing still (simulated jitter suggested it may over-count)
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
