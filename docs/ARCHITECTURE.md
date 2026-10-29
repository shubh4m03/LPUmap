# Architecture

LPU Campus Atlas has two parts that deploy together on Cloudflare Pages:

1. **A static, offline-capable web app (PWA) — the public map.** A deterministic Node pipeline turns
   a committed OpenStreetMap snapshot, a few cited LPU records and machine-detected footprints into
   versioned JSON/GeoJSON in `public/data/`, and the owner's campus illustration into
   `public/isometric-art/`. The browser validates those files, builds its services locally (search
   index, router, facility and building directories) and renders five view modes: a MapLibre map in
   2D, 3D and (optionally) satellite, an always-unavailable Photorealistic 3D option, and an isometric
   overview (the owner's illustration, or a Canvas2D drawing of our own footprints). Search, details
   and routing work offline after one visit. This part never needs a server.
2. **An optional backend: Cloudflare Pages Functions over a D1 database.** It takes public "Suggest a
   missing place" submissions, serves the owner's publication (`GET /api/locations`: approved
   locations, base-place overrides, Building Studio models and artwork links) and runs the owner admin
   at `/admin` (moderation, locations, overrides, history, quality, Building Studio, templates,
   artwork verification). The admin authenticates with Cloudflare Access or a password session and
   fails closed when it is not configured. On a host without the Functions, the app shows the base
   dataset and no error.

There are no visitor accounts and no analytics. The app makes no third-party request unless an
imagery provider is configured at build time (`VITE_ARCGIS_API_KEY` or `VITE_EOX_BACKDROP`); the CSP in
`public/_headers` enforces that (see [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md)).

## System diagram

```text
 BUILD TIME (Node 24, scripts/)                         RUN TIME: browser                                   RUN TIME: Cloudflare (optional)
 ─────────────────────────────                          ─────────────────────────────────────────────       ─────────────────────────────────

 OSM API 0.6 / Overpass ─ data:fetch ─┐                 Service worker (Workbox, prompt-mode updates)
 www.lpu.in ─ data:fetch-public ──────┤                   one versioned precache: app shell + data + glyphs
 MS / Google Open Buildings ─ data:fetch-footprints ─┐    (+ light artwork files); /api/* never precached
                                      ▼              │                 │ same origin
            data/raw/** + data/curated/** (committed)│    src/data loadCampusData()  ── manifest first,
                                      │              │      schemaVersion check, files ?v=<datasetVersion>,
                                      ▼              ▼      Zod validation; optional layers on demand
            scripts/build-data.ts (offline, byte-identical)              │
              boundary → membership → buildings → places →  src/app/data/publication.ts ── GET /api/locations ──►  functions/api/locations.ts
              graph → connectors → relations → detections     network-first, 3 s, last good copy saved              │
              → quality report → manifest (content hash)    applyPublication() merges owner changes                ▼
                                      │                                    │                              server/http (router, origin,
            scripts/validate-data.ts (exit 1 on error)       buildServices(): facility directory,           body limits, errors, logs)
                                      ▼                        building directory (+ artwork), search,                │
            public/data/*  docs/DATA_QUALITY_REPORT.md         router                                     server/handlers ── server/auth
                                                                           │                              (public + 45 admin routes;
 lpu-isometric-map-design/ (owner's 29 originals)            src/app/store (Zustand slices)                 Access or password session,
   ─ art:build / art:derive ─►  public/isometric-art/          │          │          │                      CSRF, rate limits)
     (originals byte-identical, lossless derived copies,     MapStage   IsoStudio   IsometricModeStage                   │
      manifest; art:check, art:check-dist)                   (MapLibre:  Stage      (illustrated overview:   server/domain (moderation,
                                                              2D/3D/sat, (Canvas2D   one transform for         locations, overrides, studio,
                                                              studio     map-accurate image + outlines)        artwork, publication, audit)
                                                              WebGL2     overview)                                       │
                                                              layer)                                           server/db ── D1 (migrations
                                                                                                                0001–0003)
                                                             /admin → src/admin (lazy chunk, own router) ── /api/admin/** ──►
```

## Deployables and trust boundaries

| Part                                     | Code                                                                    | Reachable by                      | Trust and failure rules                                                                                                                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Static app                               | `src/**` (minus `src/admin`), `public/**`                               | Everyone; offline after one visit | Every fetched file is schema-validated; unknown values render as unknown; location stays in memory                                                                                                           |
| Owner admin app                          | `src/admin/**` (lazy chunk loaded only on `/admin`)                     | The owner, after sign-in          | No admin code or text in the public entry (enforced by `npm run perf:bundle`); CSRF token in memory only; logout clears Studio crash recovery                                                                |
| Public API                               | `functions/api/{locations,health}.ts`, `functions/api/contributions/**` | Everyone                          | `GET /api/locations` returns only the public publication shape; `POST /api/contributions/locations` is Origin-checked, honeypotted, size-limited and rate-limited by a keyed IP hash; nothing self-publishes |
| Admin API                                | `functions/api/admin/[[path]].ts` → `server/handlers/admin/**`          | The owner                         | Fails closed (503) without `AUTH_MODE`; every write is one D1 transaction with an audit row and a revision check (409 on conflict)                                                                           |
| D1 database                              | `migrations/0001`–`0003`, `server/db/**`                                | Server code only                  | Migrations before code; non-destructive rollback scripts in `docs/db/`                                                                                                                                       |
| Imagery providers (optional, build-time) | `src/map/providers/**`                                                  | The browser, only when configured | Exactly the two hosts in `connect-src`; tiles never cached; failures fall back to the campus map                                                                                                             |

## Modules and responsibilities

Every module has one owner and one public entry (`index.ts`; the few documented second entries are listed under
[Module dependency rules](#module-dependency-rules)); the owner's document is the contract.
[MODULE_CONTRACTS.md](MODULE_CONTRACTS.md) holds the interfaces of the original modules and points to
the design documents that own the later ones.

| Module                                                                         | Responsibility                                                                                                                                                                                        | Pure?                                                     | Owning document                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config`                                                                   | `APP_CONFIG` (speeds, thresholds, budgets, storage and cache names), `CATEGORIES` registry and layer groups                                                                                           | yes                                                       | [modules/data.md](modules/data.md)                                                                                                                                                                                                       |
| `src/data` + `scripts/`                                                        | Zod schemas shared by app, scripts and server; dataset loader and optional loaders; build, validate and fetch CLIs                                                                                    | loader uses `fetch`                                       | [modules/data.md](modules/data.md), [data/README.md](../data/README.md)                                                                                                                                                                  |
| `src/geo`                                                                      | Campus boundary service: point and footprint membership (`classifyFootprint`, `validatePointLocation`), shared by pipeline, app and server                                                            | yes                                                       | [MODULE_CONTRACTS.md §v2 geographic contract](MODULE_CONTRACTS.md#v2-geographic-contract-data_schema_version-2)                                                                                                                          |
| `src/distance`                                                                 | Haversine, bearings, polylines, local projection, grid spatial index, formatting                                                                                                                      | yes                                                       | [modules/distance.md](modules/distance.md)                                                                                                                                                                                               |
| `src/routing`                                                                  | A* router over the walking/cycling graph, profiles, snapping, steps, caveats, alternatives                                                                                                            | yes                                                       | [modules/routing.md](modules/routing.md)                                                                                                                                                                                                 |
| `src/geolocation`, `src/navigation`                                            | GPS watcher and sample filter; route progress, off-route, arrival; walk tracking                                                                                                                      | filter/progress yes; watcher and hook use the browser API | [modules/geolocation-navigation.md](modules/geolocation-navigation.md)                                                                                                                                                                   |
| `src/search`                                                                   | Normalisation, deterministic tiered ranking, fuzzy matching, highlights; docs from places, categories and artwork items                                                                               | yes                                                       | [modules/search.md](modules/search.md)                                                                                                                                                                                                   |
| `src/facilities`                                                               | Facility directory, `isRoutablePlace` (on campus only), opening hours (IST), nearest facility, relation validation                                                                                    | yes                                                       | [modules/facilities.md](modules/facilities.md)                                                                                                                                                                                           |
| `src/directory`                                                                | Building directory: map keys, honest titles, routability notes, the join with verified artwork items; shared by every view mode                                                                       | yes                                                       | [MODULE_CONTRACTS.md §Directory](MODULE_CONTRACTS.md#directory-srcdirectory), [ISOMETRIC_AND_3D_DESIGN.md §7.4](ISOMETRIC_AND_3D_DESIGN.md)                                                                                              |
| `src/map` (`providers/`, `editing/`)                                           | MapLibre view, style from our own GeoJSON, overlays, camera controller, picking, e2e hook; free imagery providers and fallbacks; the map-editing contract shared by Suggest, Locations and the Studio | no (MapLibre)                                             | [modules/map-buildings3d.md](modules/map-buildings3d.md), [MAP_PROVIDER_CONFIGURATION.md](MAP_PROVIDER_CONFIGURATION.md)                                                                                                                 |
| `src/buildings3d` (`models/`)                                                  | Fill-extrusion layers and zoom LOD, 2D/3D mode, WebGL2 probe, frame watchdog, the guarded WebGL2 layer for owner-placed models                                                                        | no (MapLibre, WebGL)                                      | [modules/map-buildings3d.md](modules/map-buildings3d.md), [3D_BUILDING_FIDELITY.md](3D_BUILDING_FIDELITY.md)                                                                                                                             |
| `src/isometric`                                                                | Canvas2D map-accurate overview: projection, depth order, scene, drawing, hit-testing; never imports MapLibre                                                                                          | scene maths yes; stage no                                 | [modules/isometric-overview.md](modules/isometric-overview.md), [ISOMETRIC_AND_3D_DESIGN.md](ISOMETRIC_AND_3D_DESIGN.md)                                                                                                                 |
| `src/isometric-art`                                                            | The illustrated overview: artwork schema, manifest loader, association merge, artwork directory, hotspot geometry, renderer and detail card                                                           | schema/merge yes; renderer no                             | [LPU_ISOMETRIC_ASSET_INTEGRATION.md](LPU_ISOMETRIC_ASSET_INTEGRATION.md) (§8 ownership)                                                                                                                                                  |
| `src/building-studio`                                                          | Studio record schema, asset library, procedural meshes, validation, history, editor state, crash recovery, thumbnails, merge into the campus data, Studio UI store                                    | core yes; `ui/` and `render/` no                          | [BUILDING_STUDIO_DESIGN.md](BUILDING_STUDIO_DESIGN.md) (§14 ownership)                                                                                                                                                                   |
| `src/community`                                                                | Publication and contribution schemas shared with the server, the publication merge (`mergePublication`), duplicate detection                                                                          | yes                                                       | [COMMUNITY_MODULE_CONTRACTS.md](COMMUNITY_MODULE_CONTRACTS.md) (§Ownership)                                                                                                                                                              |
| `src/admin`                                                                    | The lazily loaded owner app: router, session gate, typed API client (45 admin routes), sections (queue, locations, overrides, history, quality, Studio, templates, artwork)                           | no (React)                                                | [ADMIN_OPERATIONS.md](ADMIN_OPERATIONS.md), [COMMUNITY_MODULE_CONTRACTS.md](COMMUNITY_MODULE_CONTRACTS.md)                                                                                                                               |
| `src/csp`                                                                      | The CSP-safe Zod entry: `vite.config.ts` aliases the client's bare `zod` import to `src/csp/zod.ts`, which turns Zod's JIT off first so no `eval` probe breaks `script-src 'self'`                    | yes                                                       | [MODULE_CONTRACTS.md §src/csp](MODULE_CONTRACTS.md#srccsp--owner-platform-security), [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md)                                                                                                  |
| `src/components/ui`, `src/components/icons`, `src/accessibility`, `src/styles` | Design-system primitives, icons, tokens, theme, focus trap, live region                                                                                                                               | no (React)                                                | [modules/design-system.md](modules/design-system.md)                                                                                                                                                                                     |
| `src/favorites`, `src/privacy`, `src/feedback`, `src/offline`, `src/utils`     | Saved and recent places, privacy settings, correction reports, PWA/service worker, safe URLs, validated storage                                                                                       | mixed                                                     | [modules/platform.md](modules/platform.md), [src/offline/README.md](../src/offline/README.md)                                                                                                                                            |
| `src/app`, feature `src/components/*`                                          | App shell, data provider, publication and artwork loading, services, store slices, view modes, deep links, commands, layouts and feature panels                                                       | no (React)                                                | [modules/app-shell.md](modules/app-shell.md)                                                                                                                                                                                             |
| `server/`                                                                      | HTTP layer, handlers, auth (Access or password, sessions, CSRF, rate limits), domain logic (moderation, locations, overrides, studio, artwork, publication, audit), D1 repositories                   | no DOM; Node/workerd                                      | [COMMUNITY_MODULE_CONTRACTS.md](COMMUNITY_MODULE_CONTRACTS.md), [BUILDING_STUDIO_DESIGN.md](BUILDING_STUDIO_DESIGN.md), [LPU_ISOMETRIC_ASSET_INTEGRATION.md §4](LPU_ISOMETRIC_ASSET_INTEGRATION.md#4-persistence-and-owner-verification) |
| `functions/`                                                                   | Thin Cloudflare Pages Functions entry points (`/api/locations`, `/api/health`, `/api/contributions/locations`, `/api/admin/[[path]]`) over `server/`                                                  | —                                                         | [DEPLOYMENT.md](DEPLOYMENT.md)                                                                                                                                                                                                           |
| `migrations/`, `docs/db/`                                                      | D1 schema: 0001 community (suggestions, locations, overrides, audit, sessions, rate limits), 0002 Building Studio, 0003 artwork associations; down scripts                                            | —                                                         | [DEPLOYMENT.md §D1 migrations](DEPLOYMENT.md), [DATA_ROLLBACK.md](DATA_ROLLBACK.md)                                                                                                                                                      |

## Module dependency rules

Modules sit in layers and import only from their own layer or below. Type-only imports count too: a
type that points up a layer couples the modules as much as a value does.

```text
 L4  entries      main.tsx (public)   src/admin (lazy; reached from main.tsx only via AdminRoot + is-admin-path)
 L3  app          src/app + feature src/components/* (one module: shell, store, services, stages, panels)
 L2  views/UI     map (+providers, editing) · buildings3d · isometric · isometric-art/view · building-studio/ui ·
                  building-studio/render · components/ui · components/icons · accessibility · favorites · privacy ·
                  feedback · offline
 L1  domain       data · geo · distance · routing · search · facilities · geolocation · navigation · directory ·
                  community · building-studio (core) · isometric-art (core)
 L0  leaves       config · utils · csp · styles

 server/    may import L0–L1 only (through their public entries); never React, DOM or MapLibre
 functions/ imports server/ only
```

The module map with every module's layer and public entries is code, not prose:
[`scripts/ci/module-boundaries.ts`](../scripts/ci/module-boundaries.ts). A file belongs to the module with the
longest matching path, so `src/components/ui` is the design system while the rest of `src/components` is part of
the app, and `src/building-studio/ui` is apart from the Studio core.

The rules:

1. **Pure domain modules stay pure.** L1 and L0 never import React, MapLibre or the DOM, so they run
   in Node (scripts, server, Vitest) unchanged.
2. **Layers point down.** No module imports a module of a higher layer. A view never reads the app: the
   store-wired overview stages are app glue (`src/app/IsoStage.tsx`, `src/app/IsometricModeStage.tsx`), and
   app services reach a view as props (MapView's `onRenderNotice`, filled with `useNoticeToast()` by
   the screens) or as ports (the Studio UI gets the admin's server client as
   `StudioServerApi`, `src/building-studio/server-api.ts`, and its error wording as `describeError`).
3. **Browser code never imports the server**, and the server never imports `src/app`,
   `src/components`, `src/map`, `src/admin` or anything with React.
4. **The admin stays out of the public bundle.** Public code reaches `src/admin` only through
   `AdminRoot.tsx` (a lazy boundary) and `is-admin-path.ts`. `npm run perf:bundle` fails the build if
   any other admin module, or an admin string ("X-CSRF-Token", "/api/admin", …), is in the entry.
5. **The overviews never load MapLibre.** `src/isometric` and `src/isometric-art` must not import
   `maplibre-gl`; `npm run perf:bundle` fails if an overview chunk contains it, and keeps the
   Canvas2D overview chunk within 25 kB gzip.
6. **Import another module only through a public entry** (G-27). Normally that is its `index.ts`. The
   few second entries exist because a barrel decides what a chunk carries (Rollup/Rolldown keep a
   re-exported module that has top-level effects, such as a Zod schema), and each is listed with its
   reason in the module map:

   | Module            | Entries                                                                             | Why the extra entry                                                                                                   |
   | ----------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
   | `utils`           | any file                                                                            | no barrel by decision                                                                                                 |
   | `styles`          | `index.ts`, `index.css`                                                             | the stylesheet `main.tsx` loads                                                                                       |
   | `geolocation`     | `index.ts`, `filter.ts`, `types.ts`                                                 | the pure filter and types, without the browser watcher and React hook                                                 |
   | `building-studio` | `index.ts`, `editor.ts`                                                             | `editor.ts` is the owner's editing core (admin, Studio UI, server); kept out of public chunks and the precache (G-19) |
   | `map`             | `index.ts`, `providers/index.ts`, `editing/index.ts`                                | sub-modules with their own contracts; neither loads MapLibre                                                          |
   | `buildings3d`     | `index.ts`, `map-runtime.ts`                                                        | `index.ts` is in the start-up chunk; `map-runtime.ts` is the map-only code                                            |
   | `isometric`       | `index.ts`, `studio.ts`                                                             | keeps the studio schema out of the overview chunk                                                                     |
   | `privacy`         | `index.ts`, `privacy-store.ts`                                                      | the settings store alone, so the start-up chunk does not carry the privacy facts                                      |
   | `app`             | `App.tsx`, `maplibre-worker.ts`, `data/publication.ts`, `data/apply-publication.ts` | the admin reuses the MapLibre worker set-up and the public publication merge                                          |
   | `admin`           | `AdminRoot.tsx`, `is-admin-path.ts`                                                 | rule 4                                                                                                                |

   Tests and scripts may import module internals (unit tests test internals; scripts run single files
   under Node type stripping).

7. **No cycles**: no module imports itself through others (type-only and lazy imports included), and no
   file-level runtime import cycle.

**Enforcement.** ESLint runs the local rule `atlas/module-boundaries`
([`scripts/ci/eslint-module-boundaries.ts`](../scripts/ci/eslint-module-boundaries.ts), no extra dependency)
on every file in `src/`, `server/` and `functions/`: it reports a layer or public-entry violation at the import.
Cycles need the whole graph: `npm run lint:modules` ([`scripts/ci/check-modules.ts`](../scripts/ci/check-modules.ts))
prints it and fails on any violation or cycle, and `tests/unit/ci/module-graph.test.ts` runs the same check in
`npm test`, with one named assertion per link the audit found two-way.

**Measured state (2026-10-29, working tree).** 511 files in `src/`, `server/` and `functions/`; 2,735
relative imports, 1,045 of them across modules; 0 layer or public-entry violations; 0 module-level cycles;
0 file-level runtime cycles. The same check run on the tree before this change (502 files) found 19 layer
violations (`building-studio/ui` → admin, `isometric` and `isometric-art` → app, `map/providers` → app), 635
imports of other modules' internal files, 0 file-level cycles, and two module cycles holding seven two-way links
(G-26). How each link was removed:

| Former link                                     | Fix                                                                                                                                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin` ↔ `building-studio`                     | The Studio UI takes the server as a port (`StudioServerApi<E>`, `src/building-studio/server-api.ts`) and `describeError`; the admin's `StudioApi` is that port with `AdminApiError`      |
| `app` ↔ `isometric`, `isometric-art`            | The store-wired stages and the session variant state moved to `src/app` (`IsoStage.tsx`, `IsometricModeStage.tsx`, `isometric-variant.ts`); the artwork renderer is `isometric-art/view` |
| `map` → `app` (types)                           | `ViewModeAvailability` is defined by the provider registry (`src/map/providers/types.ts`); `imageryForMode` takes the mode id                                                            |
| `map` → `components/ui` (toast)                 | MapView reports through `onRenderNotice`; the screens pass `useNoticeToast()` (`src/components/ui/toast-context.ts`), so the toast and its 10 s stay the same                            |
| `map` ↔ `buildings3d`                           | The map palette moved to `src/styles/map-theme-colors.ts` (L0); `src/map/index.ts` still re-exports it                                                                                   |
| `building-studio` ↔ `community`                 | `OWNER_SOURCE`, `COMMUNITY_SOURCE` and `MergeIssue` moved to `src/data/overlay.ts`; `src/community` re-exports them                                                                      |
| `directory` ↔ `isometric-art`                   | `normalizeDirectoryText` moved to `src/utils/directory-text.ts`; `src/directory` re-exports it                                                                                           |
| `app` ↔ feature panels, `layout` ↔ `navigation` | One module by definition: the app and its feature panels have one owner ([modules/app-shell.md](modules/app-shell.md))                                                                   |

The bundle was compared module by module before and after (production build with source maps): the start-up
chunks and the service-worker precache hold the same source modules as before (plus `src/data/overlay.ts`, code
moved out of `src/community/merge.ts`); start-up JS went from 133.77 to 130.62 kB gzip, the entry from 84.50 to
83.31 kB and the precache from 5,559.83 to 5,552.62 kB. Rolldown names shared chunks after a module, so chunk
names changed (the MapLibre chunk is `map-*.js`, no longer `MapView-*.js`); budgets and tests classify chunks by
content.

## Data flow

1. **Raw**: `data/raw/osm/` holds the committed OSM API responses and `SOURCE.json`;
   `data/raw/detections/` the detection snapshots; `data/curated/` the cited aliases, overrides,
   organizations, boundary-review decisions, directory-key lock and the artwork inventory, hotspots
   and registry.
2. **Normalise** (`scripts/build-data.ts` → `scripts/lib/pipeline.ts`): parse the OSM XML; assemble
   the boundary from relation 21599790 (the build fails if it does not close); classify every
   footprint as inside, crossing, uncertain or outside (`src/geo`), keeping only the campus
   inventory; record height sources; classify places by the category registry and campus zone
   (off-campus places go to the opt-in `context-places.json`); build the graph (one edge per
   consecutive OSM node pair; ways join only at shared nodes); connect places to the nearest walkable
   node within 60 m; derive relations; add detections as an unverified layer; apply curated records;
   write the quality report. The output is sorted and hashed, so a rebuild is byte-identical, and
   `datasetVersion` is a hash of the files.
3. **Publish**: `public/data/*` plus `docs/DATA_QUALITY_REPORT.md` and
   `docs/CAMPUS_BUILDING_COVERAGE.md`. `scripts/validate-data.ts` re-checks schemas and invariants and
   the count-change guard against the committed dataset, and fails on any error.
4. **Load** (`src/data/loader.ts`): `manifest.json` first (`no-cache`); a different `schemaVersion`
   rejects with `DatasetError('schema-version')` before anything else is fetched. The start-up files
   are fetched as `<file>?v=<datasetVersion>` and validated; context places, detections and the
   boundary review load on demand.
5. **Publication** (`src/app/data/publication.ts`): in parallel, `GET /api/locations` network-first
   with a 3 s start-up timeout; the last good copy is kept in Cache Storage. `applyPublication`
   merges owner overrides, approved locations, Studio models and artwork associations into the same
   records (one id per building). Static hosting answers "unavailable" and the base dataset is used.
6. **Services** (`src/app/data/services.ts`) are built once per load: facility directory, building
   directory (with the artwork layer), search index and router. Measured in
   [PERFORMANCE.md](PERFORMANCE.md).
7. **Store** (`src/app/store`): one Zustand store of ui, selection, map/view, route and nav slices.
   Components subscribe with narrow selectors, so a GPS fix does not re-render the map shell.
8. **Views**: the layouts render panels from the store; `ViewStage` mounts one stage for the current
   view mode — `MapStage` (MapLibre, lazy chunk), `IsoStudioStage` (Canvas2D) or
   `IsometricModeStage` (the illustration). Selection, route and search are shared across modes.

## Key decisions

**Static-first public map, optional backend for owner changes.** The campus changes slowly and the
data is public and small, so the map is static: offline support, no operating cost, no personal
data on a server. Owner corrections, suggestions and Studio models need a moderated write path, so
they live in D1 behind Pages Functions (owner decision, 2026-10-23), published as one versioned
public document that the static app merges. Without the backend the app is still complete.

**Free sources only, Google never a source.** No billing: Photorealistic 3D is shown as unavailable,
satellite imagery is optional (Esri free tier with pay-as-you-go off, or the keyless EOX 2016
backdrop). Google Maps, Earth and Street View are never a data source; the Google Open Buildings
detections in the unverified layer were approved by the owner (see
[GEODATA_SOURCES_AND_LICENSES.md §3](GEODATA_SOURCES_AND_LICENSES.md)).

**Campus only.** Off-campus places exist only in the opt-in "Nearby, outside campus" layer and are
never routing endpoints (`isRoutablePlace`, `routeBlockReason`).

**MapLibre fill-extrusion, plus a guarded WebGL2 layer for owner models, not Three.js.** Buildings
are flat footprints with one height each; `fill-extrusion` draws exactly that in the same context,
camera and picking model as the 2D map. Owner-placed Studio models use a small raw-WebGL2 custom
layer with fill-extrusion as the automatic fallback (decided by the bake-off in
[research/renderer-bakeoff/REPORT.md](research/renderer-bakeoff/REPORT.md)). Three.js stays behind
an adoption gate (GLB import is not enabled). Zoom LOD is implemented in the layers themselves:
extrusions from zoom 14.5, flat fills below, labels from zoom 16, campus filter.

**Basemap from our own GeoJSON.** No tile servers or keys by default. The style is generated in code
(`src/map/style.ts`); glyph PBFs are self-hosted.

**Haversine distances.** Every distance uses haversine (R = 6 371 008.8 m). Over a campus about
1.7 km across it differs from the ellipsoidal distance by under 0.5 %, below GPS and geometry error.

_*A* with an admissible heuristic._* Straight-line distance × 0.999 for "shortest", that distance ÷
the fastest profile speed for "least time"; ties break on f, then g, then node id. Disconnected
components are never bridged (`no-path`).

**Conservative opening hours in IST.** A strict subset of OSM `opening_hours`; anything else is
"unknown" with the raw text. Fixed UTC+05:30. Hours older than 180 days are labelled stale.

**Atomic app and data versioning.** Code, data and glyphs share one Workbox precache with per-file
revisions; a deploy installs in the background and the old worker serves the old, matching set until
the user accepts the update. `sw.js`, `index.html` and `data/manifest.json` are `no-cache`; hashed
`/assets/*` are immutable. API responses are never precached.

**CSP-clean by construction.** `script-src 'self'` with no `unsafe-eval`: the client's Zod is
aliased to the jitless entry in `src/csp`, and `tests/e2e/csp.spec.ts` asserts zero CSP violations on
the public app, the admin sign-in and the signed-in Studio.

**Privacy.** Location is requested only from a user gesture, processed in memory and never stored,
logged, put in a URL or sent. Local storage holds favourites, recents (switchable), privacy settings,
the theme, a session-only correction draft and the owner's Studio crash recovery; the inventory is
in [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md#local-storage-inventory). The server keeps no IP
address (keyed, rotating hashes for rate limits).

**Truthfulness as an invariant.** Unknown values render as unknown; imported records are never
labelled verified; owner models say "Illustrative model placed by the site owner — not verified"
unless sourced; artwork items are "Verified link", "Unconfirmed match" (never routed) or "Not
linked"; block numbers appear only with owner evidence.

**Graceful degradation.** Without WebGL the isometric overview replaces the map modes; without a
canvas or after a fatal map error the list layout keeps search, details, categories and directions.

## Extension points

| Module                                    | State                                      | Prerequisites still missing / where it plugs in                                                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Moderated suggestions and owner edits** | **Built** (D1 + Pages Functions, `/admin`) | Corrections to _existing_ places still reach nobody in the default deploy (`VITE_CORRECTIONS_URL` unset); a `POST /api/contributions/corrections` intake is planned with Creator Mode                                  |
| **Owner-placed buildings**                | **Built** (Building Studio)                | GLB import needs an R2 binding and the Three.js adoption gate                                                                                                                                                          |
| **Indoor navigation**                     | Not started                                | Indoor geometry under a reuse licence and mapped entrances (0 today). The graph already has `indoor`/`steps` flags and `accessed_via` relations; add node `level`, per-level layers and a level-aware heuristic        |
| **Rooms / official block numbers**        | Not started                                | Owner first-hand evidence per block (sign photo or official document). Owner-confirmed aliases go in `data/curated/aliases.json` or the admin; rooms need a `room` kind with `located_in` and `level`                  |
| **Events, shuttle timetable, menus**      | Unavailable sections with official links   | An official feed with dates and venues (events), a published timetable (GTFS ideally), outlet menus with sources (the planned food module). Each gets its own schema, provenance and freshness, never real-time claims |

Rules for any extension: add a schema (in `src/data/schema.ts`, `src/community/schema.ts` or the
module's own schema) and bump its version when existing files change; record provenance; add
validation; add counts to the quality report; keep domain logic in a pure module with its own
`index.ts`; add a D1 migration with a tested down script before the code that needs it.
