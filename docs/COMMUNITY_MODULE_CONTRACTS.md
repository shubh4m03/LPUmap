# Community contributions, moderation and owner control — contracts

Companion to `docs/MODULE_CONTRACTS.md`. Wire schemas live in
`src/community/schema.ts` (shared by public app, admin app and server).

## Architecture

```
static base dataset (public/data, OSM + curated, built offline)  ─┐
                                                                    ├─> mergePublication() ─> CampusData ─> search / facilities / router / map
D1 (Cloudflare) ── GET /api/locations (published layer only) ──────┘
     ▲
     │  Pages Functions (functions/api/**) → server/** (framework-free handlers)
     │
public: POST /api/contributions/locations  (always creates `pending`)
owner:  /api/admin/**  (Cloudflare Access JWT or password session; fail closed)
```

- The browser never writes the authoritative dataset. The generated base
  files are never modified by the admin layer; overrides are keyed by stable
  base place ids (`osm:way/123`, `cur:slug`) so they survive OSM refreshes.
- `server/` must not import React, MapLibre or DOM APIs. It uses only Web
  standard APIs (Request, Response, URL, crypto.subtle, TextEncoder) so it
  runs in workerd and in Node tests. The database is accessed through the
  minimal `SqlDatabase` interface (`server/db/types.ts`) that a Cloudflare
  `D1Database` satisfies, so no `@cloudflare/workers-types` dependency is
  needed in the main tsconfig.
- Static assets (places.json, graph.json, boundary.geojson) are read
  server-side through the Pages `env.ASSETS` fetcher for duplicate detection,
  boundary checks and access-node validation (`server/base-data.ts`, cached
  per isolate, keyed by datasetVersion).

## Database (D1, `migrations/NNNN_*.sql`, applied with `wrangler d1 migrations apply`)

All timestamps ISO-8601 UTC text. All ids random, non-guessable
(≥ 128 bits, base32/base64url): suggestions `sug_…`, owner locations
`own:…`, community locations `com:…`.

| Table          | Purpose / key constraints                                                                                                                                                                                                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `suggestions`  | id PK; name; category_id; lon, lat (CHECK ranges); description; landmark; evidence_url; details; status CHECK IN (pending, needs_information, approved, rejected, duplicate) DEFAULT 'pending'; duplicate_of; review_note (private); reviewed_by; reviewed_at; published_location_id UNIQUE NULL; created_at; updated_at; revision INT NOT NULL DEFAULT 1  |
| `locations`    | id PK; origin CHECK IN (owner, community); suggestion_id UNIQUE NULL REFERENCES suggestions; name; category_id; lon; lat; description; opening_hours; wheelchair; website; source_url; verification_status; last_verified_at; access_node_id NULL; access_note; status CHECK IN (active, hidden); created_by; created_at; updated_by; updated_at; revision |
| `overrides`    | target_id PK (base place id); fields_json (validated `OverrideFields`); hidden INT 0/1; access_node_id NULL; note (private); base_dataset_version (dataset version when last edited); updated_by; updated_at; revision                                                                                                                                     |
| `audit_events` | id INTEGER PK AUTOINCREMENT; at; actor; action; entity_type; entity_id; before_json; after_json; outcome CHECK IN (success, rejected, failed); detail. **Append-only**: triggers `BEFORE UPDATE`/`BEFORE DELETE` → `RAISE(ABORT)`. Never contains secrets, tokens, cookies, IPs.                                                                           |
| `sessions`     | id_hash PK (HMAC-SHA256 of the random token keyed by the configured password hash, so rotating the hash revokes all sessions — raw token only in the cookie); actor; csrf_token; created_at; expires_at; last_seen_at                                                                                                                                      |
| `rate_limits`  | bucket PK (HMAC of client IP + scope + window); count; window_start; expires_at. Purged opportunistically after expiry — on every rate-limited request and on `GET /api/admin/overview` (≤ 48 h retention; see docs/ADMIN_OPERATIONS.md §8). Raw IPs are never stored.                                                                                     |
| `meta`         | key PK, value — `publication_version` (bumped in the same batch as every public change), `rate_salt` + `rate_salt_day` (daily-rotated salt when no `RATE_LIMIT_KEY` secret)                                                                                                                                                                                |

Atomicity: every multi-statement change (approve = update suggestion +
insert location + bump publication_version + audit) is a single
`db.batch([...])` (D1 runs a batch as one transaction). Optimistic
concurrency: writes use `WHERE id = ? AND revision = ?`; 0 changed rows →
HTTP 409 `conflict` with the current record. `locations.suggestion_id UNIQUE`
makes double publication impossible.

## Endpoints

Public (no auth; JSON only; same-origin; `Cache-Control` as noted):

| Method & path                       | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/contributions/locations` | Body ≤ 8 KB, `contributionInputSchema`. Honeypot filled → respond 202 with a decoy reference and store nothing. Location must be inside `APP_CONFIG.contributions.area`. Rate limit 5 / 10 min and 20 / day per hashed IP + global 500 / day. Status always `pending`, server-assigned. Response 201 `contributionResponseSchema` (reference = suggestion id, `possibleDuplicates`). `Cache-Control: no-store`. |
| `GET /api/locations`                | `publicationSchema` — active locations + overrides only; no notes, actors, suggestions. `ETag: W/"pub-v<schemaVersion>-<publicationVersion>"` (amended 2026-10-24; see BUILDING_STUDIO_DESIGN.md §10), honours `If-None-Match` (304, answered before the body is built), `Cache-Control: no-cache` (always revalidate → no stale publication after edits).                                                      |
| `GET /api/health`                   | `{ ok, db: 'ok'                                                                                                                                                                                                                                                                                                                                                                                                 | 'unavailable', auth: 'access' | 'password' | 'not-configured' }` — no secrets. |

Admin (`/api/admin/**`, every request authenticated + authorized server-side;
state-changing requests also require same-origin `Origin` header,
`Content-Type: application/json`, and in password mode `X-CSRF-Token`;
`Cache-Control: no-store`; body ≤ 32 KB):

| Method & path                                                                      | Behaviour                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/admin/session`                                                          | password mode: `{password}` → sets `__Host-atlas_session` (HttpOnly, Secure, SameSite=Strict, Path=/, Max-Age 8 h); returns `{actor, csrfToken, expiresAt}`. Rate-limited 5 / 15 min per hashed IP. Access mode: 404.                                                               |
| `GET /api/admin/session`                                                           | `{actor, mode, csrfToken?}` or 401                                                                                                                                                                                                                                                  |
| `DELETE /api/admin/session`                                                        | logout: deletes session row, expires cookie                                                                                                                                                                                                                                         |
| `GET /api/admin/overview`                                                          | counts from D1: suggestions per status, locations active/hidden per origin, overrides (hidden / field), audit events last 7 days, data-quality warning count                                                                                                                        |
| `GET /api/admin/suggestions?status=&category=&q=&sort=created_desc                 | created_asc&limit=&cursor=`                                                                                                                                                                                                                                                         | list (paginated)                                                                                                              |
| `GET /api/admin/suggestions/:id`                                                   | full record + `possibleDuplicates` (recomputed) + history (audit events for it)                                                                                                                                                                                                     |
| `PATCH /api/admin/suggestions/:id`                                                 | `{revision, fields: Partial<contribution fields>}` edit before approval (pending/needs_information only)                                                                                                                                                                            |
| `POST /api/admin/suggestions/:id/approve`                                          | `{revision, fields?: PlaceFields, accessPoint?: {nodeId, note}}` → validates the FINAL record (not the raw submission), atomically creates `com:` location (status active) and sets suggestion approved. Idempotent: a second call → 409 `invalid-transition` (no second location). |
| `POST /api/admin/suggestions/:id/reject`                                           | `{revision, reason?}` (reason private)                                                                                                                                                                                                                                              |
| `POST /api/admin/suggestions/:id/duplicate`                                        | `{revision, duplicateOf}` — must reference an existing base place id, location id or suggestion id                                                                                                                                                                                  |
| `POST /api/admin/suggestions/:id/request-info`                                     | `{revision, note?}` → `needs_information` (internal state; no email is sent — say so in UI)                                                                                                                                                                                         |
| `POST /api/admin/suggestions/:id/reopen`                                           | `{revision}` rejected/duplicate/needs_information → pending                                                                                                                                                                                                                         |
| `GET /api/admin/locations?status=&origin=&q=`                                      | owner + community locations incl. hidden                                                                                                                                                                                                                                            |
| `POST /api/admin/locations`                                                        | create owner location (`placeFieldsSchema` + optional accessPoint) → `own:` id, active                                                                                                                                                                                              |
| `PATCH /api/admin/locations/:id`                                                   | `{revision, fields, accessPoint?: {nodeId,note}                                                                                                                                                                                                                                     | null}`                                                                                                                        |
| `POST /api/admin/locations/:id/hide` · `/restore`                                  | `{revision}` reversible                                                                                                                                                                                                                                                             |
| `DELETE /api/admin/locations/:id`                                                  | `{revision, confirmName}` must equal current name; only `hidden` locations can be permanently deleted; audit keeps the before snapshot                                                                                                                                              |
| `GET /api/admin/overrides` · `GET/PUT /api/admin/overrides/:targetId`              | `PUT {revision                                                                                                                                                                                                                                                                      | null, fields, hidden, accessPoint?, note?}`; targetId must exist in the base dataset; fields equal to base values are dropped |
| `POST /api/admin/overrides/:targetId/hide` · `/unhide` · `DELETE` (revert to base) | reversible                                                                                                                                                                                                                                                                          |
| `POST /api/admin/revert`                                                           | `{auditEventId}` restores the `before` snapshot of a location/override edit (new revision, new audit event)                                                                                                                                                                         |
| `GET /api/admin/audit?entity=&entityId=&action=&limit=&cursor=`                    | audit history                                                                                                                                                                                                                                                                       |
| `GET /api/admin/quality`                                                           | warnings: orphan overrides (target missing from current base dataset), locations outside boundary, locations not routable, possible duplicates among published, pending suggestions older than 14 days                                                                              |

Errors use `apiErrorSchema` with proper HTTP status (400 invalid, 401, 403,
404, 409 conflict/invalid-transition, 413, 415, 422 outside-area, 429 with
`Retry-After`, 503 unavailable/not-configured).

## Authentication & authorization (`server/auth/**`)

`AUTH_MODE` env (`access` | `password`). Anything else / missing → every
admin endpoint returns 503 `not-configured` (fail closed). No dev bypass.

- **access**: requires `ACCESS_TEAM_DOMAIN` (e.g. `https://team.cloudflareaccess.com`),
  `ACCESS_AUD`, `OWNER_EMAILS` (comma list). Verifies the
  `Cf-Access-Jwt-Assertion` header (RS256 via crypto.subtle, keys from
  `<team>/cdn-cgi/access/certs`, cached ≤ 1 h; checks `aud`, `iss`, `exp`,
  `nbf`, clock skew ≤ 60 s) and that `email` ∈ OWNER_EMAILS. The
  `CF_Authorization` cookie alone is not trusted.
- **password**: `OWNER_PASSWORD_HASH` secret = `pbkdf2-sha256$<iterations≥100000>$<salt b64>$<hash b64>`
  produced by `npm run admin:hash-password` (reads the password from stdin;
  never echoes or logs it). Constant-time compare. Sessions in D1 (token
  hashed), 8 h absolute expiry, CSRF token per session.
- `authorize(actor, permission)` — first release has one role `owner` with
  all permissions; permission names (`suggestions:review`, `locations:write`,
  `locations:delete`, `audit:read`) exist so moderators can be added later.
- Actor identity recorded in audit = Access email or `owner` (password mode).
  Client-supplied actor/role/approval fields are ignored everywhere.

## Merge service (`src/community/merge.ts`, pure)

`mergePublication(base: CampusData, pub: Publication): { data: CampusData; report: MergeReport }`

Deterministic precedence (documented & tested):

1. Base place present, override `hidden` → removed from places, buildings
   footprints (if a building), relations touching it, search, counts, routing endpoints.
2. Override fields → replace the corresponding base fields; provenance
   becomes `{sourceId:'owner', sourceRef:<base ref>, verificationStatus, lastVerifiedAt, notes:'Owner override of <source>'}`;
   building footprint properties `name/displayName/categoryId` follow.
3. Override `accessNodeId` → `graphNodeId` only after validation (node exists,
   foot-accessible, ≤ maxPlaceConnectorM from location); otherwise the place
   becomes NOT routable (never silently keeps an invalid node) and
   the report lists it.
4. Published locations (`own:`/`com:`) are appended as places (kind
   `facility`, campusZone from boundary, provenance `sourceId 'owner'` or
   `'community'`); routable only with a validated `accessNodeId` — never
   auto-snapped to the nearest node.
5. Overrides whose target is missing from the base → ignored and reported
   as `orphanOverrides` (shown in admin quality view, never applied to a
   different feature).
6. Duplicate ids between published locations and base → published location
   ignored + reported (cannot shadow base).
7. Manifest counts are recomputed from the merged data; `datasetVersion`
   stays the base version and `publicationVersion` is exposed separately.

Determinism: the result depends only on the set of input records, never on
their order. Records sharing an id (never produced by the server, but not
trusted) are resolved by a total order — highest `revision`, then latest
`updatedAt`, then canonical JSON; extra overrides are reported in
`duplicateOverrides`, extra locations in `shadowedLocations`.

The browser fetches `/api/locations` after the base dataset; on failure the
app runs on the base dataset and shows a small "Community updates
unavailable" notice (never pretends). The service worker uses
NetworkFirst for `/api/locations` (offline → last published layer, labelled
with its `generatedAt`).

## Configuration additions (`APP_CONFIG.contributions`)

`area: 'campus-or-nearby'` = inside `APP_CONFIG.map.maxBounds`; campusZone
computed from the boundary polygon. `duplicateRadiusM: 60`,
`nameSimilarityThreshold: 0.8`, rate limits, `pendingStaleDays: 14`.

## Ownership (for parallel work)

| Owner       | Files                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| lead        | `src/community/schema.ts`, this document, `src/config/*`                                                                                                                                                           |
| server-data | `migrations/**`, `server/db/**`, `server/domain/**`, `server/base-data.ts`, `src/community/merge.ts`, `src/community/duplicates.ts`, `src/community/index.ts`, `tests/server/domain/**`, `tests/unit/community/**` |
| server-http | `server/auth/**`, `server/http/**`, `server/handlers/**`, `server/env.ts`, `functions/**`, `wrangler.toml`, `scripts/admin-hash-password.ts`, `tests/server/http/**`, `tests/server/auth/**`                       |
| public-ui   | public app integration of the publication layer and contribution mode                                                                                                                                              |
| admin-ui    | `admin/index.html`, `src/admin/**`, `tests/unit/admin/**`                                                                                                                                                          |
