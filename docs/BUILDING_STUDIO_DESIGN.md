# Building Studio: frozen contract

**Status:** frozen contract for parallel implementation. **Date:** 2026-10-24. **Amended 2026-10-24
(server hardening):** §1 S3 and S6, §3.5 (invisible characters in names), §5 (URL rules and the fields they
cover), §7 (audit of body rejections), §8 (publication-version guard and 409), §10 (ETag, 304, read path),
§11.2 (labels) and §14 (actual file names). Each amendment is marked in place.
**Binding inputs:** the lead's decisions S1–S14 (restated in §1 with clarifications; none is weakened),
`docs/ISOMETRIC_AND_3D_DESIGN.md` (D1–D8, amended under D2 on 2026-10-24),
`docs/COMMUNITY_MODULE_CONTRACTS.md`, `docs/MODULE_CONTRACTS.md` ("v2 geographic contract"),
`docs/GEODATA_SOURCES_AND_LICENSES.md` and `docs/DATA_ROLLBACK.md`.

The Building Studio is the owner-only Creative Mode of the admin system. The owner places, edits, duplicates,
archives and publishes building models. Every published building is **one** canonical record with **one** id
in Realistic 3D, the isometric overview, Standard 2D, search, the directory, favourites and the URL.

Code that already implements this contract:

| File                                           | What it freezes                                                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/building-studio/schema.ts`                | Every wire shape (Zod, shared by client and server), registries, limits, validation codes and audit actions |
| `src/building-studio/text.ts`                  | Text safety and the prohibited-source (Google Maps/Earth/Street View) rule                                  |
| `src/building-studio/footprint.ts`             | Local ENU frame, rotation and footprint derivation (stub: `box`, `footprint-prism`)                         |
| `src/building-studio/mesh/types.ts`            | `StudioMesh` and its conventions                                                                            |
| `src/building-studio/mesh/triangulate.ts`      | The triangle helper contract                                                                                |
| `src/building-studio/mesh/generate.ts`         | `generateStudioMesh`, `prismFaces`, `fallbackPrismMesh`, `meshVolumeM3` (stub: `box`, `footprint-prism`)    |
| `migrations/0002_building_studio.sql`          | D1 tables, CHECKs, immutability triggers and the rebuilt `audit_events`                                     |
| `docs/db/0002_down.sql`                        | Rollback of 0002 (never under `migrations/`)                                                                |
| `src/community/schema.ts`                      | Publication v2 (`buildings`), reader accepts v1 and v2                                                      |
| `src/community/merge.ts`, `src/map/geojson.ts` | Off-campus rule 4a (§11.1), which studio buildings must also follow                                         |

---

## 1. Decisions S1–S14 (binding)

**S1 Renderer** (amends D2 for owner-authored models only; D3 unchanged).

- OSM/base buildings stay flat-roofed `fill-extrusion`s. No roof data exists for them, so D2 still holds.
- Studio models come from **one** renderer-agnostic procedural mesh module (`src/building-studio/mesh/`):
  config → `StudioMesh` (§4.3).
- **Realistic 3D:** a MapLibre `CustomLayerInterface` in raw WebGL2 (no Three.js, no new dependency) draws the
  meshes with the map's projection matrix. Window patterns are procedural in the fragment shader. It is a lazy
  chunk, loaded only when at least one visible studio instance exists or the Studio is open.
- **Isometric:** the Canvas2D renderer draws the same faces: projected, back-face culled and painter-sorted
  within a building. The order between buildings comes from the existing depth graph (§6.4 of the 3D design).
- **Standard 2D, picking and fallback** use the derived footprint polygon. If the custom layer fails (no
  WebGL2, context loss, budget watchdog), each instance renders as a plain `fill-extrusion` of footprint ×
  body height. Picking always uses the footprint layer, never the custom layer.
- **Gate 3** must pass before this is final:
  - measured chunk size (gzip);
  - frame time with 50 instances under a 4× CDP CPU throttle;
  - context-loss recovery;
  - a side-by-side on real structures: a large academic block, a non-rectangular footprint, a small
    canteen stand-in and a hostel stand-in.

  If the evidence fails the budget, report it and fall back to the extrusion representation. Never ship an
  over-budget renderer.

**S2 Templates vs instances.**

- A **template** holds defaults, allowed options, constraints and metadata: intended use, render cost and
  accuracy class. Thumbnails are generated (S14).
- An **instance** stores the **full resolved** `ModelConfigV1`, including `generatorId`, `generatorVersion`
  and every parameter. A template update therefore never changes an existing instance.
- "Apply template vN" is an explicit action on one instance, with a preview (`dryRun`), a revision check and
  an audit event.
- Generators are versioned code. A generator version is never removed while any draft or published version
  references it (`GET /studio/quality` lists the versions in use).
- **Missing template, unknown generator version or unknown `modelConfigVersion`:**
  - never drop the record;
  - render the stored footprint × body height as a plain prism (`fallbackPrismMesh`);
  - flag "model unavailable" in the admin quality view;
  - reject any write that would silently reinterpret the config (422 `unsupported-model`).
- Starter templates live in code: `src/building-studio/asset-library.ts` (versioned).
- Owner-created templates are stored in D1 (`studio_templates` + `studio_template_versions`). Each is a variant
  of a code generator, with immutable versions. Retiring a template hides it from new placements only.

**S3 Accuracy honesty.**

- Template `accuracyClass` is one of `generic-prefab | stylized | source-backed | surveyed`. Every starter
  template is `generic-prefab`. Owner templates may only be `generic-prefab | stylized`.
- _Amended 2026-10-24:_ an instance's public `accuracyClass` is derived by the server at publish from the
  **stored** template version (code library or D1 row), never from the client. The draft's `templateRef`
  counts only when it is consistent with the model: the version exists, defines the named variant, and
  builds with the model's own `generatorId` and `generatorVersion`. Anything else (a custom model, a spoofed
  or stale ref, a ref to a template of another generator) publishes as `generic-prefab`. An owner template's
  stored class is capped at `generic-prefab | stylized` whatever its stored JSON says
  (`accuracyClassFor` in `server/domain/studio/buildings.ts`).
- Instance verification is `unverified` (default), `source-backed` (needs a citation URL, title and access
  date, plus a note) or `surveyed` (needs a survey date and a note).
- Public labels are `VERIFICATION_LABELS`, for example "Illustrative model placed by the site owner — not
  verified".
- Appearance (colours, materials, windows) is always labelled "appearance only" (`APPEARANCE_LABEL`). It is
  never a statement about the real building's material.
- No photographic textures, only synthetic patterns.

**S4 Identity.**

- **New buildings** get the id `stu:` + 20–32 lower-case base32 characters, generated by the server
  (`STUDIO_ID_RE`).
- **Editing an existing base building** creates a studio record with `targetId` = the base building id (for
  example `osm:way/123`). At most one studio record exists per target (`UNIQUE`). The base snapshot is never
  rewritten, and the public id stays the base id.
- **Duplicate** creates a new `stu:` draft. In the copy:
  - name is `null` and aliases are `[]`;
  - verification is `unverified` and `accessNodeId` is `null`;
  - an official block is never copied (no studio field can hold one);
  - the copy is placed at a visible offset (`defaultDuplicateOffsetM`: width + 5 m east, unless the request
    gives one of 1–200 m);
  - it is unpublished.
- **One public record per building.** A published new studio building is **one** directory entry and **one**
  searchable item (kind `building`), with the same id in every mode, in favourites and in the URL (§11).

**S5 Geometry.**

- Placement is `anchor` [lon, lat] + `rotationDeg` (clockwise from north) + width, length and height in metres.
- Local ENU uses an equirectangular projection at the anchor. The error bound is in §4.1; tests assert
  < 1 cm at 300 m.
- The footprint is **derived** from the generator, its parameters and the transform. The server recomputes it,
  ignores any client-sent footprint (the draft schema has no footprint field) and stores it with each
  published version.
- For an existing base building, the base footprint stays authoritative and the model is fitted to it.
  Moving or replacing that footprint needs an explicit "correct position" flag with a reason
  (`positionCorrection`). The flag is stored with the version, audited, and needs an acknowledged
  `base-footprint-replaced` warning.

**S6 Validation** is pure and shared by client and server; the server's result is authoritative (§6).

- **Errors** block publishing. A draft may still be saved with errors so no work is lost. Errors cover:
  - invalid geometry;
  - dimensions or floors out of range;
  - a position outside `APP_CONFIG.map.maxBounds`;
  - a footprint classified `outside` the campus (off-campus buildings are excluded by owner decision 2);
  - an unknown category;
  - missing required verification evidence.
- **Warnings** need an explicit acknowledgement with a reason, per code, before publishing. The
  acknowledgement is recorded in the audit. Warnings cover:
  - a footprint `crossing` the boundary;
  - an `uncertain` footprint near a boundary-review section;
  - overlap above a threshold with a base building or another published studio building;
  - a possible duplicate (IoU ≥ 0.5);
  - a height/floors conflict.
- **Info:** path segments and entrances within 30 m, listed "for review — not a connection".
- Nothing is ever auto-clipped, auto-moved or auto-resized. Snapping is optional, visible and undoable.
- **Legal placement guides.** The "Unverified detected footprints" layer may be shown in the Studio as an
  optional trace/snap guide for an unmapped structure. It combines Microsoft (CDLA Permissive 2.0) and Google
  Open Buildings (ODbL). The resulting building records `geometryGuide: { detectionId }` and stays
  `unverified` until confirmed.
- **Google Maps, Google Earth and Street View are never a source.** URLs on `google.*/maps`, `maps.google.*`,
  `maps.app.goo.gl`, `goo.gl/maps`, `earth.google.*` (plus Street View, tile and Maps API hosts) are rejected
  with an explanation, because their licence terms forbid deriving map data from them.
  - The rejection applies to every field that documents provenance: citation URL, citation title,
    verification note, position-correction reason, acknowledgement reason and change summary. It applies even
    in drafts (`text.ts`, `PROHIBITED_SOURCE_MESSAGE`).
  - _Amended 2026-10-24:_ it also applies to free text that can cite a source: the identity `description`
    and private `notes`, the archive `reason`, a template's `intendedUse` and each variant's `description`
    (§5).
  - Google **Open Buildings** (`sites.research.google`, `storage.googleapis.com/open-buildings-data`) is a
    separately licensed dataset and is allowed.

**S7 Routing** is never inferred from geometry or from `entranceSide` (a visual marker only). A building is
routable only through an access node the owner chooses, validated server-side with the same rule as
locations: the node exists, is foot-accessible, and is within `APP_CONFIG.routing.maxPlaceConnectorM` of the
**footprint** (distance 0 inside it). For a base-building model, access stays in the place override.

**S8 Persistence** (migration 0002, D1; §8 has the details).

- Tables:
  - `studio_templates` and `studio_template_versions`;
  - `studio_buildings`: the head row, with status `draft | published | archived`, `draft_json` +
    `draft_revision`, `published_version`, `revision` for optimistic concurrency, actors and timestamps;
  - `studio_building_versions`: immutable published snapshots, including the derived footprint.
- `audit_events` is rebuilt to allow the entity types `building` and `template`. Rows are copied with their
  ids; indexes and append-only triggers are recreated.
- Publication payload v2 = v1 + `buildings` (published, non-archived records only; no notes, actors or drafts).
- Publish is **one** atomic `db.batch`: version insert + head update + publication bump + audit. On failure
  nothing changes, and the UI shows the failure with a retry.
- Archive removes a building from the publication (recoverable). Restore re-publishes the last version.
- Permanent delete is allowed only for archived records, with a typed confirmation (`confirmId`). The audit
  keeps the before-snapshot.
- The down-migration is documented and tested in isolation. It is not in `migrations/`, so wrangler never
  applies it.
- Browser storage is used only for crash recovery of unsaved local edits, labelled as such. It is never
  authoritative, and every access is wrapped in try/catch.

**S9 Undo/redo** is a client command stack over the local draft.

- A drag gesture is one command, coalesced on pointer-up. Numeric typing coalesces per field focus.
- Undo never claims to undo a server save. After a save, undo edits the local draft, and the state becomes
  "unsaved changes".

**S10 States are always visible:**

- unsaved local changes;
- saved draft (rev n) — `draftRevision`;
- published (version n);
- archived.

A `beforeunload` guard is active while there are unsaved changes.

**S11 GLB/glTF import:** implement and test the validator only.

- Checks:
  - magic, version and chunks; valid JSON;
  - embedded buffers only, with no external or `data:` URIs except embedded images in allowlisted formats;
  - an extension allowlist; no animations, skins or scripts;
  - size ≤ 2 MB and ≤ 50,000 triangles;
  - licence, attribution and source are required.
- Storage and rendering are **not** enabled: they need an R2 binding and the D3 Three.js adoption gate. The UI
  says so and never claims that imports work.

**S12 Admin shell.**

- `/admin` is a lazy chunk, not part of the public entry bundle.
- It renders controls only after the server confirms a session (`GET /api/admin/session`).
- The server enforces auth, CSRF and Origin on every write, whatever the UI does.
- The Studio is entered from `/admin`. Leaving it restores normal map navigation.

**S13 Interaction.**

- **Desktop:** a level-editor layout with the map, a collapsible asset browser, a tool rail, an inspector and a
  save/publish bar.
- **Mobile:**
  - centre-reticle placement: the map pans under a fixed pin;
  - large step buttons to move (0.5/1/5 m N/E/S/W), rotate (±1/±5/±15°) and resize;
  - numeric fields and a bottom-sheet inspector;
  - large Save and Cancel buttons.
- While a handle is dragged, map pan/rotate is disabled and map selection is suppressed. Both are re-enabled
  on release and on exit.
- `prefers-reduced-motion` is respected.

**S14 Starter library.**

- 17 template types from the owner's list (`LIBRARY_CATEGORIES`), built on a small set of generators: `box`,
  `l-shape`, `u-shape` (U and closed courtyard), `hall`, `tower-podium`, `kiosk-canopy` and `stepped`.
- Roofs `flat`, `shed`, `gable`, `hip` and `stepped`, only where the generator can build them (`GENERATORS`).
- Façades `none`, `ribbon`, `punched`, `grid` and `curtain`, with a window density.
- Balconies for residential types, an entrance side, and detail levels `massing`, `roof`, `facade` and
  `details`.
- At least two visually distinct variants for each major type.
- Thumbnails are deterministic SVGs generated from the default variant's mesh. There are no binary assets.

The 8th generator, `footprint-prism`, is internal. It extrudes the authoritative base footprint of a targeted
base building and is never offered for new buildings.

---

## 2. Record kinds and identity

| Kind                     | `id`    | `targetId`       | Public id (`studioPublicId`) | Identity                                                                                                                                                      | Footprint                                                                                                                                               | Access                                                    |
| ------------------------ | ------- | ---------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| New building             | `stu:…` | `null`           | `stu:…`                      | `identity` required (name may be `null`, never invented)                                                                                                      | Derived from the model                                                                                                                                  | `accessNodeId` on the record (validated)                  |
| Model of a base building | `stu:…` | `osm:way/…` etc. | the base id                  | `identity: null`. Name, category, description and location stay in the **place override** (existing `/api/admin/overrides`), so there is one writer per field | The base footprint (`footprint-prism`, or a generated model with IoU ≥ 0.85 fitted to it). With `positionCorrection`: the derived footprint replaces it | `accessNodeId: null`; the place override's access applies |

Aliases, subtype and `directoryVisible` for base buildings are **not** part of this contract (`overrideFieldsSchema`
has no aliases). This is a documented gap for the later admin-UI workflow.

---

## 3. Data model

### 3.1 Generator registry (`GENERATORS`, code)

| `generatorId`     | Shape params (`shapeParamsSchema`)                                                                     | Roofs                  | Footprint                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------ | ---------------------- | ------------------------------------------------- |
| `box`             | —                                                                                                      | flat, shed, gable, hip | width × length rectangle                          |
| `l-shape`         | `notchWidthFrac`, `notchLengthFrac` 0.2–0.8; `notchCorner` front-left/front-right/back-left/back-right | flat                   | rectangle minus a corner notch                    |
| `u-shape`         | `courtyardWidthFrac` 0.2–0.8, `courtyardDepthFrac` 0.2–0.8, `openSide` front/back/left/right/none      | flat                   | U; `none` = closed courtyard (one hole)           |
| `hall`            | —                                                                                                      | flat, shed, gable      | rectangle                                         |
| `tower-podium`    | `podiumFloors` 1–6, `towerWidthFrac`/`towerLengthFrac` 0.25–0.9                                        | flat                   | podium rectangle                                  |
| `kiosk-canopy`    | `canopyDepthFrac` 0.1–0.6, `canopySide`                                                                | flat, shed             | the whole roofed extent (body + canopy)           |
| `stepped`         | `tiers` 2–5, `setbackM` 0.5–20                                                                         | stepped                | base tier rectangle                               |
| `footprint-prism` | —                                                                                                      | flat                   | the base footprint, unchanged (base targets only) |

- Every generator is at version `[1]`.
- Sides are model-local:
  - `front` has its outward normal along local +y (north at 0°);
  - `right` points along +x (east at 0°).
- Gable and hip ridges run along the longer side. A shed roof rises towards `right`.
- Rise: (half span) × tan(pitch) for gable and hip; span × tan(pitch) for shed.
- Detail levels:
  - `massing`: flat top, no windows;
  - `roof`: adds the roof shape;
  - `facade`: adds window grids;
  - `details`: adds balconies, entrance and trim (studio-core).

### 3.2 `ModelConfigV1` (`modelConfigV1Schema`, strict)

| Field                             | Type / storable envelope                                                                                                           | Publish range (`STUDIO_LIMITS.dims`)    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `modelConfigVersion`              | literal `1`                                                                                                                        | —                                       |
| `generatorId`, `generatorVersion` | registry id; version ∈ `GENERATORS[id].versions`                                                                                   | —                                       |
| `anchor`                          | [lon, lat]: the footprint centre                                                                                                   | inside `APP_CONFIG.map.maxBounds`       |
| `rotationDeg`                     | [0, 360), clockwise from north                                                                                                     | —                                       |
| `widthM`, `lengthM`               | > 0, ≤ 5000                                                                                                                        | 2–300                                   |
| `heightM`                         | > 0, ≤ 5000. Body (wall) height from the body base to the eaves or flat roof; a pitched roof rises above it                        | 2.4–150                                 |
| `floors`                          | integer 1–400                                                                                                                      | 1–40                                    |
| `floorHeightM`                    | > 0, ≤ 5000                                                                                                                        | 2.4–8                                   |
| `baseOffsetM`                     | ≥ 0. Body base above the ground (0 on the ground)                                                                                  | 0–30                                    |
| `shape`                           | discriminated by `kind` = `generatorId`                                                                                            | generator-specific (`geometry-invalid`) |
| `roof`                            | `{shape, pitchDeg?, colour, material}`. `pitchDeg` required exactly for shed/gable/hip (0 < p < 90); shape ∈ the generator's roofs | pitch 5–45°                             |
| `facade`                          | `{material, wallColour, windowPattern, windowDensity 0–1, balconies, entranceSide}`; density = 0 ⇔ pattern `none`                  | —                                       |
| `detailLevel`                     | `massing                                                                                                                           | roof                                    | facade | details` | —   |
| `geometryGuide?`                  | `{ detectionId }` (`DETECTION_ID_RE`)                                                                                              | —                                       |

- Colours are `#rrggbb` lower-case. Materials are enums and appearance only.
- For `footprint-prism` the server overwrites the anchor (base point-on-surface), `rotationDeg` (0) and the
  width/length (local bounding box). These values are informational.
- `modelDefaultsSchema` is the same without the placement fields (`anchor`, `rotationDeg`, `geometryGuide`).
  Templates use it.
- **Reading published data** uses `modelEnvelopeSchema`, a loose object with only `modelConfigVersion`,
  `generatorId`, `generatorVersion`, `heightM` and `baseOffsetM` required, so unknown models are kept.
  `modelSupport(model)` tells a renderer whether it can generate the model.

### 3.3 Templates

- `templateDefinitionSchema` describes one **immutable** template version:
  - `id` (code: kebab-case; owner: `stv:…`) and `version`;
  - `name`, `libraryCategory`, `intendedUse`, `suggestedCategoryId`;
  - `generatorId`, `generatorVersion`;
  - `constraints` — width/length/height/floor ranges, allowed `roofShapes` and `windowPatterns`,
    `balconiesAllowed`;
  - `variants` — 1–8, each with full `defaults`; the first is the default;
  - `accuracyClass`, and `renderCost` (from the heaviest variant's face count: < 60 low, < 250 medium,
    otherwise high).
- Refinements:
  - every variant uses the template's generator and version;
  - variant defaults stay inside the constraints;
  - constraint roofs are buildable by the generator;
  - variant ids are unique.
- `ownerTemplateInputSchema` is the create/new-version body. The server assigns `id`, `version` and
  `renderCost`. `accuracyClass` is `generic-prefab | stylized`; `basedOn` names a code template version or is
  `null`.
- `templateRefSchema` (`{templateId, templateVersion, variantId}`) on an instance is **provenance only**. It is
  never re-applied silently.
- Constraints are guidance. Placing a model outside them raises the warning `outside-template-range`; nothing
  is ever clamped.

### 3.4 Instance: head, draft, published version

- **Draft** (`studioDraftSchema`, strict): `{ identity | null, model, verification (draft form), accessNodeId,
templateRef | null, positionCorrection | null }`. It has no footprint, status, actor or id field.
- **Head** (`studioBuildingHeadSchema`): `id`, `targetId`, `status`, `revision`, `draftRevision`, `hasDraft`,
  `publishedVersion`, `archivedAt`, `archiveReason`, and the created/updated actors and timestamps.
- **Published version** (`studioPublishedVersionSchema`, admin only; immutable):
  - `version`;
  - `record` (the full draft as published, including private notes);
  - `footprint` and `footprintAreaM2` (server-derived);
  - `membership` (§6.4);
  - `acknowledgements` and `changeSummary`;
  - `publishedBy` and `publishedAt`.

### 3.5 Identity (`studioIdentitySchema`, new buildings only)

| Field              | Rule                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `name`             | 2–120 characters or `null` (a blank value becomes `null`). Never invented; the UI shows an honest label |
| `aliases`          | ≤ 10, each 1–80 characters, unique case-insensitively                                                   |
| `categoryId`       | `STUDIO_CATEGORY_IDS` = the registry minus `other`. `building` means "Use not recorded"                 |
| `subtype`          | ≤ 60 characters or `null`                                                                               |
| `description`      | ≤ 500 characters or `null`                                                                              |
| `notes`            | ≤ 2000 characters or `null`. **Private**: never published                                               |
| `directoryVisible` | `false` → drawn and selectable on the map, but not listed in the directory or search                    |

All text is trimmed, and control, bidi-override and lone-surrogate characters are rejected (as in
`src/community/schema.ts`).

_Amended 2026-10-24:_ `name`, each alias, and template and variant names use `nameLine` (`text.ts`), which also
rejects invisible characters that make two identical-looking names compare different: zero-width space,
word joiner and the invisible operators U+2060–2064, U+FEFF inside a name (trimming already strips it at the
ends), U+180E, soft hyphen, combining grapheme joiner, Hangul fillers and the LINE / PARAGRAPH SEPARATORS
U+2028/2029. ZWJ and ZWNJ are allowed only right after a non-ASCII letter or mark and before another
non-ASCII letter or mark, whitespace or the end of the name (how Indic and Arabic-script text uses them,
including a ZWNJ that ends a word). After Latin letters, digits or a space, at the start, or before an ASCII
character they are rejected. Place names in
`src/community/schema.ts` (suggestions, owner locations, overrides) follow the same rule. `description` and
`notes` additionally follow the prohibited-source rule (§5).

### 3.6 Verification

| Schema                    | Use                    | `source-backed`                                                                          | `surveyed`                      |
| ------------------------- | ---------------------- | ---------------------------------------------------------------------------------------- | ------------------------------- |
| `verificationDraftSchema` | drafts (strict)        | `citation {url '' or http(s), title, accessedOn '' or date}`, `note` — may be incomplete | `surveyDate` '' or date, `note` |
| `verificationSchema`      | publish + public shape | `url` required, title 2–200, `accessedOn` date, `note` 10–1000                           | date, `note` 10–1000            |

- Prohibited sources are rejected in both schemas.
- Dates in the future are rejected by the validator (`verification-evidence`).
- Mapping onto the app's `verificationStatus`:
  - `unverified` → `unverified`;
  - `source-backed` → `verified`, with `lastVerifiedAt = accessedOn`;
  - `surveyed` → `verified`, with `lastVerifiedAt = surveyDate`.

  The public label always comes from `VERIFICATION_LABELS`.

---

## 4. Geometry and mesh

### 4.1 Local frame (`footprint.ts`)

- `createEnuFrame(anchor)` is the equirectangular projection at the anchor, using the same formula as
  `createLocalProjection`, with R = 6,371,008.8 m.
- **Error bound:** the east scale uses cos(lat) of the anchor, so a point (x, y) metres away is off by about
  |x|·tan(lat)·|y|/R. At 31.25° N that is ≤ 0.9 cm within 300 m. A test asserts < 1 cm against haversine in
  24 directions.
- **Rotation** (`rotateToEnu`): e = x·cosθ + y·sinθ, n = −x·sinθ + y·cosθ (clockwise from north). It preserves
  orientation.
- `deriveFootprint(config, {baseFootprint?})` →
  `{ok, local, footprint (GeoJSON Polygon, closed, RFC 7946 orientation), areaM2}`.
  - `footprint-prism` returns the base footprint unchanged.
  - Stub: other generators return `generator-not-implemented` until studio-core lands; the signature stays.

### 4.2 The derived footprint on the server

- The server derives the footprint from the stored model. Client footprints are never accepted.
- It stores the footprint and `footprintAreaM2` with each version.
- Limits: ≤ 256 vertices and ≤ 8 rings (`studioFootprintSchema`). Footprints of base buildings come from the
  server's base data (`server/base-data.ts`), never from the client.

### 4.3 `StudioMesh` (`mesh/types.ts`): normative conventions

- Coordinates are metres in local **ENU at `origin`** (x east, y north, z up; z = 0 is the ground at the
  origin). The rotation is already applied, so a renderer only translates.
- A **face**:
  - is planar to within 1 mm;
  - has a `ring` of ≥ 3 vertices that is open (no repeated closing vertex), simple, and **counter-clockwise
    seen from outside**;
  - may have `holes` that are simple, open and clockwise seen from outside;
  - has `normal` = the outward unit normal (Newell over the ring);
  - has `material` ∈ `wall | roof | base | trim | glass`.
- **Window grid** (`WindowGrid`): `{pattern, floorHeightM, floors, bottomM, columns, density}`, on wall faces
  only.
  - `ring[0] → ring[1]` is the bottom edge, left to right seen from outside. The u axis runs along it and v
    straight up.
  - The renderer draws the grid procedurally, clipped to the face. It is appearance only.
  - `columns = max(1, round(edge length / 3.5 m))`; walls shorter than 2 m get no grid.
- `bbox`, `footprint` (local, outer ring counter-clockwise, holes clockwise) and `closed` (every generator
  produces a closed body: `meshVolumeM3` equals the body volume).
- **Triangle helper** (`triangulateFace(face)`): indices into `faceVertices(face)` (the ring, then each hole),
  three per triangle, each counter-clockwise from outside. It is area-exact for simple rings with simple,
  non-touching holes (ear clipping with earcut-style hole bridging). It is tested on every real campus
  footprint, including the one with a courtyard hole.
- `generateStudioMesh(config, {baseFootprint?}) → MeshResult`:
  - `{ok: true, mesh}`, or
  - `{ok: false, reason}` with reason `unsupported-model | missing-base-footprint | invalid-geometry |
generator-not-implemented`. The last reason exists only in the stub and disappears when studio-core lands.
- `fallbackPrismMesh({footprint, model})`: the S2 fallback.
  - The published footprint is extruded over `[baseOffsetM, baseOffsetM + heightM]`, with no windows.
  - The origin is the anchor when present, otherwise the vertex mean of the outer ring.
- Determinism: the same config produces identical faces (tested).

---

## 5. Text and provenance rules (`text.ts`)

`line(max)`, `text(max)`, `provenanceLine(max)` and `provenanceText(max)` are the field constructors.

`isProhibitedSourceUrl(url)` returns true for:

- any `google.<tld>` or `google.<sld>.<cc>` host with a path starting `/maps`, `/earth` or `/streetview`;
- the subdomains `maps.`, `earth.`, `streetview.`, `mt*.` and `khm*.`;
- `maps.app.goo.gl`, `earth.app.goo.gl`, `g.page`, `goo.gl/maps…` and `maps.gstatic.com`;
- `*.googleapis.com` hosts for maps or Street View.

A value without a scheme is read as https.

`containsProhibitedSourceUrl(text)` scans free text for URL-like tokens. It does not judge prose such as "Not
taken from Google Maps".

_Amended 2026-10-24 (what the implementation matches, and the fields it covers):_

- Also matched: the `cbk*.` subdomains and `/cbk` Street View image endpoints (`*.ggpht.com/cbk`); Google
  Search map results (`/search?tbm=map`); and **Google Maps place and contributor photos** on
  `*.googleusercontent.com` with a path starting `/p/`, `/gps-cs-s/` or `/gps-proxy/`. Other
  `googleusercontent.com` paths (for example profile pictures under `/a/`) are not matched.
- Hosts are compared case-insensitively with **every trailing dot removed** (`www.google.com./maps`,
  `google.com../maps`) and `www.` stripped. Paths are percent-decoded, with repeated slashes collapsed.
- A Maps URL wrapped in a redirect, consent or archive link (in a query value or in the path) is unwrapped up
  to 3 levels deep.
- In free text, a URL-like token may separate labels with `.` or with the ideographic and full-width full
  stops (U+3002, U+FF0E, U+FF61, which the URL parser maps to `.`). Trailing dots after the top-level domain
  stay part of the token, so `www.google.com./maps/…` is not split from its path.
- Fields: `provenanceLine` and `provenanceText` now also back the identity `description` and `notes`, the
  archive `reason`, a template's `intendedUse` and each variant's `description`, besides the provenance fields
  listed in S6.
- Names and aliases use `nameLine` (§3.5).

_Amended 2026-10-24 (combining-mark flood, the 5-mark rule):_ `nameLine` also rejects a run of more than
`MAX_COMBINING_MARKS` = **5** combining marks (`\p{M}`) in a row (`hasCombiningMarkFlood`). Format characters
(`\p{Cf}`: ZWJ, ZWNJ, LRM, …) between the marks do not end the run. The message is `MARK_FLOOD_MESSAGE`: "Too
many combining marks (accents) on one character (at most 5)". This covers the identity `name`, each alias, and
template and variant names. These are owner-only fields; the rule is applied for consistency with public
suggestions, owner locations and overrides, which already follow it (COMMUNITY_MODULE_CONTRACTS.md, "Text
rules"). Real text stays below the limit (Indic conjuncts, pointed Hebrew and Vietnamese use 3–4 at most). A
longer run ("Zalgo" text) stacks glyphs over the surrounding UI. Read shapes (`publicStudioIdentitySchema`, the
publication) are not re-checked, so a publication written before this rule still loads. A stored draft or
version record whose name or alias breaks the rule would no longer parse in the admin (`readDraft` in
`server/domain/studio/records.ts` returns null), as with any tightening of the draft schema.

---

## 6. Validation (S6)

### 6.1 Contract for the validator (studio-core, `src/building-studio/validate.ts`)

```ts
export interface StudioValidationContext {
  base: {
    buildings: BuildingsFile; // inventory + uncertain footprints (public/data)
    places: readonly Place[];
    graph: GraphFile;
    boundary: CampusBoundary; // src/geo/boundary.ts
    reviewSections: readonly BoundaryReviewSection[];
    curatedDecisions: readonly CuratedMembershipDecision[];
  };
  /** Published, non-archived studio buildings (for overlap/duplicate checks). */
  published: readonly PublishedStudioBuilding[];
  /** Template version the draft references, when resolvable (for 'outside-template-range'). */
  template: TemplateDefinition | null;
  recordId: string | null; // excluded from its own checks
  targetId: string | null;
  today: string; // YYYY-MM-DD (server clock); dates after it are rejected
}
export function validateStudioDraft(draft: StudioDraft, ctx: StudioValidationContext): ValidationResult;
```

- The validator is pure, has no I/O, is deterministic, and orders issues by code, then path.
- **Membership** is `classifyFootprint({id: publicId, geometry: footprint}, boundary, reviewSections,
curatedDecisions)`.
- **Overlap and IoU** use the exact clipper in `src/geo/boundary.ts`: `createBoundary(otherFootprint)
.intersectionAreaM2(mine)`, with IoU = I / (A + B − I).
- **Distances to paths and entrances** use `src/distance` (point-to-segment in the local frame).
- **The access node** is checked against the **footprint polygon**: distance 0 inside it, else the distance
  to the nearest edge. The limit is ≤ `maxPlaceConnectorM`.

### 6.2 Codes (`VALIDATION_CODES`)

| Code                      | Severity | Message (the template; `data` carries the numbers)                                                                                                                  | How to resolve                                                                                       |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `geometry-invalid`        | error    | "The derived footprint is not a valid polygon: {reason}." (for example, stepped setbacks larger than the footprint, or a podium with more floors than the building) | Change the dimensions or shape parameters                                                            |
| `dimension-out-of-range`  | error    | "{field} is {value}; allowed {min}–{max}."                                                                                                                          | Enter a value inside `STUDIO_LIMITS.dims`                                                            |
| `outside-max-bounds`      | error    | "Part of the building lies outside the map area."                                                                                                                   | Move it inside `APP_CONFIG.map.maxBounds`                                                            |
| `outside-campus`          | error    | "The footprint is outside the campus boundary ({pct} % inside). Off-campus buildings are not shown (owner decision 2)."                                             | Move it onto campus, or do not publish. **Cannot be acknowledged**                                   |
| `unknown-category`        | error    | "Category {id} is not in the registry."                                                                                                                             | Choose a registry category                                                                           |
| `identity-required`       | error    | "A new building needs a category (the name may stay empty)."                                                                                                        | Fill in the Info panel                                                                               |
| `not-applicable`          | error    | "{field} does not apply to {kind}." (identity, access or footprint-prism on a base model; a position correction or footprint-prism on a new building)               | Clear the field, or use the right record kind                                                        |
| `verification-evidence`   | error    | "Source-backed needs a citation URL, title, access date and a note." / "Surveyed needs a survey date and a note." / "{date} is in the future."                      | Complete the evidence, or set `unverified`                                                           |
| `unsupported-model`       | error    | "This model needs generator {id} v{n}, which this version of the app does not have."                                                                                | Apply a current template version (explicit), or wait for the deploy that adds it                     |
| `access-node-invalid`     | error    | `checkAccessNode` messages, measured to the footprint                                                                                                               | Pick another node, or clear it (the building is then not routable)                                   |
| `base-target-missing`     | error    | "{targetId} is not in the current base dataset."                                                                                                                    | Archive the record, or model the replacement building                                                |
| `base-fit-mismatch`       | error    | "The model covers the existing footprint with IoU {iou} (needs ≥ 0.85)."                                                                                            | Adjust it, use `footprint-prism`, or set "correct position" with a reason                            |
| `boundary-crossing`       | warning  | "The footprint crosses the campus boundary ({pct} % inside)."                                                                                                       | Acknowledge, or move it                                                                              |
| `boundary-uncertain`      | warning  | "Campus membership is uncertain: {membershipReason}."                                                                                                               | Acknowledge = an owner confirmation (§6.4), or move it                                               |
| `overlap-base-building`   | warning  | "Overlaps {id} ({name or key}) by {m2} m² ({pct} % of the smaller footprint)."                                                                                      | Move or resize it; edit that building instead; or acknowledge (for example, a canopy over a walkway) |
| `overlap-studio-building` | warning  | Same, for a published studio building                                                                                                                               | Same                                                                                                 |
| `possible-duplicate`      | warning  | "May be the same structure as {id} (IoU {iou})."                                                                                                                    | Edit that building instead; acknowledge only if they are different structures                        |
| `height-floors-conflict`  | warning  | "{floors} floors × {floorHeightM} m = {h} m, but the body height is {heightM} m."                                                                                   | Adjust, or acknowledge (for example, a tall ground floor)                                            |
| `outside-template-range`  | warning  | "{field} {value} is outside the template's guidance {min}–{max}."                                                                                                   | Acknowledge, or pick another template                                                                |
| `base-footprint-replaced` | warning  | "Correct position: the published footprint replaces {targetId}'s mapped footprint (reason: …)."                                                                     | Acknowledge (audited), or remove the correction                                                      |
| `nearby-path`             | info     | "Path segment {edgeId} is {m} m away — for review, not a connection."                                                                                               | —                                                                                                    |
| `nearby-entrance`         | info     | "Entrance {id} is {m} m away — for review, not a connection."                                                                                                       | —                                                                                                    |
| `geometry-guide`          | info     | "Placed using unverified detected footprint {detectionId}; the building stays unverified until confirmed."                                                          | —                                                                                                    |
| `not-routable`            | info     | "No access point: directions will not be offered."                                                                                                                  | Choose an access node                                                                                |

Thresholds (`STUDIO_VALIDATION`):

- an overlap counts when it is ≥ 1 m² **and** ≥ 5 % of the smaller footprint;
- duplicate IoU ≥ 0.5;
- base fit IoU ≥ 0.85;
- nearby = 30 m;
- height tolerance = max(1 m, 0.5 × floor height).

### 6.3 Acknowledgements

- `acknowledgementSchema` is `{code: WarningCode, reason (5–300 characters, provenance rules)}`, with one per
  code (`acknowledgementsSchema`).
- Publish and restore must cover `ValidationResult.requiredAcknowledgements` (`missingAcknowledgements`).
- Acknowledgements for codes that are not present are ignored and not recorded.
- Errors can never be acknowledged.
- Acknowledgements are stored in `studio_building_versions.acknowledgements_json` and in the audit `after_json`.

### 6.4 Membership stored at publish (`studioMembershipSchema`)

| `classifyFootprint` status | Publish                                                        | Stored                                                                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inside`                   | yes                                                            | `inside`, decision `auto`                                                                                                                                                                                     |
| `crossing`                 | with `boundary-crossing` acknowledged                          | `crossing`, decision `auto`                                                                                                                                                                                   |
| `uncertain`                | with `boundary-uncertain` acknowledged (an owner confirmation) | `crossing`, decision `curated`, reasonCode `curated-decision`, `decisionSource` = `owner-confirmation: studio <id> v<version>` (the kind `owner-confirmation` exists in `membershipDecisionSourceKindSchema`) |
| `outside`                  | **never** (`outside-campus`)                                   | —                                                                                                                                                                                                             |

---

## 7. Admin API (`/api/admin/studio/**`)

All routes:

- run through the existing admin pipeline: authentication (Access JWT or password session), `authorize`,
  `Cache-Control: no-store`, and fail-closed 503 when `AUTH_MODE` is unset;
- every non-GET route also requires a same-origin `Origin`, `Content-Type: application/json` and, in password
  mode, `X-CSRF-Token`;
- bodies are ≤ 32 KB (`STUDIO_LIMITS.bodyBytes`) and parsed with the strict schemas;
- the server assigns ids, statuses, versions, actors and timestamps;
- every write is audited (success, rejected and failed), with entity type `building` or `template` and an
  action from `STUDIO_AUDIT_ACTIONS`. _Amended 2026-10-24:_ this includes bodies the HTTP layer rejects
  before the domain sees them (415 content type, 413 size, 400 malformed JSON or UTF-8, structural bounds).
  Each route declares its audit target in the route table (`auditAs`, `server/handlers/admin/audit-spec.ts`),
  and the rejection is written with outcome `rejected` for the authenticated actor and detail
  `<code> (HTTP <status>): <fixed message>` (never the body). Every community write route does the same.
  Unauthenticated requests, the login route and the `POST /studio/validate` dry run write no row;
- every write to an existing record carries `revision`. A mismatch returns 409 `conflict`, with
  `details.current` = the head.

New permissions: `studio:write`, `studio:publish`, `studio:delete` and `studio:templates`. The `owner` role has
all of them.

| Method & path                                               | Permission       | Request → response                                                                               | Errors (beyond 400/401/403/413/415/503)                                                                                                                                    |
| ----------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /studio/library`                                       | `admin:read`     | — → `studioLibraryResponseSchema` (code + owner templates, versions, status)                     | —                                                                                                                                                                          |
| `POST /studio/templates`                                    | studio:templates | `createOwnerTemplateRequestSchema` → 201 `templateListingSchema`                                 | 422 `unsupported-model`                                                                                                                                                    |
| `PUT /studio/templates/:templateId`                         | studio:templates | `updateOwnerTemplateRequestSchema` (new immutable version) → `templateListingSchema`             | 404; 409 `conflict`; 422 `unsupported-model`                                                                                                                               |
| `POST /studio/templates/:templateId/retire` · `/unretire`   | studio:templates | `revisionRequestSchema` → `templateListingSchema`                                                | 404; 409                                                                                                                                                                   |
| `GET /studio/buildings?status=&targetId=&q=&limit=&cursor=` | `admin:read`     | `studioListQuerySchema` → `studioBuildingListSchema`                                             | —                                                                                                                                                                          |
| `GET /studio/buildings/:id`                                 | `admin:read`     | — → `studioBuildingDetailSchema` (validation recomputed on current base data)                    | 404                                                                                                                                                                        |
| `POST /studio/buildings`                                    | studio:write     | `createStudioBuildingRequestSchema` → 201 detail (`draft`, rev 1)                                | 404 target not in base data; 409 `conflict` (target already has a record: `details.current`); 422 `unsupported-model`                                                      |
| `PUT /studio/buildings/:id/draft`                           | studio:write     | `saveDraftRequestSchema` → detail (draftRevision + 1). Saved even with validation errors         | 404; 409 `conflict`; 409 `invalid-transition` (archived); 422 `unsupported-model`                                                                                          |
| `DELETE /studio/buildings/:id/draft`                        | studio:write     | `revisionRequestSchema` → detail (draft discarded; the published version stays)                  | 409 `invalid-transition` (no draft, or never published)                                                                                                                    |
| `POST /studio/validate`                                     | `admin:read`     | `validateRequestSchema` → `validationResultSchema` (dry run, no write)                           | 422 `unsupported-model`                                                                                                                                                    |
| `POST /studio/buildings/:id/publish`                        | studio:publish   | `publishRequestSchema` → `publishResponseSchema` (`{building, publicationVersion}`)              | 409 `conflict`; 409 `invalid-transition` (no draft / archived); 422 `validation-failed` (`details.validation`, `details.missingAcknowledgements`); 422 `unsupported-model` |
| `POST /studio/buildings/:id/archive`                        | studio:write     | `archiveRequestSchema` → `publishResponseSchema`                                                 | 409 `conflict`; 409 `invalid-transition` (already archived)                                                                                                                |
| `POST /studio/buildings/:id/restore`                        | studio:publish   | `restoreRequestSchema` → `publishResponseSchema`                                                 | 409; 422 `validation-failed` (the last version is re-validated against current base data)                                                                                  |
| `DELETE /studio/buildings/:id`                              | studio:delete    | `deleteStudioBuildingRequestSchema` (`confirmId` = id) → `deleteStudioBuildingResponseSchema`    | 400 `invalid` (confirmation mismatch); 409 `invalid-transition` (not archived); 409 `conflict`                                                                             |
| `POST /studio/buildings/:id/duplicate`                      | studio:write     | `duplicateRequestSchema` → 201 detail (a new `stu:` draft)                                       | 404                                                                                                                                                                        |
| `POST /studio/buildings/:id/apply-template`                 | studio:write     | `applyTemplateRequestSchema` → `applyTemplateResponseSchema` (`dryRun` = preview, nothing saved) | 404 (template/version/variant); 409; 422 `unsupported-model`                                                                                                               |
| `GET /studio/quality`                                       | `admin:read`     | — → `studioQualityResponseSchema`                                                                | —                                                                                                                                                                          |

Error bodies:

- They use `apiErrorSchema`, plus `studioErrorDetailsSchema` (`validation`, `missingAcknowledgements`,
  `current`) placed beside `error` in the body.
- The new error codes are `validation-failed` (422) and `unsupported-model` (422) (`STUDIO_ERROR_STATUS`).
  studio-server adds them to `apiErrorSchema` and to both `STATUS_BY_CODE` maps in one change.
- The existing `outside-area` (422) is not used for studio records: the boundary rules are validation codes.

**Apply template.**

- It replaces: `generatorId`/`generatorVersion`, `shape`, `roof`, `facade` and `detailLevel` from the chosen
  variant.
- It keeps: placement (`anchor`, `rotationDeg`), the dimensions (width, length, height, floors, floor height,
  base offset), identity, verification, access and any correction.
- `changedFields` lists the replaced dot paths, for the before/after preview.
- Values outside the new constraints become `outside-template-range` warnings. Nothing is clamped.

---

## 8. Persistence (migration 0002)

| Table                      | Key / constraints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `studio_templates`         | `id` PK (`stv:` + 20–32 base32, CHECK); `name` 2–80; `status` active/retired; `latest_version` ≥ 1; actors, timestamps, `revision`                                                                                                                                                                                                                                                                                                                                                                |
| `studio_template_versions` | PK (`template_id` → `studio_templates`, `version`); `definition_json` an object ≤ 16 KB; `generator_id`, `generator_version`; **immutable** (UPDATE and DELETE triggers abort)                                                                                                                                                                                                                                                                                                                    |
| `studio_buildings`         | `id` PK (`stu:` CHECK); `target_id` UNIQUE NULL (`osm:way/[1-9]*`, `osm:relation/[1-9]*` or `cur:*`); `status` draft/published/archived; `draft_json` an object ≤ 16 KB; `draft_revision`; `draft_saved_by/at`; `published_version`; `archived_by/at`; `archive_reason` ≤ 500; actors, timestamps, `revision`. CHECKs: draft ⇒ never published and has a draft; published ⇒ `published_version`; archived ⇔ `archived_at`; draft fields set together. DELETE allowed only when archived (trigger) |
| `studio_building_versions` | PK (`building_id` → `studio_buildings`, `version`); `record_json` ≤ 16 KB; `footprint_json` (a Polygon, ≤ 32 KB); `footprint_area_m2` > 0; `membership_json`, `validation_json`, `acknowledgements_json` (an array); `change_summary` 3–500; `model_config_version`, `generator_id`, `generator_version`, `accuracy_class`, `position_corrected`, `published_by/at`. **Immutable**; deleted only while the head is archived                                                                       |
| `audit_events`             | Rebuilt: `entity_type` additionally allows `building` and `template`. Rows copied with their ids; the AUTOINCREMENT sequence carries over; the indexes `audit_entity`, `audit_at` and `audit_action` and the append-only triggers are recreated exactly                                                                                                                                                                                                                                           |

- No new `meta` keys: studio changes bump the existing `publication_version` and `publication_updated_at`.
- **Atomic operations.** Each is one `db.batch`. Writes use `WHERE id = ? AND revision = ?`, and 0 changed rows
  aborts with 409.
  - **Create:** INSERT the head + audit.
  - **Save draft:** UPDATE the head (draft fields, `draft_revision + 1`, `revision + 1`) + audit.
  - **Publish:**
    1. INSERT a version (n + 1) with the server-derived footprint, membership, validation and
       acknowledgements;
    2. UPDATE the head (status `published`, `published_version = n + 1`, draft fields cleared,
       `revision + 1`);
    3. bump the publication;
    4. audit (`after_json` includes the acknowledgements and change summary).
  - **Archive:** UPDATE the head + bump the publication (only if it was published) + audit.
  - **Restore:** UPDATE the head (status `published`, or `draft` if never published) + bump + audit. No new
    version is created; the last one is re-published.
  - **Delete** (archived only): DELETE the versions, DELETE the head, then audit with the before-snapshot
    (head + every version).
  - **Discard draft:** UPDATE the head + audit.
  - **Duplicate:** INSERT a new head + audit on both ids.
  - **Templates:** INSERT a version + UPDATE the head + audit.
- A failed batch changes nothing. The UI keeps the local draft and offers a retry.
- **Publication-version guard** (_amended 2026-10-24: documents the implemented behaviour_). Publish and
  restore-to-published validate against the published set. They read `publication_version` **before**
  validating and guard the whole batch on it: the audit row and the version INSERT (publish) or the head
  UPDATE (restore) are written only if the head revision **and** `publication_version` are both unchanged.
  Any public change that lands in between (another building published, archived or restored, or a location
  or override change) makes the batch write nothing. The answer is **409 `conflict`** with
  `details.current` = the head, with one of two messages:
  - the head's revision or status moved: "This building was changed by someone else since you loaded it…".
    Reload, review and retry with the new revision;
  - the head is unchanged and only the publication moved: "The published map changed while this building
    was being validated… your revision is still current, so validate again and retry." The same request
    with the same revision can be sent again; it is re-validated against the new published set.

  Restoring a never-published record (back to `draft`) does not touch the publication and has no version
  guard. Archive bumps the publication but needs no validation, so it is guarded on the head only.

- **Verified** on a fresh local D1 and on a D1 that already holds 0001 data (copied rows, ids, sequence,
  indexes, triggers, a failed batch rolling back, the delete rules). The down script was checked the same
  way (§12). The permanent tests belong to studio-server.

---

## 9. State machine

```
            create ─▶ DRAFT ──publish──▶ PUBLISHED ◀──publish (new version)── PUBLISHED+draft
                        │                   │   ▲                                 │      ▲
                        │                   │   └──── discard draft ──────────────┘      │
                        │                   │                                save draft ──┘
                        │                archive                                     (also from PUBLISHED)
                     archive                ▼
                        └──────────────▶ ARCHIVED ──restore──▶ PUBLISHED (last version) / DRAFT (never published)
                                           │
                                        delete (typed id) ─▶ gone (audit keeps before-snapshot)
```

| From                       | Action                          | To                                   | Notes                                                                  |
| -------------------------- | ------------------------------- | ------------------------------------ | ---------------------------------------------------------------------- |
| —                          | create                          | draft                                | rev 1, draftRevision 1                                                 |
| draft / published          | save draft                      | same status, `hasDraft`              | allowed with validation errors                                         |
| draft / published + draft  | publish                         | published (version + 1)              | zero errors + all acknowledgements; the draft is cleared               |
| published (no draft)       | publish                         | 409 `invalid-transition`             | nothing to publish                                                     |
| published + draft          | discard draft                   | published                            | the public record is unchanged                                         |
| draft (never published)    | discard draft                   | 409 `invalid-transition`             | use archive or delete                                                  |
| draft / published          | archive                         | archived                             | removed from the publication; the draft is kept                        |
| archived                   | save / publish / apply-template | 409 `invalid-transition`             | restore first                                                          |
| archived (has version)     | restore                         | published                            | the last version, re-validated (422 + acknowledgements as for publish) |
| archived (never published) | restore                         | draft                                | —                                                                      |
| archived                   | delete                          | gone                                 | `confirmId` = id                                                       |
| any non-deleted            | duplicate                       | the source is unchanged; a new draft | S4 rules                                                               |
| draft / published          | apply template vN               | same status, `hasDraft`              | `dryRun` previews; the save is audited                                 |

---

## 10. Publication v2 (`GET /api/locations`)

- `PUBLICATION_SCHEMA_VERSION = 2`.
- `publicationSchema` = the v1 fields unchanged, plus `buildings?: PublishedStudioBuilding[]`:
  - a v2 server **always** sends the array (possibly empty), in `id` order;
  - the field is optional only so a v1 body still parses (`SUPPORTED_PUBLICATION_SCHEMA_VERSIONS = [1, 2]`).
- `PublishedStudioBuilding` (`publishedStudioBuildingSchema`; a read schema that strips unknown keys) has:
  - `id`, `targetId`, `version`, `publishedAt`;
  - `identity` (`publicStudioIdentitySchema`, without notes; `null` for base models);
  - `verification` (complete) and `accuracyClass`;
  - `templateRef`;
  - `model` (`modelEnvelopeSchema`: unknown versions are kept);
  - `footprint`, `footprintAreaM2`, `membership` (inventory statuses only), `accessNodeId` and
    `positionCorrected`.
- Cross-field refinements follow §2.
- The server re-checks each record against the schema and never publishes one that fails, exactly as for
  locations.
- It contains no notes, actors, drafts, acknowledgements, validation or change summaries.
- _Amended 2026-10-24 (HTTP behaviour of `GET /api/locations`):_
  - **ETag** `W/"pub-v<PUBLICATION_SCHEMA_VERSION>-<publicationVersion>"`, for example `W/"pub-v2-17"`. The
    schema version is included because the body's shape depends on it, while `publication_version` does not
    change on a deploy. Without it, a deploy or rollback across v1 and v2 would answer 304 to a client that
    holds the other shape. The **base dataset version is deliberately not included**: the body never depends
    on the base dataset (no base data is read; the client merges the publication against whatever dataset
    it has), so a data refresh does not change the body. Older `W/"pub-<n>"` validators never match and get a 200.
  - A matching `If-None-Match` is answered with **304 from one indexed `meta` read**, before any row is read
    or the body is built.
  - Otherwise the body is read as **one consistent snapshot** (one `db.batch`, which D1 runs as a
    transaction: version, active locations, overrides, published studio versions). Its ETag is taken from the
    version inside that snapshot, so rows and ETag always agree.
  - The studio read selects only the columns the public record needs (`building_id`, `version`,
    `record_json`, `footprint_json`, `footprint_area_m2`, `membership_json`, `accuracy_class`,
    `position_corrected`, `published_at`, and the head's `target_id`). It never reads `validation_json`,
    `acknowledgements_json`, `change_summary` or the actors.

---

## 11. Client merge rules (integrate)

### 11.1 Rule 4a — off-campus results never join the campus (implemented now)

`mergePublication` returns `{ data, contextPlaces, report }`.

- A published location outside the boundary goes to `contextPlaces`, never to campus places, counts,
  categories, relations, search or the directory. A non-building place that an override moves outside goes
  there too, with relations touching it dropped and `buildingId` stripped.
- A building place is never moved outside: the footprint is authoritative, so its base position is kept.
- All of these are reported in `report.outsideCampus` with reason `location-outside-campus`,
  `override-moved-outside` or `building-move-outside-ignored`.
- `poiCollection` draws off-campus places only with `{includeOffCampus: true}`, that is, only while
  `APP_CONFIG.optionalLayers.nearbyOutsideCampus` is on. It sets `badge` to that layer's badge.
- The same rule holds for studio buildings: an outside studio building can never publish (S6). If a later
  boundary change classifies a published one as `outside`, merge drops it entirely and reports it as
  `outsideStudio`. Off-campus buildings are never shipped, not even in the context list.

### 11.2 Studio buildings: one feature, one place, one search doc, one id

Merge runs after rules 1–7 and 4a and stays deterministic: records resolve by `id` with the newest `version`,
then `publishedAt`, then canonical JSON, and one record per `targetId`. Its output is:

```ts
interface StudioRenderModel {
  publicId: string; // targetId ?? id
  recordId: string;
  version: number;
  footprint: StudioFootprint; // authoritative public footprint
  model: ModelEnvelope;
  modelAvailable: boolean; // modelSupport(model).ok; false → fallback prism + admin flag
  bodyBaseM: number; // baseOffsetM
  bodyTopM: number; // baseOffsetM + heightM (extrusion fallback)
  verification: Verification;
  accuracyClass: AccuracyClass;
}
// MergeResult gains: studioModels: StudioRenderModel[] (sorted by publicId), studioHiddenFromDirectory: string[]
// MergeReport gains: studio: { added, modelled, outside, orphan, targetHidden, shadowed, unavailable, correctionsIgnored: string[] }
```

**New building (`targetId` null).**

1. Recompute the membership with the current boundary. `outside` drops the building (`outside`). `uncertain`
   keeps the published curated decision.
2. Append **one** `BuildingsFile` feature with `id` = the `stu:` id:
   - `name`, `displayName`, `categoryId`;
   - `geometrySource: 'studio'` and `renderHeightSource: 'studio-model'` (change C1);
   - `sourceId 'owner'` and `sourceRef` = id;
   - the membership fields from the merge;
   - `areaM2`, and the anchor = point-on-surface;
   - every tag pass-through `null` (OSM facts do not exist for it);
   - `fidelityLevel` 0 (3 only when surveyed, with `verificationStatus 'verified'`);
   - `directoryKey`, `directoryCell` and the official block fields `null`;
   - `renderMinHeightM` = base offset and `renderHeightM` = body top.
3. Append **one** `Place`:
   - `kind 'building'`, `buildingId` = id, `campusZone 'on-campus'`, location = point-on-surface;
   - `displayName` = name ?? `Unnamed building (owner-placed model)`;
   - aliases, `subcategory` = subtype, description, `wheelchair 'unknown'`;
   - provenance `{sourceId 'owner', sourceRef: id, verificationStatus (mapped, §3.6), notes:
studioPublicLabel(record)}` (_amended 2026-10-24_; see **Labels** below);
   - **no** `levels` or `heightM` (an illustrative model is not a measurement).
4. Routing: `graphNodeId` only through a validated `accessNodeId`, measured to the footprint. Otherwise the
   building is not routable and reported (shared `invalidAccess`).
5. An id that collides with a base or published id is ignored and reported (`shadowed`).
6. `directoryVisible: false` puts the id in `studioHiddenFromDirectory`. The directory and search exclude it
   (change C2); the map still draws it and it stays selectable.

**Base-building model (`targetId` set).**

- If the target is hidden by a place override, the studio record is ignored (`targetHidden`): a hidden
  building is gone in every mode.
- If the target is missing from the base, it is reported as `orphan` (the record is kept in D1).
- Otherwise the feature keeps the base id and the place override's name and category (precedence: base → place
  override for identity, point location and access → studio model for geometry, height and appearance).
- `renderHeightM`/`renderMinHeightM`/`renderHeightSource` come from the model.
- _Amended 2026-10-24 (as implemented in `src/building-studio/merge.ts`):_ the base building's own place
  (kind `building`, `buildingId` = the target) keeps its override identity and location but describes what is
  drawn. It gets `heightSource 'studio-model'` and **no** `heightM` (the illustrative model height is not a
  measurement, and the base estimate no longer describes the drawn shape). The S3 label is appended to its
  provenance notes as `<existing notes> · <studioPublicLabel(record)>`, or is the whole note when there was
  none.
- The geometry is replaced only when `positionCorrected`, and only if the corrected footprint still classifies
  `inside`/`crossing` with the current boundary. Otherwise the correction is ignored and reported
  (`correctionsIgnored`).

**Views.**

- **Realistic 3D:** the custom layer draws `studioMeshFor(model)` (studio-core: `generateStudioMesh`, falling
  back to `fallbackPrismMesh`, memoised by `recordId@version`) for every `studioModels` entry in view. While
  the layer is healthy, `building-extrusion` filters those `publicId`s out. On failure it re-includes them as
  footprint × body height.
- **Isometric:** draws the same faces. Picking in every mode uses the footprint feature, whose id equals the
  public id.
- **2D:** the footprint.

**Labels** (_amended 2026-10-24_; `src/building-studio/labels.ts`, shared by the merge, the search and
directory subtitles, the overview's info card and the Studio dialogs). `studioPublicLabel(record)` is
`VERIFICATION_LABELS[verification.status]`, except for a **verified** record (`source-backed` or `surveyed`)
whose model came from a generic or stylized template (`accuracyClass` `generic-prefab`, `stylized` or absent).
That record gets the generic-template note appended: `<label> (shape and appearance from a generic template,
not the real design)` (`GENERIC_SHAPE_NOTE`). Verification is evidence that the building is there; it never
lets a generic prefab pass as the real building's design. An unverified record shows the unverified label
alone.

**Counts** are recomputed with studio buildings included (`buildings`, `heightSource:studio-model`, category
and kind counts). Search docs come from campus places, so a studio building has exactly one doc.

---

## 12. Versioning, missing assets and rollback

- **Template versions** are immutable rows. A template update makes a new version. Instances keep their full
  model and `templateRef` and are never re-resolved. "Apply template vN" is explicit (§7).
- **Generator versions** are code constants (`GENERATORS[id].versions`).
  - A behaviour change makes a new version, and the old one stays available.
  - Removal is allowed only when `GET /studio/quality` reports zero uses in drafts **and** versions.
- **`modelConfigVersion`**: a new major shape gets a new literal and its own schema. Writes reject unknown
  versions (422). Readers keep them as envelopes and render the fallback prism.
- **Missing template:** an instance does not need its template to render. The library shows the reference as
  "template no longer available".
- **Publication rollback:** a reader accepts v1 and v2. A server rolled back to pre-studio code serves v1, and
  current clients show no studio buildings, with no error.
- **Code rollback without the down script:** a pre-studio server runs safely on a 0002 database. It never
  touches the studio tables, and every audit entity type it writes is still allowed. The down script is
  therefore optional and only needed to remove the schema itself.
- **Down migration** (`docs/db/0002_down.sql`, run by hand after exporting the studio tables):
  - drops the studio tables;
  - rebuilds `audit_events` with the 0001 CHECK, keeping **every** row: studio rows keep their id, action and
    entity id, with `entity_type 'system'`;
  - bumps `publication_version`;
  - deletes the 0002 row from `d1_migrations` (that table exists only in wrangler-managed databases, so the
    server test harness must create it, or skip that statement, to test the script).
  - Verified: 0001 data → 0002 → down → 0002 again, all clean.
- **Dataset rollback** (`docs/DATA_ROLLBACK.md`) is unaffected by the studio. Base targets that disappear
  become `orphan` and are never applied to another feature.

---

## 13. Test plan (owner acceptance lists A–E)

The owner's lists are grouped as:

- A: library and placement;
- B: editing tools;
- C: identity and integration;
- D: validation, persistence, publishing and security;
- E: rendering, responsiveness and performance.

| List  | Acceptance                                                                                                                                                                                                                                                                                                              | Tests (owner)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | Searchable, categorized library (17 types, ≥ 2 variants for major types); thumbnails; metadata; translucent preview; placement by click, drag or coordinates in metres; feedback with reasons, no silent snapping                                                                                                       | studio-core: `asset-library.test.ts` (every template parses with `templateDefinitionSchema`, 17 categories, variants, `renderCost`, deterministic SVG snapshots). Admin UI: library search/filter (RTL). E2E (desktop + mobile): place by click and by typed coordinates, then assert the footprint is in metres via `__ATLAS_MAP__`; reticle placement on mobile; screenshots                                                                                                                                                                |
| **B** | Move, rotate and resize with numeric fields and limits; appearance presets, reset, before/after; undo/redo (drag = 1 command); duplicate; archive and delete                                                                                                                                                            | studio-core: `history.test.ts` (coalescing, undo after save → unsaved), `template-compat.test.ts`. Mesh: `mesh.test.ts` (this stage) + generator suites (volumes, closure, planarity, determinism, roof validity). Admin UI: inspector, step buttons, `beforeunload`. E2E: move/rotate/resize, undo/redo, duplicate offset                                                                                                                                                                                                                    |
| **C** | One canonical record and id across 3D, isometric, 2D, search, directory, favourites and URL; no duplicates; base edits via overrides; honest labels                                                                                                                                                                     | integrate: `merge-studio.test.ts` (one feature + one place + one doc per published building; `directoryVisible`; base-model precedence; hidden target; orphan; outside dropped; determinism under shuffles; counts). Directory/search integration. E2E: publish → find in search → open `?place=stu:…` in all three views → favourite                                                                                                                                                                                                         |
| **D** | Validation before publish, acknowledged and audited overrides; drafts on the server; explicit, atomic, failure-safe publish with change summary; revision conflicts; auth, CSRF, Origin and limits on every write; reversible archive; confirmed delete; template versions never change published buildings; migrations | This stage: `schema.test.ts`, `text.test.ts`, `publication.test.ts`, the merge rule 4a regressions. studio-core: `validate.test.ts` (every code in §6.2: one passing and one failing fixture, thresholds, Google URLs). studio-server: route-table auth/CSRF/Origin/503 (auto-enumerated), 409 per write, 422 shapes, atomic publish with an injected batch failure (nothing changes), the audit of every write, the state machine table in §9, migration tests on fresh and 0001-populated D1, the down script, the rollback.test.ts updates |
| **E** | Both 3D modes render studio models; fallback; Gate 3; responsive desktop + touch; reduced motion; accessibility                                                                                                                                                                                                         | render-3d: custom-layer unit tests (buffer building from `StudioMesh`, triangle winding), context-loss → extrusion fallback, lazy-chunk check, Gate 3 perf project (`*.perf.spec.ts`, 50 instances, 4× CDP throttle) with results in `docs/PERFORMANCE.md`. isometric: face projection, culling and painter order with studio meshes. E2E desktop + mobile with screenshots; axe scan of the Studio                                                                                                                                           |

---

## 14. Ownership

_Amended 2026-10-24 (actual file names):_ the command stack is `src/building-studio/history.ts` (tests in
`tests/unit/building-studio/history.test.ts`), not `command-stack.ts`. "Apply template" is
`src/building-studio/template-compat.ts` (tests in `template-compat.test.ts`), not `apply-template.ts`. The
tables below and §13 now use the actual names. The server also has `server/handlers/admin/audit-spec.ts`
(route audit targets, §7).

| Owner                        | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **contract** (frozen)        | `docs/BUILDING_STUDIO_DESIGN.md`, `src/building-studio/schema.ts`, `src/building-studio/text.ts`, `src/building-studio/mesh/types.ts` (types + conventions; studio-core may add helpers, not change shapes), `migrations/0002_building_studio.sql`, `docs/db/0002_down.sql`, publication v2 in `src/community/schema.ts`, `tests/unit/building-studio/{schema,text,publication}.test.ts`, `tests/unit/building-studio/fixtures.ts`. Changes need the lead's approval                                          |
| **studio-core**              | `src/building-studio/footprint.ts`, `src/building-studio/mesh/**` (replaces the stubs **behind the same exported signatures**), `src/building-studio/generators/**`, `src/building-studio/validate.ts`, `src/building-studio/asset-library.ts`, `src/building-studio/thumbnails.ts`, `src/building-studio/template-compat.ts`, `src/building-studio/history.ts`, `src/building-studio/local-recovery.ts`, `src/building-studio/glb-validator.ts`, `tests/unit/building-studio/**` (except the contract tests) |
| **studio-server**            | `server/db/studio-*.ts`, `server/domain/studio/**`, `server/handlers/admin/studio-*.ts` + their registration in `server/handlers/admin/routes.ts`, `server/domain/publication.ts` (the `buildings` field), the new error codes in `apiErrorSchema` + `server/errors.ts` + `server/http/errors.ts`, the studio permissions in `server/auth/authorize.ts`, `tests/server/studio/**`, the migration and down tests, the `tests/server/compat/rollback.test.ts` update                                            |
| **render-3d**                | `src/buildings3d/studio/**` (WebGL2 custom layer, lazy chunk, watchdog, context-loss fallback), the extrusion filter in `src/buildings3d/layers.ts`, the Gate 3 perf spec                                                                                                                                                                                                                                                                                                                                     |
| **isometric**                | `src/isometric/**` studio-face drawing, culling and hit-testing via the footprint                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **integrate**                | studio merge (`src/community/merge.ts` + `merge-studio.ts`), `/api/locations` fetch and the publication wiring in the app, `MapView`/`MapStage` wiring (`studioModels`, context-places layer toggle with `includeOffCampus`), changes C1–C3 below (with the lead's approval for lead-owned files), `tests/unit/community/**` (studio merge)                                                                                                                                                                   |
| **later: admin-UI workflow** | `/admin` shell and Studio UI (`src/admin/**`): toolbar, library browser, inspector, mobile reticle, state badges, publish dialog with acknowledgements, `tests/unit/admin/**`, `tests/e2e/studio*.spec.ts`                                                                                                                                                                                                                                                                                                    |

### Required changes in files this stage does not own

| #   | File (owner)                                                                       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | `src/data/schema.ts` (lead)                                                        | `heightSourceSchema` += `'studio-model'`; `geometrySourceSchema` += `'studio'`; in `buildingPropsProblems`, `'studio-model'` expects fidelity 0 (3 when verified). The pipeline never emits these values, so `public/data` and `scripts/**` are unaffected                                                                                                                                                                                                                          |
| C2  | `src/directory/*` (data) + `src/search/docs.ts` (search)                           | An optional `exclude: ReadonlySet<string>` input, for `studioHiddenFromDirectory`                                                                                                                                                                                                                                                                                                                                                                                                   |
| C3  | `src/map/MapView.tsx` / `types.ts` (map)                                           | Props for `contextPlaces` + `showNearbyOutsideCampus` (passing `includeOffCampus` to `poiCollection`) and `studioModels`                                                                                                                                                                                                                                                                                                                                                            |
| C4  | `src/community/schema.ts` `apiErrorSchema` + both `STATUS_BY_CODE` (studio-server) | Add `validation-failed` and `unsupported-model` (422) together                                                                                                                                                                                                                                                                                                                                                                                                                      |
| C5  | `tests/server/compat/rollback.test.ts` (studio-server)                             | Three assertions encode "the dataset v2 change needs no D1 migration and no publication change", which 0002 and publication v2 now make false. Replace them with: the v1 commit's publication version is 1 **and** v1 is in `SUPPORTED_PUBLICATION_SCHEMA_VERSIONS`; the v1 migration files are a byte-identical **prefix** of the current set (later files: only `0002_building_studio.sql`); a database built from v1 SQL **plus** the later migrations equals the current schema |

---

## 15. Contract index (exported names)

- **`src/building-studio/schema.ts`**
  - **Ids:** `STUDIO_ID_RE`, `OWNER_TEMPLATE_ID_RE`, `CODE_TEMPLATE_ID_RE`, `BASE_BUILDING_ID_RE`,
    `studioIdSchema`, `ownerTemplateIdSchema`, `codeTemplateIdSchema`, `templateIdSchema`, `variantIdSchema`,
    `baseBuildingIdSchema`, `studioPublicId`.
  - **Limits:** `STUDIO_LIMITS`, `STUDIO_VALIDATION`.
  - **Primitives:** `COLOUR_RE`, `colourSchema`, `isoDateSchema`, `isoDateTimeSchema`.
  - **Categories:** `STUDIO_CATEGORY_IDS`, `studioCategoryIdSchema`.
  - **Generators:** `GENERATOR_IDS`, `generatorIdSchema`, `GENERATORS`, `GeneratorInfo`, `ROOF_SHAPES`,
    `roofShapeSchema`, `PITCHED_ROOFS`, `MODEL_CONFIG_VERSIONS`, `SIDES`, `sideSchema`.
  - **Model:** `shapeParamsSchema`, `ROOF_MATERIALS`, `roofSchema`, `FACADE_MATERIALS`, `WINDOW_PATTERNS`,
    `windowPatternSchema`, `facadeSchema`, `DETAIL_LEVELS`, `detailLevelSchema`, `geometryGuideSchema`,
    `modelConfigV1Schema`, `modelDefaultsSchema`, `modelEnvelopeSchema`, `modelSupport`, `ModelSupport`.
  - **Identity:** `studioIdentitySchema`, `publicStudioIdentitySchema`.
  - **Verification:** `VERIFICATION_STATUSES`, `studioVerificationStatusSchema`, `verificationDraftSchema`,
    `verificationSchema`, `VERIFICATION_LABELS`, `APPEARANCE_LABEL`.
  - **Templates:** `LIBRARY_CATEGORIES`, `libraryCategorySchema`, `ACCURACY_CLASSES`, `accuracyClassSchema`,
    `RENDER_COSTS`, `renderCostSchema`, `templateConstraintsSchema`, `templateVariantSchema`,
    `templateDefinitionSchema`, `ownerTemplateInputSchema`, `templateRefSchema`.
  - **Draft:** `positionCorrectionSchema`, `studioDraftSchema`.
  - **Validation:** `SEVERITIES`, `VALIDATION_CODES`, `VALIDATION_CODE_LIST`, `WARNING_CODES`,
    `validationCodeSchema`, `warningCodeSchema`, `severitySchema`, `validationIssueSchema`,
    `validationResultSchema`, `acknowledgementSchema`, `acknowledgementsSchema`, `missingAcknowledgements`.
  - **Published shape:** `studioFootprintSchema`, `studioMembershipSchema`, `publicTemplateRefSchema`,
    `publishedStudioBuildingSchema`.
  - **Requests:** `studioStatusSchema`, `createStudioBuildingRequestSchema`, `saveDraftRequestSchema`,
    `revisionRequestSchema`, `publishRequestSchema`, `archiveRequestSchema`, `restoreRequestSchema`,
    `deleteStudioBuildingRequestSchema`, `duplicateRequestSchema`, `applyTemplateRequestSchema`,
    `validateRequestSchema`, `studioListQuerySchema`, `createOwnerTemplateRequestSchema`,
    `updateOwnerTemplateRequestSchema`, `defaultDuplicateOffsetM`.
  - **Responses:** `studioBuildingHeadSchema`, `studioPublishedVersionSchema`, `MODEL_UNAVAILABLE_REASONS`,
    `studioBuildingDetailSchema`, `studioBuildingSummarySchema`, `studioBuildingListSchema`,
    `publishResponseSchema`, `applyTemplateResponseSchema`, `deleteStudioBuildingResponseSchema`,
    `STUDIO_QUALITY_KINDS`, `studioQualityResponseSchema`, `templateListingSchema`,
    `studioLibraryResponseSchema`.
  - **Errors and audit:** `STUDIO_ERROR_STATUS`, `StudioErrorCode`, `studioErrorDetailsSchema`,
    `STUDIO_AUDIT_ACTIONS`, `StudioAuditAction`.
  - **Types:** `GeneratorId`, `RoofShape`, `WindowPattern`, `Severity`, `ValidationCode`, `WarningCode`,
    `ShapeParams`, `Roof`, `Facade`, `DetailLevel`, `GeometryGuide`, `ModelConfigV1`, `ModelDefaults`,
    `ModelEnvelope`, `StudioIdentity`, `PublicStudioIdentity`, `StudioVerificationStatus`,
    `VerificationDraft`, `Verification`, `LibraryCategory`, `AccuracyClass`, `RenderCost`,
    `TemplateConstraints`, `TemplateVariant`, `TemplateDefinition`, `OwnerTemplateInput`, `TemplateRef`,
    `PositionCorrection`, `StudioDraft`, `ValidationIssue`, `ValidationResult`, `Acknowledgement`,
    `StudioFootprint`, `StudioMembership`, `PublishedStudioBuilding`, `StudioStatus`,
    `CreateStudioBuildingRequest`, `SaveDraftRequest`, `PublishRequest`, `ArchiveRequest`, `RestoreRequest`,
    `DeleteStudioBuildingRequest`, `DuplicateRequest`, `ApplyTemplateRequest`, `ValidateRequest`,
    `StudioListQuery`, `StudioBuildingHead`, `StudioPublishedVersion`, `StudioBuildingDetail`,
    `StudioBuildingSummary`, `StudioBuildingList`, `PublishResponse`, `ApplyTemplateResponse`,
    `TemplateListing`, `StudioLibraryResponse`, `StudioErrorDetails`, `DeleteStudioBuildingResponse`,
    `StudioQualityResponse`.
- **`src/building-studio/text.ts`:** `hasControlChars`, `isHttpUrl`, `PROHIBITED_SOURCE_MESSAGE`,
  `isProhibitedSourceUrl`, `containsProhibitedSourceUrl`, `line`, `text`, `provenanceLine`, `provenanceText`;
  _added 2026-10-24:_ `hasInvisibleNameChars`, `nameLine`.
- **`src/building-studio/footprint.ts`:** `EnuFrame`, `createEnuFrame`, `rotateToEnu`, `ringAreaM2`,
  `normalizeLocalPolygon`, `localPolygonAreaM2`, `localToLngLatPolygon`, `lngLatToLocalPolygon`,
  `outerVertexMean`, `FootprintResult`, `boxLocalFootprint`, `deriveFootprint`.
- **`src/building-studio/mesh/types.ts`:** `Vec2`, `Vec3`, `MaterialSlot`, `WindowGrid`, `StudioFace`,
  `StudioBBox`, `LocalPolygon`, `StudioMesh`, `MeshFailureReason`, `MeshResult`, `faceNormal`, `meshBBox`.
- **`src/building-studio/mesh/triangulate.ts`:** `faceVertices`, `signedArea2`, `triangulateFace`.
- **`src/building-studio/mesh/generate.ts`:** `WINDOW_BAY_M`, `GenerateOptions`, `prismFaces`,
  `generateStudioMesh`, `fallbackPrismMesh`, `meshVolumeM3`.
- **`src/community/schema.ts`:** `PUBLICATION_SCHEMA_VERSION` (2), `SUPPORTED_PUBLICATION_SCHEMA_VERSIONS`,
  `publicationSchema` (+ `buildings`), `EMPTY_PUBLICATION` (+ `buildings: []`).
- **`src/community/merge.ts`:** `MergeResult.contextPlaces`, `MergeReport.outsideCampus`.
- **`src/map/geojson.ts`:** `PoiCollectionOptions`, `PoiProps.badge`, and the 4th parameter of
  `poiCollection`.
