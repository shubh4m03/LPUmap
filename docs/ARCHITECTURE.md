# Architecture

LPU Campus Atlas is a **static, client-only** web app. A deterministic Node pipeline turns a committed
OpenStreetMap snapshot and a few sourced curated records into versioned JSON/GeoJSON files. The
browser loads those files, validates them, builds its services locally (search index, router,
facility directory) and renders a MapLibre map plus React panels. There is no server, database,
account system or third-party runtime request.

## System diagram

```text
 BUILD TIME (Node 24, scripts/)                                   RUN TIME (browser)
 ───────────────────────────────                                  ──────────────────────────────────────────────

  OSM API 0.6 / Overpass ──data:fetch──┐                         ┌──────────── Service worker (Workbox precache) ─────────────┐
                                       ▼                         │  app shell + public/data/* + fonts, one versioned set      │
                               data/raw/osm/*.osm  (committed)   └───────────────▲────────────────────────────────────────────┘
  www.lpu.in ──data:fetch-public──┐    │                                         │ same-origin fetch only (CSP connect-src 'self')
                                  ▼    │                                         │
                 data/curated/*.json   │                         src/data loadCampusData()
                 (aliases, overrides,  │                           manifest.json first → schemaVersion check
                  organizations)       │                           → 6 files fetched ?v=<datasetVersion> → Zod validation
                                  │    │                                         │ CampusData
                                  ▼    ▼                                         ▼
                        scripts/build-data.ts  (offline,         src/app/data/services.ts  buildServices()
                        byte-identical rebuilds)                   ├─ facilities  createFacilityDirectory()
                          parse → boundary → buildings →           ├─ search      createSearchIndex(docsFromCategories + docsFromPlaces + layers + commands)
                          places → graph → connectors →            └─ routing     createRouter(graph)
                          relations → quality report                             │
                                  │                                              ▼
                                  ▼                              src/app/store  (Zustand: ui · selection · map · route · nav slices)
                        public/data/                                 ▲        │                     ▲
                          manifest.json  boundary.geojson            │        ▼                     │ GeoSample (memory only)
                          buildings.geojson  basemap.geojson     UI components          src/geolocation watcher ── navigator.geolocation
                          places.json  relations.json            (components/*,          src/navigation progress / tracking
                          graph.json  quality-report.json         design system)
                        docs/DATA_QUALITY_REPORT.md                  │
                                  │                                  ▼
                        scripts/validate-data.ts               src/map MapView ── MapLibre GL (WebGL2) + src/buildings3d
                        (schemas + invariants, exit 1)             basemap/buildings/POIs/route/user dot from our GeoJSON only
```

## Modules and responsibilities

| Module                                                                         | Responsibility                                                                                                  | Pure?                                                     | Doc                                                            |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------- |
| `src/config`                                                                   | `APP_CONFIG` (speeds, thresholds, budgets, brand), `CATEGORIES` registry and layer groups                       | yes                                                       | in [data.md](modules/data.md)                                  |
| `src/data` + `scripts/`                                                        | Zod schemas (shared by app and pipeline), dataset loader; build, validate and fetch CLIs                        | loader uses `fetch`                                       | [data.md](modules/data.md)                                     |
| `src/distance`                                                                 | Haversine, bearings, polylines, projection, grid spatial index, distance/duration formatting                    | yes                                                       | [distance.md](modules/distance.md)                             |
| `src/routing`                                                                  | A* router over the walking/cycling graph, profiles, snapping, steps, caveats, alternatives                      | yes                                                       | [routing.md](modules/routing.md)                               |
| `src/geolocation`, `src/navigation`                                            | GPS watcher and sample filter; route progress, off-route, arrival; walk tracking                                | filter/progress yes; watcher and hook use the browser API | [geolocation-navigation.md](modules/geolocation-navigation.md) |
| `src/search`                                                                   | Normalisation, deterministic tiered ranking, fuzzy matching, highlight ranges                                   | yes                                                       | [search.md](modules/search.md)                                 |
| `src/facilities`                                                               | Facility directory, opening-hours parser/evaluator (IST), nearest facility, relation validation                 | yes                                                       | [facilities.md](modules/facilities.md)                         |
| `src/map`, `src/buildings3d`                                                   | MapLibre view, style from own GeoJSON, overlays, camera controller, 2D/3D extrusion, WebGL2 probe               | no (MapLibre)                                             | [map-buildings3d.md](modules/map-buildings3d.md)               |
| `src/components/ui`, `src/components/icons`, `src/accessibility`, `src/styles` | Design-system primitives, icons, tokens, theme, focus trap, live region                                         | no (React)                                                | [design-system.md](modules/design-system.md)                   |
| `src/favorites`, `src/privacy`, `src/feedback`, `src/offline`, `src/utils`     | Saved and recent places, privacy settings, correction reports, PWA/service worker, safe URLs, validated storage | mixed                                                     | [platform.md](modules/platform.md)                             |
| `src/app`, feature `src/components/*`                                          | App shell, data provider, store slices, deep links, commands, layouts and feature panels                        | no (React)                                                | [app-shell.md](modules/app-shell.md)                           |

### Dependency direction

Domain modules depend only "downwards". Runtime (non-type) imports between directories under `src/`
were extracted with a script on 2026-10-23:

```text
config  ←  utils  ←  privacy  ←  favorites, feedback
config  ←  distance  ←  routing, geolocation, facilities
geolocation (filter, types)  ←  navigation
config, data  ←  search
config  ←  offline
config, distance, buildings3d  ←  map        (buildings3d imports only map/theme-colors.ts, see below)
accessibility, icons  ←  components/ui
everything above  ←  app + feature components  ←  main.tsx
```

- `src/data` imports no other app module at runtime, so it can run in Node from `scripts/`.
- The same script found **0 file-level runtime import cycles**.
- At directory level there are two deliberate two-way links:
  - `map` ↔ `buildings3d`. Both have the same owner. `buildings3d` imports the palette straight from
    `src/map/theme-colors.ts`, not through `src/map/index.ts`, so no file cycle forms.
  - `app` ↔ feature `components`. These are one UI layer: the shell imports the layouts, and the
    feature panels import the store and the `useAtlas()` context.
- Pure modules (`distance`, `routing`, `search`, `facilities`, `navigation`, the geolocation filter)
  never import React, MapLibre or the DOM. `navigation` imports `geolocation/filter.ts` and
  `geolocation/types.ts` directly, because the geolocation index re-exports a React hook.

## Data flow

1. **Raw**: `data/raw/osm/` holds the committed OSM API responses and `SOURCE.json` (URL, licence,
   retrieval time, method, bbox). `data/curated/` holds sourced aliases, overrides and
   organizations.
2. **Normalise** (`scripts/build-data.ts` → `scripts/lib/pipeline.ts`):
   - parse the OSM XML
   - assemble the boundary from relation 21599790; the build fails if it does not close
   - extract buildings with a height source
   - classify places with the category registry
   - build the graph (one edge per consecutive OSM node pair; ways join only at shared nodes)
   - connect places to the nearest walkable node within 60 m
   - derive relations
   - apply curated records
   - write the quality report

   The output is sorted and hashed, so a rebuild is byte-identical. `datasetVersion` is a hash of the
   files.

3. **Publish**: `public/data/*` plus `docs/DATA_QUALITY_REPORT.md`. `scripts/validate-data.ts`
   re-checks schemas and invariants (ids, references, graph bounds, hours syntax, counts against the
   previous build) and fails on any error.
4. **Load** (`src/data/loader.ts`): `manifest.json` is fetched first with `cache: 'no-cache'`. A
   different `schemaVersion` rejects with `DatasetError('schema-version')`, and nothing else is
   fetched. The six data files are then fetched in parallel as `<file>?v=<datasetVersion>` and
   validated with Zod. The error codes are `network`, `schema-version` and `invalid`.
5. **Services** (`src/app/data/services.ts`) are built once per load: the facility directory, the
   search index and the router. On the real dataset this takes about 8 ms (median); see
   [PERFORMANCE.md](PERFORMANCE.md).
6. **Store** (`src/app/store`): one Zustand store composed of ui, selection, map, route and nav
   slices. Components subscribe with narrow selectors, so a GPS fix does not re-render the map shell.
7. **UI and map**: the layouts (desktop side panel, mobile bottom sheet, list mode) render panels
   from the store. `MapView` receives plain props (data, theme, 3D mode, visible groups, selection,
   route overlay, user location) and applies changes incrementally, without rebuilding the style.

## Key decisions

**Static-first, no backend.** The campus changes slowly. The data is public and small: 7 files,
about 1.5 MB raw and about 130 KB gzipped. A static host gives offline support, no operating cost,
no personal data on a server and a small attack surface. The cost is that there are no live features
(occupancy, events, moderated corrections) until a real source and a backend exist; see the
extension points below.

**MapLibre fill-extrusion, not Three.js.** Buildings are flat footprints with one height each.
MapLibre's `fill-extrusion` layer draws exactly that, in the same WebGL context, camera and picking
model as the 2D map, with feature-state highlighting and no second renderer. Three.js would need a
custom layer, a second scene graph, manual synchronisation of the projection and hit-testing, and
more bundle weight, with no gain for the data we have: there are no measured heights, no roof shapes
and no indoor geometry. The 3D view is explicit about its limits. Heights are coloured by source
(`osm-height`, `osm-levels-estimate`, `fallback`) and the legend says which are placeholders. Phones
start in 2D to save GPU work.

**Basemap from our own GeoJSON.** There are no tile servers or API keys, and the CSP allows
`connect-src 'self'` only. The style is generated in code (`src/map/style.ts`). The glyph PBFs are
self-hosted.

**Haversine distances.** Every distance uses the haversine formula (R = 6 371 008.8 m). Within a
campus about 1.7 km across, haversine differs from the ellipsoidal (Vincenty) distance by less than
0.5 % (at 31° N, about 0.4 % north–south and 0.2 % east–west). That is a few metres over a whole
campus route, which is below GPS error and edge-geometry error, and much cheaper to compute. Local planar
projections are used only for spatial indexing and point-to-segment projection over short spans;
the grid index applies a 0.99 safety factor so that its results stay exact against brute force.

_*A* with an admissible heuristic._*

- Edge cost is the haversine length between the edge's node coordinates. The pipeline emits
  straight node-to-node edges, so the drawn polyline and `distanceM` agree.
- For "shortest", the heuristic is the straight-line distance × 0.999. A straight line can never be
  longer than a path, so A* stays optimal; the 0.999 factor absorbs floating-point error.
- For "least time", the heuristic is that distance ÷ the profile's fastest possible speed, which
  never over-estimates the remaining time.
- Ties break on f, then g, then node id, so results are deterministic.
- Disconnected components are never bridged. A route between components returns `no-path` with an
  explanation.

**Conservative opening hours in IST.**

- Only a strict subset of OSM `opening_hours` is parsed: weekday rules, time ranges, overnight
  spill, `off` and `24/7`. Anything else (public holidays, months, sunrise, comments) returns
  "unknown" and the raw text is shown. A wrong "open now" is worse than "unknown".
- Evaluation uses a fixed UTC+05:30 offset, whatever the device time zone, because the campus is in
  India (which has no DST).
- Hours older than `APP_CONFIG.cache.hoursFreshnessDays` (180) are labelled stale.

**Atomic app and data versioning through the precache.** Code, data and glyphs sit in **one**
Workbox precache manifest with per-file revisions. A deploy produces a new `sw.js`, which installs
in the background. The old worker keeps serving the old, matching set until the user accepts the
update prompt, so a cached app never runs against a dataset it was not built with. The loader's
`schemaVersion` check is a second guard. `sw.js`, `index.html` and `data/manifest.json` are served
`no-cache`; hashed `/assets/*` files are immutable.

**Privacy model.**

- Location is requested only from a user gesture and processed in memory. It is never written to
  storage, logged, put in a URL or sent anywhere.
- The e2e test hook exposes no coordinates.
- Local storage holds only favourites, recents (which can be switched off), privacy settings and the
  theme. A correction draft lives in session storage.
- "Clear all local data" removes every `lpu-atlas:` key.
- There are no analytics.

See [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md).

**Truthfulness as an invariant, not a style.**

- Unknown values render as unknown.
- Imported records are never labelled verified.
- "Nearby" relations say they are not physical connections.
- Distances say whether they are route or straight-line.
- Services LPU does not publish (mess menu, shuttle timetable, events, faculty offices) appear as
  unavailable, with links to the official pages.

**Graceful degradation.** Without WebGL2, or after a fatal map error, the app switches to a list
layout with the same search, details, categories and directions. Data loading has explicit loading
and error screens with retry.

## Extension points

Each future module below says what must exist **before** it can be built honestly. None of them is
started in the code.

| Future module                     | Prerequisites                                                                                                                                                                                                                                          | Where it plugs in                                                                                                                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Indoor navigation**             | Indoor geometry (floors, corridors, stairs, lifts) from a survey or official CAD under a reuse licence, ideally mapped in OSM as Simple Indoor Tagging. Mapped building entrances (there are 0 today), so that indoor and outdoor graphs can be joined | The graph schema already has `indoor` and `steps` flags on edges and `accessed_via` relations. Add a `level` to nodes, per-level layers in `src/map`, and a level-aware heuristic in `src/routing` (vertical cost)                                                    |
| **Rooms / block numbers**         | An authoritative, position-bearing source tying "Block NN" and room numbers to footprints (an official map with reuse permission, or a survey). Today no such source exists and block names are absent from OSM                                        | `data/curated/aliases.json` (sourced aliases to existing OSM ids) makes blocks searchable with no code change. Rooms need a new `room` place kind with a `located_in` building and an optional `level`                                                                |
| **Events**                        | An official feed of upcoming events with dates, times and venues that map to known places. The current LPU sources are retrospective news only                                                                                                         | A `data/live/` source with its own schema and freshness; a fetch at build time or a same-origin proxy (the CSP allows only `'self'`); an "Events" panel replacing the current "unavailable" section in `src/components/info`                                          |
| **Shuttle / bus**                 | A published timetable (GTFS ideally) and stop positions. Today the transport page has routes and charges, but no times                                                                                                                                 | Stops as `transport` places; timetable as static data with a validity period; never real-time claims without a real-time source                                                                                                                                       |
| **Moderated corrections backend** | A hosting decision, an operator who moderates, a privacy notice, abuse controls (rate limits, CAPTCHA or accounts) and a data-retention policy. A decision on whether accepted fixes go to OSM (preferred) or to `data/curated/` with a `check` value  | `src/feedback` already produces a validated `CorrectionDraft` and plain text. A backend would replace `correctionIssueUrl` with a POST to a same-origin endpoint; the CSP `connect-src` and `form-action` would need the endpoint, and the privacy facts would change |

General rules for any extension:

- Add a schema to `src/data/schema.ts`, bumping `DATA_SCHEMA_VERSION` if existing files change.
- Record provenance.
- Add validation to `scripts/lib/validate.ts`.
- Add counts to the quality report.
- Keep the domain logic in a pure module with its own `index.ts` and contract.
