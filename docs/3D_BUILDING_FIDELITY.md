# 3D building fidelity: what each view shows and how honest it is

**Date:** 2026-10-24. **Dataset:** `public/data/manifest.json` `datasetVersion` `62e807e6d444` (schema v2,
campus-only). **Decisions:** D1–D3 and D8 in [ISOMETRIC_AND_3D_DESIGN.md](ISOMETRIC_AND_3D_DESIGN.md), S1–S3
in [BUILDING_STUDIO_DESIGN.md](BUILDING_STUDIO_DESIGN.md). **Renderer evidence:** the Gate 3 bake-off in `docs/research/renderer-bakeoff/` (§6).

Every building drawn in 3D is either data (an OpenStreetMap footprint with a height taken from a tag or
estimated from a floor count) or an owner-placed illustrative model. This page says which is which, how
each view draws it, and the labels that keep the difference visible.

## 1. Fidelity levels

`fidelityLevel` is a property of every feature in `buildings.geojson` (`src/data/schema.ts`). It records how
much of the drawn building is evidence. The pipeline sets it; renderers never upgrade it.

| Level | Meaning                                                                           | Height drawn                                                  | Campus buildings today |
| ----- | --------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------- |
| **0** | Outline only. No height and no floor count are mapped                             | placeholder `APP_CONFIG.map.fallbackBuildingHeightM` (6 m)    | **9**                  |
| **1** | Outline + OSM `building:levels`                                                   | floors × `APP_CONFIG.map.metresPerLevel` (3.2 m), an estimate | **122**                |
| **2** | Outline + OSM `height` (a mapper's measurement)                                   | the tagged height                                             | **0**                  |
| **3** | Surveyed or verified (dated survey, or a `verificationStatus: 'verified'` record) | the surveyed value                                            | **0**                  |

Counts: 131 campus-inventory footprints (128 `inside`, 3 `crossing`), tallied from `buildings.geojson`;
the manifest agrees (`heightSource:osm-levels-estimate` 122, `heightSource:fallback` 9,
`heightSource:osm-height` 0).

**Owner-placed studio models** (S1–S3) are not evidence of height or shape: the owner chose the
generator, roof, storeys and colours. When the merge adds one to the buildings source (§11.2 of the studio
design) it gets `renderHeightSource: 'studio-model'` and `fidelityLevel` **0**, or **3** only when its
verification is `surveyed`/`source-backed` and the record is `verified`. A studio model on an existing OSM
building replaces how that building is drawn, never the OSM snapshot.

## 2. What each view shows

| Data                                   | Realistic 3D (MapLibre)                                                                                                                                          | Isometric overview (Canvas2D)               | Standard 2D (MapLibre) |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------- |
| Campus-inventory OSM footprints        | `fill-extrusion`, flat roof, colour by height source (§3), map-anchored light                                                                                    | Prisms from the same footprints and heights | Flat footprints        |
| `uncertain` / `outside` footprints     | **Not drawn.** `outside` is never shipped; the extrusion filter is `inCampusInventory == true`                                                                   | Not drawn                                   | Not drawn              |
| Studio model (published)               | WebGL2 custom layer: generated mesh, roof shape, procedural windows, owner colours. Fallback: footprint × body height as an extrusion in the studio colour class | The same mesh faces (isometric agent)       | The derived footprint  |
| Studio model the build cannot generate | Fallback prism of the stored footprint × body height, neutral colour; flagged "model unavailable" in the admin quality view                                      | Fallback prism                              | Footprint              |
| Studio preview (Studio open)           | Translucent mesh (55 % opacity, no depth writes); translucent extrusion while on the fallback                                                                    | (Studio UI)                                 | Footprint              |
| Machine-detected footprints (opt-in)   | "Unverified detected footprints": **flat**, light fill + dashed outline; Google points as hollow rings. Never extruded, picked, searched, keyed or routed        | Not drawn                                   | Same flat layer        |
| Off-campus places (opt-in)             | "Nearby, outside campus": markers with the "Outside campus" badge                                                                                                | Not drawn                                   | Same markers and badge |
| GLB models (D3)                        | **None.** `MODEL_REGISTRY` is empty; `three` is not a dependency and is never downloaded                                                                         | None                                        | None                   |

Both opt-in layers are off by default (`APP_CONFIG.optionalLayers`). `MapView` takes them as props
(`showDetectedFootprints` + `detections`, `showNearbyOutsideCampus` + `contextPlaces`); the layer panel
wiring belongs to the integrate step.

## 3. Honesty labels

| Where                         | Label                                                                                                                                                                                                                                      | Source of truth                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Legend, `osm-height`          | "Measured height" — the only class ever called measured                                                                                                                                                                                    | `buildingLegend()` in `src/buildings3d/layers.ts`                 |
| Legend, `osm-levels-estimate` | "Estimated from floor count — … an estimate, not a measurement"                                                                                                                                                                            | same                                                              |
| Legend, `fallback`            | "Height unknown (placeholder) … drawn at a placeholder 6 m"                                                                                                                                                                                | same                                                              |
| Legend, studio models         | "Owner-placed model — Illustrative model placed by the site owner — not verified, unless its details say otherwise. Shape, height, roof and colours are illustrative, not measurements." (`buildingLegend(theme, { studioModels: true })`) | `VERIFICATION_LABELS.unverified` (a test keeps the copy in step)  |
| Studio details                | `VERIFICATION_LABELS[status]` and "Colours and materials are appearance only" (`APPEARANCE_LABEL`)                                                                                                                                         | `src/building-studio/schema.ts`                                   |
| Legend, detections            | "Unverified detected footprint — detected by machine learning in imagery … not checked on the ground and not part of the campus building list" (dashed swatch)                                                                             | `buildingLegend(theme, { detectedFootprints: true })`             |
| Map attribution               | While detections are shown: the Microsoft (CDLA Permissive 2.0) and Google Open Buildings (ODbL 1.0) attribution, linked to their licences, from `manifest.sources`                                                                        | `detectionAttributionHtml()`; source added/removed with the layer |
| About → Data sources          | Each source links its `url` and `licenseUrl`; Microsoft also links the shipped `/data/licenses/CDLA-Permissive-2.0.txt`                                                                                                                    | `src/components/about/SourcesSection.tsx`                         |
| Off-campus markers            | "Outside campus" badge under every marker of the opt-in layer                                                                                                                                                                              | `APP_CONFIG.optionalLayers.nearbyOutsideCampus.badge`             |

Colour classes (`src/map/theme-colors.ts`, `src/buildings3d/palette.ts`): measured, estimated and
placeholder extrusions keep their existing tones; studio fallback blocks use a cool blue-grey that is none
of them (tested). Detection outlines reach 3:1 against the campus ground and the background in both
themes; badge text reaches 4.5:1 on its halo (tested).

Procedural windows are synthetic patterns (`ribbon`, `punched`, `grid`, `curtain`) drawn in the fragment
shader from the model's own parameters. They are never photographs and never a claim about the real
façade.

## 4. Lighting

`lightSpecification(theme)` (`src/buildings3d/lighting.ts`) puts a **map-anchored** light into the style:
position `[1.15, 210°, 35°]`, intensity 0.5 (light) / 0.35 (dark), white. Façade shading therefore stays
tied to the ground while the user rotates. These are visual tuning values inside the design's ranges, not
a claim about the sun.

The studio layer reproduces MapLibre 6.15's extrusion lighting formula with the same light. The light
vector convention was **measured**, not assumed: the bake-off's lighting check draws the same box as an
extrusion and through the custom layer and samples each face at four bearings (south face 145 vs 136,
west 125 vs 115, north and east 99 vs 87, roof 204 vs 201, RGB red channel; the custom layer is a little
darker because extrusions are drawn at 0.92 opacity over the light ground). The brightness order of the
faces is the same in both.

## 5. Degradation and fallbacks (Realistic 3D)

| Event                                                           | What happens                                                                                                                                   | User sees                                                                                                                                                                |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No studio models and the Studio is closed                       | The studio chunk is never loaded                                                                                                               | —                                                                                                                                                                        |
| Chunk fails to load, shader/buffer/draw error                   | Custom layer removed; studio buildings re-included in `building-extrusion` (footprint × body height, studio colour); pick layer removed        | Notice "Owner-placed 3D models could not be drawn on this device, so they are shown as plain blocks."                                                                    |
| WebGL context lost                                              | The layer drops its GL references (no calls into the dead context). After restore: one re-mount; a second loss stays on the extrusion fallback | The existing "context lost" banner; on the second loss also the notice above                                                                                             |
| Slow frames (rAF p95 > 50 ms over 2 s of camera movement in 3D) | 1st: custom layer → extrusion fallback. 2nd: suggest the Overview. Never switches modes by itself                                              | "Owner-placed 3D models are now drawn as plain blocks …", then "The 3D map is running slowly on this device. The Overview view may be smoother; your selection is kept." |
| A record this build cannot generate                             | Fallback prism through the custom layer (`modelAvailable: false`)                                                                              | Neutral block; the admin quality view flags it                                                                                                                           |

Notices go to `MapView`'s `onRenderNotice` prop when given, else to the app's toast, else to an inline
dismissible status message.

Picking never uses the custom layer (S1): while it draws studio buildings, an invisible
`studio-extrusion-pick` fill-extrusion of the same footprints keeps them clickable with MapLibre's own 3D
hit test, so a studio building selects exactly like an OSM one and with the same id.

Other caps: `pixelRatio` is limited to 2 (D1 item 6).

## 6. Measured performance (Gate 3)

Headless Chromium draws WebGL on SwiftShader (the CPU), so the absolute frame times below describe this
test machine, not a phone; they are useful as a comparison between paths only.

**Gate 3 decision:** studio models use the WebGL2 custom layer in Realistic 3D, guarded by the watchdog,
with the plain extrusion as the automatic fallback. Every criterion measurable here passed; the absolute
device frame-time criterion (D8) is still open because no device was available.

Scenario: 50 studio models (4 real campus footprints as `footprint-prism` models: a large named institute
building, a 44-vertex footprint, a canteen STAND-IN and a hostel STAND-IN, both unconfirmed; plus 46
starter-library models at synthetic positions that exist only in the test harness). 39 unique meshes,
3,946 triangles, 376 kB of GPU buffers. Machine: Intel Core 7 240H, Chromium 156 headless (SwiftShader),
CDP 4× CPU throttle, other agents' processes running.

| Measure (50 models)                                | Plain extrusion (fallback)                                                                         | Custom layer                                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Lazy chunk, gzip                                   | 0 (part of MapLibre)                                                                               | 17.1 kB (`runtime-*.js`)                                                                   |
| Always-loaded map chunk, gzip                      | 287.9 → 291.3 kB for the realistic-3D controller, optional layers, watchdog and light (both paths) |                                                                                            |
| rAF p50 / p95, desktop 1440×900, 4×                | 66.7 / 83.3 ms                                                                                     | 66.7 / 83.4 ms                                                                             |
| rAF p50 / p95, mobile 390×844 @2×, 4×              | 66.6 / 66.8 ms                                                                                     | 66.7 / 83.4 ms                                                                             |
| Same scene with no studio models, desktop / mobile | 50.0 / 66.7 and 66.6 / 66.8 ms                                                                     |                                                                                            |
| Layer CPU per frame p95, 4× (desktop / mobile)     | —                                                                                                  | 4.5 / 3.4 ms (0.6 ms at 1×)                                                                |
| JS heap after load (desktop)                       | 10.0 MB                                                                                            | 11.2 MB                                                                                    |
| Picking: top-down / tilted 55°                     | 50/50 / 43/50                                                                                      | 50/50 / 43/50 (same misses: the building in front)                                         |
| Context loss                                       | —                                                                                                  | fallback in 323 ms; custom layer back 882 ms after restore; 2nd loss stays on the fallback |

rAF intervals fall on 16.7 ms steps under SwiftShader, and every path, including the scene without studio
models, is above the 33 ms device budget there, so these are comparisons, not device numbers. The
isometric overview drew the same 50 meshes with gesture frames at 16.8 ms p95 (4×) and a 4× scene build
of 174–190 ms (its own budget is 120 ms; reported to the isometric agent).

Raw JSON: `docs/research/renderer-bakeoff/results/`; screenshots (desktop and mobile, all three paths,
the four real structures, context restore, fallback, detections layer):
`docs/research/renderer-bakeoff/screenshots/`; harness and specs: `docs/research/renderer-bakeoff/harness/`
(`summarize.mjs` prints these tables).

## 7. Code map

| File                                        | Role                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/buildings3d/layers.ts`                 | Extrusion (campus inventory, studio exclusion), studio pick layer, colour classes, legend |
| `src/buildings3d/lighting.ts`, `palette.ts` | Map-anchored light; realistic-3D colours                                                  |
| `src/buildings3d/optional-layers.ts`        | Detections layer + attribution, "Outside campus" badges                                   |
| `src/buildings3d/realistic3d.ts`            | Controller: lazy studio layer, fallback, watchdog, context loss, optional-layer setters   |
| `src/buildings3d/watchdog.ts`               | rAF p95 watchdog (interaction only)                                                       |
| `src/buildings3d/models/*`                  | D3 seam (`MODEL_REGISTRY` empty)                                                          |
| `src/building-studio/render/maplibre/*`     | The WebGL2 custom layer (lazy chunk `runtime.ts`), buffers, shaders, placement math       |
| `src/map/MapView.tsx`                       | Attaches the controller; DPR cap; opt-in layer props; notices                             |
