# Map provider configuration

**Status: planned. None of this is implemented.** The app today uses only its own data, needs no key and makes no
third-party requests (`.env.example:1-3`, `public/_headers:2`, `src/offline/pwa-config.ts:76-78`). Every variable,
file and behaviour below is a proposal for the implementation phases in
[`GOOGLE_EARTH_STYLE_MAP_ASSESSMENT.md`](GOOGLE_EARTH_STYLE_MAP_ASSESSMENT.md) §9. **Date:** 2026-10-24.

Labels: **[DOC]** quoted from an official source (URL given; all retrieved 2026-10-24). **[INFERRED]** our
recommendation or reasoning. **[UNVERIFIED]** needs a key or vendor answer; the procedure is in §9. **[SRC]** read
in a third-party package's source in a scratch install outside this repo. **[PLANNED]** not built yet.

Nothing in this document authorises adding a key. The owner's original rule was "no paid APIs or keys"; enabling
Google modes needs the owner decisions D1–D3 and D7 in the assessment.

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
