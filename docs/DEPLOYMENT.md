# Deployment

The app is a static site. `npm run build` produces `dist/`: hashed JS and CSS in `assets/`,
`index.html`, `sw.js` and the Workbox runtime, `manifest.webmanifest`, and copies of
`public/data/`, `public/fonts/`, `public/icons/`, `_headers`, `robots.txt` and `favicon.svg`. No
server code, database or secret is involved.

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

Never set `DATA_FETCH_CONTACT` on the host. Data fetching is a maintainer task done locally, not part
of a deploy.

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
npx tsc --noEmit -p . && npx eslint . --max-warnings=0 && npx prettier --check . && npx vitest run && npm run -s data:check && npx vite build
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
