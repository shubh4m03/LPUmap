# Deployment

The app is a static site. `npm run build` produces `dist/`: hashed JS and CSS in `assets/`,
`index.html`, `sw.js` and the Workbox runtime, `manifest.webmanifest`, and copies of
`public/data/`, `public/fonts/`, `public/icons/`, `_headers`, `robots.txt` and `favicon.svg`.

The public map needs nothing else: no server code, database or secret. The **owner features** (the
`/admin` moderation screens, the Building Studio, "Suggest a missing place" and the owner publication
`GET /api/locations`) additionally need the Cloudflare Pages Functions in `functions/` and a D1
database; see [Pages Functions, D1 and the admin](#pages-functions-d1-and-the-admin). Without them the
site still works as a static map: the publication request ends at once, a suggestion sent there is
reported as "not available on this version of the site … Nothing was sent", and `/admin` explains
that the admin API is missing.

## Cloudflare Pages (reference host)

### Project settings

| Setting                | Value                                                                                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework preset       | None (or "Vite")                                                                                                                                                                                               |
| Build command          | `npm run build`. It runs `data:check` (an offline rebuild and validation of `public/data` from the committed snapshot), then `tsc --noEmit`, then `vite build`, and fails the deploy on any data or type error |
| Build output directory | `dist`                                                                                                                                                                                                         |
| Root directory         | the repository root                                                                                                                                                                                            |
| Node version           | 24. Set the environment variable `NODE_VERSION=24` for Production and Preview. The repository's `.nvmrc` also says `24`; `package.json` declares `engines.node >= 24`                                          |
| Install                | Pages runs `npm` automatically because `package-lock.json` exists. The build needs only npm packages, with no network access to OSM or LPU                                                                     |

### Environment variables

These are set in Pages → Settings → Environment variables, separately for Production and Preview.
They are read at **build time** and embedded in the bundle, so changing one needs a new deployment.

| Variable               | Needed? | Notes                                                                                                                        |
| ---------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `NODE_VERSION`         | Yes     | `24`                                                                                                                         |
| `VITE_CORRECTIONS_URL` | No      | An `https://` URL for "Open prefilled report", such as a GitHub new-issue URL. When unset, reports are copy or download only |
| `VITE_PUBLIC_SITE_URL` | No      | Reserved; the current code does not read it                                                                                  |
| `VITE_ARCGIS_API_KEY`  | No      | Optional free-tier ArcGIS key for Esri World Imagery (Satellite 2D, and imagery under Campus 3D). See below                  |
| `VITE_EOX_BACKDROP`    | No      | `true` adds the keyless EOX Sentinel-2 2016 backdrop (10 m, Satellite 2D only, when no Esri key is set). Empty = off         |

Never set `DATA_FETCH_CONTACT` on the host. Data fetching is a maintainer task done locally, not part
of a deploy.

**Satellite imagery is optional and free-only.** The owner decided on 2026-10-24 that the project uses
no billing account, so Google Map Tiles (2D satellite and Photorealistic 3D Tiles) are not implemented;
the "Photorealistic 3D" option stays visible as unavailable with its reason. With neither imagery
variable set the build makes no third-party request and "Satellite map" is shown as "Not configured".

- `VITE_ARCGIS_API_KEY` is embedded in the bundle (it is a `VITE_` variable), so it is **public once
  built**. What protects it is how it is created: an ArcGIS Location Platform account with
  **pay-as-you-go left off** (access simply stops at the free-tier limit, no bill), the **Basemaps**
  privilege only and **referrer restrictions** to this site's origins. The step-by-step is in
  [MAP_PROVIDER_CONFIGURATION.md §Esri World Imagery](MAP_PROVIDER_CONFIGURATION.md#esri-world-imagery-arcgis-location-platform-free-tier).
  Put the value only in the Pages **build** environment (and in `.env.local` for local work, which
  is git-ignored); never commit it. With a key, the desktop start view (Campus 3D) contacts Esri at
  start-up; leave it unset if the default view must make no third-party request.
- Imagery tiles are never precached or cached offline (Esri's terms; the service worker has no
  runtime route for them). `public/_headers` already allows exactly the two provider hosts in
  `connect-src`.
- A missing or refused key, an exhausted free tier or a network failure falls back to the campus map
  with an explanation; there is never a blank map.
- `npm run smoke` reports a build made **with** `VITE_ARCGIS_API_KEY` under "no secrets in dist",
  because the key is then embedded as a string (by design: it is a public, referrer-restricted key).
  Run the smoke gate on a build without imagery variables, and review a keyed build's finding by hand:
  it must name only `VITE_ARCGIS_API_KEY`.

## Pages Functions, D1 and the admin

The full runbook (Access setup, password hashing, backups, Time Travel, credential rotation and
incident response) is [ADMIN_OPERATIONS.md](ADMIN_OPERATIONS.md). The deployment-relevant parts:

### Functions and bindings

- `functions/api/**` are thin Pages Functions over `server/`: `GET /api/health`,
  `GET /api/locations` (the public publication), `POST /api/contributions/locations` (public
  suggestions, rate-limited) and `/api/admin/**` (owner only).
- `wrangler.toml` declares the D1 binding `DB` (database `lpu-atlas`, `migrations_dir =
"migrations"`). Replace the placeholder `database_id` with the id printed by
  `npx wrangler d1 create lpu-atlas`, or bind the database in the dashboard (Pages project →
  Settings → Bindings → D1 database, variable name `DB`).
- `/admin` itself is a client route of the same `index.html` (a lazily loaded chunk; no admin code or
  text is in the public entry). Pages' single-page fallback serves it.

### Server variables and secrets

Set these in Pages → Settings → Variables and Secrets (runtime, not build time; a change applies to
new deployments). Secrets go through `npx wrangler pages secret put <NAME>` or the dashboard's
"Encrypt" option, never into `wrangler.toml` or git.

| Variable                   | Kind     | Needed?            | Notes                                                                                                                           |
| -------------------------- | -------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_MODE`                | variable | Yes, for the admin | `access` (Cloudflare Access, recommended) or `password`. **Unset or invalid = every `/api/admin/**` answers 503** (fail closed) |
| `ACCESS_TEAM_DOMAIN`       | variable | `access` mode      | `https://<team>.cloudflareaccess.com`                                                                                           |
| `ACCESS_AUD`               | variable | `access` mode      | The Access application's AUD tag                                                                                                |
| `OWNER_EMAILS`             | variable | `access` mode      | Comma-separated; must match the Access policy                                                                                   |
| `OWNER_PASSWORD_HASH`      | secret   | `password` mode    | The `pbkdf2-sha256$…` line from `npm run admin:hash-password` (the plaintext is never stored)                                   |
| `RATE_LIMIT_KEY`           | secret   | Recommended        | ≥ 32 random characters; HMAC key for rate-limit buckets (without it a daily-rotated salt in D1 is used)                         |
| `PUBLIC_ORIGIN`            | variable | No                 | Extra allowed `Origin` for admin writes, e.g. the custom domain (https only)                                                    |
| `ADMIN_LOGIN_GLOBAL_LIMIT` | variable | No                 | Global cap on password-login attempts per 15-minute window (1–100000)                                                           |

With Access, protect **both** `/admin*` and `/api/admin/*` in one Access application and leave
`/api/locations`, `/api/contributions/*` and `/api/health` public. Check the result with
`curl -s https://<host>/api/health` → `{"ok":true,"db":"ok","auth":"access"}` (or `"password"`).
Locally, copy `.dev.vars.example` to `.dev.vars` (git-ignored) for `npx wrangler pages dev dist`.

### D1 migrations: apply

The two migrations are applied in order by wrangler, which records them in `d1_migrations`, takes a
backup first and rolls back a migration that fails:

| File                                  | Creates                                                                                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrations/0001_initial.sql`         | `suggestions`, `locations`, `overrides`, `audit_events`, `sessions`, `rate_limits`, `meta` (community module, [COMMUNITY_MODULE_CONTRACTS.md](COMMUNITY_MODULE_CONTRACTS.md)) |
| `migrations/0002_building_studio.sql` | `studio_templates`, `studio_template_versions`, `studio_buildings`, `studio_building_versions`; rebuilds `audit_events` with the studio entity types                          |

```sh
npx wrangler d1 export lpu-atlas --remote --output=<outside-the-repo>/before-migrate.sql   # backup first
npx wrangler d1 migrations list  lpu-atlas --remote      # what is pending
npx wrangler d1 migrations apply lpu-atlas --remote      # production
npm run db:migrate:local                                 # local `wrangler pages dev` database only
```

Apply migrations **before** deploying code that needs them: the publication and the studio
endpoints read the 0002 tables. A pre-studio server runs safely on a 0002 database (it never touches
the studio tables), so the safe order is always "migrate, then deploy". Never edit an applied
migration; add `migrations/NNNN_description.sql` instead.

### D1 migrations: rollback

- **Code rollback** (Pages → Deployments → "Rollback") needs no database change. A rolled-back
  pre-studio server ignores the studio tables and serves publication v1; current clients then show
  no studio buildings, with no error.
- **0002 down** (removes the studio schema): only after deploying pre-studio code and exporting the
  four studio tables, run the hand-written script that is deliberately **not** under `migrations/`:

  ```sh
  npx wrangler d1 export lpu-atlas --remote --table studio_buildings --output <outside-the-repo>/studio_buildings.sql
  # repeat for studio_building_versions, studio_templates, studio_template_versions
  npx wrangler d1 execute lpu-atlas --remote --file docs/db/0002_down.sql
  ```

  It drops the studio tables, rebuilds `audit_events` with the 0001 check while keeping every row
  (studio rows become `entity_type 'system'`), bumps `publication_version` and removes 0002 from
  `d1_migrations` so it can be re-applied later
  ([BUILDING_STUDIO_DESIGN.md §12](BUILDING_STUDIO_DESIGN.md#12-versioning-missing-assets-and-rollback)).

- **0001** has no down script: removing it removes the community module itself. Export the database,
  then either restore to a point before the migration with D1 Time Travel
  ([ADMIN_OPERATIONS.md §6.3](ADMIN_OPERATIONS.md#63-point-in-time-restore-d1-time-travel), which
  also rewinds everything after that point) or unbind the database and deploy without the owner
  features. The static map keeps working either way.
- For a single bad edit, use the audit-log revert instead
  ([ADMIN_OPERATIONS.md §6.1](ADMIN_OPERATIONS.md#61-undo-one-change-preferred)).

The tests never touch a remote database: the server suites and the e2e backend use a fresh local
in-memory D1 with `migrations/*.sql` applied.

### Headers (`public/_headers`)

Pages applies `dist/_headers` automatically:

| Path                  | Headers                                                                                                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/*`                  | Content-Security-Policy (`'self'` only), Permissions-Policy (geolocation for self only), Referrer-Policy, `X-Content-Type-Options: nosniff`, `Cross-Origin-Opener-Policy: same-origin`. Details in [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md#content-security-policy-and-headers) |
| `/assets/*`           | `Cache-Control: public, max-age=31536000, immutable` (file names are content-hashed)                                                                                                                                                                                                      |
| `/sw.js`              | `Cache-Control: no-cache` (browsers must always check for a new worker)                                                                                                                                                                                                                   |
| `/index.html`, `/`    | `Cache-Control: no-cache`                                                                                                                                                                                                                                                                 |
| `/data/manifest.json` | `Cache-Control: no-cache` (the loader reads it first to learn `datasetVersion`)                                                                                                                                                                                                           |

The other data files are requested as `data/<file>?v=<datasetVersion>`, so a new dataset always gets
a new URL even where an HTTP cache holds the old one. Once installed, the service worker serves
everything from its precache.

After the first deploy, check the headers:

```sh
curl -sI https://<your-domain>/ | grep -iE 'content-security|permissions|cache-control'
curl -sI https://<your-domain>/sw.js | grep -i cache-control
```

### Service-worker update behaviour

- `registerType: 'prompt'`. A deploy never reloads an open page by itself.
- When a returning visitor loads the site, the browser fetches `sw.js` (it is `no-cache`). If its
  precache manifest changed, the new worker installs in the background, downloading only the files
  whose revision changed, and waits.
- The app then shows an update banner (`useServiceWorkerUpdate().updateAvailable`) with "Update now" and "Later".
  - **Update now**: the waiting worker activates and the page reloads once into the new app **and** its
    matching dataset.
  - **Later**: the old worker keeps serving the old, consistent set. Under standard service-worker
    rules the waiting worker takes over only after every tab of the app has been closed, so the next
    fresh visit uses the new version.
- On the first visit the app reports "ready to work offline" once precaching finishes.
- `cleanupOutdatedCaches` removes precaches from older Workbox versions.
- Development (`npm run dev`) never registers a worker.

### Cache busting

You never need to bust caches by hand:

- JS and CSS names carry content hashes.
- `index.html`, `sw.js` and `data/manifest.json` are `no-cache`.
- Data URLs include `?v=<datasetVersion>`, a hash of the data files.
- The Workbox precache revisions every file by content.

If a deploy changes only data, `datasetVersion` and the precache revisions change, and visitors get
the update prompt like for a code change.

If a user is stuck on a broken worker, which should not happen with this setup, they can open
DevTools → Application → "Clear site data". As a last resort, an operator could deploy a no-op
`sw.js` that unregisters itself. That is not part of this repository.

### Custom domain

1. Pages → your project → Custom domains → "Set up a custom domain". Follow the DNS step: a CNAME to
   `<project>.pages.dev`, or automatic setup if the zone is on Cloudflare.
2. Wait for the certificate, then enable "Always Use HTTPS". Enable HSTS at the zone level once the
   domain is final (`_headers` does not set it).
3. Geolocation and service workers need HTTPS. Both work on `*.pages.dev` and on the custom domain.
4. Each origin has its own service worker and local storage. Moving from `*.pages.dev` to a custom
   domain starts users afresh: favourites saved on the old origin do not carry over.

### Preview deployments

- Every non-production branch (and every pull request, if Git integration is on) gets a preview
  deployment at `<hash>.<project>.pages.dev` and a stable branch alias.
- Previews run the same build and the same `_headers`.
- Each preview is its own origin, with its own service worker and storage, so it does not interfere
  with production.
- Use previews to check the service-worker update flow from a manual checklist (see
  [QA_STRATEGY.md](QA_STRATEGY.md#what-needs-human-or-on-device-verification)): deploy twice to the
  same branch alias and confirm the prompt.
- Preview variables are set separately. Leave `VITE_CORRECTIONS_URL` unset on previews unless you
  want test reports filed.

### Rollback

- Pages → Deployments → choose an earlier successful deployment → "Rollback to this deployment".
  This is instant and needs no rebuild.
- Because the rolled-back build has a different `sw.js`, browsers that installed the newer version
  see an update prompt and move back to the older, consistent app and dataset as a whole. Nothing
  mixes versions.
- If the problem is in the data, you can also revert the commit that changed `data/` and push. The
  build regenerates `public/data` from the committed snapshot.

## Before deploying

Run the gate locally (or in CI):

```sh
npm ci
npx tsc --noEmit -p . && npx tsc --noEmit -p tsconfig.server.json && npx eslint . --max-warnings=0 && npx prettier --check . && npx vitest run && npx vitest run -c vitest.server.config.ts && npm run -s data:check && npx vite build
npm run smoke
npm run preview     # then open http://localhost:4173 and check the map, search and a route
```

`npm run check` runs all of this plus the Playwright suite.

## Alternative static hosts

The app needs four things from a host:

1. static files served from the site root
2. the headers from `public/_headers`
3. `no-cache` on `sw.js`, `index.html` and `data/manifest.json`
4. HTTPS

| Host                             | Notes                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Netlify**                      | Reads the same `_headers` format from the published directory. Build command `npm run build`, publish directory `dist`, `NODE_VERSION=24`                                                                                                                                                                                                                          |
| **nginx / Caddy / Apache**       | Serve `dist/` and translate `_headers` into server config (`add_header … always;` in nginx). Make sure `.webmanifest` is served as `application/manifest+json` and `.pbf` as `application/x-protobuf` or `application/octet-stream`                                                                                                                                |
| **S3 + CloudFront** (or similar) | Upload `dist/`. Set `Cache-Control` per object (`no-cache` for the three files above, immutable for `assets/`), and add the security headers with a response-headers policy                                                                                                                                                                                        |
| **GitHub Pages**                 | Possible but **not recommended**. It cannot set custom headers, so there is no CSP or Permissions-Policy and no control over `sw.js` caching. A project page also lives under a sub-path (`/<repo>/`), which needs Vite `base` set. The service worker's `navigateFallbackDenylist` (`/data/`, `/fonts/`) assumes the site root, and that path has not been tested |

Sub-path deployments in general have not been tested. Deploy at the root of a domain or subdomain.
