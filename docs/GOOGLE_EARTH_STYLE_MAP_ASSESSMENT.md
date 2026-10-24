# Google Earth-style map: assessment and recommended architecture

**Status:** research and design (phases 1–2), superseded in part by the owner decision of 2026-10-24 (no billing) — see the final section, "Owner decision 2026-10-24: no billing", for what was implemented. **Date:** 2026-10-24.
**Scope:** the owner's request for a map that looks and moves like Google Earth (real satellite imagery,
photorealistic 3D, smooth camera) with three modes (Satellite 2D, Photorealistic Earth 3D, Editable Campus 3D)
plus the existing isometric overview.

Companion documents:

- [`IMAGERY_COVERAGE_AND_FRESHNESS.md`](IMAGERY_COVERAGE_AND_FRESHNESS.md): what is known about coverage and dates at
  LPU, the verification procedure, and the UI wording rules.
- [`MAP_PROVIDER_CONFIGURATION.md`](MAP_PROVIDER_CONFIGURATION.md): Google Cloud setup, key restrictions, env vars,
  quotas, budgets and fallback configuration (all **planned**).

Related existing documents: `docs/ISOMETRIC_AND_3D_DESIGN.md`, `docs/BUILDING_STUDIO_DESIGN.md`,
`docs/GEODATA_SOURCES_AND_LICENSES.md`, `docs/SECURITY_AND_PRIVACY.md`. This document does not change them. The
implementation workflow will update `GEODATA_SOURCES_AND_LICENSES.md` and `IMPLEMENTATION_STATUS.md`.

## How to read this document

Every claim carries one of these labels:

| Label            | Meaning                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **[DOC]**        | An official source says it. The quote, URL and retrieval date are given (all retrievals 2026-10-24 unless stated).                    |
| **[MEASURED]**   | A command or build we ran. The command or log is named.                                                                               |
| **[CODE]**       | Read directly from this repository. Line numbers are from the 2026-10-24 snapshot and may drift while `src/**` is being edited.       |
| **[SRC]**        | Read in a third-party package's source, installed in a scratch directory outside this repo (versions in §5).                          |
| **[INFERRED]**   | Our reading or reasoning. Not stated by any source. Needs owner, legal or Google confirmation where it matters.                       |
| **[UNVERIFIED]** | Cannot be checked without a Google API key, a billing account or a written answer from a vendor. The verification procedure is given. |

No Google API was called during this research. No key exists. No Google imagery, tiles or Google Earth content
was downloaded, scraped or used to derive data. Raw research notes (page captures, measurement logs, scripts) are
in the session scratchpad and are not part of the repo.

---

## 0. Decision brief

1. **Why the map looks nothing like Google Earth.** The map has **no imagery, no terrain and no photogrammetry
   source at all**. It paints six local GeoJSON sources in flat colours, and its 131 buildings are single-colour
   prisms with estimated heights and flat roofs (§1). No styling change can make it photorealistic. An imagery
   source (and, for 3D, a textured mesh) is required.
2. **Google Photorealistic 3D Tiles probably do not show buildings at LPU.** On Google's coverage table, India's
   "Map Tiles 2D / 3D" cell is a single `⬤`, while 55 countries show `⬤ / ⬤`; India's "Maps JavaScript 3D" cell is
   `—` [DOC + MEASURED parse, §3.2]. Google says "3D terrain data is available worldwide. 3D surface data is
   limited to the areas highlighted in blue" [DOC]. So the "Photorealistic Earth 3D" mode at LPU will most likely
   be **satellite imagery draped on terrain, with no 3D buildings** [INFERRED]. This is [UNVERIFIED] until one
   check is run with a key (procedure in `IMAGERY_COVERAGE_AND_FRESHNESS.md` §4).
3. **Google costs (list prices, USD).** [DOC]
   - 2D Map Tiles: 100,000 free tiles/month, then $0.60 per 1,000 (global list); or 700,000 free, then $0.18 per
     1,000 (India list, for eligible India-billed accounts).
   - Photorealistic 3D Tiles: 1,000 free/month, then $6.00 per 1,000 (global); or 7,000 free, then $3.30 per 1,000
     (India).
   - **The 3D billable unit is unclear** (per root request or per returned tile). The difference is orders of
     magnitude [UNVERIFIED, §3.3].
4. **Google's terms shape the design.** [DOC] No caching or offline use; no creating content from Google imagery
   (so Building Studio must never edit over Google layers); no use "with or near a non-Google Map" (so Google
   modes must not show our OSM basemap); separate attribution for our own overlays; advance notice and revocable
   consent before the user's location is combined with Google content (ToS 4.4(c)(iii)). Whether a campus
   directory over Google imagery is a "listings or directory service" (ToS 3.2.3(d)(iii)) is an open legal
   question (§4).
5. **Recommended architecture** [INFERRED]: a provider layer in `src/map/providers/` behind the existing
   `MapController` camera contract. **One engine (MapLibre) for every map mode.**
   - Satellite 2D = Google 2D satellite tiles as a MapLibre `raster` source, with our overlays on top.
   - Photorealistic Earth 3D = deck.gl `Tile3DLayer` inside MapLibre through `@deck.gl/maplibre`
     `MapLibreOverlay`, loaded lazily (**+386.0 KiB gzip** re-measured, against **+1006.3 KiB gzip** for CesiumJS;
     an earlier figure of 142.5 KiB was wrong because the bundler had removed `Tile3DLayer`, see §5).
   - Editable Campus 3D = the existing own-data realistic 3D mode plus Building Studio, never mixed with Google
     content.
   - Isometric stays its own Canvas2D renderer and never shows third-party content.
   - Fallback: Earth 3D → Satellite 2D → own-data 3D → own-data 2D → list mode.
6. **Owner decisions needed** (§8): reverse the "no paid APIs or keys" rule for opt-in modes; billing account and
   India pricing; who owns the key and the budget; accept a new renderer dependency (deck.gl, MIT); accept that
   Earth 3D at LPU may be terrain-only; the legal reading of the "non-Google map" clause; whether a cheaper
   non-Google imagery fallback (Esri) is wanted.

---

## 1. Findings: why the map looks unlike Google Earth

All [CODE] unless marked. Line numbers are from the 2026-10-24 snapshot.

| #   | Finding                                                                                                                                                                                                                                                  | Evidence                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **No imagery, raster, vector-tile or DEM source.** The style has exactly six local `geojson` sources (boundary, basemap, buildings, places, route, user-location) plus self-hosted glyphs. A unit test enforces "no tiles, no remote URLs, no API keys". | `src/map/style.ts:62-69`; `tests/unit/map/style.test.ts:62-71`                                                                                |
| F2  | **No terrain, sky, fog, light or projection** keys in the style, so MapLibre uses its default light and flat Mercator.                                                                                                                                   | `src/map/style.ts` (keys: version, name, glyphs, sources, layers); `docs/ISOMETRIC_AND_3D_DESIGN.md` §4 "Terrain … Not used"                  |
| F3  | **The basemap is flat cartographic paint** from our own 349-feature OSM GeoJSON (road 152, path 67, green 43, service 29, road-major 19, water 15, pitch 14, parking 6, landuse 4) in hand-picked hex colours.                                           | `src/map/basemap-layers.ts:69-124`; `src/map/theme-colors.ts:57-128`; [MEASURED] tally of `properties.layer` in `public/data/basemap.geojson` |
| F4  | **Nothing outside campus is drawn**, and the camera is clamped to `maxBounds [75.685, 31.236, 75.722, 31.27]`, `minZoom 13`.                                                                                                                             | `src/config/index.ts:28-31`; `src/map/MapView.tsx:141`                                                                                        |
| F5  | **Buildings are single-colour `fill-extrusion` prisms**: height `renderHeightM`, base `renderMinHeightM`, opacity 0.92, vertical gradient on. No textures, roofs, wall/roof split, shadows or AO.                                                        | `src/buildings3d/layers.ts:53-76` (filter `inCampusInventory` at :65)                                                                         |
| F6  | **Heights are estimates or placeholders.** Of 131 buildings, 122 are `osm-levels-estimate` (levels × 3.2 m) and 9 are `fallback` (6 m); **0** have a measured OSM height. Only 11 distinct heights occur, and 50 buildings are exactly 32 m.             | [MEASURED] node tally over `public/data/buildings.geojson`; `scripts/lib/height.ts:55-96`; `src/config/index.ts:38-40`                        |
| F7  | **Every roof is flat**: `roofShape` is null on 130 of 131 (1 skillion). `roofColour` and `buildingColour` are null on all 131; `buildingMaterial` is set on 6.                                                                                           | [MEASURED] node tally                                                                                                                         |
| F8  | **Colour encodes height provenance and selection, not appearance**: light theme measured `#c7b9a3`, estimated `#d6cbba`, unknown `#e7e6e3`, selected `#c2410c`.                                                                                          | `src/buildings3d/layers.ts:36-51`; `src/map/theme-colors.ts:75-79` (light), `:111-114` (dark)                                                 |
| F9  | **The camera is constrained**: 3D uses pitch 55° and bearing −20°, `maxPitch` stays at MapLibre's default, so no horizon. Phones start in 2D.                                                                                                            | `src/config/index.ts:32-33`; `src/buildings3d/mode.ts:18-25`; `src/app/store/map-slice.ts`                                                    |
| F10 | **Almost nothing is labelled**: 128 of 131 buildings are unnamed.                                                                                                                                                                                        | `public/data/manifest.json` (`buildings:unnamed 128`); `src/map/overlay-layers.ts:235-251`                                                    |
| F11 | **Detections are loaded but never drawn**: 123 unreviewed detections (112 Microsoft, 11 Google Open Buildings) load lazily; no map layer draws them.                                                                                                     | `src/data/loader.ts:204-206`; `src/config/index.ts:141-144`                                                                                   |
| F12 | **The IITK reference has no prior art** for imagery, 3D tiles or terrain: flat 2D MapLibre 4.x from GeoJSON, rotation and pitch disabled.                                                                                                                | `C:/Users/shubh_qypqua6/Documents/LPU/iitk-main/src/main.ts:81-93`; `iitk-main/src/map/style.ts:80-330`                                       |

[INFERRED] F1, F2 and F4 cause most of the visual gap: Google Earth's look comes from photographic imagery,
textured meshes, terrain and atmosphere. F5–F8 can be improved inside MapLibre (light, colour, Studio models), but
cannot become photorealistic without an imagery or mesh source. Better OSM tagging (`height`, `roof:shape`,
colours), surveyed on the ground, would improve every OSM-based 3D renderer, including ours.

---

## 2. Feature-coupling map and regression list

### 2.1 Where the app is coupled to MapLibre

A provider abstraction must cover each of these. [CODE]

| #   | Coupling                                                                                                                                         | Where                                                                                                                              | Provider responsibility                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| C1  | Map construction: container, camera, min/max zoom, `maxBounds`, gestures, reduced motion, attribution, aria label                                | `src/map/MapView.tsx:124-151`                                                                                                      | `mount()`                                                         |
| C2  | Style built once from data                                                                                                                       | `src/map/style.ts:38-72`                                                                                                           | own-data provider only                                            |
| C3  | Self-hosted glyphs                                                                                                                               | `src/map/style.ts:25-28`; `public/fonts/**`                                                                                        | labels in every MapLibre-based mode                               |
| C4  | MapLibre worker URL and CSS                                                                                                                      | `src/app/maplibre-worker.ts:8-11`; `src/main.tsx:9`                                                                                | unchanged (one engine)                                            |
| C5  | Incremental `setData` of the six sources                                                                                                         | `src/map/MapView.tsx:228-244`; `src/map/apply.ts:52`                                                                               | `setOverlayData(kind, data)`                                      |
| C6  | Theme as paint re-application                                                                                                                    | `src/map/apply.ts:31-37`                                                                                                           | `setTheme()`                                                      |
| C7  | Layer-group filter and label toggle                                                                                                              | `src/map/apply.ts:39-50`                                                                                                           | `setVisibleGroups()`, `setShowLabels()`                           |
| C8  | Selection highlight via feature-state (`promoteId: 'id'`)                                                                                        | `src/map/apply.ts:68-94`; `src/map/style.ts:65-66`                                                                                 | `setSelection()`                                                  |
| C9  | 2D/3D switch: camera ease, extrusion visibility, gestures                                                                                        | `src/buildings3d/mode.ts:18-44`                                                                                                    | `setBuildingMode()`                                               |
| C10 | Camera controller (`flyTo`, `follow`, `fitCoordinates`, `resetView`, zoom, `resetNorth`, `setPadding`, `getCamera`), reduced motion, `essential` | `src/map/controller.ts:60-123`; interface `src/map/types.ts:26-49`                                                                 | **already MapLibre-free**: keep as the contract                   |
| C11 | Global imperative handle and map controls                                                                                                        | `src/app/map-controller.ts:7-16`; `src/components/map-controls/MapControls.tsx`                                                    | unchanged                                                         |
| C12 | Store camera requests (`focusRequest`), follow-me, route framing                                                                                 | `src/app/MapStage.tsx:106-133`                                                                                                     | unchanged if the controller is honoured                           |
| C13 | Layout padding                                                                                                                                   | `src/components/layout/map-padding.ts`                                                                                             | `setPadding()`                                                    |
| C14 | Picking: POIs first (8 px box), then buildings, via `queryRenderedFeatures` on named layer ids                                                   | `src/map/picking.ts:22-48`; `src/map/ids.ts:53-55`                                                                                 | `pick(point) → { placeId, lngLat }`                               |
| C15 | Hover cursor over pickable layers                                                                                                                | `src/map/MapView.tsx:179-186`                                                                                                      | provider-internal                                                 |
| C16 | User-pan detection stops follow-me                                                                                                               | `src/map/MapView.tsx:175-178`; `src/app/MapStage.tsx:85-89`                                                                        | `on('user-pan')`                                                  |
| C17 | Errors, `webglcontextlost`, WebGL2 probe → list mode                                                                                             | `src/map/MapView.tsx:160-161`; `src/buildings3d/webgl.ts:27-30`; `src/components/layout/AppShell.tsx:44-50`                        | `on('error')`, capability probe, fallback chain                   |
| C18 | Route overlay (alternative, casing, completed, remaining)                                                                                        | `src/map/overlay-layers.ts:55-97`                                                                                                  | `setOverlayData('route')`, drawn above imagery and mesh           |
| C19 | GPS puck (accuracy polygon, halo, dot, stale colour)                                                                                             | `src/map/overlay-layers.ts:99-147`; `src/map/geojson.ts:117-150`                                                                   | `setOverlayData('userLocation')`, clamped to the mesh in Earth 3D |
| C20 | POI markers and labels                                                                                                                           | `src/map/overlay-layers.ts:149-253`                                                                                                | per mode                                                          |
| C21 | Attribution: OSM ODbL via `customAttribution`, asserted by a test                                                                                | `src/map/style.ts:16`; `src/map/MapView.tsx:149`; `tests/unit/map/MapView.test.tsx:154-172`                                        | `attributions()`, Google block kept separate                      |
| C22 | E2E hook `window.__ATLAS_MAP__` (incl. `getLayerVisibility(layerId)`, `isStyleLoaded`)                                                           | `src/map/test-hooks.ts:20-50`; `tests/e2e/fixtures/atlas.ts`                                                                       | provider-neutral hook plus `getProviderId()`                      |
| C23 | Deep links `?place=`, `?view=3d\|iso\|2d` (unknown values ignored)                                                                               | `src/app/deep-link.ts`; `src/app/view-mode.ts:26-45`                                                                               | add new values without breaking old ones                          |
| C24 | View-mode model and capability matrix (`realistic3d`, `isometric`, `standard2d`)                                                                 | `src/app/view-mode.ts:7-124`; `src/app/store/map-slice.ts`                                                                         | add modes and reasons (offline, no key, no coverage)              |
| C25 | Building legend tied to extrusion colours                                                                                                        | `src/components/layers/BuildingLegend.tsx`; `src/buildings3d/layers.ts:123-145`                                                    | per-mode legend                                                   |
| C26 | PWA precache only, `runtimeCaching: []`, test-enforced                                                                                           | `src/offline/pwa-config.ts:76-78`; `tests/unit/offline/pwa-config.test.ts:102`                                                     | **stays empty for third-party hosts**                             |
| C27 | CSP `connect-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:`                                                                    | `public/_headers:2`; `tests/unit/offline/pwa-config.test.ts:120`                                                                   | widened only for configured providers (§7.10)                     |
| C28 | Privacy copy: "It only downloads its own files"; location "never stored or sent anywhere"                                                        | `src/privacy/privacy-facts.ts:13-25`; `tests/unit/privacy/privacy.test.ts:96`; `tests/unit/geolocation/useGeolocation.test.tsx:34` | must change for Google modes (§7.10)                              |
| C29 | Env policy: `.env.example` says the app "needs NO secrets"                                                                                       | `.env.example:1-3`                                                                                                                 | new public-by-design key (see configuration doc)                  |
| C30 | Bundle: `MapStage` chunk 1,065,787 B (287,872 B gzip-9); worker 518,806 B (147,886 B gzip-9); warning limit 1,200 kB                             | [MEASURED] node zlib over `dist/assets/MapStage-KD-43Ecr.js` (built 2026-10-24 04:38); `vite.config.ts:15`                         | any 3D-tiles renderer must be a separate lazy chunk               |

### 2.2 Regression list (feature → guarding tests)

E2E runs against `vite preview` in five viewport projects (`playwright.config.ts`). [CODE]

| Feature that must keep working                                                                               | Tests                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Map renders; no-WebGL → list view with search                                                                | `tests/e2e/visual-sanity.spec.ts`; `tests/unit/shell/app-shell.test.tsx`                                                                                                                                                                                                                          |
| Search → details and provenance; `?place=` survives reload                                                   | `tests/e2e/discovery.spec.ts`; `tests/unit/app/deep-link.test.ts`                                                                                                                                                                                                                                 |
| 3D toggle, pitch, extrusion visible, keyboard rotate, **click a projected footprint selects it**, back to 2D | `tests/e2e/buildings-3d.spec.ts`; `tests/unit/buildings3d/buildings3d.test.ts`                                                                                                                                                                                                                    |
| Walk, cycle and step-free routes                                                                             | `tests/e2e/routing.spec.ts`; `tests/unit/routing/*`; `tests/unit/directions/*`                                                                                                                                                                                                                    |
| Live navigation, weak GPS, off-route, permission denied                                                      | `tests/e2e/tracking.spec.ts`; `tests/unit/navigation*/*`; `tests/unit/geolocation/*`                                                                                                                                                                                                              |
| Follow-me until the user pans                                                                                | `tests/unit/shell/app-shell.test.tsx`                                                                                                                                                                                                                                                             |
| Map pick for route endpoints; empty click clears selection                                                   | `tests/unit/shell/app-shell.test.tsx`; `tests/unit/map/MapView.test.tsx`                                                                                                                                                                                                                          |
| Labels, categories, layer groups                                                                             | `tests/e2e/layers.spec.ts`; `tests/unit/map/style.test.ts`; `tests/unit/map/helpers.test.ts`                                                                                                                                                                                                      |
| Theme switch without style rebuild                                                                           | `tests/e2e/mobile.spec.ts`; `tests/unit/map/MapView.test.tsx`; `tests/unit/map/theme-colors.test.ts`                                                                                                                                                                                              |
| Keyboard, a11y scans, mobile sheet                                                                           | `tests/e2e/keyboard.spec.ts`; `tests/e2e/accessibility.spec.ts`; `tests/e2e/mobile.spec.ts`                                                                                                                                                                                                       |
| Offline reload: search and routing work                                                                      | `tests/e2e/offline.spec.ts`                                                                                                                                                                                                                                                                       |
| View-mode deep link and capability matrix                                                                    | `tests/unit/app/view-mode.test.ts`                                                                                                                                                                                                                                                                |
| **Policy guards a Google provider would break by design**                                                    | `tests/unit/map/style.test.ts:62` (no tiles/URLs/keys); `tests/unit/offline/pwa-config.test.ts:102` (no runtime caching), `:120` (CSP); `tests/unit/privacy/privacy.test.ts:96`; `tests/unit/geolocation/useGeolocation.test.tsx:34`; `tests/unit/map/MapView.test.tsx:154-172` (OSM attribution) |

[INFERRED] The policy-guard tests must **not** be deleted. They should be rescoped to the own-data provider (which
keeps every one of those guarantees) and new tests added that prove Google content is requested only when a key is
configured **and** the user opted in. Rescoping reverses the original "no third-party requests" decision, so it
needs the owner's explicit approval (§8, D1).

---

## 3. Provider options compared

### 3.1 Google Map Tiles API: 2D satellite tiles

| Aspect              | What the docs say                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What it is          | [DOC] "Satellite image tiles are a form of orthophotography … top-down (nadir or near-nadir) imagery" (https://developers.google.com/maps/documentation/tile/satellite). Zoom 0–22; Web Mercator 256 px tiles (https://developers.google.com/maps/documentation/tile/2d-tiles-overview).                                                                                                                                                                                                                                                                                                                                                                            |
| Intended use        | [DOC] Map Tiles API is for customers who "Want to build maps experiences without using JavaScript or Mobile SDKs" (https://developers.google.com/maps/documentation/tile/overview). [DOC] The policies page expressly covers non-Google renderers: "When you use the Map Tiles API to display Google Maps using a third-party renderer, you must not overlap or obscure the Google logo with any other logo, such as the renderer's logo" (https://developers.google.com/maps/documentation/tile/policies). **MapLibre is not named anywhere** [DOC-absence]; that a third-party 2D renderer such as MapLibre is permitted is [INFERRED] from these two statements. |
| Session token       | [DOC] "You must include a session token in all requests for 2D Tiles"; "valid for two weeks from its issue time, but this might change"; "You can use the same session token across multiple clients" (https://developers.google.com/maps/documentation/tile/session_tokens).                                                                                                                                                                                                                                                                                                                                                                                       |
| Price (global list) | [DOC] SKU "Map Tiles API: 2D Map Tiles" (Essentials, 0164-F76D-680A): **100,000** free/month; then **$0.60** (to 1M), $0.48 (to 5M), $0.36 (to 10M), $0.18 (to 50M), $0.045 (50M+) per 1,000 (https://developers.google.com/maps/billing-and-pricing/pricing).                                                                                                                                                                                                                                                                                                                                                                                                      |
| Price (India list)  | [DOC] "2D Map Tiles (India)" DA70-1FF2-6B9D: **700,000** free; then **$0.18** per 1,000 to 5M, $0.045 above (https://developers.google.com/maps/billing-and-pricing/pricing-india; the table header says "Prices - USD"). Eligibility: "India pricing is available only to India-based customers that incur a large majority of their usage in India and are billed in India" (https://developers.google.com/maps/billing-and-pricing/overview). Taxes are extra: the India regional terms say the customer pays "the Fees plus any applicable Taxes" (ToS §21, India, replacement §2.2(a), https://cloud.google.com/maps-platform/terms).                          |
| Billable event      | [DOC] "Request that returns a 2D map tile"; "Session Token and Viewport information requests aren't billed" (https://developers.google.com/maps/billing-and-pricing/sku-details).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Quota               | [DOC] **Conflict**: the usage page says "Maximum 15,000 2D Tile … queries per project per day" (https://developers.google.com/maps/documentation/tile/usage-and-billing); the 2026-05-21 release note says the default went from 15,000 to 100,000 QPD (https://developers.google.com/maps/documentation/tile/release-notes). [UNVERIFIED] read the live value in Cloud Console.                                                                                                                                                                                                                                                                                    |
| Attribution         | [DOC] the `viewport` response's `copyright` "Contains an attribution string that you must display on your map when you display roadmap and satellite tiles"; plus the Google Maps logo (https://developers.google.com/maps/documentation/tile/policies).                                                                                                                                                                                                                                                                                                                                                                                                            |
| Caching / offline   | [DOC] "you must not pre-fetch, index, store, or cache any Content except under the limited conditions stated in the terms"; clients must respect `Cache-Control` (`max-age`, `private`, …); "Offline uses" are a prohibited non-visualization use (policies page).                                                                                                                                                                                                                                                                                                                                                                                                  |
| Imagery date        | [DOC] none exposed: `viewport` returns only `copyright` and `maxZoomRects` (2d-tiles-overview).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Coverage in India   | [DOC] 2D listed for India (`⬤`). Max zoom over LPU [UNVERIFIED] (read `maxZoomRects`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### 3.2 Google Map Tiles API: Photorealistic 3D Tiles

| Aspect         | What the docs say                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What it is     | [DOC] "a 3D mesh textured with high resolution imagery … in many of the world's populated areas" (https://developers.google.com/maps/documentation/tile/3d-tiles).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Coverage       | [DOC + MEASURED] https://developers.google.com/maps/coverage (last updated 2026-10-21): India row `<td>IN</td><td>India</td><td>⬤</td><td>—</td>…`; 55 rows show `⬤ / ⬤` in "Map Tiles 2D / 3D", none in South Asia. The legend defines `⬤` as "available in the area, with good data quality and availability" and `—` as "not available in the area, or with low data quality or availability", but does not define a single dot in a "2D / 3D" column; "2D only" is [INFERRED]. [DOC] "3D terrain data is available worldwide. 3D surface data is limited to the areas highlighted in blue … Coverage data is updated daily at 11:00 UTC" (https://developers.google.com/maps/documentation/javascript/3d/coverage). Re-checked against a fresh fetch on 2026-10-24: same India row, same 55 countries. |
| Renderers      | [DOC] "specifying a root tileset URL to a 3D Tiles renderer of your choice" and "To render Google's photorealistic tiles, you must use a 3D Tiles renderer that supports the display of copyright attribution. You can use CesiumJS version 1.91 and later, or Cesium for Unreal version 1.12 and later" (3d-tiles page); "viewable using CesiumJS, Cesium for Unreal, Cesium for Unity, and deck.gl"; "minimum version of deck.gl … is 8.9.13" (https://developers.google.com/maps/documentation/tile/use-renderer). MapLibre and 3DTilesRendererJS are not named, but the "renderer of your choice" wording means an unnamed renderer is not excluded as long as it displays the attribution [INFERRED].                                                                                                 |
| Session        | [DOC] no session token needed; "at least three hours of tile requests from a single root tileset request" (3d-tiles page) vs "up to three hours" (usage page).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Price (global) | [DOC] SKU "Map Tiles API: Photorealistic 3D Tiles" (Enterprise, C6E1-98B2-DBD0): **1,000** free/month; then **$6.00** (to 100k), $5.10 (to 500k), $4.20 (to 1M), $3.30 (to 5M), $2.40 (5M+) per 1,000.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Price (India)  | [DOC] "Photorealistic 3D Tiles (India)" 592E-920B-C911: **7,000** free; then **$3.30** per 1,000 to 5M, $2.40 above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Billable event | **[UNVERIFIED]** see §3.3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Quota          | [DOC] "Maximum 10,000 root tileset queries per day"; "Unlimited renderer-originating tile requests per day"; "Rate limit is 12,000 queries per minute for the tile renderer" (usage page).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Errors         | [DOC] 400 (invalid key, params or expired session), 403 (missing key, or "your API key has not been added to the allowlist for 3D Tiles"), 429 (quota). **No "no coverage" error is documented** (https://developers.google.com/maps/documentation/tile/error_handling).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Attribution    | [DOC] Google logo plus aggregated `asset.copyright` of displayed tiles, "aggregate, sort, and display this information on a line of text" (https://developers.google.com/maps/documentation/tile/create-renderer).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Overlays       | [DOC] "You may overlay your own 3D objects on Photorealistic 3D Tiles as long as the 3D objects aren't extracted, traced, or otherwise derived by hand or machine from Photorealistic 3D Tiles" (policies).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Date metadata  | [DOC] glTF `asset.copyright` only. No capture date.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### 3.3 The 3D billing unit is unresolved (largest cost risk)

- [DOC] SKU details: billable event "**Request that returns a 3D tile**"
  (https://developers.google.com/maps/billing-and-pricing/sku-details).
- [DOC] GA announcement, 2023-10-26: "billing will reflect a tiered pricing model that's based on a per Root Tile
  request for Photorealistic 3D Tiles (akin to a map 'session')"
  (https://mapsplatform.google.com/resources/blog/build-immersive-maps-at-scale-with-photorealistic-3d-2d-and-street-view-tiles-now-in-ga/).
- [DOC] Usage page: root requests count against the daily quota; "Tile requests for Photorealistic 3D Tiles don't
  impact your daily quota" and there are "Unlimited renderer-originating tile requests per day". [INFERRED] So if
  billing turns out to be per returned tile, **no quota setting can cap 3D spending**; only the root-request quota
  and the app's own limits would remain.
- [INFERRED] Per root request: global 1,000 free sessions/month, then $0.006 per session; India 7,000, then
  $0.0033. Per returned tile: one fly-in can fetch hundreds of tiles, so a handful of sessions would use the free
  cap and each session could cost dollars at $6.00/1,000.
- **Verification procedure** (needs a key, costs at most a few events inside the free cap): in a fresh project
  with budget alerts, make exactly one root request and let the renderer fetch about 200 child tiles (count both
  in DevTools Network). After 24–48 h open Cloud Console → Billing → Reports, filter SKU C6E1-98B2-DBD0 (or
  592E-920B-C911 for India billing) and compare the count with 1 vs ~200. Or ask Google Maps Platform support in
  writing. **Do not launch Earth 3D before this is answered.**

### 3.4 Google Maps JavaScript API (Google's own renderer), for comparison

- [DOC] Global list: "Dynamic Maps" (FAF4-3B2D-51B2) 10,000 free map loads/month, then $7.00 per 1,000 (to
  100k); "Immersive Maps" (4816-83A2-9059) 5,000 free, then $7.00. India list: "Dynamic Maps (India)"
  (AA0F-63D7-9D0E) 70,000 free, then $2.10; "Immersive Maps (India)" (B383-D5A8-F843) 35,000 free, then $2.10
  (pricing pages above).
- [DOC] India's "Maps JavaScript 3D" coverage cell is `—`.
- [INFERRED] Not recommended: it replaces MapLibre with a second engine in Google modes, so every overlay,
  picking, selection and camera path would be rewritten; it also needs a remote script loader (CSP `script-src`
  change). Google's CSP guidance for Maps JavaScript API was **not retrieved** in this research; do that first if
  this option is reconsidered.

### 3.5 Alternatives (non-Google)

All retrieved 2026-10-24. Full quotes in the research notes; key facts here.

| Source                                                         | Resolution / date at LPU                                                                                                                        | Key / billing                                                                                                                                                                                                                                                                                                                                                                              | Commercial use, caching, attribution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | MapLibre fit                                  |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Esri World Imagery** (ArcGIS Location Platform)              | [MEASURED] **0.31 m WorldView-3, captured 2023-12-18** (Esri public Wayback metadata service at 75.7032, 31.2533; metadata only, no imagery)    | Token required. [DOC] "2M free then $0.15 per 1,000 tiles"; sessions "1K free then $4 per 1,000 sessions", session ≤ 12 h (https://location.arcgis.com/pricing/; https://developers.arcgis.com/rest/basemap-styles/). [DOC] "A payment method is required to enable pay-as-you-go … beyond the free tier" (https://location.arcgis.com/help/billing/). Signup without a card [UNVERIFIED]. | [DOC] "Customer may not otherwise scrape, download, or store Data" (Esri Master Agreement E204, rev. 2025-08-01, §3.2(c)). "Powered by Esri" plus data attribution required (https://developers.arcgis.com/documentation/esri-and-data-attribution/interactive-maps/).                                                                                                                                                                                                                                                                                   | `raster` source or style JSON                 |
| MapTiler Satellite                                             | [DOC] ~1 m/px "across most other densely populated regions (e.g., India" (https://docs.maptiler.com/schema-raster/satellite/); LPU [UNVERIFIED] | [DOC] Free plan "limited to non-commercial use"; Flex $30/month, 500k requests, then $0.15/1k (https://www.maptiler.com/cloud/pricing/)                                                                                                                                                                                                                                                    | [DOC] single-user browser cache only; no server-side caching; "© MapTiler © OpenStreetMap" (https://www.maptiler.com/terms/cloud/)                                                                                                                                                                                                                                                                                                                                                                                                                       | `raster`                                      |
| Mapbox Satellite (via MapLibre)                                | [DOC] "global coverage to zoom 16 (1–2 m resolution)"; LPU [UNVERIFIED]                                                                         | [DOC] Raster Tiles API 750k free, then $0.25/$0.20/$0.15 per 1k (https://www.mapbox.com/pricing); MapLibre is not a "Qualified Renderer" so billed per tile (Product Terms 2026-10-20 §2.8.3, §3.57)                                                                                                                                                                                       | [DOC] device cache ≤ 30 days (§2.8.1); Mapbox logo, © Mapbox, © OpenStreetMap, © Maxar                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `raster`                                      |
| Cesium ion (Google/Bing via ion, World Terrain, OSM Buildings) | Same Google data via ion; Bing promised "at least through September 2026" [DOC], current status [UNVERIFIED]                                    | [DOC] Community = non-commercial; Commercial $149/month (individual); "Contact us if you plan to integrate Cesium ion into solutions used outside your organization" (https://cesium.com/platform/cesium-ion/pricing/)                                                                                                                                                                     | [DOC] no offline storage (ToS §2.2.2); Google content via ion may not be used "with or near a non-Google map" (https://cesium.com/legal/terms-for-google/)                                                                                                                                                                                                                                                                                                                                                                                               | needs CesiumJS or deck.gl                     |
| Bing Maps for Enterprise                                       | n/a                                                                                                                                             | [DOC] no new licences since 2024-06-30; Basic keys stopped 2025-06-30; service ends 2028-06-30 (blogs.bing.com)                                                                                                                                                                                                                                                                            | **Not an option**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | —                                             |
| Azure Maps imagery                                             | [UNVERIFIED]                                                                                                                                    | [DOC] Gen2 free "Imagery Tiles 1,000" transactions, 15 tiles per transaction; paid price not in static HTML [UNVERIFIED]                                                                                                                                                                                                                                                                   | [UNVERIFIED]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | XYZ                                           |
| EOX Sentinel-2 cloudless **2016**                              | [DOC] 10 m                                                                                                                                      | Keyless                                                                                                                                                                                                                                                                                                                                                                                    | [DOC] CC BY 4.0, "the 2016 vintage is … free" for commercial use; 2018+ CC BY-NC-SA and "strictly prohibited" for commercial production on public endpoints (https://cloudless.eox.at/documentation/faq). The 2016 permission is conditional: attribution, "a Fair Use Policy applies", and "Do not resell or redistribute the raw source tiles as a standalone GIS dataset". Self-hostable and PWA-cacheable [INFERRED from CC BY; whether a bulk fetch of campus tiles from the free endpoint is within fair use is UNVERIFIED, ask cloudless@eox.at]. | `raster` (WMTS 3857)                          |
| NASA GIBS                                                      | [MEASURED] deepest true-colour EPSG:3857 level z12 ≈ 32.7 m/px at LPU                                                                           | Keyless                                                                                                                                                                                                                                                                                                                                                                                    | [DOC] acknowledgement requested                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `raster` (context zoom only)                  |
| ISRO Bhuvan                                                    | —                                                                                                                                               | —                                                                                                                                                                                                                                                                                                                                                                                          | [DOC] "provided for viewing purposes only"; no use outside the portal without written authorisation (https://bhuvan.nrsc.gov.in/home/terms.php). **Not usable.**                                                                                                                                                                                                                                                                                                                                                                                         | —                                             |
| Copernicus DEM GLO-30 (terrain)                                | [DOC] 30 m **DSM** (includes buildings and trees); LPU tile public [MEASURED HEAD 200]                                                          | Keyless, free                                                                                                                                                                                                                                                                                                                                                                              | [DOC] reproduction, distribution, adaptation allowed with the required notice (License-COPDEM-30 Arts. 4–6)                                                                                                                                                                                                                                                                                                                                                                                                                                              | self-built terrarium/Terrain-RGB `raster-dem` |
| AWS Terrain Tiles (terrarium)                                  | [MEASURED] z15 exists, z16 404 at LPU; SRTM 30 m source [DOC]                                                                                   | Keyless                                                                                                                                                                                                                                                                                                                                                                                    | [DOC] public-domain sources with listed attributions (tilezen/joerd attribution.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | native `raster-dem` `terrarium`               |
| Cesium OSM Buildings / OSM Buildings                           | [DOC] height = levels × 3 m when no height tag                                                                                                  | ion token / non-commercial                                                                                                                                                                                                                                                                                                                                                                 | [INFERRED] **no benefit**: our data has levels on 124, height on 0, roof shape on 1, colour on 0 [MEASURED], so LPU would be flat boxes like today                                                                                                                                                                                                                                                                                                                                                                                                       | —                                             |

[INFERRED] No keyless, billing-free, licence-clean source is sharp enough to show campus buildings. The best
verified imagery at LPU is Esri's 0.31 m (2023-12-18). It needs a key. Esri's billing page says "A payment method is
required to enable pay-as-you-go (PAYG) to continue using services beyond the free tier"; that the free tier itself
needs no card is [INFERRED] from this wording and [UNVERIFIED] (create an account to check). Google's 2D resolution
and date at LPU are unknown (no date is ever exposed).

### 3.6 Cost scenarios (arithmetic only; inputs are hypothetical, not measured)

The number of 2D tiles per user session has **not been measured**. Measure it on a staging key with the
network log before budgeting. The table only applies the cited list prices to hypothetical tile counts.

| Tiles per 2D session (hypothetical) | Free sessions/month, global list (100,000 ÷ N) | Cost per session above cap, global ($0.60/1,000) | Free sessions/month, India list (700,000 ÷ N) | Cost per session above cap, India ($0.18/1,000) |
| ----------------------------------- | ---------------------------------------------- | ------------------------------------------------ | --------------------------------------------- | ----------------------------------------------- |
| 100                                 | 1,000                                          | $0.06                                            | 7,000                                         | $0.018                                          |
| 200                                 | 500                                            | $0.12                                            | 3,500                                         | $0.036                                          |
| 300                                 | ≈ 333                                          | $0.18                                            | ≈ 2,333                                       | $0.054                                          |

Photorealistic 3D, if billed per root request: 1,000 (global) or 7,000 (India) free sessions/month, then $0.006
or $0.0033 per session. If billed per tile: unknown and potentially large (§3.3). Esri, for comparison: 2M free
tiles/month, then $0.15 per 1,000. India list prices are in USD and exclude taxes (§3.1).

**Credits.** [DOC] "Additional Google Maps Platform credits are available through Google public programs for
nonprofit, startup, crisis response, news media, and academic organizations"
(https://developers.google.com/maps/billing-and-pricing/overview). The academic route on the public programs page is
"Faculty at higher learning institutions and university-affiliated researchers can apply for credits to teach
courses" (https://developers.google.com/maps/billing-and-pricing/public-programs). [INFERRED] Teaching credits do not
obviously cover a production campus app; do not budget on them. Whether LPU qualifies for any program is
[UNVERIFIED]; ask Google Maps Platform sales in writing.

---

## 4. Terms that constrain the design

| Clause                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Design consequence [INFERRED unless stated]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [DOC] ToS 3.2.3(a) "No Scraping … (i) pre-fetch, index, store, reshare, or rehost Google Maps Content … (ii) bulk download Google Maps tiles"; 3.2.3(b) "No Caching. Customer will not cache Google Maps Content except as expressly permitted under the Maps Service Specific Terms" (https://cloud.google.com/maps-platform/terms, last modified 2026-08-26). [DOC-absence] The Service Specific Terms (last modified 2026-10-15) have **no Map Tiles API section** (0 occurrences of "tile"), so there is no caching exception for tiles.       | No Workbox runtime caching of Google hosts, no precache, no prefetch of surrounding tiles, no proxy cache. Browser HTTP cache honouring `Cache-Control` is what the policies page asks for.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| [DOC] 3.2.3(c) "No Creating Content From Google Maps Content … (i) trace or digitize roadways, building outlines … from the Maps JavaScript API Satellite base map type; (ii) create 3D building models from 45° Imagery"                                                                                                                                                                                                                                                                                                                          | **Building Studio never runs over Google layers.** Google layers are force-hidden in Editable Campus 3D. Mesh heights sampled for clamping are used at render time only and never written to our data or D1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| [DOC] 3.2.3(e) "No Use With Non-Google Maps … Customer will not use the Google Maps Core Services with or near a non-Google Map … (iii) link a Google Map to non-Google Maps Content or a non-Google Map." Map Tiles API is a Core Service (https://cloud.google.com/maps-platform/terms/maps-services, last modified 2026-10-23)                                                                                                                                                                                                                  | In Google modes, hide our OSM basemap paint (background, landuse, green, water, roads as a basemap). Show only Google tiles plus clearly attributed overlays (buildings, POIs, route, GPS puck). No split-screen, swipe compare or OSM minimap. **Tension, unresolved:** the Map Tiles policies page expressly allows overlays [DOC: "When you use the Map Tiles API to display Google Maps data as a basemap and overlay third-party (non-Google) geospatial data, you must not overlap or obscure the Google data attribution"], and Google's own deck.gl sample drapes a GeoJSON footprint on the 3D tiles [DOC use-renderer]; but example (iii) bans linking "a Google Map to non-Google Maps Content", and our overlays are OSM-derived. Whether OSM-derived overlays, and a mode switch that keeps the camera, fall under (iii) is **unclear** and needs legal or Google confirmation (§8, D6). |
| [DOC] Policies: overlay third-party data, but "The attribution of third-party data must clearly be disassociated from Google's data attributions"; "you must clearly state … which part of the scene originates from Google Maps data" (https://developers.google.com/maps/documentation/tile/policies)                                                                                                                                                                                                                                            | Two attribution blocks: Google (logo + `copyright`/aggregated credits) and "Campus data" (© OpenStreetMap contributors, ODbL; detections credits when shown).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| [DOC] Policies: "you must not overlap or obscure the Google logo with any other logo, such as the renderer's logo"                                                                                                                                                                                                                                                                                                                                                                                                                                 | MapLibre's logo control stays off (it is off today); no Cesium ion logo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| [DOC] Policies: no "Image analysis; Machine interpretation; Object detection or identification; Geodata extraction or resale; Offline uses"                                                                                                                                                                                                                                                                                                                                                                                                        | Coverage detection must not analyse mesh geometry or imagery in code; coverage is a **manual, dated decision record** (§7.8).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| [DOC] ToS 3.2.2(a)(i): the app's terms must "notify users that the Customer Application includes Google Maps features and content" and link the Google Maps End User Additional Terms and Google Privacy Policy                                                                                                                                                                                                                                                                                                                                    | Add a terms/notice entry and links before the first Google request.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| [DOC] Google Earth End User Additional Terms (https://www.google.com/help/terms_maps-earth/, last modified 2025-06-04; these bind end users of Google Earth, not the Map Tiles API customer): no "new product or service based on Google Earth", no mass download, no use "to create or augment any other mapping-related dataset … for use in a service that is a substitute for, or a substantially similar service to, Google Earth"                                                                                                            | Nothing is taken from Google Earth. "Google Earth-style" means our own renderer with Map Tiles API content. The UI must not call any mode "Google Earth". ("Google Earth" is also a separate Core Service with its own Service Specific Terms §8, about projects created in Google Earth; it is not part of this plan.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| [DOC] ToS 3.2.3(d) "Customer's product or service must contain substantial, independent value and features beyond the Google products or services. For example, Customer will not: … (iii) use the Google Maps Core Services in a listings or directory service or to create or augment an advertising product; (iv) combine data from the Directions API, Geolocation API, and Maps SDK for Android to create real-time navigation functionality …"                                                                                               | The atlas's routing, navigation and Studio provide independent value; Google modes stay optional views. **Open legal question:** the atlas is a campus directory, and example (iii) names "a listings or directory service". Whether showing Google imagery behind a campus directory is caught by (iii) is unclear [INFERRED]; add it to D6. Example (iv) names APIs we do not use (our routing and GPS are our own), but live navigation over Google imagery should be part of the same question.                                                                                                                                                                                                                                                                                                                                                                                                   |
| [DOC] ToS 4.4(a): "Google collects and receives data from Customer and End Users … including search terms, IP addresses, and latitude/longitude coordinates." ToS 4.4(c)(iii) "End User Location Privacy Requirements": the app must "notify End Users in advance of (1) the type(s) of data that Customer intends to collect … and (2) the combination and use of End User's location with any other data provider's data; and (B) will not obtain or cache any End User's location except with the End User's express, prior, revocable consent" | The app already asks before using GPS. In Google modes the consent notice must also say that the GPS position is shown over Google content and that Google receives the requests (IP address, viewed area). Consent must be revocable (a setting to turn Google modes off).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| [DOC] EEA billing addresses get 403 for satellite and 3D tiles (https://developers.google.com/maps/comms/eea/map-tiles); India is not a Prohibited Territory (https://cloud.google.com/maps-platform/terms/maps-prohibited-territories)                                                                                                                                                                                                                                                                                                            | The billing account address must be in India (also required for India pricing).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [DOC] ToS §21 Regional Terms, "Asia Pacific — India" (applies "if Customer's billing address is in the applicable region"): Google Cloud India Private Limited is the reseller; replacement §2.2 Taxes ("the Fees plus any applicable Taxes"; GSTIN "If required under the applicable law"); replacement §18.11: "governed by laws of India … litigated exclusively in the courts of New Delhi"; "Prices" means "the then-current applicable price(s) stated at https://g.co/maps/pricelist-india for eligible accounts"                           | Budget GST on top of the USD list prices. The contracting party, governing law and court are Indian; record this for the owner (D2). No India-specific restriction on tiles, overlays or caching was found in the Google terms reviewed [DOC-absence]. Indian national geospatial rules were **not** researched [UNVERIFIED].                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

---

## 5. Which renderer for Photorealistic Earth 3D, and why

All measurements [MEASURED] on 2026-10-24 with pinned versions in scratch Vite 8.3.5 builds (not in this repo),
gzip level 9, KiB = 1024 B. Smoke tests ran in headless Chromium (SwiftShader WebGL2) with every external request
blocked; no Google tiles were loaded.

**Correction (adversarial re-check, 2026-10-24).** The first deck.gl measurement (108.3 + 34.2 = 142.5 KiB) built
`const layers = key ? [new Tile3DLayer(…), …] : []` with `key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY` unset. Vite
replaced the variable with `undefined` at build time and removed the dead branch: the built chunk contained **0**
occurrences of `Tile3DLayer`, `tile.googleapis.com`, `terrain+draw` or `footprints`, and only `MapLibreOverlay`. It
measured deck.gl core plus the overlay, not the 3D Tiles path. The same pinned versions (deck.gl 9.4.0, loaders.gl
4.5.4, maplibre-gl 6.15.0, vite 8.3.5) were rebuilt with the key read at run time (`globalThis.__RUNTIME_KEY__`), so
`MapLibreOverlay`, `Tile3DLayer`, `Tiles3DLoader`, `GeoJsonLayer` and `_TerrainExtension` all stay in the chunk
(verified by string search). The lazy Earth chunks loaded on the WebGL path (`earth` 336.6 + `gpu-data-evaluator`
28.3 + `array-utils-flat` 9.3 + `webgl` 6.4 + `get-attribute-from-layouts` 5.4 + `webgl-device` 0.1 KiB gzip) total
**1,443,789 B raw, 395,262 B gzip-9 (386.0 KiB)**. The eager MapLibre entry grew by about 1 KiB gzip (275.9 vs
275.0 KiB). The Cesium (`tile.googleapis.com` present in the chunk) and 3DTilesRendererJS (`tile.googleapis.com`
present) builds were checked the same way and do include their 3D Tiles code. Not included in any figure: the
loaders.gl workers and Draco decoder that are fetched at run time (they must be self-hosted; their size was not
measured).

| Criterion                       | deck.gl 9.4.0 `Tile3DLayer` + `@deck.gl/maplibre` `MapLibreOverlay` (interleaved)                                                                                                                                                                                                                                                                                                                                                             | CesiumJS 1.146.0                                                                                                                                                            | 3DTilesRendererJS 0.5.3 + three 0.186.1                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Named by Google                 | **Yes** (≥ 8.9.13) [DOC]                                                                                                                                                                                                                                                                                                                                                                                                                      | **Yes** (≥ 1.91) [DOC]                                                                                                                                                      | **No** [DOC-absence]; Google allows "a 3D Tiles renderer of your choice" that displays attribution [DOC] |
| Engines                         | **One**: shares MapLibre's WebGL2 context; 1 canvas, a deck `ScatterplotLayer` drawn and picked on MapLibre 6.15.0 [MEASURED]. `Tile3DLayer` itself was **not** exercised (no key) [UNVERIFIED]                                                                                                                                                                                                                                               | Two (or Cesium alone in Earth mode)                                                                                                                                         | Two, unless a hand-written MapLibre custom layer                                                         |
| Lazy Earth-mode JS (gzip)       | **+386.0 KiB** (6 lazy chunks, re-measured with `Tile3DLayer` kept; see the correction above) [MEASURED]. The earlier 142.5 KiB figure excluded the 3D Tiles code.                                                                                                                                                                                                                                                                            | **+1006.3 KiB** JS, plus 342 static files (~4,137 KiB gz) to deploy; ~991 KiB gz fetched at start-up (sky box, moon, etc.) [MEASURED]                                       | 190.4 KiB plus 73–98 KiB Draco on demand [MEASURED]                                                      |
| MapLibre baseline for reference | 275.0 KiB main + 144.4 KiB worker + 9.8 KiB CSS (scratch build) [MEASURED]                                                                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                             |                                                                                                          |
| Attribution                     | Manual: read `asset.copyright`, aggregate and sort ourselves [DOC]                                                                                                                                                                                                                                                                                                                                                                            | Built in (`showCreditsOnScreen: true`) [DOC]                                                                                                                                | Built in (`getAttributions()`)                                                                           |
| Draping our data on the mesh    | `TerrainExtension`, the method Google documents: "drape the GeoJSON of a building footprint on top of the Photorealistic 3D Tiles Geometry" [DOC use-renderer]; exported as experimental `_TerrainExtension` [SRC]                                                                                                                                                                                                                            | `clampToGround`, `HeightReference.CLAMP_TO_3D_TILE` [SRC]                                                                                                                   | `GeoJSONOverlay`, raycast                                                                                |
| Camera                          | Our existing MapLibre camera and controls; no collision with the mesh [INFERRED]                                                                                                                                                                                                                                                                                                                                                              | Most Google-Earth-like (collision, `flyTo` with heading/pitch) [SRC]                                                                                                        | No built-in `flyTo`                                                                                      |
| Licence                         | MIT                                                                                                                                                                                                                                                                                                                                                                                                                                           | Apache-2.0                                                                                                                                                                  | Apache-2.0 / MIT                                                                                         |
| Known problems                  | `@deck.gl/mapbox` `MapboxOverlay` interleaved **throws on every frame on MapLibre 6.15.0** ("Cannot read properties of undefined (reading 'height')" in `getViewport`) [MEASURED; cause believed to be the missing `map.transform`, INFERRED]; use `@deck.gl/maplibre`. loaders.gl fetches workers from unpkg.com and Draco from www.gstatic.com by default [SRC]; must be self-hosted for our CSP. Interleaved mode needs WebGL2 [DOC deck]. | Without a Google key, `createGooglePhotorealistic3DTileset` silently falls back to Cesium ion asset 2275207 [SRC]; default Google cache 1536 MiB, too high for phones [SRC] | Not on Google's list                                                                                     |

**Recommendation [INFERRED; owner sign-off needed, §8 D4]: deck.gl via `@deck.gl/maplibre` `MapLibreOverlay`,
interleaved.** It is Google-named, keeps one engine, one camera and one canvas, reuses our controls, store wiring,
GPS and URL state, and costs about 386 KiB gzip (re-measured) only when Earth 3D is opened, roughly 2.6 times less
than CesiumJS's 1006.3 KiB. **CesiumJS is the fallback** if the in-MapLibre path fails the Phase E key-based test
(for example if mesh depth or the camera pivot cannot be made to behave). 3DTilesRendererJS is not recommended:
Google does not list it (it would still be allowed as "a 3D Tiles renderer of your choice" that shows attribution),
and it needs a second engine.

Caveats [INFERRED, untested with real tiles because no key exists]:

- Google's deck.gl samples use a standalone `new deck.DeckGL({…})` with no basemap [DOC use-renderer: 2 samples,
  0 occurrences of "maplibre", "mapbox" or "mapStyle"]. Running Tile3DLayer inside MapLibre is our own integration.
- The Google mesh sits at real ellipsoidal height; MapLibre draws at z = 0. In Earth 3D, our overlays must be deck
  layers with `TerrainExtension`, not MapLibre layers, and the camera pivot may sit under the mesh.
- The Building Studio custom layer (raw WebGL2 `CustomLayerInterface`, `docs/BUILDING_STUDIO_DESIGN.md` S1) and a
  deck interleaved overlay in the same map have not been tested together. Studio models are hidden in Earth 3D
  anyway (§4), but both must coexist across mode switches without GL state leaks.
- `docs/ISOMETRIC_AND_3D_DESIGN.md` D3 ("Do not add Three.js now") is not affected: deck.gl does not use
  Three.js. deck.gl does bring luma.gl and loaders.gl (MIT) as new dependencies.

---

## 6. Modes and the shared application map interface

### 6.1 Modes → providers

| Mode (UI label proposal)                  | `ViewMode` value                  | Provider                         | Engine                            | Default?            | Offline             |
| ----------------------------------------- | --------------------------------- | -------------------------------- | --------------------------------- | ------------------- | ------------------- |
| Map (2D)                                  | `standard2d` (exists)             | `own-data`                       | MapLibre                          | yes on phones       | yes                 |
| Editable Campus 3D ("3D campus")          | `realistic3d` (exists)            | `own-data` + Studio custom layer | MapLibre                          | yes on wide screens | yes                 |
| Overview                                  | `isometric` (exists in the model) | none (own Canvas2D renderer)     | Canvas2D                          | no                  | yes                 |
| Satellite 2D ("Satellite")                | `satellite2d` (new, planned)      | `google-satellite`               | MapLibre `raster` source          | **no, opt-in**      | **no** (falls back) |
| Photorealistic Earth 3D ("3D Earth view") | `earth3d` (new, planned)          | `google-photoreal`               | MapLibre + deck.gl overlay (lazy) | **no, opt-in**      | **no** (falls back) |

[INFERRED] The existing `standard2d` mode stays: it is the offline path, the phone default and a fallback target.
Deep links add `?view=sat` and `?view=earth`; the parser already ignores unknown values
(`src/app/view-mode.ts:34-43`), so old links keep working. If a Google mode is requested but not available, the app
falls back and says why (§7.9).

### 6.2 What each mode supports

[INFERRED] Initial support matrix. Every "no" must show a reason through the existing `VIEW_MODE_SUPPORT` pattern
(`src/app/view-mode.ts:82-121`), never a silently hidden control.

| Capability                   | Satellite 2D                                            | Earth 3D (initial)                                                                                                                                    | Editable Campus 3D / 2D / Overview |
| ---------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Select building / POI        | yes (same MapLibre layers, same ids)                    | yes, by picking our deck footprint layer (same `id`)                                                                                                  | unchanged                          |
| Search, directory            | yes                                                     | yes                                                                                                                                                   | unchanged                          |
| Route plan, drawn route      | yes                                                     | yes (deck `PathLayer` + `TerrainExtension`)                                                                                                           | unchanged                          |
| Pick a route endpoint on map | yes                                                     | **no** at first ("Switch to Satellite or Map to pick a point"): an unprojected z = 0 point is offset from the visible mesh                            | unchanged                          |
| Live location (puck)         | yes                                                     | yes (deck `ScatterplotLayer` + `TerrainExtension`)                                                                                                    | unchanged                          |
| Live navigation, follow-me   | yes                                                     | **switch to Satellite 2D** during navigation (same pattern as the isometric mode's `navigationSwitchAnnouncement`) until the camera pivot is verified | unchanged                          |
| Free rotate, pitch           | rotate yes, pitch yes                                   | yes; higher `maxPitch` (MapLibre 6.15.0 default 60, hard limit 180, above 60 "experimental" [SRC])                                                    | unchanged                          |
| Building Studio editing      | **no** ("Editing is not available over Google imagery") | **no**                                                                                                                                                | Editable Campus 3D only            |
| Offline                      | no → falls back to own-data                             | no → falls back                                                                                                                                       | yes                                |

### 6.3 Shared identity and state

- **Building ids.** Every provider uses the same feature `id` from `buildings.geojson` (e.g. `osm:way/…`) and the
  Studio ids defined in `docs/BUILDING_STUDIO_DESIGN.md` §2. Selection is stored once in the app store
  (`selectedPlaceId`); providers only render it. No provider invents ids, and no id is ever derived from Google
  content.
- **Selection.** own-data and Satellite 2D keep feature-state. Earth 3D sets deck layer colours from the selected
  id (`updateTriggers`).
- **Route and tracking.** The store remains the single source of truth (`alternatives`, `progress`, `lastSample`,
  `followUser`). Providers receive GeoJSON through `setOverlayData('route' | 'userLocation')`.
- **Camera.** `MapController` (`src/map/types.ts:26-49`) stays the only camera API. Mode switches carry
  `getCamera()` over by default, subject to decision D6.

---

## 7. Recommended architecture: `src/map/providers/` (planned)

### 7.1 Module layout

```text
src/map/providers/
  types.ts               MapProvider, ProviderId, ProviderCapabilities, OverlayData, ProviderEvent
  config.ts              reads and validates (Zod) VITE_* provider settings; no network
  registry.ts            ProviderId -> lazy import() factory
  capability.ts          capability and coverage detection (key? online? WebGL2? consent? coverage record?)
  fallback.ts            the ordered fallback chain and the user-facing reasons
  attribution.ts         Google block vs campus-data block; credit aggregation and sorting
  camera.ts              mode-switch camera hand-over, maxPitch per mode, reduced-motion rules
  own-data/              today's MapLibre code moved behind the interface (style, basemap, overlays, apply,
                         picking, buildings3d); default, offline-capable
  google/
    session.ts           2D createSession + refresh on `expired`; 3D root re-request before 3 h or on 400
    viewport.ts          throttled viewport calls -> copyright string + maxZoomRects clamp
    satellite.ts         google-satellite provider: own-data minus basemap paint plus a raster source
    photoreal.ts         google-photoreal provider: lazy chunk with deck.gl MapLibreOverlay + Tile3DLayer
    deck-overlays.ts     footprints, route, GPS puck and POIs as deck layers with TerrainExtension
    errors.ts            maps 400/403/429, quotaExceeded, rateLimitExceeded, expired -> ProviderEvent
  stub/                  test-only provider with a fake local tile origin (used by unit and e2e tests)
```

### 7.2 Interfaces (sketch)

```ts
export type ProviderId = 'own-data' | 'google-satellite' | 'google-photoreal' | 'stub';

export interface ProviderCapabilities {
  pitch: boolean;
  freeRotate: boolean;
  pickBuildings: boolean;
  pickGroundPoint: boolean;
  liveNavigation: boolean;
  studioEditing: boolean; // false for every Google provider
  offline: boolean; // true only for own-data
  networkOrigins: readonly string[]; // drives the CSP; never fetched by tests
  needsApiKey: boolean;
}

export interface MapProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;
  mount(container: HTMLElement, init: ProviderInit): Promise<MapControllerWithCamera>; // reuse src/map/types.ts
  unmount(): void; // must release GL resources, abort fetches, stop timers (§7.7)
  setOverlayData<K extends keyof OverlayData>(kind: K, data: OverlayData[K]): void;
  setTheme(theme: MapTheme): void;
  setVisibleGroups(groups: ReadonlySet<LayerGroupId>): void;
  setShowLabels(show: boolean): void;
  setSelection(target: SelectionTarget | null): void;
  pick(point: { x: number; y: number }): { placeId: string | null; lngLat: LngLat | null };
  project(lngLat: LngLat): { x: number; y: number } | null;
  attributions(): { google: AttributionBlock | null; campus: AttributionBlock };
  on(
    event: 'user-pan' | 'error' | 'context-lost' | 'quota' | 'auth',
    cb: (detail?: string) => void,
  ): () => void;
}
```

`MapView.tsx` becomes a thin host that keeps today's diffing of applied props and calls the active provider.

### 7.3 Configuration

`config.ts` parses build-time variables (names and rules in `MAP_PROVIDER_CONFIGURATION.md`). With no key, the
Google providers are not registered at all, and the app behaves exactly as today, including its CSP and privacy
claims.

### 7.4 Satellite imagery (`google-satellite`)

- A MapLibre `raster` source with `tiles: ['https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=…&key=…']`,
  `tileSize: 256` [DOC URL pattern; MapLibre use INFERRED].
- `maxzoom` clamped to the `viewport` response's `maxZoomRects` for the campus.
- Our basemap paint layers hidden (§4, 3.2.3(e)); buildings drawn as outlines plus a light fill so the imagery is
  visible; POIs, labels, route and puck unchanged.
- `region: "IN"` in the session request ([DOC] "represents the physical location of the user").

### 7.5 Photoreal 3D scene (`google-photoreal`)

- Lazy `import()` of a chunk with `@deck.gl/maplibre`, `@deck.gl/geo-layers` (`Tile3DLayer`) and
  `@deck.gl/extensions` (`_TerrainExtension`).
- `Tile3DLayer` with `data: 'https://tile.googleapis.com/v1/3dtiles/root.json'`, key sent per Google's deck.gl
  sample (`X-GOOG-API-KEY` header) [DOC use-renderer], `operation: 'terrain+draw'`.
- Our footprints, route, puck and POIs as deck layers with `TerrainExtension`; MapLibre basemap and overlays
  hidden.
- loaders.gl workers and the Draco decoder self-hosted (exact 4.5.4 option names to confirm in implementation).
- Root re-request before 3 hours or on a 400 that indicates an expired session.

### 7.6 Camera

- One `MapController` for every MapLibre-based mode. Animated moves stay `essential`; reduced motion jumps
  (`src/map/controller.ts:60-62`).
- Earth 3D raises `maxPitch` toward a near-horizon view. [SRC maplibre-gl 6.15.0 `src/ui/map.ts`]
  `defaultMaxPitch = 60`, `maxPitchThreshold = 180` (larger values throw), and `setMaxPitch` documents "Values
  greater than 60 degrees are experimental and may result in rendering issues". Test the chosen value (for example
  75–85°) with deck interleaved before shipping.
- Mode switch: `getCamera()` from the old provider → `mount()` of the new one. If D6 rules that this is "linking",
  switch to a reset-to-campus behaviour instead.

### 7.7 Lazy loading and disposal

- Each non-default provider is a separate dynamic-import chunk. The own-data path and the PWA precache must not
  grow when Google modes are configured but unused.
- On leaving Earth 3D: remove the `MapLibreOverlay` (`map.removeControl`), call `finalize()`, drop the tileset,
  abort in-flight fetches with an `AbortController`, stop the 3-hour session timer, and clear the Google credit
  line. On leaving Satellite 2D: remove the raster source and the viewport throttle.
- Memory: set tileset cache limits explicitly for phones (loaders.gl defaults were not checked; Cesium's Google
  default of 1536 MiB shows why defaults cannot be trusted) [INFERRED].
- No Google response is written to Cache Storage, IndexedDB, localStorage or D1 at any point.

### 7.8 Capability and coverage detection

| Check                     | How                                                                                                                                                                                            | Result when it fails                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Key configured            | `config.ts` at build time                                                                                                                                                                      | Google modes absent from the mode list                                     |
| User consent              | one-time notice (Google terms + privacy), stored locally                                                                                                                                       | mode stays off until accepted                                              |
| Online                    | `navigator.onLine` plus first-request failure                                                                                                                                                  | "Satellite needs a connection" → own-data                                  |
| WebGL2                    | existing probe (`src/buildings3d/webgl.ts`)                                                                                                                                                    | Earth 3D unavailable (deck interleaved needs WebGL2 [DOC])                 |
| Auth / quota / rate limit | HTTP 403, 429, `quotaExceeded`, `rateLimitExceeded`, `expired` [DOC error_handling]                                                                                                            | back off; on persistent failure fall back with a reason                    |
| 3D coverage at LPU        | **a manual decision record** (`photoreal3dCoverage: 'unknown' \| 'terrain-only' \| 'photogrammetry'` plus the date checked), set after the procedure in `IMAGERY_COVERAGE_AND_FRESHNESS.md` §4 | shapes the mode's description ("imagery on terrain, no 3D buildings here") |

Coverage cannot be detected from HTTP status (no documented "no coverage" error), and analysing the mesh or
imagery in code would be "machine interpretation" under the policies page, so the app does not try [INFERRED].

### 7.9 Fallback chain

`google-photoreal` → `google-satellite` → own-data `realistic3d` → own-data `standard2d` → list mode.

Triggers: no key, no consent, offline, WebGL2 missing, context lost, 403/429/quota errors, CSP violation
(`securitypolicyviolation` event), or the user choosing to stop. Each fallback announces a one-sentence reason
(existing `ViewModeChangeReason = 'fallback'`, `src/app/view-mode.ts:11`). Today's chain is only own-data → list.

### 7.10 CSP, PWA and privacy changes (planned)

**CSP (`public/_headers`)** [INFERRED from the URLs in Google's docs; Google publishes no CSP list for Map Tiles
API that we found]:

| Directive     | Today                | With Google modes configured                                                                                                                                           |
| ------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connect-src` | `'self'`             | `'self' https://tile.googleapis.com` (session, viewport, raster tiles fetched by MapLibre, 3D root/children)                                                           |
| `img-src`     | `'self' data: blob:` | unchanged while MapLibre's `refreshExpiredTiles` stays at its default `true` (see note below); add `https://tile.googleapis.com` only if that option is set to `false` |
| `script-src`  | `'self'`             | **unchanged**: Map Tiles API is REST; no Google script is loaded                                                                                                       |
| `worker-src`  | `'self' blob:`       | unchanged, provided loaders.gl workers and Draco are self-hosted                                                                                                       |
| `font-src`    | `'self'`             | unchanged                                                                                                                                                              |

[SRC maplibre-gl 6.15.0 `src/util/image_request.ts`] Raster images are loaded through an `HTMLImageElement` only
when `supportImageRefresh === false` (that is, `refreshExpiredTiles: false`), with no custom headers or protocol, on
the main thread. With the default `refreshExpiredTiles: true` (the repo does not set it), tiles are fetched with
`fetch`/XHR, which `connect-src` governs, and decoded to an `ImageBitmap` or a `blob:` image. The default also makes
MapLibre read `Cache-Control`/`Expires` and re-request expired tiles, which fits the policies page. Confirm with a
CSP-violation test on staging.

The CSP should be generated at build time from the provider configuration, so a build without a key keeps
today's strict policy. The CSP test (`tests/unit/offline/pwa-config.test.ts:120`) gains a case per configuration.

**Referrer policy.** `Referrer-Policy: strict-origin-when-cross-origin` (`public/_headers`) sends only the origin
cross-site. [DOC] "Modern browsers typically redact the Referer header in cross-origin request … stripping it down
to the Origin" (https://developers.google.com/maps/api-security-best-practices). Key referrer restrictions must
therefore be written as `https://<host>/*`.

**PWA.** `runtimeCaching` stays `[]` (`src/offline/pwa-config.ts:78`). Add a test that no Workbox route or precache
glob can match `googleapis.com`. Offline, Google modes are unavailable and the app falls back to own-data.

**Privacy.** [INFERRED] Tile requests around a followed GPS position reveal approximate location to Google ([DOC]
ToS 4.4(a): Google collects "IP addresses, and latitude/longitude coordinates"; 4.4(c)(iii) requires advance notice
of "the combination and use of End User's location with any other data provider's data" and "express, prior,
revocable consent", see §4). So:
Google modes are opt-in, never default; a consent notice before the first request names Google and links the
Google Maps End User Additional Terms and the Google Privacy Policy (ToS 3.2.2(a)); `privacy-facts.ts` gains
mode-aware statements ("In Satellite and 3D Earth views, map imagery is downloaded from Google, which receives the
area you are viewing"); `docs/SECURITY_AND_PRIVACY.md` and `README.md` are updated in the same change.

---

## 8. Owner decisions needed

| #   | Decision                                                                                                                                                                                                     | Options                                                                                                                       | Recommendation [INFERRED]                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| D1  | Reverse "no paid APIs or keys" for **opt-in** imagery modes, and rescope the policy-guard tests to own-data                                                                                                  | yes / no                                                                                                                      | Yes only for opt-in modes; own-data stays the default and keeps every guarantee                               |
| D2  | Billing account                                                                                                                                                                                              | owner's or LPU's Google Cloud billing account, India billing address (needed for India pricing and to avoid EEA restrictions) | LPU-owned account billed in India; GSTIN on file if required                                                  |
| D3  | API key ownership and limits                                                                                                                                                                                 | browser key with Website + API restrictions and daily quota caps / Cloudflare proxy holding the key                           | Browser key with restrictions and caps first; verify referrer enforcement before launch (configuration doc)   |
| D4  | Renderer dependency for Earth 3D                                                                                                                                                                             | deck.gl via `@deck.gl/maplibre` (+386.0 KiB gz lazy) / CesiumJS (+1006.3 KiB gz, second engine) / none (skip Earth 3D)        | deck.gl                                                                                                       |
| D5  | Accept that Earth 3D at LPU may be terrain-only                                                                                                                                                              | build it anyway / build only Satellite 2D until Google lists India / skip                                                     | Build Satellite 2D first; build Earth 3D only after the coverage and billing-unit checks                      |
| D6  | Legal reading of ToS 3.2.3(e) for mode switching with a preserved camera and for OSM-derived overlays, and of 3.2.3(d)(iii) "listings or directory service" for a campus directory shown over Google imagery | ask Google sales / counsel; meanwhile conservative behaviour                                                                  | Ask in writing; until then hide OSM basemap paint in Google modes and keep the camera hand-over behind a flag |
| D7  | Monthly budget and quota caps                                                                                                                                                                                | e.g. caps at or below the free usage                                                                                          | Daily quota ≈ monthly free cap ÷ 31 so the app falls back instead of billing                                  |
| D8  | Non-Google fallback imagery                                                                                                                                                                                  | none / Esri free tier (key, 2M tiles) / EOX 2016 (10 m, keyless)                                                              | Optional Esri provider for a no-billing satellite view; never shown together with Google                      |

---

## 9. Phased implementation plan with acceptance tests

No phase may call a Google API in CI. Tests use the `stub` provider with a local fake tile origin.

### Phase A: owner decisions and key-based verification (no code)

- Record D1–D8.
- With a key: run the coverage, max-zoom, referrer-enforcement, quota-default and billing-unit procedures
  (`IMAGERY_COVERAGE_AND_FRESHNESS.md` §4, `MAP_PROVIDER_CONFIGURATION.md` §9).
- **Accept when:** a dated decision record exists for each item; no tile or imagery was stored.

### Phase B: provider abstraction, no behaviour change

- Move today's MapLibre code behind `MapProvider` as `own-data`; add `getProviderId()` to the e2e hook; keep
  `getLayerVisibility` under a provider-specific hook.
- **Accept when:** every existing unit and e2e test passes unchanged except mechanical import paths; the
  `MapStage` chunk grows by ≤ 2 % gzip versus the 287,872 B baseline; the built `_headers`, precache list and
  privacy text are byte-identical to today's when no key is configured.

### Phase C: configuration, capability, consent and fallback (no Google network)

- `config.ts`, `capability.ts`, `fallback.ts`, consent notice, new `ViewMode` values and deep links, `stub`
  provider.
- **Accept when:** with no key, no Google mode is listed and `?view=sat` falls back with a reason; with a fake key
  and the stub provider, consent is required before any request; an injected 403/429/offline/context-loss falls
  back down the chain with the right announcement; old `?view=3d|iso|2d` links still work.

### Phase D: Satellite 2D

- `google/session.ts`, `viewport.ts`, `satellite.ts`, attribution blocks, build-time CSP, PWA guard test, privacy
  copy.
- **Accept when:** (unit) the satellite style has no OSM basemap layers; the Google attribution block is separate
  from the campus block and contains the logo and `copyright`; no Workbox route or glob matches
  `googleapis.com`; CSP adds only `https://tile.googleapis.com` when a key is configured. (e2e, stub) selection,
  route, puck, labels, follow-me and keyboard work in Satellite 2D; Studio editing is refused with a reason.
  (manual, real key, staging only) tiles render, `maxzoom` is clamped, tile count per typical session is recorded
  for the cost model.

### Phase E: Photorealistic Earth 3D (only after D4, D5 and the billing-unit check)

- `photoreal.ts`, `deck-overlays.ts`, lazy chunk, credit aggregation sorted by occurrence, root re-request,
  disposal.
- **Accept when:** the Earth chunks are lazy and ≤ 400 KiB gzip in total (re-measured scratch baseline 386.0 KiB,
  §5), measured with the key read at run time so `Tile3DLayer` is not tree-shaken; entering and leaving Earth 3D ten times leaves no
  growing GL resources or listeners; credits update and are sorted; footprints, route and puck drape on the mesh;
  picking a footprint selects the same building id as in 2D; live navigation switches to Satellite 2D with an
  announcement; a mid-range Android phone holds an acceptable frame rate (target to be set by the owner) over
  campus.

### Phase F: documentation and optional non-Google provider

- Update `GEODATA_SOURCES_AND_LICENSES.md`, `IMPLEMENTATION_STATUS.md`, `SECURITY_AND_PRIVACY.md`, `README.md`,
  `.env.example`. Optional Esri provider if D8 says so.
- **Accept when:** every price or term quoted in the docs has a URL and retrieval date; the in-app wording follows
  `IMAGERY_COVERAGE_AND_FRESHNESS.md` §5.

---

## 10. Risks

| Risk                                                            | Likelihood / impact [INFERRED] | Mitigation                                                                               |
| --------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| 3D billed per tile, not per root                                | unknown / high cost            | billing-unit test before launch; daily quota caps                                        |
| No photorealistic 3D at LPU (terrain only)                      | likely / feature disappoints   | build Satellite 2D first; honest mode description                                        |
| Browser key abused from another site                            | possible / cost                | API restriction, referrer restriction (verify enforcement), quotas, budget alerts        |
| ToS 3.2.3(e) reading stricter than ours                         | unknown / legal                | conservative mode separation; written confirmation (D6)                                  |
| deck.gl interleaved + MapLibre 6.x breaks on a MapLibre upgrade | possible / Earth 3D breaks     | pin versions; smoke test in CI with the stub; CesiumJS fallback                          |
| loaders.gl CDN defaults violate CSP                             | certain if not configured      | self-host workers and Draco; CSP violation triggers fallback                             |
| Privacy claims become untrue                                    | certain if copy not updated    | mode-aware privacy facts; consent before first request                                   |
| Google imagery used to edit buildings                           | possible / licence breach      | Studio refuses editing in Google modes; provenance URL rules already reject Google hosts |

---

## 11. Open questions (each with its verification route)

1. 3D billing unit: §3.3 procedure, or Google support in writing.
2. Photorealistic 3D coverage at LPU: `IMAGERY_COVERAGE_AND_FRESHNESS.md` §4.
3. 2D default daily quota (15,000 vs 100,000): Cloud Console → Quotas & System Limits.
4. Referrer restriction enforcement on `tile.googleapis.com`: `MAP_PROVIDER_CONFIGURATION.md` §9.
5. Whether the project needs Google's 3D Tiles allowlist (403 text in the error-handling doc): first root request.
6. India pricing eligibility: first invoice or Billing report shows "(India)" SKUs.
7. ToS 3.2.3(e) (mode switching, OSM-derived overlays) and 3.2.3(d)(iii) (directory service): counsel or Google
   sales (D6).
8. Tile3DLayer streaming Google tiles inside `MapLibreOverlay` on MapLibre 6.15: Phase E manual test with a
   referrer-restricted staging key and a low root-request quota.
9. loaders.gl 4.5.4 option names for self-hosted workers and Draco: loaders.gl docs, then a test with external
   requests blocked.
10. Mobile frame rate and memory per renderer: not measured; Phase E.
11. Size of the self-hosted loaders.gl workers and Draco decoder for the deck path: not measured; measure in the
    Phase E build.
12. Eligibility for Google public-program credits: ask Google Maps Platform sales in writing (§3.6).

---

## Sources

All retrieved 2026-10-24 with User-Agent `LPU-Campus-Atlas-research/0.1`. Google developer pages showed "Last
updated 2026-10-21 UTC" unless noted.

| Source                                                 | URL                                                                                                                                                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Map Tiles API overview                                 | https://developers.google.com/maps/documentation/tile/overview                                                                                                                                                                  |
| 2D tiles overview, satellite, session tokens           | https://developers.google.com/maps/documentation/tile/2d-tiles-overview ; …/tile/satellite ; …/tile/session_tokens                                                                                                              |
| Photorealistic 3D Tiles, renderers, create-renderer    | https://developers.google.com/maps/documentation/tile/3d-tiles ; …/tile/use-renderer ; …/tile/create-renderer                                                                                                                   |
| Policies                                               | https://developers.google.com/maps/documentation/tile/policies                                                                                                                                                                  |
| Usage and billing, release notes, error handling       | https://developers.google.com/maps/documentation/tile/usage-and-billing ; …/tile/release-notes ; …/tile/error_handling                                                                                                          |
| Coverage table; Maps JS 3D coverage                    | https://developers.google.com/maps/coverage ; https://developers.google.com/maps/documentation/javascript/3d/coverage                                                                                                           |
| Pricing (global, India), SKU details, billing overview | https://developers.google.com/maps/billing-and-pricing/pricing ; …/pricing-india ; …/sku-details ; …/overview                                                                                                                   |
| Public programs (credits)                              | https://developers.google.com/maps/billing-and-pricing/public-programs                                                                                                                                                          |
| MapLibre GL JS 6.15.0 source (image loading, maxPitch) | npm `maplibre-gl@6.15.0`, `src/util/image_request.ts`, `src/ui/map.ts` (scratch install, not in this repo)                                                                                                                      |
| API security best practices                            | https://developers.google.com/maps/api-security-best-practices                                                                                                                                                                  |
| GA blog (published 2023-10-26)                         | https://mapsplatform.google.com/resources/blog/build-immersive-maps-at-scale-with-photorealistic-3d-2d-and-street-view-tiles-now-in-ga/                                                                                         |
| Google Maps Platform Terms (last modified 2026-08-26)  | https://cloud.google.com/maps-platform/terms                                                                                                                                                                                    |
| Service Specific Terms (last modified 2026-10-15)      | https://cloud.google.com/maps-platform/terms/maps-service-terms                                                                                                                                                                 |
| Core Services list (last modified 2026-10-23)          | https://cloud.google.com/maps-platform/terms/maps-services                                                                                                                                                                      |
| Prohibited territories (last modified 2022-03-21)      | https://cloud.google.com/maps-platform/terms/maps-prohibited-territories                                                                                                                                                        |
| EEA Map Tiles notice                                   | https://developers.google.com/maps/comms/eea/map-tiles                                                                                                                                                                          |
| Google Earth / Google Maps end-user terms              | https://www.google.com/help/terms_maps-earth/ (last modified 2025-06-04) ; https://www.google.com/help/terms_maps/ (last modified 2026-01-27)                                                                                   |
| deck.gl MapLibre integration                           | https://deck.gl/docs/api-reference/maplibre/overview                                                                                                                                                                            |
| Esri pricing, basemap styles, billing, attribution     | https://location.arcgis.com/pricing/ ; https://developers.arcgis.com/rest/basemap-styles/ ; https://location.arcgis.com/help/billing/ ; https://developers.arcgis.com/documentation/esri-and-data-attribution/interactive-maps/ |
| Esri Master Agreement E204 (rev. 2025-08-01)           | https://assets.esri.com/content/dam/esrisites/en-us/media/legal/ma-full/ma-full.pdf                                                                                                                                             |
| MapTiler pricing, terms, satellite schema              | https://www.maptiler.com/cloud/pricing/ ; https://www.maptiler.com/terms/cloud/ ; https://docs.maptiler.com/schema-raster/satellite/                                                                                            |
| Mapbox pricing, satellite data, attribution            | https://www.mapbox.com/pricing ; https://docs.mapbox.com/data/tilesets/reference/mapbox-satellite/ ; https://docs.mapbox.com/help/dive-deeper/attribution/                                                                      |
| Cesium ion pricing, terms, terms for Google            | https://cesium.com/platform/cesium-ion/pricing/ ; https://cesium.com/legal/terms-of-service/ ; https://cesium.com/legal/terms-for-google/                                                                                       |
| Bing Maps retirement                                   | https://blogs.bing.com/maps/2024/5/Microsoft-Announces-Vision-for-Next-Generation-of-Enterprise-Maps/ ; https://blogs.bing.com/maps/2025/6/Bing-Maps-for-Enterprise-Basic-Account-shutdown-June-30,2025/                        |
| EOX cloudless FAQ and WMTS capabilities                | https://cloudless.eox.at/documentation/faq ; https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml                                                                                                                          |
| NASA GIBS                                              | https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml                                                                                                                                                   |
| ISRO Bhuvan terms                                      | https://bhuvan.nrsc.gov.in/home/terms.php                                                                                                                                                                                       |
| Copernicus DEM licence; AWS registry                   | https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM/resources/license/License-COPDEM-30.pdf ; https://registry.opendata.aws/copernicus-dem/                                                                 |
| AWS Terrain Tiles                                      | https://registry.opendata.aws/terrain-tiles/                                                                                                                                                                                    |
| MapLibre style spec (sources)                          | https://maplibre.org/maplibre-style-spec/sources/                                                                                                                                                                               |

---

## Owner decision 2026-10-24: no billing

**Decision (binding):** no billing account and free sources only. Google Map Tiles (2D satellite and Photorealistic
3D Tiles) need a Google Cloud billing account, so nothing Google is implemented; Google Maps, Earth and Street View
are never a data source. A 3D-tiles renderer may be added only if evidence justifies it; with no photorealistic
source there is nothing to draw, so **no dependency was added** (D4 is moot). Decisions D1–D3, D5–D7 lapse with the
Google modes. D8 is answered: Esri's free tier (key, pay-as-you-go off) and the EOX 2016 backdrop.

| Item in this assessment                               | Status after the decision                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §7 provider layer in `src/map/providers/`             | **Implemented** in a smaller form: no `MapProvider` mount abstraction; one MapLibre map, imagery added as a raster source under our overlays (`imagery-layer.ts`), plus config, registry/capability, failure classification, attribution, camera helpers.                                          |
| Satellite 2D (`google-satellite`)                     | **Implemented with free sources instead**: Esri World Imagery (`VITE_ARCGIS_API_KEY`) or the EOX Sentinel-2 2016 backdrop (`VITE_EOX_BACKDROP=true`, 10 m, zoom-capped, "buildings not visible"). Not configured → the option stays visible and says so.                                           |
| Photorealistic Earth 3D (`google-photoreal`, deck.gl) | **Not implemented** (needs billing; LPU coverage likely terrain-only, §0.2). Shown as a permanently unavailable option with the reason; `?view=earth` is ignored.                                                                                                                                  |
| Editable Campus 3D                                    | **Implemented**: our buildings and studio models, on Esri imagery when a key is set (neutral tones on imagery, no textures). The map-editing interface (`src/map/editing`) keeps working on every basemap (the Google-only editing ban of §4 does not apply to Esri/EOX; see the open item below). |
| §7.6 camera                                           | **Implemented**: maxPitch 60 (MapLibre default, non-experimental), eased mode changes, "Back to campus" control.                                                                                                                                                                                   |
| §7.8 capability detection, §7.9 fallback              | **Implemented**: build configuration, online/offline, one metadata probe (Esri), tile-error classification (auth/quota/network) → Campus map 2D with a toast and announcement; never a blank map.                                                                                                  |
| §7.10 CSP, PWA, privacy                               | **Implemented**: `connect-src` adds exactly `https://ibasemaps-api.arcgis.com` and `https://tiles.maps.eox.at`; no runtime caching (tested, plus an e2e Cache Storage check); the privacy panel names the provider when one is configured.                                                         |
| Terrain (§3.5 GLO-30 / AWS)                           | **Measured, not added**: ≈4.7 m ground variation across campus (`IMAGERY_COVERAGE_AND_FRESHNESS.md` §3.3).                                                                                                                                                                                         |
| §9 phases A–F                                         | A, D, E (Google) dropped; B/C done in the reduced form above; F's docs updated (`MAP_PROVIDER_CONFIGURATION.md` §Free providers, `IMAGERY_COVERAGE_AND_FRESHNESS.md` §7, `.env.example`).                                                                                                          |

Open items: whether ArcGIS Location Platform sign-up asks for a payment card (the help pages do not say);
Esri's exact response once the free tier is used up; whether using Esri imagery as a visual reference while placing
Building Studio models raises any Esri-terms question (the Studio records the owner's placement, never data copied
from imagery; owner/legal to confirm). Details and sources: `MAP_PROVIDER_CONFIGURATION.md` §Free providers.
