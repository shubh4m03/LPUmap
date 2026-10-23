# Admin operations runbook

How the site owner sets up, runs, backs up and recovers the community
contributions module (Cloudflare Pages Functions + D1). Contracts and
endpoint details: [`COMMUNITY_MODULE_CONTRACTS.md`](COMMUNITY_MODULE_CONTRACTS.md).
Static hosting: [`DEPLOYMENT.md`](DEPLOYMENT.md).

Guarantees this runbook relies on (all enforced server-side and covered by
`npm run test:server`):

- A public submission is always stored as `pending`; nothing reaches the
  public layer (`GET /api/locations`) without an authenticated owner action.
- Admin endpoints **fail closed**: if `AUTH_MODE` or its settings are missing
  or invalid, or the `DB` binding is absent, every `/api/admin/**` request
  answers `503 not-configured` / `unavailable`. There is no dev bypass.
- Every change is one D1 transaction (change + audit row + publication
  version bump). A failure leaves nothing half-written.
- Every write uses the record's `revision`; a stale write gets `409 conflict`
  with the current record, so two people (or two tabs) can never silently
  overwrite each other.
- The audit log (`audit_events`) is append-only (database triggers abort
  UPDATE/DELETE). It never contains passwords, hashes, cookies, CSRF tokens or
  IP addresses.
- The generated base dataset (`public/data/*`) is never modified. Owner
  corrections are overrides keyed by stable base ids (`osm:way/123`,
  `cur:slug`) and survive data rebuilds.
- A place is routable only through a validated access node (exists in the
  graph, on a walkable edge, within `routing.maxPlaceConnectorM` of the
  location). Nothing is ever snapped automatically.

All commands below run from the repository root. `npx wrangler …` uses the
pinned devDependency.

---

## 1. First-time setup

### 1.1 Create the D1 database and apply migrations

```sh
npx wrangler login
npx wrangler d1 create lpu-atlas
```

Copy the printed `database_id` into `wrangler.toml` (`[[d1_databases]]`,
binding `DB`, `migrations_dir = "migrations"`). Then:

```sh
npx wrangler d1 migrations apply lpu-atlas --remote   # production
npm run db:migrate:local                              # local wrangler pages dev
```

`migrations apply` records applied files in `d1_migrations`, captures a
backup before applying, and rolls back a migration that fails. Never edit an
applied migration; add `migrations/NNNN_description.sql` instead.

Bind the database to the Pages project too (dashboard → Pages project →
Settings → Bindings → D1 database, variable name `DB`) if the project is not
deployed from `wrangler.toml`.

### 1.2 Choose ONE authentication mode

Nothing works until one mode is fully configured — that is deliberate.

#### Option A — Cloudflare Access (recommended for production)

1. Zero Trust dashboard → Access → Applications → **Add an application** →
   _Self-hosted_.
2. Application domain: your Pages hostname, with **two paths**:
   `/admin*` and `/api/admin/*` (add both as destinations of the same
   application). Do **not** protect `/api/locations`, `/api/contributions/*`
   or `/api/health` — they are public.
3. Add a policy: _Action: Allow_, _Include: Emails_ → the owner's email(s).
   Optionally require a login method with MFA.
4. Copy the application's **AUD tag** (Overview tab).
5. Set the variables (dashboard → Pages project → Settings → Variables, or
   `[vars]` in `wrangler.toml` — none of them is secret):

   | Variable             | Value                                                         |
   | -------------------- | ------------------------------------------------------------- |
   | `AUTH_MODE`          | `access`                                                      |
   | `ACCESS_TEAM_DOMAIN` | `https://<team>.cloudflareaccess.com` (https origin, no path) |
   | `ACCESS_AUD`         | the AUD tag                                                   |
   | `OWNER_EMAILS`       | comma-separated owner emails (must match the policy)          |

The server verifies the `Cf-Access-Jwt-Assertion` header itself (RS256
signature against `<team>/cdn-cgi/access/certs`, `aud`, `iss`, `exp`/`nbf`)
**and** checks the email against `OWNER_EMAILS`. The Access policy and
`OWNER_EMAILS` are two independent locks; keep them in sync. The audit actor
is the verified email.

#### Option B — password (simple; single owner)

```sh
npm run admin:hash-password            # prompts without echo; ≥ 12 characters
npx wrangler pages secret put OWNER_PASSWORD_HASH --project-name lpu-campus-atlas
npx wrangler pages secret put RATE_LIMIT_KEY      --project-name lpu-campus-atlas
```

Paste the printed `pbkdf2-sha256$<iterations>$<salt>$<hash>` line when asked
(the plaintext password is never stored anywhere). Set `AUTH_MODE = password`
as a plain variable. `RATE_LIMIT_KEY` is a random string of ≥ 32 characters,
e.g. `node -e "console.log(crypto.randomBytes(32).toString('base64url'))"`.

Sessions: `__Host-atlas_session` cookie (HttpOnly, Secure, SameSite=Strict),
8 h absolute expiry, a per-session CSRF token required on every write, login
limited to 5 attempts / 15 min per hashed client. The audit actor is `owner`.

Locally, copy `.dev.vars.example` to `.dev.vars` (git-ignored) and fill it.

#### Optional settings

- `PUBLIC_ORIGIN` — extra allowed `Origin` for admin writes (e.g. the custom
  domain when the request host differs). https only.

### 1.3 Verify

```sh
curl -s https://<host>/api/health
# {"ok":true,"db":"ok","auth":"access"}   (or "password")
```

`auth: "not-configured"` or `db: "unavailable"` means admin is closed; fix
the variables/binding and redeploy (variables apply to new deployments).

---

## 2. Moderation workflow

The admin UI calls the endpoints below; they can also be driven with `curl`.
In password mode a session is needed (browser login, or: `POST
/api/admin/session` with `{"password": …}` and an `Origin` header, keep the
returned cookie and `csrfToken`, send `Origin`, `Content-Type:
application/json` and `X-CSRF-Token` on every write). Avoid putting the
password on a command line (shell history).

Every write body carries the `revision` you last read. `409 conflict` means
someone else changed the record: reload, re-check, retry.

1. **Queue**: `GET /api/admin/suggestions?status=pending&sort=created_asc`.
   `GET /api/admin/suggestions/:id` adds possible duplicates (base places,
   published locations, other open suggestions) and the full history.
2. **Decide** (all audited, actor = you):
   - fix wording/position first: `PATCH /api/admin/suggestions/:id`
     `{revision, fields}` (pending / needs_information only);
   - **approve**: `POST …/:id/approve {revision, fields?, accessPoint?}` —
     validates the final record and atomically creates a `com:` location.
     Without `accessPoint` it is **map-only** (shown, searchable, not
     routable). Give `accessPoint: {nodeId, note}` only for a path node you
     have verified is the real way in; the server rejects nodes that are
     missing, not walkable or too far, and never picks one for you;
   - **reject** `{revision, reason?}` (reason is private), **duplicate**
     `{revision, duplicateOf}` (an existing base place, location or
     suggestion id), **request-info** `{revision, note?}` (internal state —
     no email is sent; the submitter is anonymous), **reopen** `{revision}`.
     Approving twice is impossible (`409 invalid-transition`).
3. **Check** `GET /api/admin/quality` regularly: orphan overrides, access
   nodes that stopped validating after a rebuild, locations outside the
   boundary or not routable, possible duplicates, pending items > 14 days.

## 3. Editing published data

- **Owner locations**: `POST /api/admin/locations {fields, accessPoint?}` →
  `own:` id. `PATCH /api/admin/locations/:id {revision, fields,
accessPoint?}` — absent fields are kept, `null` clears an optional field,
  `accessPoint: null` removes routing. Moving a location re-validates its
  kept access node; if it no longer qualifies the edit is refused with 422.
- **Base places** (OSM/curated): `PUT /api/admin/overrides/:targetId
{revision | null, hidden, fields, accessPoint?, note?}`. Only fields that
  differ from the base are stored; an override equal to the base is removed.
  `note` is private. `DELETE /api/admin/overrides/:targetId {revision}`
  reverts the place to its base values.
- Every public change bumps `publication_version`; `GET /api/locations`
  answers with `ETag: W/"pub-<n>"` and `Cache-Control: no-cache`, so visitors
  see the change on their next load.

## 4. Hiding vs deleting

| Need                                  | Do                                                                                                      | Reversible                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------- |
| Take an owner/community location down | `POST /api/admin/locations/:id/hide {revision}`                                                         | yes — `/restore`            |
| Take a base (OSM) place down          | `POST /api/admin/overrides/:targetId/hide` (removes place, footprint, relations, search entry, counts)  | yes — `/unhide`             |
| Remove a location for good            | hide it, then `DELETE /api/admin/locations/:id {revision, confirmName}` with the **exact** current name | from the audit log (see §6) |

Prefer hiding. Deleting is allowed only for hidden locations; the audit row
keeps the complete record, so even a delete can be undone with revert.
Suggestions and audit events are never deleted through the API.

## 5. Base dataset rebuilds (OSM refresh)

Rebuilding `public/data` (`npm run data:check`) never touches D1. After
deploying a new dataset:

1. `GET /api/admin/quality` → **orphan overrides**: their target id vanished
   (the message names the dataset version they were made on). They are not
   applied to any other feature. Re-create the correction on the new id if
   needed, then `DELETE` the orphan.
2. **override-access-invalid / location-not-routable**: the graph changed
   and an access node no longer validates; those places are shown map-only
   until you set a new access point.
3. Hidden places stay hidden; owner and community locations stay published.

## 6. Recovery

### 6.1 Undo one change (preferred)

`GET /api/admin/audit?entity=location&entityId=<id>` → pick the event →
`POST /api/admin/revert {auditEventId}`. Restores that event's `before`
snapshot as a new revision (history is never rewritten) and audits the
revert. Works for location/override edits, hide/restore, deletes and
earlier reverts. It is refused with `409` if the record changed after that
event (revert the newer event first) and with `422` if a restored access
node no longer validates against the current graph.

### 6.2 Backups

```sh
# Full logical backup (schema + data), e.g. weekly and before risky work:
npx wrangler d1 export lpu-atlas --remote --output=backups/lpu-atlas-$(date -u +%Y%m%dT%H%M%SZ).sql
```

Store exports **outside the repository** (or in an encrypted, access-controlled
bucket): they contain private review notes and the full moderation history.
They never contain passwords, password hashes, cookies or IPs, but the
`sessions` table holds live session hashes and CSRF tokens — export with
`--table` for each of `suggestions locations overrides audit_events meta` if
the file will be shared, or simply let sessions expire.

### 6.3 Point-in-time restore (D1 Time Travel)

D1 keeps a continuous history (30 days on paid plans; less on Free — check
your plan).

```sh
npx wrangler d1 time-travel info lpu-atlas --timestamp=2026-10-20T09:00:00Z
npx wrangler d1 export lpu-atlas --remote --output=backups/before-restore.sql   # always first
npx wrangler d1 execute lpu-atlas --remote --command   "SELECT value FROM meta WHERE key = 'publication_version'"                   # note it: N
npx wrangler d1 time-travel restore lpu-atlas --timestamp=2026-10-20T09:00:00Z
npx wrangler d1 execute lpu-atlas --remote --command   "UPDATE meta SET value = '<N + 1>' WHERE key = 'publication_version'"
```

A restore rewinds **everything**, including the audit log and
`publication_version`. Keep the pre-restore export so later legitimate
changes can be re-applied by hand. The last step matters: the public ETag is
`W/"pub-<publication_version>"`, so after a rewind the next edits would reuse
version numbers that browsers already hold for _different_ content and get a
false `304 Not Modified`. Setting the version above anything served before
the restore makes every client fetch the restored layer. Prefer §6.1 for
single mistakes.

### 6.4 Restore an export into a fresh database

```sh
npx wrangler d1 create lpu-atlas-restore
npx wrangler d1 execute lpu-atlas-restore --remote --file=backups/<export>.sql
```

Point the `DB` binding at the new database, redeploy, check `/api/health`
and `/api/admin/overview`.

---

## 7. Credentials: rotation and recovery

- **Password mode — rotate / forgotten password**: run
  `npm run admin:hash-password`, then
  `npx wrangler pages secret put OWNER_PASSWORD_HASH`, redeploy. Session ids
  are keyed by the configured hash, so **every existing session ends** at once.
- **RATE_LIMIT_KEY**: rotate the same way at any time; it only resets
  current rate-limit windows.
- **Access mode — owner changes**: update the Access policy **and**
  `OWNER_EMAILS` together. Once the redeploy with the new `OWNER_EMAILS` is
  live, a removed email gets 403 even while its Access session is still valid. Revoke
  sessions in Zero Trust → Users if a device was lost.
- **Lost all access**: anyone with Cloudflare account access can reset the
  secret or variables as above; the data in D1 is unaffected. There is no
  recovery backdoor in the application.

## 8. Privacy: rate limits, IP hashes and retention

- Rate-limit buckets are `rl:` + HMAC-SHA256(`RATE_LIMIT_KEY` or a salt
  rotated daily in `meta`, scope | client | window). IPv6 clients are keyed by
  their /64. Raw IP addresses are never stored or logged.
- Limits: submissions 5 / 10 min and 20 / day per client, 500 / day globally;
  login 5 / 15 min per client.
- Retention: each bucket expires at most 24 h after its first request and is
  deleted by the next submission, login or owner dashboard visit
  (`GET /api/admin/overview`), so rows outlive their window by at most one
  such request — ≤ 48 h with normal use. Expired sessions are purged the same
  way. To purge immediately:

  ```sh
  npx wrangler d1 execute lpu-atlas --remote --command \
    "DELETE FROM rate_limits WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'); DELETE FROM sessions WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now');"
  ```

- Without `RATE_LIMIT_KEY`, yesterday's salt is overwritten, so buckets cannot
  be linked across days. With it, set a new key if it may have leaked.

## 9. Incident response

| Situation                                 | Steps                                                                                                                                                                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spam flood of suggestions                 | Rate limits cap it (500/day globally). Reject in bulk from the queue; nothing was public. If it persists, add a Cloudflare WAF rate-limiting rule on `POST /api/contributions/*`.                          |
| Wrong data published                      | Hide the location/place (instant), then revert the audit event that introduced it (§6.1).                                                                                                                  |
| Suspected credential leak (password mode) | Rotate `OWNER_PASSWORD_HASH` (§7) — ends all sessions. Review `GET /api/admin/audit` for actions you did not take; revert them.                                                                            |
| Suspected credential leak (Access mode)   | Remove the email from the Access policy and `OWNER_EMAILS`, revoke its Access sessions, review and revert as above.                                                                                        |
| Need to close admin immediately           | Remove `AUTH_MODE` (or set it to anything else) and redeploy: every admin endpoint returns 503; the public site keeps working.                                                                             |
| Database corrupted / mass bad edits       | Export first, then Time Travel restore (§6.3), then re-apply legitimate later changes from the export / audit log.                                                                                         |
| `/api/health` reports `db: "unavailable"` | Check the `DB` binding and that migrations are applied (`npx wrangler d1 migrations list lpu-atlas --remote`). The public map keeps working on the base dataset and shows "Community updates unavailable". |

Logs (`npx wrangler pages deployment tail`) contain only method, route,
status and duration — never bodies, cookies, tokens or IPs — so they are safe
to share when asking for help.
