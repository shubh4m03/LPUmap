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
