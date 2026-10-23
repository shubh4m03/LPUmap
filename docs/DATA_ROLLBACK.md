# Dataset schema v2: compatibility, migration and rollback

This document covers moving from dataset schema v1 to v2 (the "v2 geographic contract",
[MODULE_CONTRACTS.md](MODULE_CONTRACTS.md)) and rolling back. It covers the static app, the base
dataset, the community/admin server and its D1 database. Every statement below is backed by a test
in `tests/server/compat/` (see [§6](#6-tests-that-back-this-document)).

- v1 dataset: commit `902af56`, `datasetVersion` `b628c5855b1d`
- v2 dataset: the working tree at the time of writing, `datasetVersion` `41801e4d11cc`

## 1. Decision: the server reads exactly one schema version

The server's base-data loader (`server/base-data.ts`) reads only `DATA_SCHEMA_VERSION`, the version
of the code it was built from. It does **not** support v1 and v2 side by side.

- Any other version is refused loudly before anything else is read.
  - The manifest is checked first, then every versioned file: `places.json`, `graph.json`,
    `context-places.json` and `boundary-review.json`.
  - The refusal is a `DomainError('unavailable')`, HTTP 503. Its message names the file, the version
    found and the version expected, for example `manifest.json has schemaVersion 1 but this server
reads schema version 2`.
  - It carries `details: { reason: 'schema-version', file, expected, found }`.
  - A failure is never cached; the next request retries.
- **Why not support both?**
  - Reading v1 would put off-campus places back into the set of override targets, against owner
    decision 2.
  - The client app refuses v1 data anyway (`src/data/loader.ts`).
  - Server code and data are deployed from the same commit, so there is no supported state in which
    they differ.
- **What a mismatch would affect.** It can only come from a broken or partial deploy.
  - `POST /api/contributions` and the admin endpoints that need base data answer 503 with that
    message.
  - `GET /api/locations` (the public publication) does not read base data and keeps working.
- **Context and review data in v2.** The server also loads `context-places.json` and
  `boundary-review.json`, read-only, for three purposes:
  - duplicate detection, so a suggestion near Law Gate is still matched against a mapped shop;
  - `duplicateOf`, which may name a context place;
  - explaining orphans.
- **Overrides target campus places only.** These are the ids in `places.json`. An override whose
  target is a context place is an orphan, and it is never applied to the context layer.

## 2. Static app and data rollback

The precondition for an atomic rollback: the v2 change must land as **one commit**. That commit
contains `public/data/**`, `src/data/schema.ts` (`DATA_SCHEMA_VERSION = 2`) and
`src/config/index.ts` (`cache.dataCache = 'lpu-atlas-data-v2'`). The drill checks this and fails if
the flip is split across commits.

### 2a. Instant rollback (no rebuild)

Cloudflare Pages → the project → **Deployments** → the last v1 deployment → **Rollback to this
deployment**. Static files and Pages Functions roll back together, so the server and its data stay
in step. D1 is not part of the deployment and needs nothing (see §3).

### 2b. Rollback by revert (what the drill tests)

```sh
# 1. Find the commit that flips public/data from schema 1 to 2 (the v2 data commit).
git log --oneline -- public/data/manifest.json src/data/schema.ts

# 2. Revert it. This restores the v1 files, DATA_SCHEMA_VERSION = 1 and 'lpu-atlas-data-v1' together.
#    If later commits touched the same files, revert those first (newest first) or resolve the conflicts.
git revert --no-edit <v2-data-commit>

# 3. Verify before pushing. The Pages build runs data:check, which must reproduce the v1 files exactly.
npm ci
npm run -s data:check
git status --porcelain -- public/data        # must print nothing
npx tsc --noEmit -p . && npx tsc --noEmit -p tsconfig.server.json
npx vitest run && npx vitest run -c vitest.server.config.ts
npx vite build && npm run smoke

# 4. Deploy.
git push
```

Rehearse it without touching this checkout, the site or any database:

```sh
LPU_ROLLBACK_DRILL=1    npx vitest run -c vitest.server.config.ts tests/server/compat/rollback-drill.test.ts  # git level, ~10 s
LPU_ROLLBACK_DRILL=full npx vitest run -c vitest.server.config.ts tests/server/compat/rollback-drill.test.ts  # + data:check, build, smoke, v1 server suite, ~2 min
```

On PowerShell, set the variable first, e.g. `$env:LPU_ROLLBACK_DRILL='full'`.

The drill works on a temporary clone:

1. It overlays any uncommitted work and commits it **in the clone only**, as a simulated v2 commit.
   Once v2 is committed, there is nothing to overlay and the drill reverts the real commit.
2. It finds the flip commit, checks that the flip is atomic, and runs `git revert`.
3. It checks that the reverted tree is byte-identical to the v1 parent for `public/data`,
   `src/data`, `src/config`, `server`, `migrations`, `functions` and `src/community`.
4. In `full` mode it also runs, inside the reverted clone:
   - `npm run data:check`, which must leave `public/data` unchanged;
   - `vite build`;
   - a check that the precache manifest lists every `data/*` file with an MD5 revision of its
     content, and no v2-only file;
   - `npm run smoke`;
   - the v1 server suite.

### Service worker behaviour (precache atomicity)

- **One manifest.** The app shell, all JS and every `data/*.json` / `data/*.geojson` file are in one
  Workbox precache manifest with content revisions (`src/offline/pwa-config.ts`). A rollback build
  therefore ships a new `sw.js` whose manifest lists the v1 files.
- **Returning visitors** get the update prompt. Until they accept it, the old worker serves the v2
  app together with the v2 data. After "Update now", they get the v1 app together with the v1 data.
  Nothing mixes versions. The loader also refuses data whose `schemaVersion` differs from the code.
- **The data-cache name is a version label, not the mechanism.** `cache.dataCache`
  (`lpu-atlas-data-v1` / `-v2`) is reverted with the commit and must stay equal to
  `lpu-atlas-data-v${DATA_SCHEMA_VERSION}` (tested). No runtime code reads it; consistency comes
  from the single precache manifest, the `?v=<datasetVersion>` URLs and the loader's version check.
- **Lazy v2 files** (`context-places.json`, `detections.geojson`, `boundary-review.json`) do not
  exist in v1. The v1 worker's manifest does not list them, and Workbox removes them from the
  precache when the v1 worker activates.

## 3. D1: no migration in either direction

- **Nothing to run.** v2 changes no SQL. `migrations/` is exactly the v1 set (only
  `0001_initial.sql`, byte-identical to `902af56`). A database built from the v1 SQL has the same
  `sqlite_master` schema as one built from the current migrations (tested).
- **What D1 stores.** Base data appears only as place ids (`overrides.target_id`) and a free-text
  `base_dataset_version`. Neither depends on the dataset schema.
- **Unchanged API.** The public publication contract (`PUBLICATION_SCHEMA_VERSION`) is the same as
  in v1.
- **No apply and no down path.** None is needed, so none is provided. On rollback, D1 keeps every
  row written during the v2 period.

Recommended before deploying v2 (and before any rollback):

```sh
npx wrangler d1 export lpu-atlas --remote --output=backups/lpu-atlas-before-v2-$(date -u +%Y%m%dT%H%M%SZ).sql
npx wrangler d1 migrations list lpu-atlas --remote   # expect only 0001_initial.sql applied, before and after
```

Store exports outside the repository ([ADMIN_OPERATIONS.md §6.2](ADMIN_OPERATIONS.md)).

## 4. What happens to owner data

### v1 → v2

All figures below are derived from the two `places.json` files and v2's `context-places.json` /
`boundary-review.json`.

| Place ids in v1 `places.json` (855)                    | In v2                                                                                      | Effect on an override or hide stored in D1                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 227 campus places                                      | kept in `places.json`, same ids                                                            | **applied** as before                                                   |
| 261 off-campus places                                  | moved to `context-places.json`; 46 former off-campus "building" places become point places | **orphan**, reason `context-layer`: not applied, kept in D1             |
| 5 on-campus buildings in open boundary-review sections | held out of the inventory as `uncertain` (`centre-indent-blocks` ×4, `ne-bay` ×1)          | **orphan**, reason `boundary-review`: reapplies once the owner confirms |
| 1 on-campus duplicate footprint (`osm:way/675395630`)  | removed (IoU 1 with `osm:way/422437890`)                                                   | **orphan**, reason `not-in-dataset`                                     |
| 352 off-campus buildings, 9 off-campus areas           | not shipped (owner decision 2)                                                             | **orphan**, reason `not-in-dataset`                                     |

- **Where orphans show up.** `GET /api/admin/quality` lists every orphan with its reason
  (`orphanReason`) and the dataset version it was made on. `GET /api/admin/overrides` shows
  `orphan` and `orphanReason`.
- **Orphans are never applied to another feature.** The merge matches by id only.
- **Orphans are never deleted automatically.** Only an explicit, audited `DELETE` removes one.
- **They can't be edited against v2.** Editing returns 404, because there is no campus target.
- **Hidden places stay hidden.** A hidden campus building stays hidden across rebuilds, even when a
  refresh drops the building and a later refresh brings it back.
- **Owner and community locations persist unchanged.**
- **Access nodes.** Graph node indices and coordinates are identical in v1 and v2: 1,636 nodes; v2
  only adds the `campus` edge flag. So every stored access node still validates. Re-validation
  against the current graph runs on every quality check and in every merge. A node that stops
  validating makes the place map-only and is reported; the D1 row is kept.
- **Locations outside the boundary.** An owner or community location outside the campus boundary
  is still published. It gets `campusZone: 'off-campus-nearby'`, is excluded from campus search,
  and is flagged `location-outside-boundary` in quality.

What the owner should do after deploying v2:

1. Open the data-quality page and review the orphans by reason.
   - `context-layer`: the correction is not applied, because overrides apply to campus places only.
     **Keep the row** while a rollback is still possible: deleting it cannot be rolled back by a
     code revert (only by `POST /api/admin/revert` of the delete).
   - `boundary-review`: keep the row. It applies again once the boundary section is resolved, either
     by a curated decision in `data/curated/boundary-review.json` or by an OSM fix.
   - `not-in-dataset`: if the correction is still needed, re-create it on the new id. Then delete
     the orphan.
2. `override-access-invalid` / `location-not-routable`: set a new access point if needed. None are
   expected for the v1 → v2 change, because the graph is unchanged.

### After a rollback to v1

- **Every override applies again.** Every v2 campus place id also exists in v1 (tested), so nothing
  made during the v2 period becomes an orphan. All rows are applied again, **including the
  v2-period orphans**, because their targets exist in v1:
  - overrides and hides on off-campus places apply again (a hidden Law Gate place is hidden again,
    a renamed shop is renamed again);
  - overrides on the boundary-review buildings apply again.
- **Deletions stay.** An orphan the owner deleted during the v2 period stays deleted, because D1 is
  not rolled back. Restore it with `GET /api/admin/audit?entity=override&entityId=<id>` and then
  `POST /api/admin/revert {auditEventId}`.
- **Locations keep their state.** Owner and community locations added during the v2 period stay
  published. Their access nodes still validate, because the graph is unchanged.

What the owner should do after a rollback:

1. Open the data-quality page and expect zero `orphan-override` warnings.
2. Review the corrections that were orphans during v2. They are visible again; confirm each is
   still wanted.
3. If a deliberate v2-period change should survive the rollback, re-apply it in the admin; D1 is not
   rolled back.

## 5. Moving forward again (v1 → v2 after a rollback)

Revert the revert: `git revert --no-edit <revert-commit>`, or redeploy the v2 deployment in Pages.
§4 "v1 → v2" applies again. D1 needs nothing.

## 6. Tests that back this document

All tests run on a throwaway local D1 (wrangler `getPlatformProxy`, `persist: false`). The v1
dataset is exported with `git show 902af56:public/data/*` into a temp directory.

| File                                                  | What it proves                                                                                                                                                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/server/compat/base-data-versions.test.ts`      | v2 loads (campus, context and review kept apart); v1 is refused at the manifest before any other file is read; a mixed deploy is refused by file name; failures are not cached; orphan reasons           |
| `tests/server/compat/override-survival.test.ts`       | the §4 scenario end to end: seed on v1, switch to v2, simulated graph breakage, a refresh that drops and reintroduces a hidden building, rollback to v1, explicit delete of an orphan; merge determinism |
| `tests/server/compat/rollback.test.ts`                | schema version, data and cache name agree (working tree and `902af56`); every data file is in the precache and matches the manifest; migrations byte-identical; identical D1 schema from v1 SQL          |
| `tests/server/compat/rollback-drill.test.ts` (opt-in) | §2b in an isolated clone                                                                                                                                                                                 |

```sh
npx vitest run -c vitest.server.config.ts tests/server/compat
LPU_ROLLBACK_DRILL=full npx vitest run -c vitest.server.config.ts tests/server/compat/rollback-drill.test.ts
```

**Shallow checkouts.** CI uses `actions/checkout` without `fetch-depth`, so commit `902af56` is not
present there. The v1-dependent suites then **skip** with a printed reason. To run them in CI, use
`fetch-depth: 0`, or point `LPU_V1_DATA_DIR` at a directory containing `data/manifest.json`,
`data/places.json`, `data/graph.json` and `data/boundary.geojson` from v1.
