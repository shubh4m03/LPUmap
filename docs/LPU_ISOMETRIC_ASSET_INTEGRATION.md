# LPU isometric artwork integration: contract, architecture and status

> **Status:** integrated, 2026-10-24 (not yet committed). Schemas, the build/check script, derived web
> copies, migration 0003 with its tested rollback, publication v3, the merge rule, the Illustrated
> overview renderer, the directory/search/details wiring and the admin Artwork section with its
> endpoints are built, reconciled by the integration owner (§10) and tested. Real gate results are in
> [IMPLEMENTATION_STATUS.md §1.10](IMPLEMENTATION_STATUS.md#110-campus-illustration-artwork-integration-on-top-of-6050e91-uncommitted).
> Open items are in §9, the owner's verification guide in §11.

The owner supplied 29 artwork files (`lpu-isometric-map-design/`) on 2026-10-24 with the statement "I own or am
authorized to use the artwork" (recorded in [GEODATA_SOURCES_AND_LICENSES.md §14](GEODATA_SOURCES_AND_LICENSES.md#14-lpu-isometric-map-design-owner-supplied-campus-illustration)).
The artwork is the authoritative **visual** source of the isometric experience: it is shown as drawn, not used
as a style reference. It is never a geographic source, and its numbers are never official LPU block numbers.

**Where to read what**

| Topic                                                   | Section       |
| ------------------------------------------------------- | ------------- |
| Rules, records and ids                                  | §0, §1        |
| Assets, build pipeline, derived copies, offline         | §2            |
| View modes, hotspot rendering, renderer choice          | §3            |
| Database, admin endpoints, publication, rollback, merge | §4            |
| Directory and search                                    | §5            |
| Gates and where they are enforced                       | §6            |
| Ownership and reconciliations                           | §8, §10       |
| Owner verification guide (replaces `OWNER_CHECKLIST`)   | §11           |
| Tests, screenshots, limitations                         | §12, §13, §14 |

Related: [LPU_ISOMETRIC_ASSET_INVENTORY.md](LPU_ISOMETRIC_ASSET_INVENTORY.md) (files and exact transcriptions),
[LPU_ISOMETRIC_ASSET_MAPPING.md](LPU_ISOMETRIC_ASSET_MAPPING.md) (generated per-subject association table),
[ISOMETRIC_AND_3D_DESIGN.md](ISOMETRIC_AND_3D_DESIGN.md) (modes, directory),
[COMMUNITY_MODULE_CONTRACTS.md](COMMUNITY_MODULE_CONTRACTS.md) (publication, audit).

## 0. Binding rules (summary)

1. Originals are never modified, renamed or lossily overwritten. Copies are byte-identical; derived copies are
   uniform scales of the whole image, recorded with the sha256 of their source.
2. Every printed label is kept **exactly** (spelling and typos such as `INGNEERING`/`HOSTAL`, capitals,
   punctuation, double spaces). A corrected spelling may only be a search **alias**.
3. Five things are kept apart: exact artwork label, official verified name, official verified block number,
   internal stable id, search aliases. The artwork contracts carry only the first, the fourth and the fifth;
   any key starting with `official` is rejected by the registry check.
4. Nothing is inferred from position or appearance. Visual correspondences between two drawings are recorded
   as `relations` (unverified) and are never shown as identity.
5. The illustration is a **2D schematic**: not geographically exact, not rotatable, not a 3D model. It is never
   stretched to fit geography and never used for routing.
6. Association status: `verified` only with recorded owner/official evidence (none exists today),
   `approximate` = a reviewed candidate footprint (shown only as "Unconfirmed match", never routed),
   `unresolved` otherwise.

## 1. Records and ids (`src/isometric-art/schema.ts`)

| Record      | Id                                                            | Where                                                          | Notes                                                                                                                      |
| ----------- | ------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Asset       | `iso-art-NNN` (inventory id)                                  | `inventory.json` (facts), `registry.json` (publish/derive)     | One original file. 28 published; `iso-art-115` is a byte-identical duplicate of `iso-art-111` and is not published.        |
| Hotspot     | `hs-…`                                                        | `hotspots.json`                                                | 65 outlines on the master, normalized source coordinates.                                                                  |
| Subject     | `art:num-<n>` / `art:scene-<NNN>` / `art:area-<hotspot slug>` | `registry.json`                                                | What the artwork depicts. 82 today: 55 numbered, 7 scenes, 20 areas. Every hotspot belongs to exactly one subject.         |
| Association | keyed by subject id                                           | `registry.json` (baseline) + D1 `artwork_associations` (owner) | `{status, buildingId, evidence[], candidateFootprints[] (curated only), reason (curated) / note (D1, private), revision}`. |

Why subjects and not files: one vignette (`iso-art-087`) captions 14 numbered buildings and the master shows 45,
so labels and links cannot belong to a file. (The brief's "assetId 'art:block-25-26'" is this `subjectId`.)

**Subject fields:** `artworkNumber` (as printed, e.g. `21A`), `displayLabel` (exact caption, or the only index
row; `null` when sources disagree), `visibleBlockLabel` (exact heading, e.g. `BLOCK-25,26:`), `otherLabels`,
`artworkCategory` (an index section heading, only when unambiguous), `hotspotIds`, `vignetteAssetIds`,
`relations` (`candidate-part-of` / `visual-correspondence`, unverified), `aliases`, `displayHold` (a label the owner
must rule on before it is shown: today only `art:scene-103`), `needsManualVerification`, `notes`.

**Label quotes** are `{ref, text, span?}`: `ref` is an inventory label (`iso-art-087/L1`), an inventory pin
(`iso-art-119/pin:58`) or a hotspot label (`hotspot:hs-text-lpu-letters`). `text` must equal the referenced text,
or be an exact substring of it when `span: true`. Transcription placeholders (`(blank)`, `(illegible)`) can never be
quoted or published.

## 2. Assets and the build (`scripts/build-isometric-art.ts`)

| Command                  | Does                                                                                                                                                                                                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run art:build`      | Validates inventory, hotspots (their own validators, reused), registry; checks every original's sha256; copies canonical originals **unchanged, same file names** to `public/isometric-art/original/`; writes `public/isometric-art/manifest.json` and `docs/LPU_ISOMETRIC_ASSET_MAPPING.md`.      |
| `npm run art:check`      | The same validation, then fails if the manifest or mapping doc is stale, a published copy or derived file is missing or differs, a derived file was made from a different original, or `public/isometric-art/` holds a file the manifest does not list. No Chromium. In CI and in `npm run build`. |
| `npm run art:derive`     | Makes every registry `derive` spec in the Playwright Chromium canvas (§2.1), writes `public/isometric-art/derived/**`, measures visual equivalence into `docs/isometric-art/derived-equivalence.json`, then builds as `art:build`. Dev only; fails if any group is not equivalent.                 |
| `npm run art:verify`     | Chromium, writes nothing: derives twice in separate browsers (must be byte-identical), reports whether they equal the committed bytes, and re-measures the **committed** copies (thresholds + negative controls). In CI after the Playwright install.                                              |
| `npm run art:check-dist` | After `vite build`: `dist/` holds the manifest and every published file byte-identical and nothing else under `isometric-art/`; `sw.js` precaches only the manifest and preview and has the artwork runtime route; the app bundle contains the loader and disclaimer; `img-src` is self only.      |

`art:check` additionally: lossless derived files are VP8L at the recorded size, every derived file is covered by the
equivalence record with its current sha256 and passes the current thresholds (and every negative control fails
them), duplicates are handled, the manifest has no absolute URL, and every subject has an association record
(counts are printed). `npm run build` runs `art:check` before and `art:check-dist` after `vite build`.

All outputs are **committed** (not git-ignored, not machine-specific), so a fresh checkout and the production
build contain every required image without Chromium. Vite copies `public/isometric-art/**` into `dist/`.
The originals are committed **in place** in `lpu-isometric-map-design/` (unchanged bytes and names): they are the
approved project assets and the inputs `art:check` verifies by sha256. `tests/integration/isometric-art-git.test.ts`
proves no required path is git-ignored and that git stores every image byte-for-byte (filtered blob id = raw blob
id); git stores the byte-identical `public/isometric-art/original/*` copies as the same blobs, so they add no
repository size.

**Derived copies** (registry `derive[]`, validated by `validateDerived`): `web-full` (same pixel size, sRGB),
`preview` (`maxWidth`, uniform scale), `tiles` (pyramid: level 0 = full size, each level halves, tiles cover each
level exactly). Each manifest record has `url`, `sha256`, `sourceSha256`, `width`, `height`, `mime` and, for tiles,
the normalized tile rectangle. Names: `derived/<assetId>/web-full.<ext>`, `…/preview-<w>.<ext>`,
`…/tiles/<level>/<col>-<row>.<ext>`.

**Chosen for the master** (CMYK JPEG with an embedded SWOP profile, 5.2 MB): `web-full`, `preview` (`maxWidth`
1600 → 1600×1132) and `tiles` (512 px, 3 levels: 35 + 12 + 4 tiles), all **lossless WebP** (`quality: 1`, which
Chromium encodes as VP8L with an sRGB ICC chunk) — 53 files, 6.2 MB. Lossy WebP q0.9 (1.6 MB) was measured and
rejected: at 1:1 it visibly softened the red window grids, court markings and coloured text edges (native maxAbs
123), which conflicts with "reproduce faithfully". The vignettes (40–190 KB PNG) stay original only (no derived copy).
At integer pixel sizes a scaled level cannot have exactly the source aspect; the difference is below one derived
pixel (tested), and renderers place every level by normalized coordinates, so hotspots stay aligned.

### 2.1 Derivation and visual equivalence (`scripts/lib/isometric-art/{chromium,integrity}.ts`)

- **Decode**: `<img>` + `drawImage` into a software canvas (`--disable-gpu`, `willReadFrequently`), i.e. Chromium's
  colour-managed path: CMYK + SWOP → sRGB exactly as the browser displays the original (a compositor screenshot of
  the original and of `web-full` at 1:1 differ by 0 in every channel). Each level is the WHOLE decoded image drawn
  at `ceil(W/2^L) × ceil(H/2^L)` (high-quality smoothing); tiles are exact pixel crops of their level. Sizes, names
  and rectangles come only from `expectedDerived` (`renderJobs`).
- **Determinism**: same Chromium → byte-identical files (two browsers, and repeated `art:derive`, tested). Another
  Chromium/OS may encode different bytes; then `art:verify`'s equivalence on the committed copies is the gate.
- **Equivalence** (per group = one file, or all tiles of one level composed): `native` = derived vs the original
  drawn at the same size (encoding loss only); `downscaled` = derived vs the FULL original, both downscaled in
  Chromium to 512 px wide (catches crop, stretch, shift, misplaced tiles, recolour). Thresholds
  (`EQUIVALENCE_THRESHOLDS`): lossless native maxAbs = 0; lossy native PSNR ≥ 32 dB and ≤ 8 % pixels off by > 16;
  downscaled PSNR ≥ 30 dB, mean abs ≤ 2.5, ≤ 6 % pixels off by > 16. Negative controls must fail: 2 px shift
  (measured 27.2 dB, 11.4 %), R/B swap (13.6 dB), 2 % crop stretched back (17.3 dB). Measured today: native maxAbs 0
  for all five groups; downscaled web-full and tiles-0 identical, tiles-1 37.4 dB, tiles-2 42.2 dB, preview 34.5 dB
  (two-stage vs one-stage resampling). Recorded with the Chromium version in `docs/isometric-art/derived-equivalence.json`.

### 2.2 Offline / PWA (`src/offline/pwa-config.ts`)

- **Precached** (light, versioned with the app): `isometric-art/manifest.json` and
  `isometric-art/derived/*/preview-*.webp` (640 KB).
- **Never precached** (`PRECACHE_IGNORES`): `isometric-art/original/**` (5.2 MB master + 2.4 MB vignettes),
  `derived/*/web-full.*` and `derived/*/tiles/**`.
- **Runtime-cached** (`ART_RUNTIME_CACHING`, the only runtime route): same-origin `GET /isometric-art/(original|derived)/…
.(png|jpg|jpeg|webp)`; `sameOrigin` is required explicitly, so satellite providers and the API can never match.
  StaleWhileRevalidate into cache `lpu-atlas-isometric-art`, at most 96 entries (today 80 eligible files), 30 days,
  purged first on quota errors. Offline, the illustrated view therefore always has the preview, and has every tile,
  vignette or original that was viewed before.

## 3. Mode model (`src/app/view-mode.ts`)

- The isometric mode (`?view=iso`) has two variants: **Illustrated overview** (default, `&iso=art`) and
  **Map-accurate isometric** (`&iso=map`, the existing footprint drawing). `?view=iso` keeps working.
- Exports: `IsometricVariant`, `DEFAULT_ISOMETRIC_VARIANT`, `ISOMETRIC_VARIANT_LABELS`/`_DESCRIPTIONS`,
  `parseIsometricVariantParam`, `buildIsometricViewUrl`, `supportsIsometric(variant, cap)`,
  `resolveIsometricVariant(requested, {artworkUnavailable})`.
- The illustrated variant always shows `ILLUSTRATION_DISCLAIMER` ("Schematic illustration … not geographically
  exact …") and announces it on entry. It cannot plan routes, pick points, rotate or tilt; each has a stated
  reason. Live location and navigation stay unsupported in both variants (as today).
- If the manifest or images cannot load (`loadIsometricArtManifest` → `{ok: false, reason}`), the map-accurate
  variant is shown and the reason announced, never a blank canvas.
- **Synchronization is by stable building ids only.** Selecting a hotspot selects its subject; if the effective
  association is `verified`, the app selection becomes that `buildingId` (the same entry in every mode). An
  `approximate` subject selects only the artwork entry and may outline the candidate as "Unconfirmed match" in map
  modes. Selecting a building in a map mode highlights the hotspots of its verified joins in the illustration.

### 3.1 Hotspot rendering (Gate 2)

Hotspots are stored in normalized source coordinates of the master (`x = px / 3371`, `y = px / 2384`,
`coordinateSpace` in the manifest). The renderer applies **one** transform to image and outlines:
`screen = translate + scale × (n × [width, height])`, with uniform `scale` (never separate x/y scales, so the
artwork is never stretched). Tiles and previews are placed in the same normalized space.
`reviewStatus: 'needs-manual-verification'` outlines (44 of 65) are drawn dashed in "Show outlines", badged
"Outline needs review" in the detail card, and were never guessed into place.

**Tested** (`tests/e2e/isometric-art.spec.ts`, production build, real backend) at 1440×900, 1280×800, 768×1024,
390×844 (DPR 2) and 360×800 (DPR 2), after opening, wheel zoom, drag pan, touch pan, pinch, keyboard zoom, window
resize and keyboard-focus panning:

- **Image registration:** the screenshot best matches the web copy drawn with the reported transform at offset
  (0, 0) within ±1 device px; a 3 px shift is at least 15 % worse.
- **Outline registration:** the pixels changed by "Show outlines" best match the predicted polygons at a shift
  within ±1 device px (p95 distance ≤ 1.5 × DPR + 1, edge coverage > 90 %).
- **Hit test:** clicking a hotspot's label anchor selects that hotspot's subject, and clicking a printed pin disc
  selects that pin (`tests/unit/isometric-art/renderer-model.test.ts` checks all 45 discs at the centre and 4 rim
  points).
- **Fidelity:** `tests/e2e/art-evidence.spec.ts` draws the original master JPEG with the renderer's transform next
  to the rendered overview for four regions (pins 58, 50, 1, 2): PSNR 47.9–53.1 dB, mean error 0.07–0.38 / 255 on
  desktop and mobile.

### 3.2 Renderer (`src/isometric-art/`)

**Choice: layered DOM, measured.** On the real 3371×2384 master at 4× CPU throttle in Chromium, one CSS
transform on a layer holding the `<img>` tiles and an SVG of outlines gave a 16.7 ms frame median and p95 and a
first paint of about 0.5–0.6 s. Canvas2D gave a 33–50 ms median, a 50–67 ms p95 and a first paint of 3.2–3.6 s.
Without throttling both held 16.7 ms. The benchmark page is in scratch only; the numbers are from the renderer
agent's run on 2026-10-24.

| Module                    | Role                                                                                                                                                                                                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `viewport.ts`             | The single transform `{scale, tx, ty}` (pure): point mapping both ways, clamp, zoom about a point, pan, pinch, resize (keeps the centre), initial view (whole traced campus if scale ≥ 0.36, else 0.5 for legibility on phones), framing, max scale 4. Translation is snapped to device pixels. |
| `hotspot-geometry.ts`     | Hit test in source pixels through the inverse of the same transform: first a printed pin disc containing the point (so clicking "33" selects pin 33 although pin 36's outline runs under that disc), else the smallest outline containing it; touch tolerance only on a miss.                   |
| `image-plan.ts`           | Smallest sharp-enough preview first, then the visible tiles of the coarsest sharp-enough level, else the full image. Derived copies whose `sourceSha256` does not match the original are ignored.                                                                                               |
| `hotspot-model.ts`        | Model from the manifest and the merged associations; keyboard order (45 pins by printed number, then the other outlines); a building highlights only its verified subjects.                                                                                                                     |
| `IllustratedOverview.tsx` | The view: mouse, wheel, drag, touch pan, pinch, keyboard (arrows, +/−, 0, Escape; Tab walks the outlines, Enter selects). Outlines are named by their exact printed label, or a neutral numbered name when nothing is printed.                                                                  |
| `IsometricModeStage.tsx`  | App glue: variant switch ("Illustrated" / "Map-accurate"), store selection, focus requests, fallback to the map-accurate drawing with the reason announced.                                                                                                                                     |
| `ArtworkDetailCard.tsx`   | Exact labels by role, the "not an official LPU block number" note, the original vignette, official name and block "Not verified" unless verified, Directions only for verified links.                                                                                                           |
| `ArtworkLegend.tsx`       | A crop of the artwork's own legend (`LEGEND_CROP` 72, 1886, 678×432 source px; all five swatches, `PEDISTRIAN` as printed).                                                                                                                                                                     |

**Touch taps** (final gate, 2026-10-26): a tap selects on `pointerup`, and the detail card can open right under
the finger; Chromium then hit-tests again for the click it synthesizes from the touch, so that click landed on the
new card's Close button and undid the selection (reproduced on the 768×1024 tablet project resized to 614×870).
The stage now cancels `touchend` (it handles touches through pointer events only), so no synthesized click
follows a tap. Regression test: `tests/unit/isometric-art/renderer-component.test.tsx` ("no ghost click").

**Measured cost** (CDP 4× CPU throttle, cache disabled): first paint 79–85 ms after the stage mounts on
desktop and 134–196 ms on mobile; pan/zoom rAF interval median 16.7 ms, p95 16.7–16.8 ms on both. The
overview's own bytes on opening are 686 KB on a 1440×900 desktop (preview + manifest) and 2.12 MB on a
390×844 DPR-2 phone (preview + 12 level-0 tiles).

## 4. Persistence and owner verification

### 4.1 Migration 0003 (`migrations/0003_artwork_associations.sql`)

`artwork_associations(subject_id PK, status, building_id, evidence_json, note, created_by, created_at, updated_by,
updated_at, revision)` with CHECKs: subject id shape; status enum; base/studio building id shape;
`unresolved ⇔ building_id IS NULL`; `verified ⇒ ≥ 1 evidence`; evidence is a JSON array ≤ 8 KB; note ≤ 1000.
`audit_events` is rebuilt (rows and ids preserved, as in 0002) to accept entity type `'artwork'`.

### 4.2 Admin endpoints (`server/domain/artwork/associations.ts`, routes in `server/handlers/admin/artwork-routes.ts`)

| Method | Path (under `/api/admin`)          | Permission       | Body / result                                                                                           |
| ------ | ---------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------- |
| GET    | `/artwork/associations`            | `admin:read`     | `{items: [{subjectId, baseline, decision (incl. private note), effective}], issues}`                    |
| GET    | `/artwork/associations/:subjectId` | `admin:read`     | the same view + `history` (audit, oldest first)                                                         |
| PUT    | `/artwork/associations/:subjectId` | `artwork:verify` | `artworkAssociationWriteSchema` (`expectedRevision` null = create; 409 when stale), audit `artwork.put` |
| DELETE | `/artwork/associations/:subjectId` | `artwork:verify` | `artworkAssociationResetSchema` → back to the curated baseline, audit `artwork.reset`                   |

Every write is one batch: the row change, the audit row with before/after (guarded by `changes() > 0`) and the
publication bump. 404 for an unknown subject, 422 for a building that is not a current campus building.
422 also for a Google Maps / Earth / Street View URL as evidence or inside an evidence description (never a
source, `isProhibitedSourceUrl` from `src/building-studio/text.ts`, as in Building Studio) and for evidence whose
stored JSON would exceed the 0003 CHECK (8192 characters). Evidence text, URLs and the private note refuse control
characters, bidi embedding/override/isolate controls and unpaired surrogates (400). Red-team coverage:
`tests/server/security/artwork-attacks.test.ts`.

### 4.3 Publication v3

`PUBLICATION_SCHEMA_VERSION = 3`: v2 + `artworkAssociations` (public fields only: `subjectId, status,
buildingId, evidence, revision, updatedAt`; never the note or actors). Readers accept v1, v2 and v3; an older
body simply has no decisions. Deploy order: apply 0003, then deploy the v3 server.

### 4.4 Rollback and recovery (`docs/db/0003_down.sql`)

Non-destructive by design. It keeps `artwork_associations` (inert for the pre-0003 server), rebuilds
`audit_events` with the 0002 CHECK while keeping every row (`artwork` → `system`, action prefix kept), bumps the
publication version and forgets 0003 in `d1_migrations`. Re-applying 0003 (`IF NOT EXISTS`) restores the exact
0003 schema, the same decisions and the `artwork` entity type of their audit rows. Tested on isolated local D1
only (`tests/server/migrations/migration-0003.test.ts`): fresh, populated, failing-atomic, rollback, re-apply and
three repeated cycles. Recovery copy before any rollback: `wrangler d1 export`.

### 4.5 Merge rule (`mergeArtworkAssociations`, `src/isometric-art/associations.ts`)

1. An owner decision replaces the curated baseline **whole**; candidate footprints always come from the curated
   baseline. No decision and no baseline → `unresolved`.
2. Decisions live only in D1, so regenerating the registry never overwrites them; deleting a decision (audited)
   is the only way back to the baseline.
3. A decision for an unknown subject is reported (`orphan-decision`) and ignored.
4. A link to a building missing from the current building set is reported (`building-missing`) and shown as
   `unresolved` (the stored decision is untouched).
5. Only `verified` yields `buildingId`; `approximate` yields `unconfirmedMatchId`.

## 5. Directory contract (`createArtworkDirectory`, `src/isometric-art/directory.ts`)

- **Verified** subject → no new entry: it joins the existing directory entry with the same stable id and adds
  its exact labels (and aliases) as search text (`joinsByBuilding`).
- **Other** subjects → artwork-only entries with their `art:` id: `routable: false`, `location: null`, exact
  title (display label, else block heading, else "Illustration pin N" / "Unlabelled area on the illustration"),
  `artworkNumberNote` beside any number, and `unconfirmedMatch` for approximate links.
- `search(query)` is the ONLY artwork search (the building directory's illustration layer,
  `src/directory/artwork.ts`, calls it). It matches exact labels, aliases and the printed artwork number
  (normalized like `normalizeDirectoryText`). Rank 0: the number the query names (`artworkNumberQuery`:
  "25", "025", "Block 25", "BLOCK-25", "block25") or an exact label/alias; 1: prefix; 2: contained, or every
  query word contained. Ties: artwork-number order (`compareArtworkNumbers`), then id. Held labels are
  neither shown nor searchable.
- The app search index (`src/search/artwork-docs.ts`) indexes the same entries for the command palette:
  one `artwork` doc per artwork-only entry, and a verified item's labels and number as extra terms of its
  building's own doc (one building, one result).

## 6. Gate mapping

The results of the integration owner's runs are recorded in
[IMPLEMENTATION_STATUS.md §1.10](IMPLEMENTATION_STATUS.md#110-campus-illustration-artwork-integration-on-top-of-6050e91-uncommitted);
this table says where each gate is enforced.

| Gate                       | Where it is enforced                                                                                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Asset integrity          | `art:check` + `art:check-dist` (CI + `npm run build`), `art:verify` (CI), `tests/unit/isometric-art/{registry,integrity}.test.ts`, `tests/integration/isometric-art-{git,derive,dist}.test.ts`.                                          |
| 2 Hotspot accuracy         | Normalized hotspots + manifest `coordinateSpace` (§3.1); one transform (`viewport.ts`); `tests/unit/isometric-art/renderer-*.test.ts(x)`; `tests/e2e/isometric-art.spec.ts` at five sizes; fidelity in `tests/e2e/art-evidence.spec.ts`. |
| 3 Single integration owner | §8 ownership; §10 lists every competing implementation found in the combined diff and merged into one.                                                                                                                                   |
| 4 Migration safety         | `tests/server/migrations/migration-0003.test.ts` and `tests/server/artwork/persistence.test.ts` on isolated local D1, plus a wrangler `--local --persist-to <scratch>` rehearsal; non-destructive rollback (§4.4); no remote D1 touched. |
| 5 Clean checkout           | All outputs committed; `art:check` needs no Chromium; fresh-tree rebuild (`npm ci`, `npm run build`, smoke, Vitest, Playwright) by the integration owner.                                                                                |
| 6 Evidence                 | `tests/e2e/art-evidence.spec.ts` (desktop and mobile screenshots, §13), exact-label tests (§12), identity: a verified link selects the same building id in the illustration and on the map.                                              |

## 7. Required changes outside the contract stage

- ~~`src/offline/pwa-config.ts` precache decision~~ — done by the art pipeline (§2.2).
- ~~`.gitattributes`: `*.jpg binary`, `*.jpeg binary`, `*.webp binary`~~ — done by the integration owner;
  `tests/integration/isometric-art-git.test.ts` checks every artwork image has `binary` set and `text` unset.
- ~~`server/http/router.ts` `subjectId` parameter; `server/auth/authorize.ts` permission `artwork:verify`~~ —
  done by the admin package.

## 8. Ownership (one owner per service; reuse these modules, never re-implement them)

| Work package                | Owns (writes)                                                                                                                                                                                                                                                                                                                                                                                | Must reuse                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Contract (this stage)       | `src/isometric-art/{schema,text,associations,directory,manifest-loader,index}.ts`, `scripts/lib/art-registry-check.ts`, `scripts/build-isometric-art.ts` (except `--derive`), `data/curated/isometric-art/registry.json`, migration 0003 + `docs/db/0003_down.sql`, `server/db/artwork-associations.ts`, publication v3 field, isometric-variant helpers in `src/app/view-mode.ts`, this doc | —                                                                                               |
| Inventory / hotspots (done) | `inventory.json`, `hotspots.json`, `scripts/lib/art-{inventory,hotspots}-check.ts`, contact sheets                                                                                                                                                                                                                                                                                           | —                                                                                               |
| Art pipeline                | `--derive` in `scripts/build-isometric-art.ts`, registry `derive[]` specs, `public/isometric-art/derived/**`, PWA precache decision                                                                                                                                                                                                                                                          | `expectedDerived`, `validateDerived`, `manifestDerivedSchema`                                   |
| Illustrated renderer / UI   | Illustrated stage, variant switch, disclaimer, hotspot drawing and hit-testing, alignment tests and screenshots                                                                                                                                                                                                                                                                              | manifest loader, `resolveIsometricVariant`, `supportsIsometric`, `ILLUSTRATION_DISCLAIMER`      |
| Admin verification          | `server/domain/artwork/associations.ts` bodies, route registration, permission, router param, admin UI                                                                                                                                                                                                                                                                                       | `server/db/artwork-associations.ts`, write/reset schemas, `mergeArtworkAssociations`, `audited` |
| Search / directory wiring   | Feeding `createArtworkDirectory` into the directory panel and search                                                                                                                                                                                                                                                                                                                         | `createArtworkDirectory`, `mergeArtworkAssociations`                                            |
| **Integration owner**       | Reconciles schemas, resolves conflicts, reviews the combined diff, `.gitattributes`, clean-checkout rebuild, final evidence and the commit                                                                                                                                                                                                                                                   | everything above                                                                                |

## 9. Open items

**Owner** (the walk-by-walk guide is §11):

- No association is verified (0 of 82): the owner must supply evidence (site sign, official document or owner
  statement) in `/admin/artwork`. 19 are approximate ("Unconfirmed match"), 63 unresolved.
- `art:scene-103` label is withheld until the owner decides whether it may be displayed.
- 44 of 65 outlines are `needs-manual-verification`; 72 subjects carry 121 manual-verification notes and 8 assets
  carry inventory items (registry `needsManualVerification`, the admin "Needs review" filter, and the "Needs manual
  verification" list in [LPU_ISOMETRIC_ASSET_INVENTORY.md](LPU_ISOMETRIC_ASSET_INVENTORY.md)).
- The search aliases are conservative spelling corrections only (`INGNEERING`→`ENGINEERING`, `HOSTAL`→`HOSTEL`,
  etc.); `POLYTECHINQUE` and `CHANCELLORY` were left without an alias because the intended word is unclear.

**Engineering** (recorded by the integration owner, not fixed in this integration):

- Map modes do not outline an "Unconfirmed match" candidate; it is only framed and named.
- On desktop the illustration's detail card and the details panel can show the same item side by side.
- The public details panel quotes the internal research file path inside the curated reason.
- On a DPR-2 phone the overview downloads about 2.1 MB of images on opening (preview + 12 level-0 tiles).
- Safari, Firefox and real touch hardware were not tested (pinch and pan were emulated through CDP).
- [LPU_ISOMETRIC_ASSET_MAPPING.md](LPU_ISOMETRIC_ASSET_MAPPING.md) is generated and checked byte for byte by
  `art:check`, so it cannot be edited by hand. It lists label, block heading, status, candidates with scores and
  the reason, but not "what evidence would verify it" or the per-subject manual-verification notes; those are
  in §11 and in `/admin/artwork`. Adding them as columns is a change to `renderMappingMarkdown`
  (`scripts/lib/art-registry-check.ts`) followed by `npm run art:build`.

## 10. Integration owner: reconciliations (2026-10-24)

One implementation per service; every item below was found in the combined diff and merged into one.

| Service                    | Competing implementations found                                                                                                                                      | Now                                                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Artwork search             | `createArtworkDirectory().search` (contract) and a second ranked search with number matching in `src/directory/artwork.ts`                                           | One search in `src/isometric-art/directory.ts` (number + token matching added there, with `artworkNumberQuery` / `compareArtworkNumbers`); the directory layer calls it |
| Association status wording | Three tables: `ASSOCIATION_BADGE` (renderer), `ARTWORK_STATUS` (directory), `ARTWORK_STATUS_TEXT` (search), with different words for the same status                 | `src/isometric-art/text.ts` (zod-free): `ASSOCIATION_STATUS_TEXT` (item's view) and `BUILDING_VERIFIED_ARTWORK_TEXT` (building's view); the three tables derive from it |
| Contract wording constants | `ARTWORK_NUMBER_NOTE` copied by hand into `src/components/place/artwork-format.ts` (to keep zod out of the chunk)                                                    | Constants live in `text.ts`; `schema.ts` re-exports them; the copy imports the original                                                                                 |
| "Official name"            | The detail card showed the linked building's MAP display name ("Unnamed building · 10 floors") as its official name; place details used the verified-provenance rule | One rule, `src/directory/identity.ts` `verifiedOfficialName`; the card shows the map name separately as "Map building"                                                  |
| Variant / selection sync   | Directory package's own variant state and select-subject logic vs the renderer's (resolved by the directory package before integration)                              | `src/isometric-art/variant-state.ts` and the renderer's `subjectsForSelection`; one manifest load (`src/app/data/artwork.ts`, `useAtlas().artwork`)                     |
| Studio artwork links       | The read-only Studio panel requested `/artwork/associations` on every Studio open; a missing artwork API crashed the whole Studio (13 failing tests)                 | Requested only when the owner opens the collapsed panel (`PanelSection onToggle`); tested                                                                               |

Also wired by the integration owner: a route found or "choose on map" while the Illustrated overview is
shown switches to the last map mode with `ILLUSTRATED_ROUTE_REASON` / `ILLUSTRATED_PICK_REASON`
(`illustratedHandoffReason`, `useViewModeSync`); the details landmark names an illustration item by its exact
title; result rows keep printed double spaces; `.gitattributes` marks the images binary; the evidence run
`tests/e2e/art-evidence.spec.ts` (desktop and mobile only).

## 11. Owner verification guide

This replaces the guidance in
[`docs/research/block-leads/OWNER_CHECKLIST.md`](research/block-leads/OWNER_CHECKLIST.md): the walks below are
the same, now keyed by illustration subject and recorded in the admin **Artwork** screen instead of by hand.
The per-subject table (exact labels, block heading, status, candidate footprints with scores, reason) is
[LPU_ISOMETRIC_ASSET_MAPPING.md](LPU_ISOMETRIC_ASSET_MAPPING.md).

### 11.1 What a link means

| Status                                | Meaning                                            | Needs                                                                                                                                      | Effect in the app                                                                                                 |
| ------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **Verified**                          | The illustration item **is** this campus building. | At least one evidence entry: site sign, official document (URL required) or your own statement, each with a date that is not in the future | Joins the building: one directory entry and one search result, Directions and "Show on map" from the illustration |
| **Approximate** ("Unconfirmed match") | A likely but unchecked building.                   | A private note saying why it is only approximate                                                                                           | The item stays separate; the candidate is only named and framed, never selected, routed or merged                 |
| **Unresolved**                        | Not linked.                                        | Nothing                                                                                                                                    | The item stays on the illustration only, with no map position                                                     |

A link never sets an official block number or official name. Those stay separate building fields
(`officialBlockLabel` with `officialBlockSourceId`, from a cited source for that exact footprint;
[MODULE_CONTRACTS.md](MODULE_CONTRACTS.md)). The illustration's number is never evidence for either, and a
position or appearance on the illustration is never evidence of a link. Google Maps, Earth and Street View URLs
are refused as evidence.

### 11.2 How to record a decision

1. Open `/admin/artwork` and sign in. The list filters by **Verified**, **Unconfirmed**, **Unresolved**,
   **Your decisions** and **Needs review**, and searches by printed label, number or id.
2. Open an item (`/admin/artwork/art%3Anum-25`, for example). It shows the printed labels exactly with their
   inventory ids, the item on the overview (same transform as the public view; a dashed outline still needs
   review), its vignettes, the manual-verification notes, the candidate footprints on the campus map with their
   scores, the current link and its history.
3. Under **Set the link**, choose the status, pick the building (a candidate, a click on the map, or a search by
   name or id), add the evidence or the private note, and save. Each save is one audited change
   (`artwork.put`) and republishes; the public app shows it after a refresh. A stale form is refused (409) and
   asks you to reload.
4. **Reset to the curated baseline** removes your decision (`artwork.reset`); the history keeps it.
5. Decisions live in D1 only; regenerating the registry never overwrites them.

Record, for each sign: the exact text, the date, which footprint (`osmId`) and which face or part of it. Where
one OSM way holds several blocks, say which part, and note that splitting the way is a separate OSM edit based
on your own survey or permitted imagery, never traced from the illustration. Record the block number and the
hostel name or number (for example BH-n) separately: they are different numbering systems. Room plates of the
form `NN-xxx` (an official page lists "Conference Hall, 32-213") are supporting evidence only.

### 11.3 Walks, most valuable first

Status is the curated baseline today. "Official" means an lpu.in statement of number and function only; none of
them places a building ([OFFICIAL_CROSSCHECK.md](research/block-leads/OFFICIAL_CROSSCHECK.md)).

| #   | Subjects                                                                                           | Baseline today                                                                                                                      | What would verify it                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `art:num-25` … `art:num-29`                                                                        | All approximate to `osm:way/422823421`, a 195 m row of 5 joined units                                                               | The block sign on each unit, west to east. Note whether the units are separate buildings (one way would become five). The vignette and the index disagree on 29.                                                 |
| 2   | `art:num-37` (and `art:num-36`, `art:num-38`)                                                      | 37 approximate to `osm:way/422556249` (V-shaped); 36 and 38 unresolved                                                              | Official: "Central Library located in Block-37", building not named. The library entrance and its sign; which part is 37; the signs on the west and SSW arms; any building in the notch between the arms.        |
| 3   | `art:num-30` … `art:num-34`                                                                        | Unresolved; 30, 31 and 32 compete for `osm:way/422823423`, 33–34 for `osm:way/422823420`                                            | Official: "Department of Records at Building No. 32, Room No. 101". Visit the Records window; read the signs on the trapezoid, its attached parts and the N-S row.                                               |
| 4   | `art:num-35`                                                                                       | Approximate to `osm:way/422556250` (quarter-circle bowl)                                                                            | Official: "Shanti Devi Mittal Auditorium (Block No. 35)". Is the bowl the auditorium, signed 35, and a separate block?                                                                                           |
| 5   | `art:num-13`                                                                                       | Approximate to `osm:relation/7099162` (courtyard square)                                                                            | Official: "Block 13, Student Welfare Wing". The sign and the wing; the index also prints "BUSINESS 13".                                                                                                          |
| 6   | `art:num-15`, `art:num-16`, `art:num-14`, `art:num-18`                                             | 15 → `osm:way/422437885`, 16 → `osm:way/422823431`, 18 → `osm:way/422437890` approximate; 14 unresolved (`422437887` / `422437888`) | Signs on the wedge (15), the large roof (16: does it have a number at all?), the business school (14) and the bar (18).                                                                                          |
| 7   | `art:num-45`, `art:num-48`, `art:num-49`, `art:num-50`, `art:num-51`                               | Approximate: 45 → `422548300`, 48 and 49 → `422548297` (6-tower chain), 50 → `422548299`, 51 → `422548298`; 52, 53, 54 unresolved   | Block number and hostel name per building; which towers are 48 and 49. Do not assume BH-4 for 51. A hostel allotment letter or the hostel office counts as an official document.                                 |
| 8   | `art:num-9` … `art:num-12`, `art:num-21`, `art:num-21a`, `art:num-21b`, `art:num-22`, `art:num-23` | Unresolved (ambiguous); several hostel buildings here are not in OSM                                                                | Block number and hostel name on every building, including unmapped ones. Whether "GIRLS HOSTAL 1, 2, 3, 4" follows blocks 9–12 in order (paired only by listing order). Only signs can resolve 21/21A/21B/22/23. |
| 9   | `art:num-2`, `art:num-1`, `art:num-3`, `art:num-4`, `art:num-6` … `art:num-8`                      | 4 approximate to `osm:way/354830243`; the rest unresolved                                                                           | Which part of the gate-side complex is signed 2 (do not conflate with "Baldev Raj Mittal Unipolis"). Signs on 1, 3, 4 (OSM names differ from the captions). 6–8 are probably unmapped.                           |
| 10  | `art:num-41` … `art:num-44`, `art:num-47`                                                          | 44 approximate to `osm:way/422437897`, 47 to `osm:way/422737297`; 41–43 unresolved                                                  | The sign on each slab and on both halves of `422437897` (two readings remain open); whether the large hall is signed 47 and is an indoor sports hall.                                                            |

**Do not link without new evidence:** 55–58 (three near-identical wedges; the two printed sources disagree on
55/56), 5 and 52 (no plausible footprint), and any number taken from the illustration's position alone (the
review measured about 50 m of position error, one building spacing). Numbers 17, 24, 39, 40 and 46 are not
printed anywhere in the artwork and have no subject.

### 11.4 Other owner decisions

- Whether the `art:scene-103` caption may ever be displayed (held today; the file and its exact transcription
  are kept).
- The 44 outlines marked for review, especially the judged edges in the 25–38 cluster, 6/7/8, 48/49, 53/54 and
  56/57/58, and every scene or disc-less building matched to a vignette by eye.
- The inventory's manual-verification list (clipped pin "58" in `iso-art-119`, the clipped pin in
  `iso-art-111`, the gate micro-text in `iso-art-091`, the double space in `CAMPUS CAFE  &`, the small-text
  punctuation in `iso-art-087`).

## 12. Tests

| Area                         | Files                                                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inventory and hotspots       | `tests/unit/isometric-art-inventory/inventory.test.ts`, `tests/unit/isometric-art-hotspots/hotspots.test.ts` (exact labels, sha256, geometry, deliberate breakages)                                                       |
| Contract, registry, pipeline | `tests/unit/isometric-art/{schema,registry,associations,directory,manifest-loader,integrity}.test.ts`; `tests/integration/isometric-art-{git,derive,dist}.test.ts`                                                        |
| Renderer                     | `tests/unit/isometric-art/renderer-{viewport,model}.test.ts`, `renderer-{component,stage}.test.tsx`; `tests/e2e/isometric-art.spec.ts` (five sizes, zoom, pan, pinch, resize, registration, hit test, bytes on opening)   |
| Modes and app glue           | `tests/unit/app/{view-mode-iso-variant,artwork-selection}.test.ts`, `tests/unit/app/{artwork-deep-link,illustrated-handoff,panel-label-artwork}.test.tsx`                                                                 |
| Directory, search, details   | `tests/unit/directory/{artwork-join,identity}.test.ts`, `tests/unit/search/artwork-search.test.ts`, `tests/unit/directory-ui/artwork-ui.test.tsx`                                                                         |
| Admin                        | `tests/unit/admin/artwork-{model,section}.test.tsx`, `tests/server/artwork/{http,persistence}.test.ts`, `tests/server/security/artwork-attacks.test.ts`, `tests/e2e/admin-artwork.spec.ts`                                |
| Database and publication     | `tests/server/migrations/migration-0003.test.ts`, `tests/server/compat/rollback.test.ts`, `tests/server/security/hardening.test.ts`, `tests/server/studio/http.test.ts`, `tests/unit/building-studio/publication.test.ts` |
| Evidence                     | `tests/e2e/art-evidence.spec.ts` (fidelity against the original, identity across modes, screenshots)                                                                                                                      |

## 13. Screenshots

`npx playwright test tests/e2e/art-evidence.spec.ts` writes them to `test-results/evidence/art/` (git-ignored,
regenerated on demand) as `<project>-<name>.png` for `desktop` (1440×900) and `mobile` (390×844). Each one is
also an assertion. The integration owner inspected all of them on 2026-10-24.

| Name                                                         | Shows                                                                                     |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `01-illustrated-overview`                                    | Opening view: artwork, variant switch, "Illustration — not to scale" notice, legend       |
| `02-region-1-art-num-58` … `02-region-4-art-num-2`           | Four regions (pins 58, 50, 1, 2) compared with the original drawn with the same transform |
| `03-vignette-1-art-num-1` … `03-vignette-4-art-num-14`       | The original vignettes of four block captions in the detail card or details sheet         |
| `04-directory-block-wise`                                    | Directory grouped by the printed block headings                                           |
| `05-selection-highlight`                                     | A selected outline over the art                                                           |
| `06-verified-illustration`, `07-verified-geographic-map`     | A verified item (created in the in-memory e2e database, then reset) in both modes         |
| `08-unresolved-illustration`, `09-unresolved-geographic-map` | An unresolved item: selected on the illustration, no map position                         |
| `10-admin-artwork-list`, `11-admin-artwork-item`             | The admin Artwork list and one item                                                       |

## 14. Limitations

- **A 2D illustration, not a 3D model.** The artwork is a flat drawing with one fixed viewpoint. It can be zoomed
  and panned, never rotated or tilted, and no building in it can be viewed from another side. Realistic 3D and
  the map-accurate isometric drawing remain separate modes built from footprints.
- **Schematic layout.** Positions, sizes and distances are the illustrator's, not geography. The artwork is never
  stretched or warped to fit the map, never used for routing or "near me", and never shown as geographically
  exact. Pin discs float above their buildings and some disc centres sit outside their outline (up to 16.2 source
  px).
- **Dated content.** The master was made in Illustrator CS6 on 2019-04-25 (XMP). Buildings built since are absent,
  and the index and the vignettes disagree in places (21 recorded conflicts, for example 37 RESEARCH vs CENTRAL
  LIBRARY).
- **Not everything is clickable.** Unlabelled buildings with no pin in any vignette have no outline by design.
  Numbers 19, 22, 23 and 55 appear only in vignettes and have no place on the overview.
- **Mode synchronization is by identity only.** Only verified links join the two modes; with 0 verified links
  today, selecting an illustration item never selects a map building.
- **Labels are printed text, not names.** Typos are kept (`INGNEERING`, `HOSTAL`, `PEDISTRIAN`), corrected
  spellings exist only as search aliases, and an illustration number is never an official block number.
