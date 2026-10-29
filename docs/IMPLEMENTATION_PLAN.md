# Implementation plan

This is the staged plan that was actually followed to build LPU Campus Atlas, with the acceptance
criteria each module had to meet. Progress against the plan and the final acceptance results are
recorded separately in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) and
[ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md). Stages A–E built the static v1; the waves that followed
are in [Beyond v1](#beyond-v1-the-delivered-waves).

## Principles that shaped the plan

- **Contracts before code.** Every module's public interface was fixed in
  [MODULE_CONTRACTS.md](MODULE_CONTRACTS.md) before any implementation, so that modules could be
  built and tested in parallel by different agents without touching each other's files.
- **Real data from day one.** The OSM snapshot was committed during the foundation stage, so every
  later stage was checked against real LPU data, not only synthetic fixtures.
- **Independent review.** Every module was reviewed by a separate agent that had not written it.
  The reviewer re-ran the tests, added regression tests for the defects it found, and listed open
  issues instead of hiding them.
- **Truthfulness over coverage.** Where data does not exist, the acceptance criterion is an honest
  empty or unavailable state, not a feature.

## Stage A: assessment, research and foundation contracts

### A1. Assessment and research

- Inventory the workspace, which held only a reference copy of the MIT-licensed IIT Kanpur map, used
  as an engineering reference.
- Inventory the toolchain: Node 24.19, npm 11.17, Playwright Chromium.
- Test data-source reachability. Overpass was unreachable; the OSM API was reachable; `www.lpu.in`
  was reachable.
- Profile what OSM contains for LPU: a boundary relation, about 532 footprints, very few names, no
  heights, no step or wheelchair tags.
- Research LPU's public pages under `robots.txt` and the site terms, and record every URL examined.

**Exit criteria for A1:** [PROJECT_ASSESSMENT.md](PROJECT_ASSESSMENT.md) and
[research/LPU_PUBLIC_SOURCES.md](research/LPU_PUBLIC_SOURCES.md) written, and the blockers and their
consequences listed: sparse naming, no accessibility tags, no menu/transport/events source.

### A2. Foundation contracts

- Scaffold React 19, TypeScript (strict, erasable syntax), Vite, Tailwind 4, Vitest, Playwright,
  ESLint and Prettier, with exact dependency versions.
- Write `src/config` (`APP_CONFIG` with documented speeds and thresholds, the category registry) and
  `src/data/schema.ts` (Zod schemas shared with Node scripts).
- Write `src/distance/geodesic.ts` (fixed signatures).
- Write [MODULE_CONTRACTS.md](MODULE_CONTRACTS.md): interfaces, file ownership and global
  conventions (explicit `.ts` imports, `[lon, lat]`, no magic numbers, no HTML injection, privacy,
  `synthetic-*` fixtures).
- Commit the OSM snapshot (`data/raw/osm/`, retrieved 2026-10-23 through the OSM API).
- Write `public/_headers` with the CSP.

**Exit criteria for A2:** `tsc` and `eslint` pass on the skeleton; the contracts cover every module; the
snapshot and `SOURCE.json` are committed.

## Stage B: nine parallel modules, each independently reviewed

Each module was built against its contract in its own files, then reviewed by a different agent.

| Module                                                                                               | Acceptance criteria                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Data pipeline** (`scripts/`, `src/data`)                                                           | Builds offline from the committed snapshot; two rebuilds are byte-identical; the boundary comes from relation 21599790 and is never replaced with a rectangle; heights record their source; disconnected graph components are reported and never bridged; curated records need sources and real anchors (an unresolved anchor fails the build); `validate-data` exits 1 on any error; the loader rejects a schema-version mismatch before fetching anything else; synthetic and real-snapshot integration tests pass |
| **Public-sources research** (`scripts/fetch-public-data.ts`)                                         | Obeys `robots.txt` (RFC 9309 subset) and waits between requests; stores names, URLs and titles only (no prose or HTML in git); records carry no coordinates unless anchored by an identical OSM name; refuses to write when extraction drops more than 40 % or yields 0 records; an offline re-extraction reproduces the committed file                                                                                                                                                                              |
| **Routing** (`src/routing`)                                                                          | A* with an admissible heuristic; deterministic tie-breaking; walk, cycle and step-free profiles; step-free excludes steps and `wheelchair=no` and adds an "accessibility unverified" caveat; never invents connections; typed failure reasons; alternatives must differ by at least `alternativeMinDifference`; `distanceM` equals the drawn polyline length                                                                                                                                                         |
| **Geo** (`src/distance`, `src/geolocation`, `src/navigation`)                                        | Haversine is exact against references; the grid index is exact against brute force; the sample filter rejects invalid, low-accuracy, stale, out-of-order and implausible fixes; `start()` only from a user gesture, and `stop()` clears the watch; off-route and arrival need consecutive fixes; travelled distance counts only de-jittered accepted movement; nothing persists or transmits samples                                                                                                                 |
| **Search** (`src/search`)                                                                            | Deterministic tiered ranking (exact → code → prefix → word → multiword → synonym → fuzzy) with documented tie-breaks; unnamed places do not flood generic queries; highlights refer to the original title; never throws on odd input; p95 under `APP_CONFIG.performance.searchBudgetMs` (50 ms)                                                                                                                                                                                                                      |
| **Facilities** (`src/facilities`, `src/utils/safe-url.ts`)                                           | Conservative `opening_hours` subset; unsupported syntax gives "unknown", never a guess; evaluated in IST; stale after `hoursFreshnessDays`; counts derived from data only; nearest uses route distance when available and labels a straight-line fallback; relation validation; URL helpers accept only `http(s)`, `tel:` and plain `mailto:`                                                                                                                                                                        |
| **Map and 3D** (`src/map`, `src/buildings3d`)                                                        | Basemap only from project GeoJSON (no tiles, no keys); self-hosted glyphs; fill-extrusion coloured by height source; props applied incrementally without rebuilding the style; selection never moves the camera by itself; reduced motion respected; WebGL2 probe and readable error messages; e2e hook that exposes no user coordinates                                                                                                                                                                             |
| **Design system** (`src/components/ui`, icons, `src/accessibility`, `src/styles`)                    | Token-based light and dark themes with WCAG AA contrast verified for every declared pair; Dialog and BottomSheet with focus trap and restore; keyboard-operable controls (SegmentedControl roving tabindex, Switch, ToggleChip); live-region announcer; axe has no violations in the kitchen-sink test                                                                                                                                                                                                               |
| **Platform** (`src/favorites`, `src/privacy`, `src/feedback`, `src/offline`, `src/utils/storage.ts`) | Validated, versioned storage with try/catch around every access; turning history off clears recents; "clear all" removes every `lpu-atlas:` key; correction reports contain no location or device data; the issue URL only when `VITE_CORRECTIONS_URL` is https; prompt-mode service worker; one precache for app and data; no runtime caching of third parties                                                                                                                                                      |

The reviewers fixed defects in every module: data pipeline 9, public sources 9, routing 6, geo 3,
search 4, facilities 3, map 6, design system 8, platform 3. Their unresolved findings are carried
into the "Known limitations" section of each [module doc](modules/).

**Exit criteria:** each module's suites pass and the review findings are fixed or documented.

## Stage C: app shell and feature UIs, reviewed in a real browser

- **App shell:**
  - `index.html`, `main.tsx`, the data provider with loading and error screens, and the Zustand
    store slices.
  - Desktop side-panel, mobile bottom-sheet and list-mode layouts.
  - Command palette (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd>, <kbd>/</kbd>), deep links,
    browser-history integration for panels, and map controls.
- **Feature UIs:**
  - Search results, place details (facts, hours, provenance, related places, actions) and category
    panels.
  - Layers and the building legend.
  - Directions (endpoints, profiles, preference, steps, caveats, pick on map), the navigation HUD and
    "Track my walk".
  - Saved places, settings and privacy, the correction report, About with sources and the quality
    summary, campus information (official directory and unavailable services), and offline/update
    status.
- **Browser reviews:** Playwright-driven sessions at desktop and phone sizes against a production
  build. They took screenshots and checked keyboard flows, focus handling and console errors. The
  reviewers fixed 14 defects in the shell, 5 in directions and navigation, and 5 of 7 in the
  platform UI. The other 2 are minor layering and wording issues, listed in
  [modules/app-shell.md](modules/app-shell.md).

**Acceptance criteria:**

- Every control has an accessible name, and focus moves to the opened panel's heading and back.
- No modal is stacked on another modal.
- Escape and Back close the topmost layer.
- Without WebGL2 the list layout keeps search, details, categories and directions working.
- Empty categories show honest empty states.
- Unlocated places are never called "mapped".
- Distances say whether they are route or straight-line.
- No `console.error` in a normal session.

## Stage D: hardening, end-to-end tests and documentation

- **Hardening:** tighten `npm run check` into a full gate (format, lint, typecheck, tests,
  `data:check`, build, smoke, e2e). Add the post-build smoke test (`scripts/smoke.ts`: HTML shell,
  manifest, service worker, shipped data against the manifest, a real search and route, secret
  scan). Code-split the map chunk.
- **End-to-end:** Playwright specs for workflows A–F (see [QA_STRATEGY.md](QA_STRATEGY.md)) in five
  viewports against `vite preview`, with axe checks.
- **Documentation:** README, CONTRIBUTING, LICENSE, architecture, data sources, QA, security and
  privacy, deployment, performance with measured numbers, and one doc per module.

**Acceptance criteria:**

- The full gate passes:

  ```sh
  npx tsc --noEmit -p . && npx eslint . --max-warnings=0 && npx prettier --check . && npx vitest run && npm run -s data:check && npx vite build
  ```

- Every documented command exists in `package.json`.
- Every number in the docs comes from `public/data/manifest.json`, `docs/DATA_QUALITY_REPORT.md` or a
  recorded measurement.
- No document claims a feature that does not exist.

## Stage E: final QA

A final pass by the lead:

- run the full gate and the e2e suite
- spot-check the workflows in a browser
- reconcile every module's open issues
- write [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) (the acceptance report itself,
  [ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md), was first committed in Stage L)

Items that only a human or a real device can verify are listed in
[QA_STRATEGY.md](QA_STRATEGY.md#what-needs-human-or-on-device-verification) and are reported as
unverified, not as passed.

## Beyond v1: the delivered waves

Stages A–E delivered the static v1 (`27acd56` … `f8d43f0`). The waves below followed owner decisions
that changed the scope; each ended with a full gate run recorded in its commit message and in
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md). The verdict for every requirement is in
[ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md).

### Stage F: community backend (`7075dfc`)

**Owner decision:** moderated contributions and owner edits on Cloudflare Pages Functions + D1,
superseding the v1 "no backend" rule. **Built:** suggestions, private moderation, owner locations
and overrides of base places, an append-only audit log, the publication layer with ETag, a pure merge
service; Cloudflare Access or password sessions (HttpOnly `__Host-` cookie, CSRF, rate-limited login),
failing closed when unconfigured. **Exit:** server suites on a local D1 and a real HTTP flow against
`wrangler pages dev` pass; nothing self-publishes.

### Stage G: geography audit and the campus-only dataset (`902af56`, `ceb0ac0`, `9207811`, `de688b4`)

**Owner decisions:** campus-only data, off-campus places only in an opt-in layer and never routable;
detections as an unverified layer; block numbers only with owner evidence. **Built:** the campus
geography audit, geodata sources and licences, the isometric/3D design; schema v2 with campus
membership (inside, crossing, outside, uncertain) from a shared boundary service, context places,
detections, directory keys, the count-change guard; block-number leads for the owner (not applied).
**Exit:** two byte-identical rebuilds, the coverage suite, override-survival and rollback tests.

### Stage H: Building Studio core, isometric overview, view modes (`e8f313a`)

**Built:** the Studio contract and migration 0002 (tested down script), mesh generators, validation,
history, recovery, thumbnails, the Studio server (17 endpoints, atomic publish, revisions), the
renderer bake-off (raw WebGL2 layer for owner models with a fill-extrusion fallback), the Canvas2D
isometric overview and the building directory, `?view=` deep links. **Exit:** red-team fixes, gate
green; device frame time (D8) left open.

### Stage I: admin app, Studio editor, suggestions, map providers (`2407afe`)

**Owner specs A, B and C.** **Built:** `/admin` (lazy chunk) with queue, locations, overrides,
history, quality, Studio and templates; the public "Suggest a missing place" flow; five view modes on
free sources only (optional Esri key, optional EOX backdrop, Photorealistic 3D shown as unavailable);
the real-handler e2e backend. **Exit:** the 57-item QA acceptance checklist on the real app.

### Stage J: fix wave (`6050e91`)

**Fixed** the checklist defects D3 (off-campus places were routable), D4 and D5, the honeypot decoy
parity, the Zod CSP violation, the Studio leave prompt, access points picked on the map. **Exit:**
each fix has a regression test proven to fail without it; 56 PASS, 0 FAIL, 1 NOT TESTABLE of 57.

### Stage K: the owner's campus illustration (`6a07349`)

**Owner decision:** the owner's artwork is the authoritative visual source of the isometric
experience; geography stays separate. **Built:** inventory and hotspots, the art pipeline with
integrity checks in build and CI, the Illustrated overview, block-wise directory and search, the admin
Artwork section and migration 0003. **Exit:** artwork gates 1–5 on a fresh clone (Vitest 2513, server
1588 with 4 opt-in skips, Playwright 324 passed and 0 failed).

### Stage L: master-spec conformance (2026-10-26, this wave)

**Input:** the master-spec conformance audit (255 requirements, 33 work items G-01–G-33).
**Waves:** gate integrity (server suites in `check` and CI, no silent browser skips, bundle budgets,
committed performance scripts), data provenance and fetch robustness, a documentation truth pass
(architecture, current dataset numbers, acceptance report, QA and contributing guides, security
inventory), and small UX and code fixes, worked on in parallel by separate workstreams. **Exit:** the
full `npm run check` gate on the combined tree, each fix with a regression test proven by a temporary
revert, and this plan, the status file and the acceptance report refreshed from the real results.

### Next: Creator Mode and the food module

Planned after Stage L: owner editing of names, aliases, categories, opening hours and entrances
(`accessed_via`), corrections to existing places, food outlets with sourced menus and hours, and a
shared facility card. The overlapping audit items O-1–O-7 belong to that work, not to Stage L.
