# Security and privacy

LPU Campus Atlas is mostly a static app: no public accounts, no analytics. It has a small server of
its own (Cloudflare Pages Functions with D1) for the owner's published updates (`GET /api/locations`),
public place suggestions (`POST /api/contributions/locations`) and the owner-only `/admin`; its
security (authentication, CSRF, rate limits, audit) is specified in
[COMMUNITY_MODULE_CONTRACTS.md](COMMUNITY_MODULE_CONTRACTS.md) and
[ADMIN_OPERATIONS.md](ADMIN_OPERATIONS.md). The only runtime third-party requests are satellite
imagery tiles, and only when a build configures an imagery provider
([MAP_PROVIDER_CONFIGURATION.md](MAP_PROVIDER_CONFIGURATION.md)). The remaining risks are in the
browser (content injection, unsafe links, storage), in the data pipeline (what is fetched and what is
committed), and in the supply chain.

## Threat model

| Asset                         | Threat                                                                                             | Mitigation                                                                                                                                                                                                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User's location               | Leak through storage, logs, URLs, network or test hooks                                            | Requested only from a user gesture; kept in memory; never persisted, logged, put in a URL or sent; the e2e hook exposes only _whether_ a marker is shown; correction reports contain no location. Details below                                                                                                   |
| The user's device and session | XSS through OSM tag values, LPU names or URL parameters (a malicious name or `website` tag in OSM) | React text rendering only; `dangerouslySetInnerHTML` is banned by ESLint; no `innerHTML`, `eval` or `setHTML` in `src/`; MapLibre draws labels as glyphs, not HTML; strict CSP with `script-src 'self'`                                                                                                           |
| Users following links         | `javascript:`/`data:` URLs, credential-bearing URLs, mailto header injection                       | `safeExternalUrl` (absolute `http(s)` only; rejects credentials, whitespace, control or invisible characters, backslashes and anything over 2,048 characters), `telHref` (6–15 digits), `mailHref` (single plain address; rejects `?&%,;:<>"` and newlines). External links open with `rel="noopener noreferrer"` |
| App state                     | Deep-link injection (`?place=`)                                                                    | Ids must match `osm:(node\|way\|relation)/<digits>` or `cur:<slug>` (≤ 200 characters) before lookup; unknown ids show a message                                                                                                                                                                                  |
| App state                     | Corrupt or hostile local-storage values                                                            | Keys are read through `createStorage` (JSON parse plus Zod validation, falling back and deleting on mismatch). The theme key is a plain string checked with `isThemePreference`. Every access is wrapped in try/catch                                                                                             |
| Dataset integrity             | A tampered or mismatched data file                                                                 | Same-origin only; Zod validation of every file; `schemaVersion` check before loading; precache revisions per file; `validate-data` in the build                                                                                                                                                                   |
| Embedding                     | Clickjacking                                                                                       | `frame-ancestors 'none'`                                                                                                                                                                                                                                                                                          |
| Corrections channel           | Phishing through a configurable URL                                                                | `VITE_CORRECTIONS_URL` is used only if it is `https:`; the report is plain text with a 6,000-character URL cap; the user always reviews it before copying or opening                                                                                                                                              |
| Remote servers (OSM, LPU)     | Abusive scraping                                                                                   | `robots.txt` obeyed (RFC 9309 subset, exact product token); 2 s between requests; retries with backoff; an identifying User-Agent with an operator-supplied contact; no login, form or private API                                                                                                                |
| Third-party rights            | Redistributing LPU content                                                                         | Only names, titles and URLs are committed; HTML is cached only in the git-ignored `data/.cache/`                                                                                                                                                                                                                  |
| Supply chain                  | A compromised or vulnerable dependency                                                             | Exact versions in `package.json`, a committed `package-lock.json`, `npm ci`, a small dependency set, `npm audit`                                                                                                                                                                                                  |

Out of scope here: the server and the owner account (see
[COMMUNITY_MODULE_CONTRACTS.md](COMMUNITY_MODULE_CONTRACTS.md) and
[ADMIN_OPERATIONS.md](ADMIN_OPERATIONS.md)) and hosting-provider security (see
[DEPLOYMENT.md](DEPLOYMENT.md)).

## Content Security Policy and headers

`public/_headers` (Cloudflare Pages and Netlify format) sends the following for every path:

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:; font-src 'self';
  connect-src 'self' https://ibasemaps-api.arcgis.com https://tiles.maps.eox.at;
  worker-src 'self' blob:; child-src blob:; manifest-src 'self'; frame-ancestors 'none';
  base-uri 'self'; form-action 'self'; object-src 'none'
Permissions-Policy: geolocation=(self), camera=(), microphone=()
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
Cross-Origin-Opener-Policy: same-origin
```

- **`script-src 'self'`** with no `'unsafe-inline'` and no `'unsafe-eval'`. `index.html` has no
  inline script. The theme is applied by `initTheme()` in the main bundle before the first render.
- **`style-src 'unsafe-inline'`** is needed for React `style` attributes and for the inline styles
  that MapLibre sets on its canvas and controls. Inline styles cannot execute script.
- **`worker-src 'self' blob:`**: the MapLibre worker is emitted as a same-origin asset and pointed at
  through `setWorkerUrl` (`src/app/maplibre-worker.ts`). `blob:` remains allowed for MapLibre's
  internal use.
- **`connect-src 'self'`**: the app can only fetch its own files. Any future third-party request
  (tiles, analytics, an API) would be blocked by the CSP, which is intentional.
- **Geolocation** is allowed only for the app's own origin. Camera and microphone are disabled.

HSTS is not set in `_headers`. Enable it at the domain level (Cloudflare: SSL/TLS → Edge
Certificates → HSTS) once the custom domain is final.

## No HTML injection

- Every dataset string (OSM names, descriptions, `website` tags, LPU names) is rendered as React text.
- ESLint (`no-restricted-syntax`) fails the build on `dangerouslySetInnerHTML`.
- A grep of `src/` on 2026-10-23 found no `innerHTML`, `setHTML`, `eval(` or `new Function`.
- The only HTML string passed to a library is the constant OSM attribution link in
  `src/map/style.ts`, which contains no data.

## Location privacy model

1. **Consent by gesture.** `start()` on the geolocation watcher is called only from a user action:
   the locate button, "My location" as an endpoint, starting navigation, or "Track my walk". The
   browser's permission prompt follows. The watcher reports `unsupported` in insecure contexts
   instead of prompting.
2. **In memory only.** `GeoSample`s live in the Zustand nav slice and in the navigation and tracking
   objects. They are never written to local or session storage, IndexedDB, cookies, the URL or the
   service worker.
3. **Never transmitted.** No request carries a location fix: not the satellite tiles, not the
   owner's published updates, and not a place suggestion (which sends only the map point the user
   chooses). Correction reports explicitly exclude location and device data.
4. **Stopped when done.** `stop()` clears the browser watch id. Navigation, tracking and unmount all
   stop the watch. A one-shot "My location" releases the watch once the endpoint is set, unless
   location was already on.
5. **Tracking summary** ("Track my walk") is shown and then discarded. The path is kept in memory
   only for the session.
6. **Test hook**: `window.__ATLAS_MAP__` exists only with `?e2e=1`. It returns the camera, selection
   and layer state, and `isUserLocationShown()`, never coordinates. During navigation, though, the
   camera centre can be near the user once they recentre the map.
7. **No logging.** There are no `console.log` calls in `src/`.

The privacy facts shown in the app's Settings panel (`src/privacy/privacy-facts.ts`) state this in
plain language and must stay literally true.

## Local storage inventory

All keys are namespaced `lpu-atlas:v1:` (`APP_CONFIG.storage`). They are validated on read and
removed by "Clear all local data", which deletes every `lpu-atlas:` key in local and session storage
for all versions.

| Key                             | Storage | Contents                                                     | Written by                         |
| ------------------------------- | ------- | ------------------------------------------------------------ | ---------------------------------- |
| `lpu-atlas:v1:favorites`        | local   | Array of place ids (max 200), newest first                   | `src/favorites/favorites-store.ts` |
| `lpu-atlas:v1:recents`          | local   | Array of place ids (max 8). Not written while history is off | `src/favorites/recents-store.ts`   |
| `lpu-atlas:v1:privacy`          | local   | `{ saveHistory: boolean }`                                   | `src/privacy/privacy-store.ts`     |
| `lpu-atlas:v1:theme`            | local   | Plain string `light`, `dark` or `system`, validated on read  | `src/accessibility/theme.ts`       |
| `lpu-atlas:v1:correction-draft` | session | The half-written correction form (no location)               | `src/feedback/draft-store.ts`      |

The browser also keeps:

- **Cache Storage**: the Workbox precache, named with the `lpu-atlas` cache id. It holds the app
  shell, dataset and glyphs, and no personal data.
- **The service-worker registration.**

Neither is cleared by "Clear all local data". Use the browser's "Clear site data" for those.

Map preferences (3D mode, layer visibility, labels) are not persisted. They reset on reload.

## Requests and data the app sends

- There are no tracking pixels, analytics SDKs, error reporters, fonts from other origins, or ads.
  The only cookie is the owner's admin session (`__Host-atlas_session`, HttpOnly, Secure,
  SameSite=Strict), set only on `/admin` sign-in in password mode.
- At runtime the app requests its own origin (the app shell, `data/*`, `fonts/*` and the owner's
  published updates at `/api/locations`) and, only in a build with an imagery provider configured,
  satellite tiles from that provider's host (listed in `connect-src` above). Imagery tiles are never
  cached by the service worker.
- "Suggest a missing place" sends what the user typed and the chosen map point to this site's
  server, for the owner to review. The server keeps no IP address: rate limits use a keyed hash of
  it that changes with each counting window (`server/auth/rate-limit.ts`).
- Two actions open another site, and only when the user chooses them: an external link (an official
  website, OpenStreetMap), and "Open prefilled report" when `VITE_CORRECTIONS_URL` is configured.

## Supply chain

- Every dependency is pinned to an exact version in `package.json`. `package-lock.json` is committed,
  and `npm ci` installs exactly the locked tree.
- **Runtime dependencies (6):** `react`, `react-dom`, `maplibre-gl`, `zod`, `zustand`,
  `workbox-window`. Everything else is a dev dependency used at build or test time.
- `npm audit` on 2026-10-23 reported **0 vulnerabilities**, both for the full tree and with
  `--omit=dev`.
- `scripts/smoke.ts` scans the built `dist/` for secret-like patterns.
- The env file is git-ignored, except for `.env.example`. No variable is a secret, and `VITE_*`
  values are public by design.

**Limits of scanners.** `npm audit` reports only _known_ advisories in the npm registry's database.
It cannot detect:

- a malicious package published without an advisory
- a compromised maintainer account
- typo-squatting
- vulnerabilities in our own code

The secret scan is pattern-based and can miss secrets that are encoded or split. ESLint's rules find
specific unsafe patterns, not logic flaws. None of these replaces reviewing dependency updates
(changelogs, the diff of the lockfile) and keeping the dependency set small.

## Incident record: personal e-mail sent in User-Agent headers during research

**What happened.** On 2026-10-23, during manual research for the LPU public-sources step, before
`scripts/fetch-public-data.ts` existed, the agent doing the research made ad-hoc HTTP requests that
put the maintainer's personal account e-mail address in the `User-Agent` header. Those requests went
to four hosts:

- `www.lpu.in`
- `iviewd.com`
- `happenings.lpu.in`
- `wikidata.org`

The address therefore reached those operators' request logs.

**What was not affected.**

- The address is **not stored anywhere in this repository**: not in source, data, snapshots,
  documentation or the generated dataset.
- The scripted runs of `fetch-public-data.ts` used the non-personal contact string
  "LPU Campus Atlas maintainers".
- No credentials or other personal data were sent.

**What changed.**

- The fetch scripts take the contact only from the `DATA_FETCH_CONTACT` environment variable and
  never embed a personal default.
  - `scripts/fetch-public-data.ts` refuses to run live without it: "Set DATA_FETCH_CONTACT (see
    .env.example) before fetching." `--offline` runs need none.
  - `scripts/fetch-osm.ts` sends the placeholder `no contact configured; set DATA_FETCH_CONTACT`
    when it is unset, never a personal value.
- `.env.example` documents the variable as a contact the operator chooses to share. It is never
  shipped to the browser.
- Operators should use a project or role address, not a personal one.

**Residual risk.** Log entries already held by those four operators cannot be recalled from here.
It is recorded here so that the maintainer can decide whether any follow-up with those operators is
wanted.
