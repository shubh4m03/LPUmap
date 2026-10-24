# LPU Campus Atlas

A campus map with search and walking/cycling directions for **Lovely Professional University**
(Phagwara, Punjab, India). It ships as an installable, offline-capable web app (PWA). It is built
only from verifiable open data, mainly [OpenStreetMap](https://www.openstreetmap.org/), plus a short
list of official LPU school and facility names cited from `www.lpu.in`.

The app reports what the data says and no more. An unnamed building is shown as "Unnamed building".
Unknown hours show as unknown. A facility nobody has mapped gets an honest empty state. A route that
the mapped paths cannot support is reported as "no path"; the app does not draw a straight line
instead.

> This is an independent project. It is not an official LPU product and is not endorsed by Lovely
> Professional University. Confirm anything important with the university.

## Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Quick start](#quick-start)
- [Testing](#testing)
- [Campus data](#campus-data)
- [Licensing of data](#licensing-of-data)
- [Environment variables](#environment-variables)
- [Admin setup](#admin-setup)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [Project layout](#project-layout)
- [Documentation](#documentation)
- [Credits](#credits)

## Features

Everything below exists in the current code. Features that depend on data LPU does not publish are
listed under [Known limitations](#known-limitations).

**Map**

- A MapLibre GL map drawn from the project's own GeoJSON: campus boundary, roads, paths, green
  areas, water and building footprints. By default there are no third-party tiles and no API key;
  satellite imagery is optional (see [Map providers](#map-providers-free-sources-only)). The map
  glyphs (Noto Sans) are self-hosted.
- Five view modes in one "View mode" switcher in the map controls (or the `?view=` deep link):
  **Satellite map** (`satellite`), **Photorealistic 3D** (`earth`, always unavailable, see below),
  **3D map** (`3d`: our buildings and owner-placed models, on satellite imagery when it is
  configured), **Isometric overview** (`iso`: a Canvas2D drawing that needs no WebGL) and **2D map**
  (`2d`). Selection, search, saved places and the planned route are shared: switching keeps the
  selected building and opens on the same ground point. The app starts in 3D on screens 768 px and
  wider and in 2D on phones. A mode that cannot be used stays visible with its reason (a toast and
  an announcement when chosen), never hidden and never faked: Satellite without a configured free
  source, Photorealistic 3D always, the overview during live navigation. Live location and
  navigation use a map mode; starting either from the overview switches to the last map mode and
  announces it. A deep link to an
  unavailable mode is ignored and dropped from the URL. A "Back to campus" button appears whenever
  the campus is off screen.
- The 3D legend separates the height sources: measured heights (`height` tag, none in the current
  snapshot), heights estimated from `building:levels`, placeholder heights, and owner-placed models.
- Layer groups (academic, residences, food, study, health, ATMs, sports, transport and others), a
  label toggle, and a building-height legend.
- Without WebGL the isometric overview replaces the map (the map modes say why they are
  unavailable). Only when the browser cannot draw a canvas either, or the map fails, does the
  list-based layout take over; search, details, categories and directions still work there.
- Two opt-in layers in "Map layers", both off by default: **Nearby, outside campus** (places just
  outside the boundary, always marked "Outside campus", searchable only while the layer is on, never
  counted as campus places) and **Unverified detected footprints** (machine-detected outlines, drawn
  flat and dashed, never part of the campus building list).
- A **Building directory** (menu → Building directory, or <kbd>D</kbd> in the overview): the accessible
  list of every drawn building with its map key, searchable and filterable by category, shared by
  all three modes.

**Search and places**

- One search over places, categories, map layers and app commands, opened with <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> or <kbd>/</kbd>.
  Ranking is deterministic: exact name or alias, then code, prefix, word, all words, category synonym,
  and finally fuzzy matches for typos. Matched text is highlighted.
- Category panels. When your location is known, places are ordered by walking-route distance, and a
  place with no route is labelled "straight-line".
- Place details: category, on- or off-campus zone, opening hours evaluated in IST (shown as unknown
  when absent, or with a freshness warning when old), provenance (source, retrieval date,
  verification status), related places, and actions (directions, save, share, report a correction).
- Deep links: `?place=<id>` opens a place (base ids, published owner locations and owner-placed
  buildings), and `?view=3d|iso|2d` picks the mode. Ids are validated before use.
- Unnamed buildings with a map key are searchable by that key (for example `D4-01`).
- A "Campus information" panel. It lists official LPU schools and facilities, which have no map
  position, and explains which student services (mess menus, transport timetable, events, faculty
  directory) have no public source.

**Directions and navigation**

- Walking, cycling and step-free profiles, with a "shortest" or "least time" preference and up to
  two genuinely different alternatives. Each route has turn-by-turn steps and caveats: steps on the
  route, pushing a bike, a long off-network connector, unnamed paths, and "accessibility unverified".
- Start and end points can be chosen by search, by tapping the map, or from "My location". A place
  that is not connected to the mapped paths cannot be a route endpoint (it is never snapped to the
  nearest path): tapping it while choosing on the map says so and keeps picking on, its details
  offer "Choose a nearby point on the map", and a failed route offers "Choose start/destination on
  map". The chosen point is labelled as a picked point, never as the place.
- Live navigation from device GPS: remaining distance and time, off-route detection, and arrival.
  Low-accuracy, stale and implausible fixes are filtered out. The map follows your position until
  you pan it, and "Follow" resumes it. When you are off route, "Recalculate from here" plans a new
  route from your latest fix; it is never re-planned silently.
- "Track my walk" records distance, elapsed time and average speed from accepted fixes. Nothing is
  saved.

**Platform**

- Saved places (favourites) and recent places, both stored only in this browser. Recent history can
  be turned off.
- Light, dark or system theme. Reduced-motion support.
- A correction report. It produces plain text that you can copy, download, or open as a prefilled
  issue when `VITE_CORRECTIONS_URL` is configured.
- Settings and privacy panel with "Clear all local data".
- An About panel with data sources, licences, dataset version and a data-quality summary.
- Offline use after one online visit. App and data are precached together and updated together, and
  an update prompt never reloads the page without asking.

**Owner updates**

- When the site runs with its Cloudflare Pages Functions, the app fetches the owner's publication
  (`GET /api/locations`) next to the dataset: owner corrections, approved locations and buildings
  placed in the Building Studio. They are merged into the same places, buildings, directory and
  search in every view mode, with one id per building. An owner-placed building is always labelled
  as such ("Illustrative model placed by the site owner — not verified" unless it carries a cited
  source or a survey); drafts and archived records are never published.
- The publication is fetched network-first with a 3 s start-up timeout; the last good copy is kept in
  the browser for offline or slow starts, and About & data sources says when it was last updated or
  why only the base dataset is shown. On a host without the API (static hosting) the base dataset is
  used and the app shows no error. Hosts with a single-page fallback answer quietly; a host that
  answers 404 instead leaves one network line in the browser console, which the app cannot suppress.

- **Suggest a missing place** (menu, or a place's details): place a point on the map (click or
  drag on desktop, a centre pin on phones, or "Use the map centre" from the keyboard), then give a
  name, category and optional description, landmark and evidence link. It is sent to the owner's
  moderation queue; "Submitted for review" appears only after the server confirms it, and nothing is
  ever published without the owner's approval. Rate limits, an unsupported host and unknown
  outcomes each get their own honest message.

**Owner tools (`/admin`)**

Only the site owner can open them (Cloudflare Access or a password session, see
[Admin setup](#admin-setup)). The admin is a separate lazily loaded chunk: no admin code or text is
in the public bundle.

- **Moderation queue** with pending, needs-information, approved, rejected and duplicate tabs,
  suggestion detail with the server's duplicate candidates, and the actions the server allows.
  Approving creates a location; an access point is chosen explicitly from validated path nodes (or
  none).
- **Locations** editor on the map (add, edit, move, hide, restore, delete with a typed
  confirmation), **base-place overrides** (rename, recategorise, hide, orphans with their reason),
  **History** (field-level audit with revert) and **Quality** warnings.
- **Building Studio** (`/admin/studio`): place, move, rotate and resize template buildings on the
  map (desktop handles and numeric fields; on phones a centre reticle, step buttons and a bottom
  sheet), edit identity, size, floors, roof and appearance, run the server's checks, acknowledge
  warnings with a reason, save drafts and publish with a change summary. Unsaved, saved-draft,
  published and archived states are always shown; crash recovery is kept in this browser and cleared
  on sign-out. Archive, restore, duplicate and typed-confirmation delete are available, and existing
  base buildings can be modelled through studio records. **Templates** (`/admin/templates`) manages
  owner templates, versions and retirement. Published models are labelled "Illustrative model placed
  by the site owner — not verified" unless they carry a cited source or survey.

There is no account for visitors and no analytics. **The app makes no third-party request** unless
`VITE_ARCGIS_API_KEY` (Esri World Imagery) or `VITE_EOX_BACKDROP` (EOX Sentinel-2 backdrop) is set at
build time (see [Map providers](#map-providers-free-sources-only)). Map data, glyphs, icons and the
community layer all come from the site itself. The Content Security Policy in `public/_headers`
enforces this: `connect-src` allows only the site and those two imagery hosts, and images, fonts and
scripts may come only from the site. Links to OpenStreetMap or a source page are only followed when you
open them.

## Screenshots

No screenshots are committed to the repository yet. Run the app locally (below) to see it.

## Quick start

**Prerequisites:** Node.js **24 or newer** (the data scripts use Node's built-in TypeScript type
stripping; `.nvmrc` says `24`) and npm. Git is needed to clone the repository. The end-to-end tests
also need Playwright's Chromium (see [Testing](#testing)).

```sh
git clone <repository-url> lpu-campus-atlas
cd lpu-campus-atlas
npm ci                 # installs the exact versions in package-lock.json
npm run dev            # http://localhost:5173
```

The committed `public/data/` dataset is used as is. You do not need network access to OSM or LPU to
build or run the app.

Build and preview the production bundle (the service worker is registered only in production
builds):

```sh
npm run build          # data:check, then tsc --noEmit, then vite build → dist/
npm run preview        # http://localhost:4173 (strict port)
```

## Testing

| Command                    | What it runs                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                 | All Vitest suites (unit + integration) in jsdom                                                                                                |
| `npm run test:unit`        | `tests/unit` only                                                                                                                              |
| `npm run test:integration` | `tests/integration` only (data pipeline on a synthetic snapshot and on the real committed snapshot)                                            |
| `npm run test:e2e`         | Playwright against `vite preview` on port 4173 plus a local real-handler backend, in five viewports (needs a prior `vite build`)               |
| `npm run test:server`      | Server suites (`vitest.server.config.ts`): handlers, domain, auth, studio and red-team tests on a local in-memory D1                           |
| `npm run test:a11y`        | Only the Playwright specs tagged `@a11y` (axe checks)                                                                                          |
| `npm run smoke`            | `scripts/smoke.ts`: checks the built `dist/` (HTML shell, web manifest, service worker, shipped dataset, a real search and route, secret scan) |
| `npm run check`            | The full gate: `format:check` → `lint` → `typecheck` → `test` → `data:check` → `vite build` → `smoke` → `test:e2e`                             |
| `npm run typecheck`        | `tsc --noEmit`                                                                                                                                 |
| `npm run lint`             | `eslint . --max-warnings=0`                                                                                                                    |
| `npm run format:check`     | `prettier --check .`                                                                                                                           |

CI (`.github/workflows/ci.yml`) runs the same gates on every push and pull request. It also checks
that rebuilding the data leaves `public/data` unchanged, and audits production dependencies.

First-time setup for end-to-end tests:

```sh
npx playwright install chromium
```

Load the app with `?e2e=1` to expose read-only test hooks: `window.__ATLAS_MAP__` (camera,
selection, route, layer and Realistic-3D state) and, in the overview, `window.__ATLAS_ISO__`. They
never report user coordinates. See [docs/QA_STRATEGY.md](docs/QA_STRATEGY.md).

The e2e suite never talks to a live or remote backend. The admin, suggestion and Building Studio
specs run the **real** server handlers locally (`tests/e2e/backend/server.ts`) over a fresh
in-memory D1 with `migrations/*.sql` applied, in password mode with a throwaway password generated
per run. Set `E2E_DIST=<dir>` to serve a build from another directory (both servers), so a test run
never has to rebuild `dist/`. Other specs that need owner data enable the
`syntheticPublication` option (`tests/e2e/fixtures/publication.ts`), which serves a clearly synthetic
publication ("E2E fixture hall (synthetic)", a synthetic canteen, leaked draft/archived records that
must never appear) through route interception; it is never shipped. Set `PW_PORT` to run the
preview server on another port when 4173 is taken.

## Campus data

All map content comes from `data/` and is turned into `public/data/` by a deterministic offline
build. The full rules are in [data/README.md](data/README.md) and
[docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

| Command                     | Network? | What it does                                                                                                                                                                             |
| --------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run data:build`        | No       | Raw OSM snapshot + curated files → `public/data/*` and `docs/DATA_QUALITY_REPORT.md`. Repeated builds produce byte-identical output                                                      |
| `npm run data:validate`     | No       | Zod schemas + invariants. Exits 1 on any error                                                                                                                                           |
| `npm run data:check`        | No       | Both of the above (also the first step of `npm run build`)                                                                                                                               |
| `npm run data:fetch`        | Yes      | Refreshes `data/raw/osm/`. Tries Overpass (two endpoints, with retries), then falls back to the OSM API 0.6. Does nothing if a snapshot already exists; add `-- --force` to refresh it   |
| `npm run data:fetch-public` | Yes      | Re-extracts the official school and facility names into `data/curated/organizations.json`. Obeys `robots.txt` and waits 2 s between requests. Supports `-- --dry-run` and `-- --offline` |

Offline builds always work from the **committed snapshot**: `data/raw/osm/campus-bbox.osm` and
`boundary-relation-21599790.osm`, retrieved 2026-10-23 through the OSM API because Overpass was
unreachable from the retrieving machine. To refresh:

```sh
export DATA_FETCH_CONTACT="you@example.org"   # or a URL; sent in the User-Agent
npm run data:fetch -- --force
npm run data:check
# review docs/DATA_QUALITY_REPORT.md and the count-change warnings, then commit raw + generated files together
```

The same refresh can be run on GitHub as the manual "Data refresh" workflow
(`.github/workflows/data-refresh.yml`). It uploads the diff for review and never commits.

## Licensing of data

- **Code** is MIT-licensed (see [LICENSE](LICENSE)).
- **Map data** is © OpenStreetMap contributors, under the
  [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). `public/data/*` is a
  derived database: it must keep the attribution "© OpenStreetMap contributors" wherever the map or
  data is shown, and if you distribute the derived database publicly you must offer it under the
  ODbL (share-alike). The app shows this attribution on the map and in the About panel.
- **LPU content** belongs to LPU. Its website terms allow personal, non-commercial use only. The
  project stores only short factual identifiers (official names, page URLs and page titles as
  citations) and never redistributes LPU prose, images or logos. Fetched HTML is cached only in the
  git-ignored `data/.cache/`.
- **Map glyphs** are generated from Noto Sans, under the SIL Open Font License 1.1
  (`public/fonts/LICENSE.txt`).

## Environment variables

See `.env.example`. **None is a secret**, and nothing needs to be set to build or run the app.
`VITE_*` values are embedded in the browser bundle at build time, so a secret must never go in one.

| Variable               | Used by                                                | Effect                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_CORRECTIONS_URL` | `src/feedback/report.ts`                               | An `https://` URL, such as a GitHub "new issue" URL. When set, the correction dialog offers "Open prefilled report". When empty or not https, reports can only be copied or downloaded |
| `VITE_PUBLIC_SITE_URL` | Declared in `.env.example`                             | Reserved for canonical and Open Graph metadata. **The current code does not read it**, so setting it has no effect yet                                                                 |
| `DATA_FETCH_CONTACT`   | `scripts/fetch-osm.ts`, `scripts/fetch-public-data.ts` | A contact e-mail or URL, sent in the data scripts' User-Agent as the OSM and Overpass usage policies ask. Required for live runs of `data:fetch-public`. Never shipped to the browser  |
| `VITE_ARCGIS_API_KEY`  | `src/map/providers/`                                   | Optional free-tier ArcGIS key for Esri World Imagery. **Public once built**; put it only in `.env.local` (git-ignored) or the host's build settings, never in git. See below           |
| `VITE_EOX_BACKDROP`    | `src/map/providers/`                                   | `true` adds the keyless EOX Sentinel-2 2016 backdrop (10 m, Satellite map only, when no Esri key is set). Empty = off                                                                  |

The owner features need server-side settings (`AUTH_MODE` and friends) that are **not** `VITE_`
variables and never reach the browser; see [Admin setup](#admin-setup).

### Map providers (free sources only)

**Owner decision (2026-10-24): no billing.** Google Map Tiles (2D satellite and Photorealistic 3D
Tiles) need a Google Cloud billing account, so they are **not implemented**. The Photorealistic 3D
option is always shown as unavailable with the reason (no billing-free provider; Google's 3D
coverage at LPU is unverified and likely absent); it is never imitated with our own blocks. Google
Maps, Earth and Street View are never a data source.

- **Nothing set (default):** no third-party request; "Satellite map" says "Not configured".
- **`VITE_ARCGIS_API_KEY`:** Esri World Imagery in Satellite map and under the 3D map. Create the key
  in ArcGIS Location Platform with pay-as-you-go **off** (access stops at the free limit, no bill),
  the Basemaps privilege only and referrer restrictions to your site. With a key the desktop start
  view (3D map) contacts Esri at start-up. The capture date is shown only as Esri's published
  metadata ("Imagery captured 2023-12-18 according to Esri World Imagery Wayback metadata (retrieved
  2026-10-24)") and only over the area where it was checked; imagery is never called live.
- **`VITE_EOX_BACKDROP=true`:** a keyless 10 m Sentinel-2 2016 backdrop for Satellite map only,
  zoom-capped, with "10 m imagery — buildings not visible".
- Attribution is always visible while imagery is drawn. Imagery tiles are never precached or cached
  offline. A missing or refused key, an exhausted free tier or a network failure falls back to the
  campus map with an explanation; there is never a blank screen.

Details: [docs/MAP_PROVIDER_CONFIGURATION.md](docs/MAP_PROVIDER_CONFIGURATION.md); licences:
[docs/GEODATA_SOURCES_AND_LICENSES.md §17](docs/GEODATA_SOURCES_AND_LICENSES.md#17-runtime-basemaps-and-elevation-free-sources-only).

## Admin setup

The owner tools run on Cloudflare Pages Functions (`functions/`, over `server/`) with a D1
database. The public map does not need them. The full runbook is
[docs/ADMIN_OPERATIONS.md](docs/ADMIN_OPERATIONS.md); in short:

1. `npx wrangler d1 create lpu-atlas`, put the id in `wrangler.toml`, then apply
   `migrations/0001_initial.sql` and `0002_building_studio.sql` with
   `npx wrangler d1 migrations apply lpu-atlas --remote` (`npm run db:migrate:local` for local
   development). Rollback is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#d1-migrations-rollback).
2. Choose **one** `AUTH_MODE`. Without it every `/api/admin/**` endpoint answers 503 (fail closed).
   - `access` (recommended): a Cloudflare Access application over `/admin*` and `/api/admin/*`, plus
     `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and `OWNER_EMAILS`.
   - `password`: `npm run admin:hash-password`, then store the printed hash as the
     `OWNER_PASSWORD_HASH` secret (`npx wrangler pages secret put OWNER_PASSWORD_HASH`). Add a
     `RATE_LIMIT_KEY` secret of at least 32 random characters.
3. Check `https://<host>/api/health` → `{"ok":true,"db":"ok","auth":"access"}` (or `"password"`),
   then open `https://<host>/admin`.

Locally: copy `.dev.vars.example` to `.dev.vars` (git-ignored), fill it, run
`npm run db:migrate:local`, `npm run build` and `npx wrangler pages dev dist`. Secrets never go in
git, `wrangler.toml` or a `VITE_` variable.

**Using the Building Studio.** Open `/admin/studio` and sign in. Pick a template in the asset browser
(search, categories, preview), place it by clicking the map, dragging or typing coordinates, then
move, rotate or resize it with the handles or the numeric fields. The inspector edits identity,
dimensions and floors, roof and appearance; the checks panel shows boundary, overlap and path
problems with their reasons. "Save draft" keeps it on the server (and in local crash recovery until
saved); "Publish" shows the change summary and every unresolved warning, which needs an
acknowledgement with a reason. Published models appear in the 3D map, the isometric overview, search
and the directory, always labelled as owner-placed. Archive hides a model and can be undone; delete
needs the typed id.

**Where to read more (owner tools):**

| Topic                                                                           | Document                                                                                                                                  |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| First-time setup, sign-in modes, moderation, recovery, credentials, privacy     | [docs/ADMIN_OPERATIONS.md](docs/ADMIN_OPERATIONS.md) (§1 setup, §2 moderation, §6 recovery, §7 credentials, §8 rate limits and IP hashes) |
| Hosting, headers, D1 migrations and rollback                                    | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)                                                                                                  |
| Building Studio: records, templates, validation, publishing, text rules         | [docs/BUILDING_STUDIO_DESIGN.md](docs/BUILDING_STUDIO_DESIGN.md)                                                                          |
| Suggestions, moderation, honeypot, merge rules (off-campus places never routed) | [docs/COMMUNITY_MODULE_CONTRACTS.md](docs/COMMUNITY_MODULE_CONTRACTS.md)                                                                  |
| Optional imagery keys and what each one contacts                                | [docs/MAP_PROVIDER_CONFIGURATION.md](docs/MAP_PROVIDER_CONFIGURATION.md)                                                                  |
| Security and privacy model                                                      | [docs/SECURITY_AND_PRIVACY.md](docs/SECURITY_AND_PRIVACY.md)                                                                              |
| What is built, tested and still open                                            | [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md)                                                                            |

## Deployment

The app is a static site: `dist/` after `npm run build`. The reference host is **Cloudflare Pages**:

- build command `npm run build`
- output directory `dist`
- `NODE_VERSION=24`

`public/_headers` sets the Content Security Policy, the security headers and the cache rules.
Settings, update behaviour, rollback and other hosts are covered in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). The owner tools additionally need the Pages Functions, the
D1 binding `DB` with migrations 0001 and 0002 applied, and `AUTH_MODE` (see
[Admin setup](#admin-setup)); without them the site runs as a static map.

## Troubleshooting

| Symptom                                                                    | Cause and fix                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Your browser could not start the map (WebGL unavailable)" and a list view | MapLibre 6 needs **WebGL2**. The browser or GPU has it disabled (common in remote desktops, some VMs and locked-down browsers), or the WebGL context was lost. Search, details, categories and directions keep working in list mode. Enable hardware acceleration or try another browser                                                                                                                                |
| `Port 5173 is in use` / `Port 4173 is in use`                              | `npm run preview` uses `--strictPort` on 4173 because Playwright expects it. Stop the other process. For the dev server you can run `npx vite --port 5174`                                                                                                                                                                                                                                                              |
| Playwright: `Executable doesn't exist`                                     | Run `npx playwright install chromium` once                                                                                                                                                                                                                                                                                                                                                                              |
| Old version still shows after a deploy, or after `npm run preview`         | The service worker serves the precached version until you accept the update prompt. Reload once and choose "Update now" in the banner, or in DevTools → Application → Service workers click "Unregister" and then "Clear site data". Dev builds (`npm run dev`) never register a worker; the preview origin (`localhost:4173`) keeps its worker between preview runs, so an old build can appear there until you update |
| `data:validate` fails after editing a curated file                         | The error names the file and the record. Common causes: an `anchor.target` or alias `target` that is not an id in the snapshot, a missing `source`, or an override without a `check` field                                                                                                                                                                                                                              |
| `data:fetch-public` says "Set DATA_FETCH_CONTACT"                          | Set it as shown above. `-- --offline` re-extracts from the local cache without network access                                                                                                                                                                                                                                                                                                                           |
| Build fails in Workbox with a file-size error                              | A precached file is larger than 8 MB. This failure is intentional (see `src/offline/README.md`)                                                                                                                                                                                                                                                                                                                         |

## Known limitations

These come from [docs/DATA_QUALITY_REPORT.md](docs/DATA_QUALITY_REPORT.md) (dataset `b628c5855b1d`,
from the OSM snapshot of 2026-10-23) and from the module reviews. The module docs under
[docs/modules/](docs/modules/) give the detail.

- **Sparse naming.** 499 of 535 building footprints are unnamed (134 of them on campus). Campus
  block numbers ("Block 34") are not in OpenStreetMap and no official source gives their positions,
  so blocks cannot be searched for by number.
- **Unlocated official records.** The 32 official schools and facilities (for example the Central
  Library, which the official page says is in "Block-37", and the Uni Health Centre) are searchable
  but have no map position. Only "School of Design" is anchored, to an OSM building with the same
  name; human confirmation of that anchor is still recommended.
- **Empty or sparse categories.** No drinking water, washroom or printing points are mapped. Health,
  ATM and bank, library, gate and hostel each have fewer than 3 on-campus records.
- **Building heights.** No building has a measured height. 137 heights are estimated from floor
  counts (3.2 m per level) and 398 are placeholders (6 m), shown in a lighter tone.
- **Routing coverage.** The walking graph has 9 disconnected components; the largest holds 92.2 % of
  nodes. 34 located places are more than 60 m from any walkable node and cannot be routed to. The
  app never draws a made-up connection. Untagged trunk roads (NH44) are excluded from routing. The
  router snaps to the nearest graph node, not the nearest point on an edge.
- **Step-free routing** can only avoid mapped steps and `wheelchair=no` ways. There are no
  wheelchair tags on campus paths and no mapped entrances (0 entrance nodes), so step-free routes
  always carry an "accessibility unverified" caveat.
- **Opening hours.** Almost no places have hours. Only a conservative subset of the OSM
  `opening_hours` syntax is evaluated; anything else (public holidays, months, sunrise) shows as
  "not in a format we can interpret", with the raw value.
- **No data for:** mess menus, a shuttle or bus timetable, an events feed, faculty offices,
  indoor maps or rooms. No public source was found (see [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)),
  so these show as unavailable rather than invented.
- **Imported, not verified.** Every record is `imported`. No physical survey has been done.
- **GPS behaviour has been tested only with simulated positions** (jsdom and Playwright). The
  real-device checks still open are listed in [docs/QA_STRATEGY.md](docs/QA_STRATEGY.md#what-needs-human-or-on-device-verification).
- **Glyph coverage** is Latin only. Characters such as Gurmukhi or Devanagari in an OSM name render
  blank on the map labels. Panels and search results use the system font stack, so they show whatever the device's fonts support.

## Project layout

```text
data/            raw OSM snapshot, curated sourced records, JSON schemas (see data/README.md)
docs/            architecture, plans, data sources, QA, security, deployment, performance, module docs
public/          static files: _headers, generated data/, self-hosted fonts/, icons/
functions/       Cloudflare Pages Functions (thin entry points over server/)
server/          API handlers, domain logic (community, Building Studio, publication), auth, D1 access
migrations/      D1 migrations 0001 (community) and 0002 (Building Studio); rollback in docs/db/
scripts/         Node 24 TypeScript CLIs: fetch-osm, fetch-public-data, build-data, validate-data, smoke, generate-icons
  lib/           pipeline stages (parse, geometry, buildings, places, graph, relations, quality, validate)
src/
  config/        APP_CONFIG (speeds, thresholds, budgets) and the category registry
  data/          Zod schemas (shared with scripts) and the dataset loader
  distance/      haversine, polylines, grid spatial index, formatting
  routing/       A* router, profiles, steps, alternatives
  geolocation/   GPS watcher, sample filter, React hook
  navigation/    route progress and walk tracking
  search/        search index, normalisation, ranking, highlighting
  facilities/    directory, opening hours, nearest, relation checks
  map/           MapView (MapLibre), style, layers, controller, e2e hook; providers/ (free imagery), editing/ (map-editing contract)
  isometric/     Canvas2D isometric overview
  building-studio/  studio schema, mesh generator, validation, history, editor state, studio UI store
  community/     publication and contribution schemas shared with the server
  admin/         the lazily loaded /admin app: API client, session gate, sections, Building Studio UI
  buildings3d/   fill-extrusion layers, 2D/3D mode, WebGL2 probe
  favorites/ privacy/ feedback/ offline/   platform modules
  accessibility/ live region, focus trap, theme, media queries
  components/    design-system primitives (ui/), icons and feature UIs
  app/           App, data provider, Zustand store slices, hooks, commands, deep links
  styles/        design tokens (tokens.css) and the Tailwind 4 entry (index.css)
  utils/         safe-url (link sanitising), storage (validated localStorage)
tests/
  unit/          Vitest suites, one folder per module or UI area
  integration/   data pipeline end-to-end (synthetic and real snapshot)
  fixtures/      synthetic-* OSM and graph fixtures
  server/        server suites on a local in-memory D1 (vitest.server.config.ts)
  e2e/           Playwright specs; backend/ runs the real handlers locally for admin, suggest and studio specs
```

## Documentation

| Document                                                                     | Topic                                                                                   |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                                 | System diagram, module boundaries, data flow, key decisions, extension points           |
| [docs/MODULE_CONTRACTS.md](docs/MODULE_CONTRACTS.md)                         | Public interface of every module                                                        |
| [docs/modules/](docs/modules/)                                               | One page per module: purpose, interface, invariants, tests, limitations                 |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)                   | The staged plan that was followed, with acceptance criteria                             |
| [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)                                 | Every source, its licence and status, and what was looked for but not found             |
| [docs/DATA_QUALITY_REPORT.md](docs/DATA_QUALITY_REPORT.md)                   | Generated by `data:build`: counts, gaps, survey priorities                              |
| [docs/research/LPU_PUBLIC_SOURCES.md](docs/research/LPU_PUBLIC_SOURCES.md)   | Every LPU page examined, `robots.txt` and terms findings                                |
| [docs/QA_STRATEGY.md](docs/QA_STRATEGY.md)                                   | Test pyramid, browser matrix, workflows, accessibility, CI stages                       |
| [docs/SECURITY_AND_PRIVACY.md](docs/SECURITY_AND_PRIVACY.md)                 | Threat model, CSP, storage inventory, location privacy, supply chain, incident record   |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)                                     | Cloudflare Pages, headers, service-worker updates, rollback, D1 migrations, other hosts |
| [docs/ADMIN_OPERATIONS.md](docs/ADMIN_OPERATIONS.md)                         | Owner runbook: auth setup, moderation, backups, recovery, credentials, incidents        |
| [docs/COMMUNITY_MODULE_CONTRACTS.md](docs/COMMUNITY_MODULE_CONTRACTS.md)     | Suggestions, moderation, locations, overrides, audit: API and data contracts            |
| [docs/BUILDING_STUDIO_DESIGN.md](docs/BUILDING_STUDIO_DESIGN.md)             | Building Studio design: schema, validation, publication, rollback                       |
| [docs/ISOMETRIC_AND_3D_DESIGN.md](docs/ISOMETRIC_AND_3D_DESIGN.md)           | Isometric overview, realistic 3D and view modes                                         |
| [docs/MAP_PROVIDER_CONFIGURATION.md](docs/MAP_PROVIDER_CONFIGURATION.md)     | The five view modes, free imagery providers, fallbacks, CSP and privacy                 |
| [docs/GEODATA_SOURCES_AND_LICENSES.md](docs/GEODATA_SOURCES_AND_LICENSES.md) | Licences of every geodata and imagery source, including what is not used (Google)       |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md)                                   | Budgets and measured search, route, load and bundle numbers                             |
| [docs/PROJECT_ASSESSMENT.md](docs/PROJECT_ASSESSMENT.md)                     | Starting state and data reachability                                                    |
| [data/README.md](data/README.md)                                             | Pipeline rules and curated-file formats                                                 |
| [src/offline/README.md](src/offline/README.md)                               | Offline and PWA strategy                                                                |
| [CONTRIBUTING.md](CONTRIBUTING.md)                                           | Coding standards, data-contribution rules, PR checklist                                 |

## Credits

- Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL 1.0.
- Official school and facility names cited from [www.lpu.in](https://www.lpu.in/). Wikidata
  (CC0) was consulted for basic facts.
- Rendering by [MapLibre GL JS](https://maplibre.org/); glyphs from Noto Sans (SIL OFL 1.1).
- Engineering inspiration only: the MIT-licensed IIT Kanpur campus map
  ([github.com/ni5arga/iitk](https://github.com/ni5arga/iitk)). Its ideas of a static data pipeline,
  unified search, graph routing, provenance and smoke checks informed this design. No IIT Kanpur
  code, data or branding is used.
