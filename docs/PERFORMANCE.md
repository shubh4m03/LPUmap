# Performance

The budgets, and what was actually measured against them on the real LPU dataset (`b628c5855b1d`).
All numbers below were measured on **2026-10-23** by the documentation agent. They are a
**snapshot**: another agent was code-splitting the app at the same time, so bundle figures are given
for two builds taken about 20 minutes apart.

## Budgets

| Budget                     | Value        | Source                                                                                   |
| -------------------------- | ------------ | ---------------------------------------------------------------------------------------- |
| Search query latency (p95) | **< 50 ms**  | `APP_CONFIG.performance.searchBudgetMs`                                                  |
| Route computation          | **< 150 ms** | `APP_CONFIG.performance.routeBudgetMs`                                                   |
| Search input debounce      | 60 ms        | `APP_CONFIG.search.debounceMs` (UI responsiveness, not a measurement)                    |
| Single precached file      | ≤ 8 MB       | `maximumFileSizeToCacheInBytes` in `src/offline/pwa-config.ts`; the build fails above it |
| JS chunk size warning      | 1,200 kB     | `chunkSizeWarningLimit` in `vite.config.ts`                                              |

`APP_CONFIG` calls the budgets "targets (not guarantees)". No budget is defined for page-load time or
total transfer size. Those are reported below without a pass/fail verdict.

## Test machine

- **Laptop**: Intel Core 7 240H (16 logical CPUs), Windows 11 (10.0.26300), on mains power
- **Node.js**: 24.19.0
- **Browser**: Playwright 1.64.1 headless Chromium (build 1248)
- **Load**: other agents' processes were running on the same machine; no isolation was attempted

A low-end Android phone will be several times slower. Those numbers have **not** been measured; see
[QA_STRATEGY.md](QA_STRATEGY.md#what-needs-human-or-on-device-verification).

## Search latency (real index)

**Method.**

- The index was built from `public/data/places.json` with
  `docsFromCategories(CATEGORIES, counts) + docsFromPlaces(places)`, giving **306 docs**.
  Unnamed places without aliases are excluded by design.
- 200 queries were timed, with a seeded random generator. They comprised:
  - 20 fixed realistic queries ("library", "atm", "school of", "block 34", "xyz", …)
  - typing prefixes of 1–6 characters
  - full titles
  - one-character typos
  - single words from titles
- One warm-up pass ran first, then each query was timed with `performance.now()` in Node.

| Run | p50     | p95     | max     | mean    |
| --- | ------- | ------- | ------- | ------- |
| 1   | 0.21 ms | 0.49 ms | 1.27 ms | 0.24 ms |
| 2   | 0.19 ms | 0.43 ms | 0.71 ms | 0.22 ms |
| 3   | 0.20 ms | 0.47 ms | 0.89 ms | 0.23 ms |

- 197 of 200 queries returned at least one hit.
- The first query on a freshly built index took 0.22 ms.
- Building the docs and the index took 11–13 ms.
- The app's own index also has layer and command docs, **328 docs** in all. `buildServices()`, which
  builds the facility directory, that index and the router, took a median of **7.97 ms** over 10 runs
  (min 5.27 ms, max 20.89 ms, the first and coldest run).

**Verdict: met.** The p95 is about 0.5 ms against a 50 ms budget, two orders of magnitude inside it.

The unit test `tests/unit/search/performance.test.ts` uses a 5,000-doc synthetic corpus, which is
much larger than the real index. It reported p95 values of 4.4 ms and 8.8 ms when run on its own
(module review). In one full parallel `npx vitest run` on 2026-10-23, both of its tests **failed** the
50 ms threshold while dozens of jsdom suites competed for the CPU. A later full run the same evening
passed them. That is a measurement-environment
problem, not a real-index regression. Run that suite serially in CI rather than relaxing it.

## Route latency (real graph)

**Method.**

- `createRouter(graph.json)`: 1,636 nodes and 1,770 edges, built in 1.9–2.7 ms.
- 500 random pairs per profile from the **790 routable places** (those with a location and a
  `graphNodeId`), as place-to-place requests, timed with `performance.now()`.
- 100 random pairs through `alternatives()`, which is what the directions panel calls.

| Profile (500 pairs)            | p50     | p95     | max (incl. first call) | Succeeded | Failure reasons |
| ------------------------------ | ------- | ------- | ---------------------- | --------- | --------------- |
| walk                           | 0.03 ms | 0.21 ms | 3.68 ms                | 498 / 500 | 2 × `no-path`   |
| cycle                          | 0.02 ms | 0.14 ms | 0.54 ms                | 496 / 500 | 4 × `no-path`   |
| step-free                      | 0.02 ms | 0.13 ms | 1.04 ms                | 490 / 500 | 10 × `no-path`  |
| alternatives (walk, 100 pairs) | 0.15 ms | 0.97 ms | 1.23 ms                | 99 / 100  | —               |

Two repeat runs agreed within ±0.05 ms at p95. The worst single call was the first, cold one:
3.7 ms.

The `no-path` results are real. They are pairs in different graph components, out of 9 components
in all; the router never bridges them.

**Verdict: met.** The p95 is under 1 ms (under 0.25 ms for a single route) against a 150 ms budget.
The graph is small. Search cost grows with the explored area, and the A* heuristic keeps that small.

## Page load (local, unthrottled)

**Method.**

- `vite preview` serving a production build.
- Headless Chromium with service workers blocked, so every run was a cold network load.
- 5 runs per viewport; the median is reported.
- "Map style loaded" is the time from `goto()` until `window.__ATLAS_MAP__.isStyleLoaded()` returned
  true (`?e2e=1`). It includes downloading the data, Zod validation, building the services, and
  MapLibre initialising its worker and style.
- Headless Chromium may render WebGL in software, so the map time is pessimistic for a GPU device and
  optimistic for a slow phone.

| Build snapshot                              | Viewport   | FCP    | DOMContentLoaded | Map style loaded |
| ------------------------------------------- | ---------- | ------ | ---------------- | ---------------- |
| A (before 21:30 IST, before code-splitting) | 1440 × 900 | 112 ms | 71 ms            | 1,014 ms         |
| A                                           | 390 × 844  | 96 ms  | 59 ms            | 907 ms           |
| B (21:43 IST, panels code-split)            | 1440 × 900 | 80 ms  | 47 ms            | 925 ms           |
| B                                           | 390 × 844  | 72 ms  | 45 ms            | 710 ms           |

These are localhost numbers with no network latency or throttling. They show CPU-side cost, not
real-world load time. On a 4G connection, transfer time for the gzipped sizes below dominates. No
budget is defined, so there is no verdict.

## Bundle sizes (`npx vite build`)

Built into a scratch directory, so the repository's `dist/` was not touched. Sizes are bytes on
disk; gzip is level 9 and brotli uses default settings, both computed by Node `zlib`. Vite's own
gzip column differs slightly.

### Snapshot A: before 21:30 IST, 7 assets, precache 32 entries / 3,730 KiB

| File                                  | Raw              | gzip            | brotli          | Loaded                                             |
| ------------------------------------- | ---------------- | --------------- | --------------- | -------------------------------------------------- |
| `assets/index-*.js`                   | 538,325 B        | 167,460 B       | 142,045 B       | at start                                           |
| `assets/index-*.css`                  | 105,751 B        | 17,330 B        | 14,490 B        | at start (includes MapLibre's CSS)                 |
| `assets/MapStage-*.js`                | 1,064,546 B      | 287,438 B       | 235,301 B       | lazily, when the map mounts (contains MapLibre GL) |
| `assets/maplibre-gl-worker-*.mjs`     | 518,806 B        | 147,886 B       | 121,564 B       | by MapLibre as a Web Worker                        |
| `assets/workbox-window.prod.es5-*.js` | 5,714 B          | 2,246 B         | 1,995 B         | production only, to register the worker            |
| `sw.js` + `workbox-*.js`              | 3,308 + 15,246 B | 1,517 + 5,257 B | 1,276 + 4,745 B | by the service worker                              |

### Snapshot B: 21:43 IST, 28 JS/CSS assets, precache 55 entries / 3,745 KiB

Another agent's code-splitting had landed by then. The changes that matter:

- `index-*.js` dropped to **322.39 kB** (99.54 kB gzip, as reported by Vite).
- `AppShell-*.js` (63.24 kB, 20.70 kB gzip) and shared chunks (`ui` 42.19 kB, `commands` 25.02 kB,
  `services` 16.94 kB, `store` 15.71 kB) now load separately.
- These panels became lazy chunks: About 8.47 kB, Settings 5.63 kB, Campus info 6.08 kB, Saved
  places 3.64 kB, Directions 16.43 kB, Report 9.49 kB.
- `MapStage-*.js` is essentially unchanged at 1,065.65 kB (291.14 kB gzip).
- The worker is unchanged at 518.80 kB.

The final layout is whatever the final build produces. Rerun `npx vite build` to see it.

**Against the 1,200 kB chunk warning:** the largest chunk, `MapStage`, is 1,064–1,066 kB, **under**
the limit but within about 12 % of it. Most of that is MapLibre GL itself. No budget exists for the
initial JS; the code-splitting cut it by about 40 % between the two snapshots.

### Data and fonts

| File (`public/data/`) | Raw             | gzip          | brotli       | Loaded                   |
| --------------------- | --------------- | ------------- | ------------ | ------------------------ |
| `graph.json`          | 495,453 B       | 36,647 B      | 23,601 B     | at start                 |
| `places.json`         | 401,563 B       | 27,570 B      | 19,883 B     | at start                 |
| `relations.json`      | 265,663 B       | 8,594 B       | 5,799 B      | at start                 |
| `buildings.geojson`   | 239,339 B       | 26,348 B      | 18,527 B     | at start                 |
| `basemap.geojson`     | 142,362 B       | 25,082 B      | 17,337 B     | at start                 |
| `manifest.json`       | 11,496 B        | 2,311 B       | 1,924 B      | at start (first request) |
| `boundary.geojson`    | 3,166 B         | 1,041 B       | 792 B        | at start                 |
| `quality-report.json` | 13,990 B        | 2,351 B       | 1,937 B      | About panel only         |
| **Loaded at start**   | **1,559,042 B** | **127,593 B** | **87,863 B** |                          |

The byte counts of the data files match `public/data/manifest.json`. The largest data file, at
0.5 MB, is far below the 8 MB precache limit.

The self-hosted glyphs are 6 PBF files totalling 489,262 B (243,733 B gzip). They are requested on
demand by MapLibre and all precached.

**Whole `dist/`**, excluding source maps (snapshot A): 4,365,285 B raw, 1,047,422 B gzipped. This is
roughly what the service worker precaches on the first visit: Workbox reported 3,730 KiB for
snapshot A.

## Observations and follow-ups

- **Search and routing are far inside their budgets.** At this dataset size there is no reason to
  move either into a Web Worker.
- **The initial download is dominated by MapLibre.** That is the `MapStage` chunk plus the worker,
  about 435 kB gzip together. The start-up JS, CSS and data together are about 312 kB gzip in
  snapshot A (167 + 17 + 128 kB), and less in B.
- Production source maps are generated (`build.sourcemap: true`). They are not precached, because
  `.map` files are not in the precache globs, and they are only downloaded when DevTools is open.
- The next useful measurement is on a real mid-range Android phone over 4G: first load, a repeat
  load from the service worker, and time to first route. That has not been done.

## View modes and the owner publication (2026-10-24)

Measured by the integration agent on the same laptop (dataset `62e807e6d444`), while other agents were
running tests. These are single-machine snapshots, not budgets. Gate 3 (the studio WebGL layer with 50
instances under a 4× CPU throttle) belongs to the render-3d work package and is not repeated here.

### Chunks (`npx vite build` into `dist/`)

Raw bytes on disk; gzip is level 9 from Node `zlib` (Vite's own column is within about 1 %).

| Chunk                 | Raw         | gzip      | Loaded                                                           |
| --------------------- | ----------- | --------- | ---------------------------------------------------------------- |
| `index-*.js` (entry)  | 225,003 B   | 70,844 B  | at start                                                         |
| `AppShell-*.js`       | 81,467 B    | 26,654 B  | at start, in parallel with the dataset                           |
| `services-*.js`       | 51,100 B    | 17,936 B  | at start: search index, router, directory, publication merge     |
| `publication-*.js`    | 5,879 B     | 2,552 B   | at start: GET /api/locations loader (schemas load with it)       |
| `MapStage-*.js`       | 1,076,435 B | 291,598 B | only in Realistic 3D and 2D (contains MapLibre GL)               |
| `IsoStudioStage-*.js` | 44,039 B    | 16,463 B  | only in the isometric overview (Canvas2D; never loads MapLibre)  |
| `generate-*.js`       | 12,723 B    | 5,033 B   | with the overview or the studio layer (procedural studio meshes) |
| `runtime-*.js`        | 14,508 B    | 6,109 B   | only when a studio model is visible in 3D (WebGL2 custom layer)  |

The overview and the map are separate chunks: a phone that opens `?view=iso` never downloads MapLibre,
and the 3D/2D map never downloads the overview. The largest chunk is still `MapStage`, under the
1,200 kB warning.

### Publication (GET /api/locations)

| What                                                                 | Value               | How                                         |
| -------------------------------------------------------------------- | ------------------- | ------------------------------------------- |
| Start-up wait for the network before using the saved copy            | 3,000 ms (setting)  | `PUBLICATION_TIMEOUT_MS`, not a measurement |
| Request abandoned after                                              | 20,000 ms (setting) | `PUBLICATION_HARD_TIMEOUT_MS`               |
| Parse the e2e fixture body (2 studio buildings, 1 location; 6,268 B) | 0.16 ms             | Node, median of 21 warm runs                |
| `applyPublication` on the real dataset with that body                | 8.61 ms             | Node, median of 21 warm runs                |
| `buildServices`, base dataset / with the publication applied         | 12.16 ms / 14.50 ms | Node, median of 21 warm runs                |

The publication is fetched in parallel with the dataset, so on a working server it adds no start-up
time; only a server slower than the dataset download delays start-up, by at most the 3 s timeout.
Without an API (static hosting) the request ends at once and the base dataset is used.

### Studio models in the browser (Playwright, headless Chromium, SwiftShader)

`tests/e2e/view-modes.spec.ts` reads `window.__ATLAS_MAP__.getRealistic3D()` with the two synthetic
fixture buildings published. In all five viewports the custom WebGL2 layer was used (`studio:
"custom"`, no fallback): 2 instances, 2 draw calls, 88 triangles, 12,360 B of GPU buffers, and a
last layer render of about 0.1 ms. This is a correctness check on a software renderer, not a
frame-time measurement.

## UI wave: admin, Building Studio, suggestions and map providers (2026-10-24)

Measured by the integration lead on the same laptop (dataset `62e807e6d444`) from a production build
of the integrated working tree, `npx vite build --outDir <scratch>` (not `dist/`, so the owner's
preview was not touched), with **no imagery variables set**. Raw bytes on disk; gzip is level 9 from
Node `zlib`. Rollup names a shared chunk after one of its modules, so some names below are not what
the chunk mainly holds; the "Holds" column says what is in it (read from the source maps).

| Chunk                    | Raw         | gzip      | Holds                                                             | Loaded                                   |
| ------------------------ | ----------- | --------- | ----------------------------------------------------------------- | ---------------------------------------- |
| `index-*.js` (entry)     | 261,438 B   | 83,270 B  | React DOM, app store, shell glue, provider registry (no MapLibre) | at start                                 |
| `categories-*.js`        | 102,401 B   | 28,864 B  | Zod 4 and the category registry                                   | at start                                 |
| `AppShell-*.js`          | 74,763 B    | 23,587 B  | layouts, panels, controls                                         | at start                                 |
| `apply-publication-*.js` | 28,089 B    | 9,679 B   | owner publication merge                                           | at start                                 |
| `services-*.js`          | 21,875 B    | 8,663 B   | search index, router, directory                                   | at start                                 |
| `index-*.css`            | 116,473 B   | 19,358 B  | Tailwind output                                                   | at start                                 |
| `MapView-*.js`           | 1,085,388 B | 294,788 B | MapLibre GL and the map view                                      | only in the map modes                    |
| `MapStage-*.js`          | 6,704 B     | 2,833 B   | store wiring of the map                                           | only in the map modes                    |
| `studio-*.js`            | 41,797 B    | 15,752 B  | **the isometric overview** (`src/isometric/**`; no `maplibre-gl`) | only in the overview                     |
| `generate-*.js`          | 9,607 B     | 4,028 B   | procedural studio meshes                                          | with the overview or the studio layer    |
| `runtime-*.js`           | 14,695 B    | 6,181 B   | WebGL2 custom layer for studio models                             | only when a studio model is drawn in 3D  |
| `SuggestPanel-*.js`      | 13,362 B    | 4,603 B   | "Suggest a missing place"                                         | when the panel opens                     |
| `DirectionsPanel-*.js`   | 16,672 B    | 5,753 B   | directions panel                                                  | when the panel opens                     |
| `AdminApp-*.js`          | 28,983 B    | 10,011 B  | admin shell, session gate, API client                             | only on `/admin`                         |
| `QueueSection-*.js`      | 19,980 B    | 6,523 B   | moderation queue                                                  | only on `/admin`                         |
| `LocationsSection-*.js`  | 13,940 B    | 5,014 B   | locations editor                                                  | only on `/admin/locations`               |
| `OverridesSection-*.js`  | 14,162 B    | 5,045 B   | base-place overrides                                              | only on `/admin/overrides`               |
| `AuditSection-*.js`      | 4,087 B     | 1,918 B   | history                                                           | only on `/admin/audit`                   |
| `QualitySection-*.js`    | 3,180 B     | 1,388 B   | quality warnings                                                  | only on `/admin/quality`                 |
| `StudioSection-*.js`     | 123,796 B   | 36,263 B  | Building Studio UI                                                | only on `/admin/studio`                  |
| `TemplatesSection-*.js`  | 11,772 B    | 3,898 B   | template library management                                       | only on `/admin/templates`               |
| `controls-*.js`          | 31,242 B    | 10,045 B  | studio asset library, thumbnails, field helpers                   | only in the studio and templates screens |

- **Admin isolation (checked in the built entry):** `index-*.js` contains none of `X-CSRF-Token`,
  `/api/admin`, `Owner password`, `Moderation queue`, `Approve and publish` or `cdn-cgi/access`. The
  admin adds about 1.4 kB of source to the entry (the lazy boundary and the path test).
- **Entry growth:** 225,003 B at the earlier view-modes snapshot → 261,438 B now (+36 kB raw). The
  source map attributes the entry's own code mostly to `src/app`, `src/components` and `src/map` (the
  five-mode switcher, the provider registry, the imagery notice, return-to-campus and the shell glue);
  it was not broken down further. No new npm dependency was added.
- **Precache:** 96 files, 4.6 MiB (smoke). Imagery tiles are never precached or cached at runtime.
- **Isometric chunk budget (≤ 25 kB gzip, no `maplibre-gl`):** 15,752 B gzip, no `maplibre` string —
  within budget.

### Isometric overview budgets (D8)

The budgets are in [ISOMETRIC_AND_3D_DESIGN.md §9.1](ISOMETRIC_AND_3D_DESIGN.md#91-budgets) and are
measured by `tests/perf/iso.perf.spec.ts` (`npx playwright test -c tests/perf/playwright.iso.config.ts --project=perf`,
Chromium with CDP CPU throttling as the mid-range-phone proxy). The five runs recorded on 2026-10-24 on
a **shared, loaded** machine are in
[modules/isometric-overview.md](modules/isometric-overview.md) ("Measured results"):
everything within budget except the full redraw at 4×, which was over its 25 ms p95 budget in 2 of 5
runs (25.6 and 29.3 ms).

One more run by the integration lead after this wave's changes (2026-10-24, same laptop, only idle
preview servers of this session running; `test-results/perf/iso.json`):

| Metric (budget)                                          | Result                      |
| -------------------------------------------------------- | --------------------------- |
| Scene build, unthrottled max (≤ 30 ms)                   | 6.5 ms                      |
| Full redraw, unthrottled p95 (≤ 8 ms)                    | 1.5 ms                      |
| Scene build at 4×, max (≤ 120 ms)                        | 74.8 ms                     |
| Full redraw at 4×, p95 of 14 (≤ 25 ms)                   | 13.9 ms                     |
| Gesture frames at 4× (p95 ≤ 20 ms; ≤ 2 % over 50 ms)     | p95 16.8 ms; 0 % over 50 ms |
| Hit-test at 4×, max of 10 (≤ 1 ms)                       | **1.2 ms — over budget**    |
| Mode switch → first frame at 4×, chunk cached (≤ 300 ms) | 151 ms                      |
| JS heap growth after opening the overview (≤ 8 MB)       | 2.19 MB                     |

The spec therefore failed on its soft hit-test assertion in this run (one sample of ten at 1.2 ms; the
median was 0 ms at the timer's 0.1 ms resolution). Earlier runs measured 0.2–1.0 ms. One run on a
shared laptop is not a verdict either way; re-measure on an idle machine.

#### Re-measure, 2026-10-24 12:41–12:42 IST (three runs, quieter machine)

Run by the performance agent with the same command,
`npx playwright test -c tests/perf/playwright.iso.config.ts --project=perf`, three times back to back
(07:11:07, 07:11:41 and 07:12:10 UTC). The harness built its own production page and served it on its
own port, 4420. Each run's `test-results/perf/iso.json` was copied aside before the next run.

**Conditions:**

- Same laptop, Chromium, viewport and 4× CDP throttle as above.
- Code: working tree on top of `2407afe`. Other agents had small uncommitted edits, including 4 lines
  in `src/isometric/IsoStage.tsx`: a toast condition in the selection handler, not drawing code.
- No other agent's tests or builds were running. The only other Node processes were the owner's idle
  preview on 4410, which was not touched, and the chrome-devtools MCP servers.
- CPU load was sampled every 2 s from `\Processor(_Total)\% Processor Time`, as a share of all 16
  logical CPUs:
  - In the 20 s before the runs, with nothing from this measurement running, it was 17–30 %
    (median 28 %). The busiest process was the WMI provider host (`wmiprvse`, about 2.4 cores), then
    Defender and the IDE. So the machine was not idle. The earlier runs recorded no load figure to
    compare with; they only note that other agents were running tests.
  - During the three runs it was 25–48 % (median 40 %). That includes the harness build and its own
    Chromium.

| Metric (budget)                                          | Run 1           | Run 2           | Run 3           | Verdict       |
| -------------------------------------------------------- | --------------- | --------------- | --------------- | ------------- |
| Scene build, unthrottled max (≤ 30 ms)                   | 7.6 ms          | 6.7 ms          | 8.0 ms          | met           |
| Full redraw, unthrottled p95 (≤ 8 ms)                    | 1.4 ms          | 1.4 ms          | 1.3 ms          | met           |
| Scene build at 4×, max (≤ 120 ms)                        | 31.4 ms         | 31.9 ms         | 33.2 ms         | met           |
| Full redraw at 4×, p95 of 14 (≤ 25 ms)                   | 6.7 ms          | 16.0 ms         | 12.4 ms         | met           |
| Gesture frames at 4× (p95 ≤ 20 ms; ≤ 2 % over 50 ms)     | 16.8 ms; 0 %    | 16.8 ms; 0 %    | 16.8 ms; 0 %    | met           |
| Hit-test at 4×, max of 10 (≤ 1 ms)                       | 0.3 ms          | 0.4 ms          | 0.3 ms          | met           |
| Mode switch → first frame at 4×, chunk cached (≤ 300 ms) | 147 ms          | 197 ms          | 190 ms          | met           |
| JS heap growth after opening the overview (≤ 8 MB)       | 2.19 MB         | 2.19 MB         | 2.19 MB         | met           |
| Depth cycles                                             | 0               | 0               | 0               | met           |
| Spec result                                              | passed (24.5 s) | passed (23.9 s) | passed (24.3 s) | 3 of 3 passed |

**Verdict:** on the quieter machine, every D8 overview budget was met in all three runs.

- The hit-test miss in the earlier single run (1.2 ms) did not recur: the worst sample was 0.4 ms.
- The 4× full-redraw misses in the earlier shared-machine runs did not recur either: the worst p95 was
  16.0 ms against 25 ms.
- Run-to-run spread is largest for the 4× full redraw (6.7–16.0 ms) and the mode switch (147–197 ms).
- The scene had 131 buildings and 794 faces.
- The spec also records a diagnostic with no budget: wheel zoom driven through CDP, which commits a
  redraw on each step. Its p95 was 49.9–50.0 ms, with 2.2–3.7 % of frames over 50 ms. The budgeted
  gesture path (pan and wheel over the cached bitmap) stayed at a 16.8 ms p95.

These are still 4× CPU-throttle proxy numbers on a laptop, not phone numbers. The overview with 50
studio models is a heavier scene. It is measured by the bake-off harness, in the next subsection and in
[REPORT.md §3, addendum](research/renderer-bakeoff/REPORT.md#addendum-2026-10-24-re-measure-on-a-quieter-machine).
There, one budget is still exceeded: the unthrottled full redraw.

### 3D renderer bake-off

The decision on how to draw owner-placed models in Realistic 3D (raw-WebGL2 custom layer, guarded,
with fill-extrusion as the automatic fallback) and its measurements are in
[research/renderer-bakeoff/REPORT.md](research/renderer-bakeoff/REPORT.md). In headless Chromium WebGL
runs on SwiftShader (CPU), so its frame times are not device frame times.

**Re-measure, 2026-10-24 12:43–12:45 IST.** One frame-time run of the harness: 4×, desktop and mobile,
baseline, extrusion, custom and overview, plus the 1× desktop reference. Conditions were as in the
overview re-measure above: before the run, CPU load was 17–30 % (median 28 %) with no other agent's
tests running. During the run, SwiftShader itself loaded the CPU: median 61 % at 4× and 84 % at 1×.
Full numbers are in the
[report addendum](research/renderer-bakeoff/REPORT.md#addendum-2026-10-24-re-measure-on-a-quieter-machine).

- **Map paths at 4×.** p50 was 50.0 ms and p95 66.7 ms on every path in both viewports. That includes
  the scene with no studio models, so the custom layer equalled the extrusion path at p50 and p95.
  This is still over the 33 ms device budget. SwiftShader does the drawing on the CPU, so this is not
  a device verdict, and D8 on a phone stays open.
- **Custom layer CPU p95 at 4×.** 4.4 ms on desktop and 3.5 ms on mobile, within its 5 ms budget.
- **Overview with 50 studio models** (1,611 faces):
  - Gesture p95 was 16.7 ms.
  - Scene build at 4× after a rotation was 70.0 ms on desktop and 89.5 ms on mobile. The earlier run
    measured 173.8 and 190.0 ms, over budget; this run is now within 120 ms.
  - Full redraw at 4× was 9.7 ms on desktop and 2.9 ms on mobile, within 25 ms.
  - **The unthrottled full redraw is still over its 8 ms budget**: 9.4 ms in both viewports. It is one
    sample per viewport, at DPR 1 on desktop and DPR 2 on mobile.
  - The applicable §9.3 fallback is "lower the DPR cap to 1.5, then 1", but that cuts fill cost only
    on DPR > 1 screens. §9.3's other overview fallbacks do not target a static redraw: hiding labels
    during gestures, and a worker that takes only the scene build. Gesture frames, which §9.3 guards,
    are within budget.

### Gaps (not measured)

- **Device D8 is not measured.** No Realistic-3D frame time (rAF p95 ≤ 33 ms during a scripted camera
  move) has been taken on a real mid-range Android phone; headless numbers are CPU-rendered and are
  not a substitute. The bake-off's open condition (switch phones to the extrusion representation if
  studio models push p95 over 33 ms) therefore remains open.
- **Satellite imagery cost** (tile count, transfer, frame time with imagery under Campus 3D) is not
  measured: no real key is configured, and the e2e runs answer every provider request with synthetic
  tiles.
- **Admin and Studio screens** have no performance budget; their chunk sizes above are the only
  numbers.
- Page-load timings in this file predate this wave and were not re-measured.

## How to reproduce

The measurement scripts lived in the session's scratch directory, not in the repository. To repeat
the measurements:

1. **Search.** In Node 24, import `docsFromPlaces`, `docsFromCategories` and `createSearchIndex`
   from `src/search/index.ts` and `CATEGORIES` from `src/config/categories.ts`. Load
   `public/data/places.json`, build the index, run a warm-up pass, then time `index.search(q)` for
   each query.
2. **Routing.** Import `createRouter` from `src/routing/index.ts` and load
   `public/data/graph.json`. Pick random pairs of places that have both `location` and
   `graphNodeId`, and time `router.route(...)` with `{ kind: 'place', nodeId: graphNodeId, … }`
   endpoints.
3. **Bundle.** Run `npx vite build --outDir <tmp> --emptyOutDir`, then gzip and brotli each file with
   Node `zlib`.
4. **Load.** Run `npx vite preview --outDir <tmp> --port <p>` and a Playwright script that waits for
   `window.__ATLAS_MAP__.isStyleLoaded()` on `/?e2e=1`.
