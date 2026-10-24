# Map provider configuration

**Status: §Modes and §Free providers are IMPLEMENTED (free sources only, owner decision 2026-10-24). §§1–11 are the
earlier Google plan, kept only as a record: the no-billing decision rules out every Google part of them.** A build
with no provider variables behaves as before: it needs no key and makes no third-party request. With
`VITE_ARCGIS_API_KEY` (Esri World Imagery) or `VITE_EOX_BACKDROP=true` (EOX Sentinel-2 2016) the imagery modes work
and the browser contacts exactly that provider's host. **Date:** 2026-10-24.

Labels: **[DOC]** quoted from an official source (URL given; all retrieved 2026-10-24). **[INFERRED]** our
recommendation or reasoning. **[UNVERIFIED]** needs a key or vendor answer; the procedure is in §9. **[SRC]** read
in a third-party package's source in a scratch install outside this repo. **[PLANNED]** not built yet.

Keys: only a free-tier ArcGIS key with pay-as-you-go left off is supported (§Free providers), and only the owner adds
it, outside git. Google keys are out of scope under the no-billing decision. In §5 below, `VITE_ESRI_API_KEY` is
superseded by `VITE_ARCGIS_API_KEY`.

---

## Modes

**Owner decision (binding, 2026-10-24): no billing, free sources only.** Google Map Tiles (2D satellite and
Photorealistic 3D Tiles) need a Google Cloud billing account, so they are **not implemented**; the Google parts of
§§1–11 below remain a record of what enabling them would take, not a plan. Google Maps, Earth and Street View are
never a data source. No 3D-tiles renderer dependency is added: with no photorealistic source there is nothing for it
to draw.

The app offers **five clearly labelled view modes in one flat list**. The basemap (campus vector map or satellite
imagery) is a property of each mode, not a second user-facing switch: that is the simplest model that still gives
the five options, keeps every `?view=` link meaningful, and leaves nothing to combine wrongly (e.g. "isometric +
satellite").

| Mode (title)       | Id            | `?view=`    | Switcher label / accessible name | Renderer  | Satellite imagery                     | Available today                                          | Falls back to                          |
| ------------------ | ------------- | ----------- | -------------------------------- | --------- | ------------------------------------- | -------------------------------------------------------- | -------------------------------------- |
| Satellite 2D       | `satellite2d` | `satellite` | Satellite / "Satellite map"      | MapLibre  | required                              | Only with a free provider configured (§Free providers)   | Campus map 2D → Isometric              |
| Photorealistic 3D  | `photoreal3d` | `earth`     | Photoreal / "Photorealistic 3D"  | none      | —                                     | **Never** (no billing-free source; LPU coverage unknown) | Campus 3D → Campus map 2D → Isometric  |
| Campus 3D          | `realistic3d` | `3d`        | 3D / "3D map"                    | MapLibre  | optional (used when one is available) | Yes (needs WebGL)                                        | Campus map 2D → Isometric              |
| Isometric overview | `isometric`   | `iso`       | Overview / "Isometric overview"  | Canvas 2D | none                                  | Yes                                                      | — (needs neither WebGL nor a provider) |
| Campus map 2D      | `standard2d`  | `2d`        | 2D / "2D map"                    | MapLibre  | none                                  | Yes (needs WebGL)                                        | Isometric                              |

"Campus 3D" is the owner's "Editable Campus 3D": our campus buildings (imported OpenStreetMap footprints, not
surveyed) plus published Building Studio models. It is not photorealistic and is never presented as the
Photorealistic 3D mode.

Rules (all implemented in `src/app/view-mode.ts` and tested in `tests/unit/app/view-mode.test.ts`):

- **Unavailable modes stay visible with their reason**, never hidden and never faked. Reasons come from
  `src/map/providers/types.ts`: `SATELLITE_NOT_CONFIGURED_REASON`, `PHOTOREAL_UNAVAILABLE_REASON` (+
  `PHOTOREAL_UNAVAILABLE_DETAIL` for an info dialog), `PROVIDER_FAILURE_REASONS` (auth, quota, network, no WebGL).
- **The store never enters a blocked mode**: `setViewMode` refuses it (`viewModeBlockedReason`).
- **Deep links**: `?view=3d|iso|2d` work as before; `?view=satellite` and `?view=earth` open only when the mode is
  available, otherwise the device default applies and the parameter is dropped from the URL (`deepLinkViewMode`).
- **Fallbacks** (`VIEW_MODE_FALLBACKS`, `resolveViewMode`): a missing key, a quota or network failure, or no WebGL
  moves to the next mode in the chain and returns the reason to announce. The chain always ends in the overview, so
  there is no blank screen.
- **Availability** is `ViewModeAvailability` (`{satellite, photoreal}`: null = available, else the reason). Until the
  provider registry reports otherwise, `DEFAULT_VIEW_MODE_AVAILABILITY` applies: satellite not configured,
  photorealistic unavailable.
- **The switcher** (`src/components/map-controls/ViewModeSwitcher.tsx`) shows all five options in the owner's order
  (`VIEW_MODE_OPTIONS`); on phones they sit in two columns so the control column is no taller than before (a
  single column reached the bottom sheet and the attribution button and failed axe `target-size`). Choosing an
  unavailable option changes nothing; its reason is shown as a toast and announced (Photorealistic 3D shows
  `PHOTOREAL_UNAVAILABLE_DETAIL`). Accessible names: "Satellite map", "Photorealistic 3D", "3D map", "Isometric
  overview", "2D map" — no name contains another, so role queries stay unambiguous (unit-tested).
- **Availability is per build and per session**: the store holds `availability`, derived from this build's registry
  (`BUILD_PROVIDERS`, `src/map/providers/runtime.ts`) and `imageryRuntime` (a failure seen this session; online or
  not). Deep links are checked against it.

Provider contract (`src/map/providers/types.ts`):

- `ImageryProvider`: id, label, attribution as text parts plus required logo text (rendered as text nodes and
  links, never HTML), min/max zoom, `requiresKey`, `configured()` (pure, no network), `source()` (raster tile
  template(s) or a style URL; the key is added at runtime from `.env.local` / build env, never written in code),
  `imageryDate` metadata or null, and `offline: false` (third-party tiles are never precached or cached offline).
- `PhotorealProvider`: always `status: 'unavailable'` with a reason (`PHOTOREAL_PROVIDER`).
- `TerrainProvider` (optional; none configured), `ProviderRegistry`, `ProviderStatus` / `CapabilityReport`
  (capability and coverage detection result), `ProviderCamera`.
- **Imagery date**: only an officially published capture date counts, with its source and the date it was checked;
  a year in a copyright line is not a capture date, and imagery is never described as "live". If Esri World Imagery
  is adopted, the measured record is "captured 2023-12-18, WorldView-3, 0.31 m" (Esri metadata service, checked
  2026-10-24; `IMAGERY_COVERAGE_AND_FRESHNESS.md`). The UI shows it only as "Imagery captured 2023-12-18 according to
  Esri World Imagery Wayback metadata (retrieved 2026-10-24)." and only while the view centre is inside the area
  where it was verified (`ESRI_IMAGERY_DATE.verifiedBounds`); elsewhere it says "Capture date not verified for this
  part of the map."
- Added while implementing (additive, in `types.ts`): `ImageryDateMetadata.verifiedBounds` and `.statement`;
  `ImageryProvider.detail` ('high' | 'low'), `cameraMaxZoom`, `cameraBounds`, `caption`, `notice`, `origins`,
  `probeUrl()`.

---

## Free providers (implemented)

Code: `src/map/providers/` — `config.ts` (env parsing; warnings name the variable, never the value), `esri.ts`,
`eox.ts`, `registry.ts` (registry, capability detection, which imagery each mode draws), `failure.ts` (error
classification, one metadata probe, debounce), `attribution.ts` (escaped attribution HTML, the date line),
`camera.ts` (maxPitch, return-to-campus helpers), `imagery-layer.ts` (MapLibre wiring; imported by MapView only),
`runtime.ts` (this build's registry). UI: `src/components/map-controls/ImageryNotice.tsx` and
`ReturnToCampusButton.tsx`; wiring in `src/app/MapStage.tsx`, `src/map/MapView.tsx`, `src/app/store/map-slice.ts`
and `src/app/hooks/useImageryRuntime.ts`.

| Mode              | Imagery drawn                                                    | On top                                                                                                    |
| ----------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Satellite 2D      | the first configured provider (Esri if its key is set, else EOX) | footprints (white outline, 22 % fill), boundary, footpaths/steps (light dashes), labels, routes, GPS puck |
| Photorealistic 3D | none — never entered                                             | —                                                                                                         |
| Campus 3D         | Esri only (`detail: 'high'`), never the 10 m EOX backdrop        | extrusions in the light-theme neutral tones in both themes (no textures), studio models, as above         |
| Isometric         | none                                                             | —                                                                                                         |
| Campus map 2D     | none (default, offline, unchanged look)                          | —                                                                                                         |

On imagery our basemap area fills and road fills are hidden; everything else stays. Imagery is added and removed with
`addSource`/`removeSource`, never `setStyle`, so selection, routes, the puck, studio models and the map-editing
layers (`src/map/editing`) keep working on every basemap (unit-tested: the editing layers sit above the raster and
clicks still go to the editor).

### Esri World Imagery (ArcGIS Location Platform, free tier)

- **Endpoint** [DOC, Esri's MapLibre tutorial "Display multiple basemap layers", retrieved 2026-10-24]: map tile
  service `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=<key>`
  (rows before columns), 256 px tiles. The Static Basemap Tiles service (`static-map-tiles-api.arcgis.com`) lists
  only `arcgis/imagery/labels`, not the imagery itself, so it is not used.
- **Max zoom 19** over the campus (`MaxMapLevel 19` in Esri's metadata, [MEASURED] 2026-10-24); MapLibre over-zooms
  beyond it instead of requesting tiles that do not exist.
- **Attribution** [DOC https://developers.arcgis.com/documentation/esri-and-data-attribution/interactive-maps/]: the
  text "Powered by Esri" ("The word Esri should be linked to https://www.esri.com" is a recommendation) and data
  attribution "on or at the bottom of the map where it is always visible", with "an expandable UI … when they can not
  be displayed on small screens" allowed. Implemented: MapLibre's attribution control lists "Powered by Esri | Source:
  Esri, Vantor, Earthstar Geographics, and the GIS User Community" (the service's `copyrightText`, read 2026-10-24)
  whenever the imagery is drawn, and the imagery notice repeats "Powered by Esri". Re-read `copyrightText` when
  updating: Esri asks to "Frequently verify names as data source providers can change".
- **Billing** [DOC https://location.arcgis.com/help/billing/]: "A payment method is required to enable pay-as-you-go
  (PAYG) to continue using services beyond the free tier"; "Without PAYG turned on you only have privileges enabled
  for services with a free tier" (and "that free tier has not been exhausted"). Free tier "2M free then $0.15 per
  1,000 tiles" for "Vector, map, and static basemap tiles" [DOC https://location.arcgis.com/pricing/]. With PAYG left
  off there is no bill: access stops until the next billing cycle and the app falls back (quota). Whether sign-up
  asks for a card remains [UNVERIFIED]: the account-management help page lists email, username, password, portal URL,
  security question and accepting the terms, and does not mention a card.
- **Terms**: no caching or offline storage ([DOC] Esri Master Agreement E204 §3.2(c): "Customer may not otherwise
  scrape, download, or store Data"). The service worker has no runtime route for it (tested).
- **Owner steps (key)** [DOC
  https://developers.arcgis.com/documentation/security-and-authentication/api-key-authentication/tutorials/create-an-api-key/location-platform/]:
  1. Sign up for ArcGIS Location Platform and **leave pay-as-you-go off**.
  2. Portal → Content → My content → New item → Developer credentials → API key credentials.
  3. "Where will you use these credentials?" → **Public application**; item access: none.
  4. Privileges: **Basemaps** only.
  5. Referrers: the site's own origins only (production domain and this project's `pages.dev` domain). Expiration: at
     most one year; "The expiration date and referrers of an access token cannot be changed without invalidating the
     token".
  6. Copy the key (shown once) into `.env.local` (git-ignored) as `VITE_ARCGIS_API_KEY=…` for local work, and into
     the Cloudflare Pages **build** environment for deploys. Never commit it. It is public once built (a `VITE_`
     variable); the referrer restriction and PAYG-off are what protect it.
- **Measured failure behaviour** (2026-10-24, curl; bodies discarded, nothing stored): a tile request **without** a
  token returns HTTP 200 `text/plain` with `{"error":{"code":499,"message":"Token Required."}}`; the service metadata
  without a token returns the same JSON error with HTTP 200; a request with a **malformed** token was answered
  normally (HTTP 200 JSON for the metadata, `image/jpeg` for a tile). So an invalid key is not reliably refused.
  The app treats a non-image tile from a keyed provider, HTTP 401/403/498/499 and JSON error codes 498/499/403 as
  **auth**, 429 as **quota**, and four failed tiles with none loaded in between as **network** (`failure.ts`). Esri's
  answer when the free tier is exhausted has not been observed [UNVERIFIED]; it may surface as auth or network.
- **Probe**: the first time Esri imagery is shown in a page, one metadata request (`…/MapServer?f=json&token=…`, no
  imagery) checks the key; a 498/499/403 answer falls back at once.

### EOX Sentinel-2 cloudless 2016 (keyless backdrop)

- **Terms re-checked 2026-10-24** [DOC https://cloudless.eox.at/documentation/faq]: the 2016 vintage "is published
  under the CC BY 4.0 license. You may use this data as an embedded basemap in commercial mobile apps, B2B portals,
  video templates, and websites", provided attribution, no SLA, no redistribution of raw tiles, and "a Fair Use
  Policy applies"; "Commercial apps may access the free 2016 endpoint under CC BY 4.0, provided traffic is
  reasonable." For 2018+ layers "Using the public WMS/WMTS endpoints for commercial production apps is strictly
  prohibited" — they are never used.
- **Endpoint** (WMTS capabilities: layer `s2cloudless_3857`, "Sentinel-2 cloudless layer for 2016 by EOX - 3857",
  matrix set `g`): `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg`.
- **Attribution** ("Attribution must be visible whenever the imagery is shown"): "EOxCloudless
  https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)", plus "CC BY 4.0".
- **Never misleading**: 10 m pixels cannot show buildings. Tiles are requested up to z13 (≈16 m/px at the campus
  latitude) and the camera stops at **z14** (≈8 m/px). The notice "10 m imagery — buildings not visible" stays
  visible while it is shown. The campus panning limit keeps a 1440 px window above z14.6, so the backdrop uses a
  wider limit (`EOX_CAMERA_BOUNDS`, about ±8 km); the campus limit returns when it is removed. Campus 3D never uses
  it.
- **Enable**: `VITE_EOX_BACKDROP=true`. It is used for Satellite 2D only when no Esri key is set. Off by default: it
  sends the viewed area to EOX, so it is the owner's choice.

### Photorealistic 3D: unavailable

`PHOTOREAL_PROVIDER` (status 'unavailable') is the only photorealistic provider. The option is always visible,
disabled, and explains why; `?view=earth` is ignored and removed from the URL. No 3D-tiles dependency was added.

### Terrain: none (measured)

[MEASURED 2026-10-24] Copernicus GLO-30 tile `Copernicus_DSM_COG_10_N31_00_E075_00_DEM.tif` from the public bucket
`https://copernicus-dem-30m.s3.amazonaws.com/`, read in a scratch directory outside the repo (geotiff.js), 1,080
pixel centres inside the campus boundary: min 222.5 m, p5 232.4 m, median 234.0 m, p95 242.2 m, max 249.1 m (range
26.5 m). GLO-30 is a surface model, so the upper values include buildings and trees. A ground proxy (10th percentile
in each cell of a 3 × 3 grid over the boundary bbox) varies only 231.2–235.9 m: about 4.7 m over roughly 1.1 × 1.7
km, a ≈0.3 % slope. That relief would not be visible, and draping GLO-30 would raise the ground under buildings, so
**no terrain is added** and nothing was added to the repo. If terrain is ever added, the Copernicus DEM licence
(License-COPDEM-30) notice must be shown; copy its exact wording from the licence PDF at that time [UNVERIFIED here].

### Fallbacks (never a blank map)

| Trigger                                          | In Satellite 2D                                    | In Campus 3D with imagery                 |
| ------------------------------------------------ | -------------------------------------------------- | ----------------------------------------- |
| No key / not configured                          | option disabled with the reason                    | campus map look (no imagery)              |
| 401/403/498/499, non-image tile, probe refusal   | → Campus map 2D, toast and announcement            | stays in Campus 3D without imagery, toast |
| 429 / free tier used up                          | → Campus map 2D, "free limit … reached"            | as above                                  |
| Network (4 failed tiles, or the browser offline) | → Campus map 2D; back online re-enables the option | as above                                  |

Auth and quota failures last for the page session; the mode is never switched back automatically. Imagery errors
never reach the generic "campus data" banner, and their URLs (which carry the key) are never logged or shown.

### Camera

- `maxPitch` 60 (MapLibre's default; MapLibre documents values above 60 as experimental), set explicitly in MapView.
- Switching between map modes keeps the camera and eases pitch/bearing (`setBuildingMode`, 700 ms; a jump with
  reduced motion); focusing a place uses `flyTo`.
- **Return to campus**: a "Back to campus" button appears in every map mode and size while no part of the campus
  boundary is on screen, and glides back to the whole-campus view (`requestFocus({kind:'reset'})`).

### Privacy and the default view

- Without provider variables: no third-party request; the privacy text is unchanged.
- **With an Esri key**: Satellite 2D and **Campus 3D** draw Esri imagery. Campus 3D is the default view on screens at
  least 768 px wide, so with a key **the desktop default view contacts Esri at start-up**; phones start in Campus map
  2D, which never does. The privacy panel then adds "Satellite imagery comes from Esri World Imagery": the browser
  downloads tiles directly from `ibasemaps-api.arcgis.com`, which receives the IP address and the viewed map area
  (which shows roughly where the user is while the map follows their live location); tiles are never stored offline.
  An owner who wants no third-party request by default should not set the key.
- **With only the EOX backdrop**: only Satellite 2D contacts EOX, after the user picks it (or opens
  `?view=satellite`).

### CSP and PWA

- `public/_headers`: `connect-src 'self' https://ibasemaps-api.arcgis.com https://tiles.maps.eox.at` — exactly the
  provider origins (tested against `IMAGERY_ORIGINS`); every other directive unchanged. MapLibre fetches raster tiles
  (`refreshExpiredTiles` stays at its default `true`), so `img-src` needs no host. The file is static, so a build
  without provider variables also allows these two hosts; it never contacts them.
- `src/offline/pwa-config.ts`: `runtimeCaching: []`, and no precache glob can match a provider (unit-tested); the e2e
  smoke checks that Cache Storage holds no provider URL after Satellite 2D was shown.

### Tests

- Unit: `tests/unit/map-providers/*` (config, registry, availability, fallback, failure classification, probe,
  attribution escaping, date line, CSP/PWA/no-key guards, privacy text, MapLibre wiring, store fallback, notices) and
  `tests/unit/app/view-mode-switcher.test.tsx`.
- e2e: `tests/e2e/map-modes.spec.ts`. Every provider request is answered by route interception with **synthetic**
  tiles (a generated grid, not imagery) or an injected failure; any other non-local request fails the test. It reads
  the build's configuration from the UI, so run it once per build, from a directory outside `dist/`:

  ```sh
  VITE_ARCGIS_API_KEY=TEST_ONLY_fake_arcgis_key_0123456789abcdef npx vite build --outDir <tmp>/key
  npx vite preview --outDir <tmp>/key --port 5402 --strictPort   # in another shell
  PW_PORT=5402 npx playwright test tests/e2e/map-modes.spec.ts
  # repeat with VITE_EOX_BACKDROP=true and with no variables; MAP_MODES_SHOTS_DIR=<dir> also saves screenshots
  ```

---

## 1. Prerequisites (owner)

1. Decision D1 recorded: Google modes are **opt-in** views; own-data stays the default and the offline path.
2. A Google Cloud billing account. [DOC] "To use the Map Tiles API, you must enable billing on each of your projects
   and include an API key or OAuth token with all API or SDK requests"
   (https://developers.google.com/maps/documentation/tile/usage-and-billing).
3. **Billing address in India**, for two reasons:
   - [DOC] "India pricing is available only to India-based customers that incur a large majority of their usage in
     India and are billed in India" (https://developers.google.com/maps/billing-and-pricing/overview).
   - [DOC] For EEA billing addresses, "Satellite image tiles in 2D Tiles are not available. Photorealistic 3D tiles
     are not available" (https://developers.google.com/maps/comms/eea/map-tiles).
4. Tax details if required. [DOC] ToS §21 (India): "Customer will provide Google with applicable tax identification
   information (Goods and Services Tax Identification Number ('GSTIN') …"; Google Cloud India Private Limited is the
   reseller in India (https://cloud.google.com/maps-platform/terms).
5. [DOC] "Accounts eligible for India pricing cannot enroll in subscription plans" (billing overview).
6. [DOC] India regional terms (ToS §21, "Asia Pacific — India", applied when the billing address is in India): the
   customer pays "the Fees plus any applicable Taxes"; claims are "governed by laws of India … litigated exclusively
   in the courts of New Delhi"; India list prices are in USD ("Prices - USD", pricing-india page). Budget taxes on
   top of the list prices [INFERRED].
7. [DOC] Credits exist through Google public programs; the academic one is for faculty "to teach courses"
   (https://developers.google.com/maps/billing-and-pricing/public-programs). Do not assume they cover this app
   [INFERRED]; assessment §3.6.

## 2. Google Cloud project setup [PLANNED]

| Step | Action                                                                      | Notes                                                                                                                                                      |
| ---- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Create **two projects**: `lpu-atlas-maps-staging` and `lpu-atlas-maps-prod` | [INFERRED] keeps verification traffic and its quotas away from production.                                                                                 |
| 2    | Link each project to the billing account                                    |                                                                                                                                                            |
| 3    | Enable **Map Tiles API** only                                               | It serves both 2D satellite tiles and Photorealistic 3D Tiles from `tile.googleapis.com`. Do **not** enable Maps JavaScript API: the plan does not use it. |
| 4    | Create the API keys (§3)                                                    |                                                                                                                                                            |
| 5    | Set quota caps (§4.1) and budgets with alerts (§4.2)                        | Before the first request.                                                                                                                                  |
| 6    | Run the verification checks in §9 in staging                                | Before any production build includes the key.                                                                                                              |

[DOC] "All Map Tiles API applications require authentication"
(https://developers.google.com/maps/documentation/tile/web-api-best-practices).
[DOC] A 403 can mean "your API key has not been added to the allowlist for 3D Tiles. Contact Google Support with
your project ID to get added to the allowlist" (https://developers.google.com/maps/documentation/tile/error_handling).

## 3. API keys and restrictions

### 3.1 What Google says (and where it is ambiguous)

- [DOC] "Restrict you API keys to prevent unauthorized usage. You are financially responsible for charges caused by
  abuse of unrestricted API keys." (https://developers.google.com/maps/api-security-best-practices)
- [DOC] "API restrictions only allow requests to the APIs and SDKs you specify." (same page)
- [DOC] Websites restriction: "Always provide the whole referrer string, including the protocol scheme, hostname and
  optional port"; "Be careful when authorizing full-path referrers … most web browsers will for privacy reasons strip
  the path from cross-origin requests." (same page)
- [DOC] Google's Map Tiles samples put the key in browser code: CesiumJS `root.json?key=YOUR_API_KEY`, deck.gl
  `X-GOOG-API-KEY` header (https://developers.google.com/maps/documentation/tile/use-renderer).
- [DOC] **But** the same security page lists **Map Tiles API** under "Apps and servers using web services", which
  should use IP restrictions, and warns: "Web service API keys are not expected to be publicly exposed to
  unauthorized users or untrusted applications or devices!"
- [DOC] Its proxy guidance says: "Don't allow clients to relay arbitrary API calls using the proxy" and "Always require
  authentication for client access to the proxy servers."
- [DOC] Pointing the other way, the same page's Websites section says: "For websites using Maps JavaScript API
  services, Maps Static API or Street View Static API or calling recent Google Maps Platform services directly over
  the HTTPS REST API or gRPC, use the Websites application restriction", and its troubleshooting section says "more
  recent Google Maps Platform APIs will also support referrer restrictions", adding that browsers "will likely
  restrict the Referer header to the Origin for cross-origin requests". Map Tiles API is not named in either passage.
- [DOC] The Map Tiles get-api-key page's generated "Page Summary" says "Google strongly recommends restricting your
  API keys by limiting their usage to specific APIs and IP addresses"
  (https://developers.google.com/maps/documentation/tile/get-api-key). IP restrictions cannot work for a browser key.
- [DOC] "If you need to call Google Maps Platform services both from server-side applications and directly from
  client-side applications … Google recommends splitting up your usage between two separate projects", which "lets
  you apply appropriate per-minute, per-user quota limits" (api-security-best-practices). Whether per-user limits
  are offered for Map Tiles API is [UNVERIFIED]; check Quotas & System Limits.
- **Conclusion.** A browser-exposed key is not the documented primary model for Map Tiles API (it is listed with
  server-side web services), but Google's own Map Tiles renderer samples use one and the security page allows
  Websites restrictions for "recent" REST APIs. **No Map Tiles page states that Website (HTTP referrer) restrictions
  are enforced on `tile.googleapis.com`.** [UNVERIFIED] Test it (§9.1) before relying on it.

### 3.2 Recommended keys [INFERRED, PLANNED]

| Key                   | Project | API restriction   | Application restriction (Websites)                                                              | Used by                   |
| --------------------- | ------- | ----------------- | ----------------------------------------------------------------------------------------------- | ------------------------- |
| `atlas-tiles-prod`    | prod    | **Map Tiles API** | `https://<production-domain>/*` and `https://<project>.pages.dev/*`                             | production build only     |
| `atlas-tiles-preview` | staging | **Map Tiles API** | `https://*.<project>.pages.dev/*` (this project's preview subdomains only, never `*.pages.dev`) | Cloudflare Pages previews |
| `atlas-tiles-dev`     | staging | **Map Tiles API** | `http://localhost:5173/*`, `http://127.0.0.1:5173/*` (match the dev and preview ports used)     | local development         |

- One key per environment, so a leaked dev key can be revoked without touching production.
- Write referrers as `https://host/*`: the app sends `Referrer-Policy: strict-origin-when-cross-origin`
  (`public/_headers`), and [DOC] "Modern browsers typically redact the Referer header in cross-origin request …
  stripping it down to the Origin".
- If §9.1 shows referrer restrictions are **not** enforced, use option B below or do not launch.

### 3.3 Option B: Cloudflare Pages Function proxy [INFERRED, PLANNED only if needed]

- A function under `functions/` that holds an IP-restricted or unrestricted key as a **Cloudflare secret** (never a
  `VITE_` variable), and relays only the fixed Map Tiles paths the app needs (`createSession`, `viewport`,
  `2dtiles/{z}/{x}/{y}`, `3dtiles/...`).
- It must not cache Google responses ([DOC] ToS 3.2.3(b) "No Caching"; the policies page says clients must respect
  "the private directive when they are passed in the response"; whether Map Tiles responses actually carry
  `Cache-Control: private` is [UNVERIFIED], read the headers in staging) and must bypass the Cloudflare edge cache.
- Caveat: the atlas has no user login, so Google's "always require authentication" advice cannot be met for public
  users; a public proxy only moves the abuse problem. Rate-limit by origin and IP, and keep the daily quota caps.
- All tile traffic would flow through Cloudflare (3D child tile URLs also need the key [DOC create-renderer: "You
  must attach it to all subsequent tile requests"]).

## 4. Quotas and budgets

### 4.1 Quota caps (the only hard stop)

Defaults [DOC], from https://developers.google.com/maps/documentation/tile/usage-and-billing unless noted:

| Limit                                    | Documented value                                                                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2D tiles per day                         | **Conflict:** "Maximum 15,000 2D Tile … queries per project per day" vs release note 2026-05-21 "Old Default: 15,000 queries per day (QPD) - New Default: 100,000 QPD" (…/tile/release-notes). [UNVERIFIED] read Cloud Console. |
| 2D tiles per minute                      | "Maximum 6,000 2D Tile, Street View Tile, Thumbnail, or Street View PanoID queries per project per minute"                                                                                                                      |
| Session and viewport requests per minute | "Maximum 6,000 session token requests, viewport information requests, or Street View Metadata requests per project per minute"                                                                                                  |
| 3D root tileset requests per day         | "Maximum 10,000 root tileset queries per day"                                                                                                                                                                                   |
| 3D renderer tile requests                | "Unlimited renderer-originating tile requests per day"; "Rate limit is 12,000 queries per minute for the tile renderer"                                                                                                         |

[DOC] "When the number of requests in your project reaches the quota limit, your service stops responding to
requests" (usage page). [DOC] "Requests that fail authentication" don't count against quota
(https://developers.google.com/maps/billing-and-pricing/manage-costs).
[DOC] "Because of the technical separation between the quota and billing systems, discrepancies may exist … consider
requesting a quota adjustment to set your quota limits slightly lower than your absolute maximum" (same page).

[DOC] Lowering a default is supported: "If you wish to cap your usage at a lower level to manage costs or prevent
unexpected traffic spikes, you can set a quota override (also known as a consumer override)" on the Quotas & System
Limits page (release note 2026-05-21, …/tile/release-notes). [DOC] Usage page: "Tile requests for Photorealistic 3D
Tiles don't impact your daily quota"; only root requests do.

**Recommended caps [INFERRED arithmetic from the cited free caps; owner decision D7]:** set the daily cap at or below
the monthly free usage divided by 31, so the app falls back to own-data instead of billing.

| SKU                      | Free/month (global / India list) [DOC] | Daily cap ≈ free ÷ 31 (global / India) |
| ------------------------ | -------------------------------------- | -------------------------------------- |
| 2D Map Tiles             | 100,000 / 700,000                      | ≈ 3,225 / ≈ 22,580 tiles               |
| Photorealistic 3D (root) | 1,000 / 7,000                          | ≈ 32 / ≈ 225 root requests             |

The 3D row assumes billing per root request, which is **unverified** (assessment §3.3). If 3D turns out to be
billed per tile, the root-request quota does not bound cost, and Earth 3D must stay off until another cap exists.

### 4.2 Budgets and alerts (notification only)

- [DOC] "You can set budget alerts to notify you when you've reached a certain percentages of your total budget"
  (https://developers.google.com/maps/billing-and-pricing/manage-costs).
- [DOC] "Remember: Setting a budget does not automatically cap Google Cloud or Google Maps Platform usage or
  spending."
- [DOC] "The Quotas page reflects real-time usage for service resilience but is not a source of truth for billing
  … the Cloud Billing Dashboard … may have up to 48 hours of latency."
- [INFERRED] Create a monthly budget per project with alerts at 50 %, 90 % and 100 %, sent to the owner and the
  maintainer. Review the Billing report weekly for the first month.
- [DOC] Free usage "resets on the first day of each month, at midnight Pacific US time" (billing overview). The
  USD 200 monthly credit no longer exists: "Google has replaced the USD $200 monthly recurring credit with a free
  monthly usage threshold for each Core Services SKU" (https://developers.google.com/maps/billing-and-pricing/march-2025).

## 5. Environment variables [PLANNED]

Vite inlines every `VITE_*` variable into the browser bundle (as `.env.example:1-3` already warns). The Google key is
therefore **public by design**; its protection is the restrictions in §3 and the caps in §4, not secrecy.

| Variable                       | Example                             | Meaning                                                                                                                            |
| ------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_GOOGLE_MAPS_API_KEY`     | (empty)                             | Restricted browser key (§3.2). **Empty or unset = no Google modes, today's CSP, today's privacy text.**                            |
| `VITE_MAP_PROVIDERS`           | `google-satellite,google-photoreal` | Which optional providers to register. Ignored without a key. `own-data` is always present.                                         |
| `VITE_GOOGLE_MAPS_REGION`      | `IN`                                | `region` in the 2D session request ([DOC] "represents the physical location of the user").                                         |
| `VITE_GOOGLE_MAPS_LANGUAGE`    | `en-IN`                             | `language` (IETF tag) in the 2D session request.                                                                                   |
| `VITE_PHOTOREAL_3D_COVERAGE`   | `unknown`                           | `unknown` \| `terrain-only` \| `photogrammetry`, copied from the dated decision record (`IMAGERY_COVERAGE_AND_FRESHNESS.md` §4.5). |
| `VITE_PHOTOREAL_3D_CHECKED_ON` | `2026-11-01`                        | Date of that decision record.                                                                                                      |
| `VITE_ESRI_API_KEY`            | (empty)                             | Only if decision D8 adopts the Esri fallback (§10).                                                                                |

Rules:

- Put real values in **`.env.local`** for local work. `.gitignore` already ignores `.env` and `.env.*` except
  `.env.example` (`.gitignore:7-9`). Never commit a key, never put it in `wrangler.toml`, docs, tests or issue text.
- For Cloudflare Pages, set the variables as **build-time** environment variables in the Pages project, separately for
  Production and Preview, using the matching key from §3.2.
- `config.ts` validates them with Zod at build/start; an invalid value disables the Google providers with a console
  warning, never a crash.
- Tests never read a real key. Unit and e2e tests use a fake key and the `stub` provider with a local tile origin.
- When this is implemented, update `.env.example` (its "needs NO secrets" header becomes "needs no secrets; optional
  public, restricted map keys") and keep `tests/server/security/secrets.test.ts` scanning for server secrets.

## 6. Session handling [PLANNED]

### 6.1 2D tiles

- [DOC] "You must include a session token in all requests for 2D Tiles and Street View imagery."
- [DOC] Request: `POST https://tile.googleapis.com/v1/createSession?key=KEY` with `{"mapType":"satellite",
"language":"en-IN","region":"IN"}`; response `{"session": "...", "expiry": "...", "tileWidth": 256, "tileHeight":
256, "imageFormat": ...}` (https://developers.google.com/maps/documentation/tile/session_tokens).
- [DOC] "A session token is currently valid for two weeks from its issue time, but this might change. You can always
  check the expiration time of a session token by looking at the expiry field."
- [DOC] "You can use the same session token across multiple clients."
- [INFERRED] Each browser creates one token when the user first opens Satellite 2D and keeps it **in memory only**
  (not localStorage: it is Google service state, and a fresh one is free). Re-create on an `expired` error or when
  `expiry` is near. Session and viewport calls are not billed [DOC sku-details].
- Tile URL: `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=SESSION&key=KEY`.
- Viewport (attribution and max zoom): `https://tile.googleapis.com/tile/v1/viewport?session=…&key=…&zoom=…&north=…&south=…&east=…&west=…`,
  throttled to camera `moveend`.

### 6.2 Photorealistic 3D

- [DOC] "You need to use session tokens for getting 2D Tiles and Street View Tiles, but not for getting 3D Tiles."
- [DOC] Child tile URIs carry a `session` parameter, and the key must be attached to every subsequent request
  (create-renderer). loaders.gl propagates `?session=` automatically [SRC: @loaders.gl/tiles 4.5.4].
- [DOC] "at least three hours of tile requests from a single root tileset request" (3d-tiles) vs "up to three hours"
  (usage page). [INFERRED] Re-request `root.json` after 2.5 hours or on a 400, whichever comes first, and never more
  than once per Earth 3D visit otherwise.

## 7. Attribution obligations [PLANNED]

| #   | Obligation                                                                                                                                                                                                           | Source                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | Show the **Google Maps logo** in every Google view. "Minimum logo height: 16dp; Maximum logo height: 19dp"; clear space 10dp left, right and top, 5dp bottom. Self-host the official asset (CSP `img-src 'self'`).   | [DOC] policies                                                       |
| 2   | 2D: display the `viewport` `copyright` string, updated as the view changes. If space is short, a "Data sources" control is acceptable.                                                                               | [DOC] 2d-tiles-overview; policies                                    |
| 3   | 3D: collect `asset.copyright` from displayed tiles, split on `;`, **sort by occurrence** and show one line. Google's deck.gl sample uses an unsorted `Set`; add the count.                                           | [DOC] create-renderer ("aggregate, sort, and display"); use-renderer |
| 4   | Keep the campus attribution ("© OpenStreetMap contributors", ODbL; detection credits when shown) in a **separate** block that never overlaps Google's.                                                               | [DOC] policies ("must clearly be disassociated from Google's")       |
| 5   | No other logo may overlap the Google logo or the data attribution. The MapLibre logo stays off.                                                                                                                      | [DOC] policies                                                       |
| 6   | The app's terms must tell users it includes Google Maps features and content, and link https://maps.google.com/help/terms_maps/ and https://policies.google.com/privacy.                                             | [DOC] ToS 3.2.2(a)(i)                                                |
| 7   | Do not modify, obscure or delete Google's attribution.                                                                                                                                                               | [DOC] ToS 3.2.2(b)                                                   |
| 8   | Before showing the user's GPS position in a Google view, notify them in advance of "the combination and use of End User's location with any other data provider's data" and get "express, prior, revocable consent". | [DOC] ToS 4.4(c)(iii)                                                |

## 8. Cost control in the app [PLANNED, INFERRED]

1. Google modes are **opt-in** and never the startup view; no Google request happens until the user selects a Google
   mode and accepts the notice.
2. Lazy loading: the Earth 3D chunk downloads only when the mode opens.
3. No prefetching of neighbouring tiles or zoom levels; MapLibre `maxzoom` for the Google source clamped to
   `maxZoomRects`.
4. Camera bounds stay at the campus `maxBounds`, so users cannot pan Google views across India.
5. Viewport calls throttled to `moveend`.
6. One 3D root request per visit (plus the timed refresh).
7. Circuit breaker: on `quotaExceeded`, `rateLimitExceeded` or HTTP 429, back off ([DOC] "exponential backoff",
   error_handling); after repeated failure, fall back to own-data with "Satellite view is unavailable right now".
8. No analytics are added. Usage is monitored only in Cloud Console (the app has no analytics by design,
   `src/privacy/privacy-facts.ts:17-18`).
9. Never cache Google responses in the service worker; the browser HTTP cache follows Google's `Cache-Control`
   headers ([DOC] policies: "your client must respect the max-age value … and the private directive").

## 9. Verification before go-live (staging, with a key)

### 9.1 Are Website restrictions enforced on `tile.googleapis.com`? [UNVERIFIED]

1. Restrict a staging key to Websites `https://example.invalid/*` and API = Map Tiles API.
2. `curl -X POST -H 'Content-Type: application/json' -H 'Referer: https://example.invalid/' -d '{"mapType":"satellite","language":"en-IN","region":"IN"}' "https://tile.googleapis.com/v1/createSession?key=K"`
   should succeed.
3. Repeat with no `Referer` and with `Referer: https://other.invalid/`; both should fail with a 403.
4. Repeat steps 2–3 for `GET https://tile.googleapis.com/v1/3dtiles/root.json?key=K` and one child tile.
5. Record the results. If steps 3–4 succeed without the right referrer, restrictions are not enforced: use option B
   (§3.3) or do not launch.
6. [INFERRED] Even if enforced, step 2 shows that any non-browser client can send the allowed `Referer`. A referrer
   restriction stops other websites from using the key in browsers; it does not stop scripted abuse. The daily
   quota caps (§4.1) remain the only hard bound on cost.

### 9.2 Other checks

| Check                        | Procedure                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Live 2D daily quota default  | Cloud Console → Google Maps Platform → Quotas & System Limits → Map Tiles API "2D Tiles"                           |
| 3D billing unit              | Assessment §3.3                                                                                                    |
| 3D allowlist                 | First root request; a 403 naming the allowlist means contacting Google Support with the project id                 |
| India pricing applied        | Billing report shows SKU names with "(India)" (e.g. DA70-1FF2-6B9D, 592E-920B-C911)                                |
| Coverage and max zoom        | `IMAGERY_COVERAGE_AND_FRESHNESS.md` §4                                                                             |
| Tiles per typical 2D session | Staging build, DevTools Network, a scripted 2-minute browse; record the count for the cost model (assessment §3.6) |

## 10. Fallback provider configuration [PLANNED]

| Provider            | Always present? | Key                        | Network origins (CSP)                                                     | Offline | Attribution                                                                                                                   | Notes                                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | --------------- | -------------------------- | ------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `own-data`          | **yes**         | none                       | `'self'` only                                                             | yes     | © OpenStreetMap contributors (ODbL)                                                                                           | Today's map. Default, offline path and final fallback before list mode.                                                                                                                                                                                                                                                                                          |
| `google-satellite`  | if key + listed | `VITE_GOOGLE_MAPS_API_KEY` | `https://tile.googleapis.com`                                             | no      | Google logo + `copyright`; campus block separate                                                                              | Our OSM basemap paint hidden.                                                                                                                                                                                                                                                                                                                                    |
| `google-photoreal`  | if key + listed | `VITE_GOOGLE_MAPS_API_KEY` | `https://tile.googleapis.com`                                             | no      | Google logo + sorted credits; campus block separate                                                                           | Lazy deck.gl chunk; loaders.gl workers and Draco self-hosted.                                                                                                                                                                                                                                                                                                    |
| `esri-imagery`      | only if D8      | `VITE_ESRI_API_KEY`        | Esri basemap hosts (confirm exact hosts from Esri docs at implementation) | no      | [DOC] "Powered by Esri" plus data attribution, e.g. "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community" | [DOC] 2M free tiles/month (https://location.arcgis.com/pricing/). Never shown together with Google content. No PWA/offline caching: E204 §3.2(c) allows offline use only "through Esri Content Packages … for use with licensed ArcGIS Runtime applications and ArcGIS Desktop" and otherwise says "Customer may not otherwise scrape, download, or store Data". |
| `eox-2016`          | optional        | none                       | `'self'` if self-hosted                                                   | yes     | "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)"             | 10 m: context only, cannot show buildings. Only the 2016 vintage is free for commercial use [DOC EOX FAQ].                                                                                                                                                                                                                                                       |
| self-hosted terrain | optional        | none                       | `'self'`                                                                  | yes     | Copernicus DEM notice (License-COPDEM-30) or SRTM credits                                                                     | Build terrarium tiles for the campus bbox offline; GLO-30 is a surface model, so smooth it under buildings.                                                                                                                                                                                                                                                      |

Fallback order: `google-photoreal` → `google-satellite` → own-data 3D → own-data 2D → list mode. A non-Google imagery
provider is never used as a fallback **inside** a Google view (ToS 3.2.3(e)); it is a separate mode the user chooses.

## 11. CSP per configuration [PLANNED]

`public/_headers` would be generated at build time from the configuration, so a build with no key keeps today's
policy byte for byte.

| Configuration   | `connect-src`                        | `img-src`                                                                       | `script-src` | `worker-src`   |
| --------------- | ------------------------------------ | ------------------------------------------------------------------------------- | ------------ | -------------- |
| No key (today)  | `'self'`                             | `'self' data: blob:`                                                            | `'self'`     | `'self' blob:` |
| Google modes    | `'self' https://tile.googleapis.com` | unchanged while `refreshExpiredTiles` keeps its default `true` [SRC, see below] | `'self'`     | `'self' blob:` |
| Esri added (D8) | add Esri's hosts                     | as above                                                                        | `'self'`     | `'self' blob:` |

[INFERRED] The Map Tiles API is a REST API, so no Google script is loaded and `script-src` stays `'self'`. The Google
logo is a self-hosted image. Google publishes no CSP list for Map Tiles API that we found; the origin above is the
one in Google's documented request URLs.

[SRC maplibre-gl 6.15.0 `src/util/image_request.ts`] MapLibre uses an `HTMLImageElement` (governed by `img-src`) only
when `refreshExpiredTiles` is `false`; with the default `true` (not overridden in this repo) raster tiles are fetched
with `fetch`/XHR (governed by `connect-src`). Keep the default, and keep a CSP-violation test in staging.

## Sources

All retrieved 2026-10-24; Google developer pages showed "Last updated 2026-10-21 UTC".

- https://developers.google.com/maps/documentation/tile/get-api-key
- https://developers.google.com/maps/documentation/tile/web-api-best-practices
- https://developers.google.com/maps/api-security-best-practices
- https://developers.google.com/maps/documentation/tile/session_tokens
- https://developers.google.com/maps/documentation/tile/2d-tiles-overview
- https://developers.google.com/maps/documentation/tile/3d-tiles
- https://developers.google.com/maps/documentation/tile/create-renderer
- https://developers.google.com/maps/documentation/tile/use-renderer
- https://developers.google.com/maps/documentation/tile/policies
- https://developers.google.com/maps/documentation/tile/usage-and-billing
- https://developers.google.com/maps/documentation/tile/release-notes
- https://developers.google.com/maps/documentation/tile/error_handling
- https://developers.google.com/maps/billing-and-pricing/overview
- https://developers.google.com/maps/billing-and-pricing/pricing and …/pricing-india
- https://developers.google.com/maps/billing-and-pricing/sku-details
- https://developers.google.com/maps/billing-and-pricing/manage-costs
- https://developers.google.com/maps/billing-and-pricing/march-2025
- https://developers.google.com/maps/billing-and-pricing/public-programs
- npm `maplibre-gl@6.15.0` source, `src/util/image_request.ts` (scratch install, not in this repo)
- https://developers.google.com/maps/comms/eea/map-tiles
- https://cloud.google.com/maps-platform/terms (last modified 2026-08-26)
- https://location.arcgis.com/pricing/ ; https://developers.arcgis.com/documentation/esri-and-data-attribution/interactive-maps/
- https://cloudless.eox.at/documentation/faq
