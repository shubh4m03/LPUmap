# Isometric overview and realistic 3D: architecture decision record and design spec

**Status:** proposed (design only, no code changed). **Date:** 2026-10-24.
**Dataset measured:** `public/data/manifest.json` `datasetVersion` `b628c5855b1d`, built from the OSM snapshot
retrieved 2026-10-23T09:39:00Z. **MapLibre measured:** `node_modules/maplibre-gl` **6.15.0**.

This document decides how the app renders buildings in three view modes (**Realistic 3D**, **Isometric
overview**, **Standard 2D**), how one building directory with map keys serves all of them, and what
the data pipeline must add. Section 11 lists the parallel work packages.

> **Note on the brief.** The owner's brief names IITK reference files (`src/main.ts`,
> `src/route/router.ts`, `scripts/*.mjs`). Those files are in `C:/Users/shubh_qypqua6/Documents/LPU/iitk-main`.
> In this repository they correspond to `src/main.tsx` + `src/app/MapStage.tsx` + `src/map/MapView.tsx`,
> `src/routing/router.ts`, and `scripts/*.ts` + `scripts/lib/*.ts`. The IITK map is flat 2D MapLibre
> (`pitchWithRotate: false`, `iitk-main/src/main.ts:92`), so it offers no prior art for 3D or isometric
> rendering.

---

## 0. Decisions at a glance

| #   | Decision                                                                                                                                                                                                                                                                                       | Section |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| D1  | **Realistic 3D stays on MapLibre `fill-extrusion`.** Improve it with campus-membership LOD, map-anchored lighting and honest colour classes. Add no custom layer now.                                                                                                                          | §5      |
| D2  | **No pitched-roof renderer.** The snapshot has 2 `roof:shape` tags in total and none on a pitched campus building. _Amended 2026-10-24: owner-authored studio models only (S1)._                                                                                                               | §5.4    |
| D3  | **Do not add Three.js now.** The GLB model registry is empty. Define the seam (a lazy custom layer that loads only when the registry is non-empty) and the conditions for adopting it.                                                                                                         | §5.5    |
| D4  | **The isometric overview gets its own Canvas2D renderer** (`src/isometric/`). It projects the real footprints from `public/data` with a parallel 2:1 dimetric transform, orders prisms with a depth graph, and does its own hit-testing. It works without WebGL.                               | §6      |
| D5  | **A building directory service** (`src/directory/`) is the single source for both modes and for the accessible list: eligibility, stable ids, honest names, facilities, routability and **map keys**.                                                                                          | §7      |
| D6  | **Map keys are grid references** such as `C4-07`: a fixed 200 m grid plus a sequence within each cell, frozen in a committed lock file. They are drawn in a distinct diamond glyph and labelled "Map key". Official block numbers are shown only from cited curated aliases (currently **0**). | §7.3    |
| D7  | **`viewMode: 'realistic3d' \| 'isometric' \| 'standard2d'`** replaces `mode3d`. Selection, search, favourites and the route are shared across modes. Live GPS navigation runs only in the map modes. The URL takes `?view=3d\|iso\|2d`.                                                        | §8      |
| D8  | **Isometric budgets are gated in CI** with Playwright, CDP CPU throttling and requestAnimationFrame (rAF) timing. Realistic-3D frame budgets are measured on devices only, because headless CI renders WebGL on the CPU (SwiftShader).                                                         | §9      |

---

## 1. Evidence base (measured and verified)

All numbers below were computed during this task from the files named. Scripts and outputs are in the
scratch folder `C:/Users/shubh_qypqua6/AppData/Local/Temp/claude/c--Users-shubh-qypqua6-Documents-LPU/e111b9d0-0d61-4344-b92c-327d477048d2/scratchpad/geo/iso3d/`
(`analyze.mjs` → `analyze-output.json`, `relations.mjs`, `tags.mjs`, `numbering.mjs`, `gridkeys-origin.mjs`,
`overlaps.mjs`, `true-overlaps.txt`). The scripts only read the repository.

### 1.1 Buildings (`public/data/buildings.geojson`)

> **Dataset update (amended 2026-10-24).** The table below was measured on dataset `b628c5855b1d`, which held
> all 535 footprints of the snapshot (campus and nearby). The current dataset is **`62e807e6d444`**
> (`manifest.json` `schemaVersion` 2, built from the same OSM snapshot retrieved 2026-10-23T09:39:00Z). Its
> `buildings.geojson` holds only the campus inventory: **131** footprints, all `geometrySource` `osm` and
> `inCampusInventory: true`, with `campusStatus` **128** `inside` and **3** `crossing`. The manifest accounts for
> the rest of the snapshot: 535 in the snapshot = 131 in the inventory + 390 outside (excluded) + 13 uncertain
> (not in this file) + 1 duplicate removed. Render heights: 122 `osm-levels-estimate`, 9 `fallback`, 0
> `osm-height`. Names: 3 named, 128 unnamed. Categories: 130 `building`, 1 `food`. Off-campus footprints are
> no longer in this file, so rows below that count 535 features, the 137/398 `campusZone` split or off-campus
> heights describe the earlier dataset only. They are kept as the record of the evidence D1–D8 were decided
> on; re-measure before relying on any of those counts. (Tallied from `public/data/manifest.json` `counts` and
> `public/data/buildings.geojson` properties.)

| Fact                                                            | Value                                                                                                                                                                       | How                                                                                                                                                                           |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Footprints                                                      | **535**, all `Polygon`                                                                                                                                                      | feature count                                                                                                                                                                 |
| `campusZone` property                                           | **137** `on-campus`, **398** `off-campus-nearby`                                                                                                                            | property tally                                                                                                                                                                |
| Same split from three representative points                     | 137 / 137 / 137 inside the boundary                                                                                                                                         | Point-in-polygon against `boundary.geojson` (holes respected) for the vertex-mean centroid, the area centroid, and the pipeline's point-on-surface (`places.json` `location`) |
| Share of each footprint inside the boundary (`insideFraction`)  | 397 have 0; **1** is between 0 and 0.5 (`osm:way/422738892`, 0.41, 91 m², off-campus); **6** are between 0.5 and 1 (0.77–0.97, all on-campus); 131 have 1                   | Grid sampling about 2,500 points per footprint bounding box; share of the in-footprint samples that are also in the boundary                                                  |
| `campusZone` vs `insideFraction ≥ 0.5`                          | **0 disagreements**                                                                                                                                                         | cross-tab                                                                                                                                                                     |
| Are all 535 extruded in 3D?                                     | **Yes.** The `building-extrusion` layer has no filter (`src/buildings3d/layers.ts`, `buildingExtrusionLayers`)                                                              | code read                                                                                                                                                                     |
| On-campus height source                                         | 129 `osm-levels-estimate`, 8 `fallback` (6 m placeholder), **0** `osm-height`                                                                                               | tally                                                                                                                                                                         |
| Off-campus height source                                        | 8 `osm-levels-estimate`, **390** `fallback`                                                                                                                                 | tally                                                                                                                                                                         |
| On-campus `building:levels`                                     | 53 × 10, 22 × 1, 15 × 5, 10 × 2, … ; **2 × 0.2** (`osm:way/422732974`, `osm:way/427330238`, giving 0.64 m prisms, probably tagging errors); 8 missing                       | tally                                                                                                                                                                         |
| On-campus names                                                 | **3 of 137** named: "Lovely Institute Of Management", "Lovely Institute of Technology", "Lovely Institute of Pharmacy". The other **134** are "Unnamed building · N floors" | tally                                                                                                                                                                         |
| On-campus category                                              | 136 `building` (use not recorded), 1 `food`                                                                                                                                 | tally                                                                                                                                                                         |
| On-campus area (m²): min / p10 / p25 / median / p75 / p90 / max | 4.1 / 13.9 / 54.2 / 222.6 / 1,062.8 / 1,817.7 / 12,793.6; **21** under 20 m²; total 124,424 m²                                                                              | equirectangular area at latitude 31.2533°                                                                                                                                     |
| On-campus outline vertices                                      | **1,433** in total (equal to the number of wall faces), at most 44 per footprint                                                                                            | ring lengths                                                                                                                                                                  |
| On-campus render heights: min / median / p90 / max              | 0.6 / 19.2 / 32 / 35.2 m (estimates)                                                                                                                                        | `heightM`                                                                                                                                                                     |
| Footprint pairs that truly overlap (≥ 1 m² shared area)         | **8**: a nested footprint (`osm:way/675395630` inside `osm:way/422437890`, 1,476 m²), the stacked group `osm:way/422823426…28`, and `osm:way/426284154` (`building=roof`)   | 0.5 m sampling of bounding-box intersections (`true-overlaps.txt`). A coarser test also flagged 80 pairs that only share walls                                                |

### 1.2 Tags available for styling (`data/raw/osm/campus-bbox.osm`)

Every element was parsed with `tags.mjs`.

| Tag                            | Elements | Notes                                                                                                                                |
| ------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `building=*`                   | 535      | 532 `yes`, 2 `apartments`, 1 `roof`. This matches the pipeline count                                                                 |
| `roof:shape`                   | **2**    | `skillion` on `way/426284154` (`building=roof`, which also has `roof:levels=9`); `flat` on `way/1300687881`, which is not a building |
| `roof:colour`, `roof:material` | **0**    |                                                                                                                                      |
| `building:part`                | **1**    | `way/422437885` (also tagged `building=yes`)                                                                                         |
| `building:material`            | 6        | all `brick` (`way/422323508`, `way/422547443…447`)                                                                                   |
| `building:min_level`           | 4        |                                                                                                                                      |
| `height`                       | **0**    | No measured heights                                                                                                                  |
| `ref` on any building          | **0**    | The 16 `ref` tags are on roads, routes and one named node. **OSM provides no block numbers.**                                        |

### 1.3 Basemap, places, relations, graph

- `basemap.geojson` has **389** features and 3,380 vertices: 152 road, 67 path, 29 service and 19 road-major lines, plus 43
  green, 37 landuse, 20 pitch, 15 water and 7 parking polygons. **214** of them (1,732 vertices) have at
  least one vertex inside the boundary.
- `boundary.geojson`: one polygon with 124 outer vertices and an area of 889,685 m². Its extent is **1,120 m E–W ×
  1,673 m N–S**. The principal axis of its vertices is 63.5° counter-clockwise from east; the axis of the
  campus building centroids is 77.2°. The campus is long in roughly the N–S direction.
- `places.json` has 855 places: 535 building, 213 facility, 73 area, 32 organization, 1 gate, 1 landmark.
  **Only 1 facility is on-campus.** Of the 32 organizations, 1 has a location.
- `relations.json` has 167 `located_in`, of which **only 1 targets an on-campus building**; 165 target
  off-campus buildings and 1 is curated (`cur:school-of-design → osm:way/425717552`, a facility). There are
  393 `nearby` (all off-campus) and 200 `part_of`.
- Routability: **124 of 137** on-campus building places have both a `location` and a `graphNodeId`.
  Connector length median is 16.4 m, p90 50.4 m, max 59.5 m. The graph has 1,636 nodes and 1,770 edges.

### 1.4 Re-verifying the lead's measurements

| Lead's claim                                                                       | Verdict                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boundary is OSM relation 21599790                                                  | Consistent: the comment on `APP_CONFIG.map.center` in `src/config/index.ts` and the file `data/raw/osm/boundary-relation-21599790.osm`.                                                                                                                                         |
| 535 footprints, about 137 inside and about 398 outside, all rendered in 3D         | **Confirmed exactly** with three independent representative points (§1.1) and by reading the layer code.                                                                                                                                                                        |
| The pipeline keeps features inside the `maxBounds` rectangle and tags `campusZone` | **Confirmed** in `scripts/lib/build-buildings.ts` (`if (!inBBox(location, ctx.maxBounds)) return;`, then `campusZone: ctx.insideCampus(location) ? …`). The OSM download bbox is `75.695,31.243,75.715,31.262` (manifest `sources[0].url`), which is narrower than `maxBounds`. |
| OSM lacks hostels, the Agriculture Block and canteens                              | Consistent with §1.1: 3 named on-campus footprints, no building `ref`, and only 1 on-campus facility. A fresh download was **not** re-diffed in this task.                                                                                                                      |
| Microsoft footprints: 169 inside the boundary, 99 unmatched (12–2,284 m²)          | **Reproduced** by re-running the lead's `geo/count.mjs` on `geo/ms.csv.gz`: `{osmIn:137, osmOut:398, msIn:169, msMatched:70, msUnmatched:99}`. Unmatched area quantiles: 12, 28, 45, 83, 213, 522, 2,284 m². This reused the lead's script; it is not an independent method.    |

**Implication for design.** The directory will mostly list unnamed, estimated-height buildings with no
facilities attached. The UI must make that honest **and** still usable. That is why map keys (§7.3)
carry real weight: they become the main handle for 134 unnamed footprints.

---

## 2. The reference illustration: visual system

**Source:** "LPU isometric map design" on Behance (<https://www.behance.net/gallery/105159145/LPU-isometric-map-design>),
viewed from `reference/assets/lpu-isometric-map-reference.png`. That file is a browser screenshot at 40 % page
zoom, so fine details are approximate. It is **copyrighted third-party artwork of unknown date.**

**Usage rule (binding).** The illustration is used **only** as design inspiration and as unverified leads for a
future survey. We do not copy its colours, typography, logo or layout literally. No footprint is named,
numbered or positioned from it. Its block numbers never appear in the product.

### 2.1 What we observe and what we borrow

| Aspect                  | Observation (approximate)                                                                                                                                                                                                                                                              | What we borrow (as a principle, not pixels)                                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Projection              | A parallel projection with no vanishing points. Vertical edges stay vertical and the ground axes run diagonally at a shallow angle, like 2:1 "pixel-isometric" or dimetric. The campus runs diagonally across the sheet.                                                               | Parallel 2:1 dimetric projection: camera elevation 30°, view rotation in 90° steps (§6.3).                                                                                                                         |
| Building massing        | Simple prisms, each wall plane a flat colour. The two visible wall orientations get different tones, roofs are lighter, and edges are crisp. Many blocks are subdivided with window rhythm and some roof details.                                                                      | Flat per-face shading in three tones (roof / light wall / shade wall) from a fixed light direction, plus thin edge strokes. **No** windows or ornament: our data has no façade information.                        |
| Palette roles           | Warm light background for the surroundings; saturated green for gardens and grounds; black roads with white dashed centre lines; a muted pink for pedestrian areas; dark grey for parking; light grey for paved plazas; warm brick-red buildings with lighter roofs.                   | **Roles only:** surroundings, campus ground, green, pitch, pedestrian, road, parking, water, building faces, selection, route. We pick our own values in `iso-theme.ts`, contrast-tested in light and dark themes. |
| Roads and paths         | Roads are wide black bands with a dashed centre line. Pedestrian areas are filled pink polygons with a tree border.                                                                                                                                                                    | Roads as cased bands whose width in metres scales with the view. Paths dashed, as in the existing 2D style.                                                                                                        |
| Greens and surroundings | Grounds and fields are flat green polygons with track markings and tree sprites. Everything outside the campus is one flat warm tone.                                                                                                                                                  | Outside the boundary: one flat "surroundings" tone, with off-campus footprints flat and muted (§6.5). No decorative trees, because tree positions are not in our data.                                             |
| Numbered markers        | White circular badges with black numerals sit on roofs. The numbers run from 1 to 58.                                                                                                                                                                                                  | Markers on roofs with leader-free placement, **but in a different glyph (diamond) and grid-reference keys** so they cannot be mistaken for official numbers (§7.3).                                                |
| Legend                  | A box in the bottom-left corner with 5 swatches: garden or ground, road, pedestrian, parking, surroundings.                                                                                                                                                                            | A collapsible legend that also explains **data honesty**: estimated vs placeholder heights, and "Map key ≠ official block number".                                                                                 |
| Index panel             | A right-hand panel titled "INFORMATION" with grouped lists (Education, Administrative, Residential), each heading in its own colour, mapping names to numbers. Several names share a number (for example two departments on one number), and residential entries list several numbers. | The **directory panel** (§7.5), grouped by grid cell or category, with one row per building and many organizations per building. On mobile it is a bottom sheet.                                                   |
| Branding                | University logo and tagline top-right.                                                                                                                                                                                                                                                 | **Not borrowed.** We do not use LPU marks.                                                                                                                                                                         |

**Leads for a future survey (unverified).** The index associates department and residence names with
numbers, for example Pharmacy 4 and 7, Computer Science 34, Administrative 29, Baldev Raj Auditorium 2, Girls
Hostel 9–12 and 21A/B, Boys Hostel 45 and 48–53. These may help a surveyor ask the right questions on site.
They are not data. Note that one curated record already cites an official page for a block number:
`cur:central-library` says "The official page places it in Block-37" (source
<https://www.lpu.in/academics/libraries.php>). That block still has no verified map position, so it stays
unplaced.

---

## 3. Current implementation (as read)

- **One MapLibre map, built once** (`src/map/MapView.tsx`). Its style comes from code (`src/map/style.ts`:
  basemap, then building footprints, then extrusions, then overlays). Updates are incremental (`setData`,
  paint setters, feature-state `selected`). The camera is driven by `createMapController`
  (`src/map/controller.ts`), and the app talks to it through `MapController` (`src/map/types.ts`).
- **2D/3D** is the boolean `mode3d` (`src/app/store/map-slice.ts`; the default is 3D at ≥ 768 px wide).
  `setBuildingMode` (`src/buildings3d/mode.ts`) eases to `pitch3d` 55° and `bearing3d` −20°, toggles extrusion
  visibility, and enables `dragRotate`/`touchPitch` in 3D only.
- **Extrusion** (`src/buildings3d/layers.ts`): `fill-extrusion-color` encodes `heightSource` (measured,
  estimated or placeholder) or selection. Opacity is 0.92, `vertical-gradient` is on, and `minzoom` is
  `extrusionMinZoom` 14.5. The legend comes from `buildingLegend()`. The architecture decision "fill-extrusion,
  not Three.js" is recorded in `docs/ARCHITECTURE.md` (§ "MapLibre fill-extrusion, not Three.js").
- **No WebGL2** means list mode (`AppShell.tsx` → `ListLayout`); `supportsWebGL()` probes WebGL2
  (`src/buildings3d/webgl.ts`).
- **Test hook** `window.__ATLAS_MAP__` (`src/map/test-hooks.ts`) is installed only with `?e2e=1` and is
  read-only. E2E runs against `vite preview`, and headless Chromium renders WebGL on SwiftShader
  (`playwright.config.ts` comment).
- **Deep link:** only `?place=<id>`, written with `history.replaceState` (`src/app/deep-link.ts`).
- **Bundle:** `MapStage-*.js` is about 1,065 kB raw / 291 kB gzip and is loaded lazily
  (`docs/PERFORMANCE.md`, "Bundle sizes").
- **Facilities:** `createFacilityDirectory` (`src/facilities/directory.ts`) gives `related(id)` with honest
  relation labels and `isRoutablePlace` (location + `graphNodeId`).

---

## 4. MapLibre GL JS 6.15.0 capability audit

Sources: `node_modules/maplibre-gl/dist/maplibre-gl.d.ts` (**d.ts**),
`node_modules/@maplibre/maplibre-gl-style-spec/dist/index.d.ts` (**spec**), and
`node_modules/maplibre-gl/dist/maplibre-gl-dev.mjs` (**dev**). Line numbers are for these installed files.

| Capability                       | Finding                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fill-extrusion` paint           | `color`, `height`, `base` and `pattern` are **data-driven** (spec 10125, 10154, 10149). `opacity` (10115), `translate` (10135) and `vertical-gradient` (10169) are **layer-wide only**. Per-feature opacity therefore needs separate layers.                                                                                                                                                       |
| `fill-extrusion` layout          | `visibility` and **`fill-extrusion-rounded-corner-distance`** (spec 10101: "distance from each corner … replaced by a rounded corner"). This rounds corners; it does not shape roofs. It is of no use for rectilinear campus blocks.                                                                                                                                                               |
| Per-face colour, outlines, roofs | **None.** One colour per feature; walls are shaded by the global light plus the optional vertical gradient. There is no wall/roof split, no edge stroke, and no roof geometry other than flat.                                                                                                                                                                                                     |
| Shadows / ambient occlusion      | **None.** No shadow or ambient-occlusion property exists among the fill-extrusion properties (complete list extracted from spec 10090–10170).                                                                                                                                                                                                                                                      |
| Light                            | `LightSpecification` has `anchor` (`map` \| `viewport`, default `viewport`), `position` `[r, azimuth, polar]` (default `[1.15, 210, 30]`; azimuth is from north when `anchor: map`), `color`, and `intensity` (default 0.5) (spec 8458–8506). Setters: `map.setLight` (d.ts 16102).                                                                                                                |
| Sky                              | `sky-color`, `horizon-color`, `fog-color`, `fog-ground-blend`, `horizon-fog-blend`, `sky-horizon-blend`, `atmosphere-blend` (spec 8509+); `setSky`. It only shows near the horizon at high pitch. Not needed.                                                                                                                                                                                      |
| Terrain                          | `setTerrain({source, exaggeration})` (d.ts 15516) needs a `raster-dem` source. We have no DEM, the campus is flat, and the CSP is `connect-src 'self'`. **Not used.**                                                                                                                                                                                                                              |
| Camera FOV                       | **Yes:** `getVerticalFieldOfView()` (default **36.87°**) and `setVerticalFieldOfView(fov)` (d.ts 14302/14317). The dev build clamps to **[0.1°, 150°]** (`fov = clamp$2(fov, .1, 150)`, dev 42688). There is **no `fov` in `MapOptions`**, so it must be set after construction. Camera distance is `0.5 / tan(fov/2) · height` (dev), so at 0.1° the camera sits about 573 viewport heights away. |
| Orthographic projection          | **No.** Projections are `mercator`, `globe` and `vertical-perspective` only (dev 44463–44555). A very small FOV is only an approximation of a parallel projection.                                                                                                                                                                                                                                 |
| Pitch limits                     | `MapOptions.minPitch` / `maxPitch` (d.ts 13585/13590; default max **60**, allowed range 0–180). `setMaxPitch` (d.ts 14861) says "> 60 degrees are experimental". **Roll** exists (`setRoll`).                                                                                                                                                                                                      |
| Camera locking                   | `MapOptions.transformCameraUpdate` (d.ts 13706) can clamp or override every camera update. Handlers (`dragRotate`, `touchPitch`, `keyboard`) can be disabled.                                                                                                                                                                                                                                      |
| Custom layers                    | `CustomLayerInterface` (d.ts 6064): `id`, `type:'custom'`, `renderingMode '2d' \| '3d'` ('3d' shares the depth buffer), `render`, `prerender`, `onAdd(map, gl: WebGL2RenderingContext)`, `onRemove`, experimental `renderToTerrainTile`. This is enough for a Three.js GLB layer that shares MapLibre's GL context.                                                                                |
| Rendering controls               | `MapOptions.pixelRatio` (d.ts 13796), `canvasContextAttributes` (13556, for example `antialias`), `maxCanvasSize` (13814), `globalState` (13807, for the `global-state` expression), `fadeDuration`.                                                                                                                                                                                               |

---

## 5. Decision A: the realistic 3D mode

### 5.1 Context

We have 137 campus footprints with estimated heights and 398 off-campus footprints, 390 of which use the
6 m placeholder. All are extruded today. There are no measured heights, no roof shapes and no façade data.

### 5.2 Decision D1: stay on native `fill-extrusion`

The reasons in `docs/ARCHITECTURE.md` still hold, and the audit (§4) shows that nothing a second renderer
would add is supported by our data. The enhancements, in order of value:

1. **Campus-membership level of detail (LOD)**, which is source-backed. Split the extrusion into two layers:
   - `building-extrusion` filters on campus membership (`inside` or `straddling`): 137 footprints today.
     It keeps the honest `heightSource` colour encoding.
   - `building-extrusion-context` shows `outside` footprints with a neutral tone and lower opacity (opacity
     must be per layer, §4). It has `minzoom` 16 and is **hidden on phones**. Off-campus 3D carries almost no
     information (390 of 398 heights are placeholders), so on phones those buildings show as flat footprints.
     This cuts extruded prisms by **74 %** (398 of 535).
2. **Map-anchored light.** Use `setLight({ anchor: 'map', position: [1.15, az, polar], intensity })` so the
   shading stays tied to the ground when the user rotates; today's default `viewport` anchor makes the "sun"
   turn with the camera. Start from azimuth 200–225° (light from the south-south-west, plausible for the
   campus latitude of about 31° N) and polar 30–40°. Use intensity 0.5 in light theme and about 0.35 in dark.
   The exact values are a **visual-review tuning item**, not a physical claim. Keep `vertical-gradient: true`;
   it is the only built-in depth cue.
3. **Material classes are rendering-only now.** The colour stays a function of `heightSource`, selection and
   membership. Source-backed material classes (`buildingMaterial`, `roofColour` from tags) go into the data
   contract (§11.3) but are **not shown**. Coverage is 6/535 for `building:material` and 0 for
   `roof:colour`, and a 4 % class would read as noise. Revisit when coverage on campus reaches 25 % or more.
4. **Shadows and ambient occlusion.**
   - No native support.
   - A uniform drop shadow made with `fill-translate` is **rejected**: translate is not data-driven, so a
     35 m block and a 3 m kiosk would cast the same shadow, which is a visual lie.
   - Optional P2 experiment: height-proportional ground shadows as a translucent `fill` layer. Each shadow
     is the footprint swept along the light vector by `heightM · cot(elevation)` and is computed at runtime
     from the same estimated heights. Label it decorative, keep it off on phones, and measure its cost
     first. It is not part of the first delivery.
5. **Camera.** Keep `pitch3d` 55°, `bearing3d` −20° and `maxPitch` at the default 60 (above 60 is experimental,
   §4). Leave the FOV at its default.
6. **Mobile degradation.** Pass `pixelRatio: Math.min(devicePixelRatio, 2)`, leave antialiasing at its
   default, and hide the context layer on phones. Keep the existing behaviour of starting phones in 2D.
   Losing the WebGL context degrades to Standard 2D, and then to the list as today. A runtime frame
   watchdog (rAF p95 above 50 ms over 2 s of interaction) first hides the context layer, then suggests the
   isometric overview in a toast. It never switches modes by itself.

### 5.3 Rejected for now

- Category colour: 136 of 137 campus footprints are `building` (use not recorded), so it would be one
  colour.
- `fill-extrusion-pattern` façade textures: they would invent windows.
- Terrain and sky: no data, and the campus is flat.

### 5.4 Decision D2: no roof-shape renderer

MapLibre cannot draw pitched roofs (§4). The alternatives are a custom WebGL layer that triangulates
gables and hips, or stacked "generated prisms" that fake slopes. Both are **rejected**: the snapshot has
**two** `roof:shape` tags in total. One is a `skillion` canopy (`way/426284154`, `building=roof`); the other is
`flat` on a non-building way. A flat roof is exactly what extrusion draws.

**Revisit when** at least 10 % of campus buildings carry a non-flat `roof:shape`, or a survey supplies roof
data. The data contract still records `roofShape` so the decision can be re-evaluated from the data.

> **Amendment 2026-10-24 (Building Studio, decision S1 in `docs/BUILDING_STUDIO_DESIGN.md` §1).**
>
> - **OSM/base buildings: unchanged.** They stay flat-roofed `fill-extrusion`s. There is still no roof data
>   for them, so the reasoning above still holds.
> - **Owner-authored studio models are a different case.** Their roof shape is an explicit parameter that
>   the owner chooses, and it is labelled as an illustrative model. It is not inferred from OSM.
> - **One shared mesh module draws them in both modes.** `src/building-studio/mesh/` (`StudioMesh`) feeds a
>   raw-WebGL2 MapLibre `CustomLayerInterface` in Realistic 3D and the Canvas2D renderer in the isometric
>   overview. The custom layer is a lazy chunk with no new dependency. Picking and the 2D view use the
>   derived footprint. If the custom layer fails, the model is drawn as footprint × body height in
>   `fill-extrusion`.
> - **This is final only after the Gate 3 bake-off passes.** Gate 3 measures the chunk size (gzip), frame
>   time with 50 instances under a 4× CDP CPU throttle and context-loss recovery, and compares models side
>   by side on real structures. If the budget fails, studio models ship as extrusions only.
> - **D3 is unchanged.** No Three.js and no GLB rendering. GLB import is validated but not stored or rendered
>   (S11).

### 5.5 Decision D3: GLB models through a lazy Three.js custom layer, not now

- **Cost.** `three` is not installed. npm reports `three@0.186.1` with an unpacked size of 20.4 MB (`npm view
three version dist.unpackedSize`). Its bundled cost after tree-shaking plus `GLTFLoader` is **unmeasured**
  and must be measured by a spike build before adoption. It adds a second scene graph, matrix syncing
  through `CustomLayerInterface.render(gl, {modelViewProjectionMatrix})`, manual picking, and more
  context-loss handling.
- **Benefit today:** zero. The model registry is empty and no licensed, georeferenced campus model exists.
- **Decision:** do not add the dependency. Ship the **seam** only (realistic-3D agent):

```ts
// src/buildings3d/models/registry.ts: committed data, empty today.
export interface ModelEntry {
  /** Footprint this model replaces (its extrusion is filtered out while the model is shown). */
  buildingId: string;
  /** Self-hosted under public/models/ (CSP connect-src 'self'). */
  url: string;
  bytes: number;
  sha256: string;
  anchor: [lon: number, lat: number];
  rotationDeg: number;
  scale: number;
  licence: string;
  sourceId: string; // must exist in manifest.sources
  verifiedAt: string;
}
export const MODEL_REGISTRY: readonly ModelEntry[] = [];

// src/buildings3d/models/maybe-add-model-layer.ts
export async function maybeAddModelLayer(map: ModelHostMap, registry = MODEL_REGISTRY): Promise<void> {
  if (registry.length === 0) return; // three is never downloaded
  const { createModelLayer } = await import('./model-layer.ts'); // the only module that imports 'three'
  map.addLayer(createModelLayer(registry), BUILDING_LAYER_IDS.extrusion);
}
```

**Adoption gate (all required):**

- at least 1 registry entry with a licence and source;
- a spike build whose chunk size is recorded in `docs/PERFORMANCE.md`;
- loaded only in `realistic3d` on tablet or desktop;
- a picking fallback (the extrusion stays queryable with zero opacity, or the footprint fill is used for
  picking);
- context-loss tests.

---

## 6. Decision B: the isometric overview mode

### 6.1 Options

**(i) MapLibre "isometric look".** This would combine:

- `setVerticalFieldOfView(≈0.1–5)` to approximate a parallel projection (no true orthographic projection
  exists, §4);
- pitch 60° (2:1 dimetric, elevation 30°) or 54.74° (true isometric), at or below the default `maxPitch`;
- bearing locked at 45° plus 90° steps through `transformCameraUpdate`, with `dragRotate` and `touchPitch`
  disabled;
- an illustrated style through expressions.

**(ii) A custom Canvas2D renderer** (or SVG) that projects the real footprints with an isometric transform
and draws prisms in painter's order. Ground polygons, markers, labels, pan/zoom, hit-testing and the
route overlay are all its own.

| Criterion                                                | (i) MapLibre, low FOV                                                                                                                                                                                                        | (ii) Canvas2D renderer                                                                                                                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fidelity to the isometric look                           | Partial. One colour per prism, no per-face tones, no edge strokes. A tiny FOV is only _near_-parallel, and its behaviour at 0.1° (camera about 573 viewport heights away, depth precision, label placement) is **untested**. | **Full.** Exact parallel projection, three face tones from a fixed light, crisp edges, diamond key markers, styled legend.                                                                                |
| Geographic truth                                         | Same real footprints and heights.                                                                                                                                                                                            | Same real footprints and heights. Projection is exact (equirectangular metres → affine). Inverse projection to the ground plane is exact, which supports picking a point on the map.                      |
| Performance (about 300 buildings + 400 basemap features) | GPU-friendly, but needs WebGL2 and the about 291 kB-gzip MapLibre chunk.                                                                                                                                                     | Small scene: today 137 prisms (1,433 wall faces, about half facing the viewer) plus 214 campus basemap features. A static image is cached and pan/zoom transforms the cached bitmap (§6.6). Must meet §9. |
| Works without WebGL                                      | No.                                                                                                                                                                                                                          | **Yes.** Today's no-WebGL fallback is list-only; this gives those users a map.                                                                                                                            |
| Accessibility                                            | Same as the map: the canvas is opaque to assistive technology.                                                                                                                                                               | Same, so the **directory list is the accessible alternative** in both cases (§8.5). Simpler keyboard model (no rotation or pitch).                                                                        |
| Testability                                              | E2E on SwiftShader only.                                                                                                                                                                                                     | Projection, depth order, hit-testing and label collision are **pure functions**, unit-tested in Vitest/jsdom without WebGL. E2E stays deterministic.                                                      |
| Bundle                                                   | No new code, but requires the MapLibre chunk.                                                                                                                                                                                | New chunk, budget **≤ 25 kB gzip**, with no MapLibre import. It can render before or without MapLibre.                                                                                                    |
| Build effort                                             | Low.                                                                                                                                                                                                                         | Medium (spec below).                                                                                                                                                                                      |

**Decision D4: option (ii), Canvas2D.** It is the only option that delivers the illustrated parallel
look, works without WebGL, and is testable without a GPU. The scene is small enough that a well-cached
Canvas2D renderer should meet mid-range phone budgets; §9 makes that a gated, measured claim rather than an
assumption. **SVG** was considered: it is equally exact and gives free DOM hit-testing, but about 2,000
path nodes make pinch-zoom on phones less predictable and give up bitmap caching. The scene graph is kept
renderer-agnostic so an SVG or print export can be added later. **Option (i) remains the fallback plan** if
(ii) misses its budgets. In that case a one-day spike must first verify behaviour at small FOV.

### 6.2 Scope of the isometric overview

- **Prisms:** campus buildings only (directory-eligible, §7.1). Off-campus footprints are drawn **flat and
  muted** for context.
- **Ground:** boundary, landuse, green, pitch, parking, water, roads, service roads, paths and steps from
  `basemap.geojson`. All of it is real data. No decorative trees, cars or sculptures.
- **Overlays:** selection highlight, map-key markers, labels, the route (planned alternatives and the active
  one), and route endpoints.
- **Not shown:**
  - live GPS position and follow-me (§8.2);
  - points of interest (POIs) without a building, except gates and route endpoints. Facilities appear
    through their building's directory entry.

### 6.3 Projection (normative)

Inputs and constants:

- `[lon, lat]`; origin `O = APP_CONFIG.map.center`.
- Local metres: `e = (lon − O.lon) · kx`, `n = (lat − O.lat) · ky`, where `kx = cos(O.lat) · π/180 · R` and
  `ky = π/180 · R`, with `R = 6,371,008.8 m`. This matches `scripts/lib/geometry.ts`.
- **Do all centroid and area math in local metres.** Cross products on raw degrees lose precision badly.
  This was found and fixed while preparing this document.
- View rotation `θ = 45° + 90°·r` with `r ∈ {0,1,2,3}`. θ is the compass direction shown at the top of the
  screen.

Rotate into the view frame:

- `a = e·cos θ − n·sin θ` (screen-right)
- `b = e·sin θ + n·cos θ` (depth; larger is farther)

Project, with elevation `α = 30°` (2:1 dimetric) and scale `k` in px per metre:

- `sx = k·a`
- `sy = −k·(b·sin α + z·cos α)` (screen y points down)

Ground inverse (`z = 0`): `a = sx/k`, `b = −sy/(k·sin α)`, then rotate back. This is exact.

- **Heights are drawn 1:1** from `heightM`, with no exaggeration. Placeholder heights (`fallback`) get a
  dashed roof outline and a lighter tone, matching the 2D/3D legend semantics.
- **Default rotation:** choose the `r` whose projected campus extent best matches the viewport aspect ratio.
  The campus axis is about 63–77° from east (§1.3). The user can rotate in 90° steps; rotation is a
  per-viewer convenience kept in `localStorage`, wrapped in try/catch.
- **Scale range:** from "fit campus" to 8 px/m. At θ = 45° the projected building extent is about 1,262 × 1,110
  units at 1 px/m (`numbering.mjs`). A 390 px phone therefore opens at about 0.3 px/m and zooms in from there.

### 6.4 Draw order (normative)

1. **Per prism.** Draw only walls whose outward normal faces the viewer (`normal · viewDir < 0`). Sort them
   far to near by mid-point `b`, which matters for concave footprints. Draw the roof last. A flat roof can
   never be hidden by its own walls in a view from above.
2. **Between prisms.** Build a "behind" graph. For each pair whose intervals along `a` overlap, sample the
   overlap: A is _behind_ B when, at the sampled abscissas, A's nearest `b` is ≥ B's farthest `b`. Vertical
   prisms on a plane seen from above can only be hidden by prisms in front of them, so ordering by ground
   depth alone is correct whatever the heights. Then sort topologically, breaking ties by farthest `b` and
   then by `id`.
3. **True overlaps.** For footprints that share at least 1 m² of area (8 pairs today, §1.1), draw the lower
   `heightM` first, then the higher `minHeightM`. `building=roof` canopies are drawn after the prisms they
   cover.
4. **Cycles.** Break them by depth and **count them** in the debug hook. A unit test asserts that the
   real dataset has 0 cycles at all 4 rotations.

**Prototype result on today's data (`overlaps.mjs`):** 838 and 589 overlapping pairs (rotations 45/225° and
135/315°), **0 interleaved pairs and 0 nodes left in cycles** at all four rotations. The order is computed
once per rotation and cached.

### 6.5 Styling (palette roles)

`src/isometric/iso-theme.ts` defines `IsoThemeColors` for `light` and `dark`, as `src/map/theme-colors.ts`
does:

- surroundings and campus ground;
- green, pitch, parking, pedestrian and water;
- road band and casing, road centre dash, path, steps;
- three building face tones (`roofTone`, `wallLit`, `wallShade`), `edge`, and a placeholder-height variant;
- `context` (off-campus, flat);
- `selected`, `route`, `routeAlt`, `keyMarkerFill/Stroke/Text`, `labelText/Halo`.

The iso agent picks the values from `src/styles/tokens.css`, not from the illustration. A unit test checks
contrast with the existing `contrastRatio`: text at least 4.5:1, markers and route at least 3:1 against
their underlay.

- **Face shading:** tone = clamp(Lambert(face normal, fixed light), 3 steps), so the light is fixed relative to
  north and consistent with the 3D mode's map-anchored light.
- **Labels:**
  - Named buildings show their name.
  - Unnamed buildings show **only their key**. Never draw "Unnamed building" on the map.
  - Label priority is: selected > named > route endpoints > keyed buildings by descending area.
  - Collision uses a uniform screen grid of axis-aligned boxes.
  - Minimum 12 CSS px text.
  - Markers have at least a 24 × 24 CSS px hit target (WCAG 2.2, 2.5.8).

### 6.6 Rendering pipeline

1. **Scene build** (`scene.ts`), rerun only when the data or rotation changes. It projects everything at
   `k = 1` in view-frame units and precomputes:
   - faces and their tones;
   - the draw order;
   - roof label anchors at `z = heightM`;
   - ground polylines with widths in metres.

   It is a pure function and can be moved into a worker if §9 requires it.

2. **Static layer:** basemap and prisms are drawn into an `OffscreenCanvas` (falling back to a hidden
   `<canvas>`) at the current scale and a device-pixel ratio capped at 2.
3. **Dynamic layer:** a top canvas for selection, route, markers and labels.
4. **Gestures:**
   - Pan and pinch apply a CSS transform to the cached bitmaps, so a gesture frame does no path drawing.
   - When the gesture ends (or after 120 ms idle), both layers are redrawn at the new scale. That is one
     full draw per settle.
   - Wheel and `+`/`−` zoom about the cursor or the centre.
   - Arrow keys pan.
   - With reduced motion, transitions jump.
5. **Hit-testing:**
   - Test prisms in **reverse draw order** against the projected roof polygon and the visible wall quads.
   - Test markers before prisms, using their enlarged hit boxes.
   - If nothing is hit, invert to the ground plane: the result is a point (for "pick on map") or a click
     on empty space.
6. **Route overlay:** the route polyline is projected at `z = 0` and drawn **after** prisms with reduced
   opacity where it is hidden. This is a deliberate legibility choice: a route behind a tall block stays
   visible as a dashed line.

---

## 7. Building directory and numbering (`src/directory/`)

### 7.1 Eligibility (campus-only)

A building is directory-eligible when `kind === 'building'` and its campus status is `inside`, or
`straddling` with `insideFraction ≥ 0.5`.

- Today that is **137** buildings, identical to the current `on-campus` set (0 disagreements).
- 6 straddle (0.77–0.97).
- `osm:way/422738892` (0.41) is excluded.

Footprints of 20 m² or more, or any that is named or has a facility relation, receive a **map key**: **116**
today. The 21 smaller structures are listed under "Small structures" without a key.

### 7.2 Identity, names and facts

| Field                        | Rule                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                         | Existing source id (`osm:way/…`, `cur:…`). This is the stable identity everywhere (URL, favourites, relations).                                                                                                                                                                                 |
| `displayName`                | The existing pipeline label. 134 are "Unnamed building · N floors", and 53 of those say "10 floors". **Never invent names.** For unnamed buildings the UI title becomes `Building C4-07` (key first), with the honest pipeline label as the subtitle, so 53 identical labels can be told apart. |
| `officialBlock`              | Only from `data/curated/aliases.json` entries that cite a public source tying that label to **this exact footprint**. Currently **0**. "Block-37" for the Central Library has a cited source but no footprint, so it does not qualify.                                                          |
| `categoryId`                 | As the pipeline gives it (today 136 are `building`). Shown as "Use not recorded", not hidden.                                                                                                                                                                                                   |
| Footprint / location         | Footprint geometry by reference to `buildings.geojson`, and `location` = point-on-surface from `places.json`.                                                                                                                                                                                   |
| Height                       | `heightM`, `heightSource` and `levels`, always shown with the legend wording ("estimated from floor count", "placeholder").                                                                                                                                                                     |
| Facilities and organizations | Incoming `located_in` / `part_of` from `createFacilityDirectory().related(id)`. Today **1** campus building has a `located_in`. The empty state says "No facilities recorded for this building yet" and links to the report flow.                                                               |
| Routability                  | `isRoutablePlace(place)`: 124 of 137 today. Unroutable entries say so and offer "Show on map" only.                                                                                                                                                                                             |

### 7.3 Map keys (Decision D6)

**Format:** `<column letter><row number>-<two-digit sequence>`, for example `C4-07`.

- **Grid:** 200 m cells. Columns A, B, … run west to east; rows 1, 2, … run north to south. The origin is a
  **fixed config constant**, `APP_CONFIG.directory.gridOrigin = [75.6975, 31.2610]`: the manifest `bbox`
  `[75.6973474, 31.2457534, 75.7091258, 31.2607949]` rounded outward to 0.0005°. It is never derived at build
  time, so a boundary edit cannot reshuffle keys.
- **Cell:** taken from the building's point-on-surface.
- **Sequence within a cell:** Hilbert-curve order of the point-on-surface on a 1,024 × 1,024 grid over the
  `maxBounds` frame (cells of about 3.4 × 3.7 m), with ties broken by `id`. The prototype had **3 ties**, so the
  tie-break is required.
- **Measured on today's data** (`gridkeys-origin.mjs`):
  - a 6 × 9 grid (columns A–F), with **24** occupied cells for the 116 keyed buildings;
  - at most **13** per cell and a median of 3, so two digits are ample;
  - with all 137: at most 17 per cell.
- **Why geography and not plain sequence numbers.** In the prototype, the mean walking distance between
  consecutively numbered buildings was **83 m** in Hilbert order, 120 m in north-to-south row-major order,
  and 210 m in OSM-id order (`numbering.mjs`). Grid letters also let the overview draw a light reference
  grid, as street atlases do.
- **Why it cannot be mistaken for official numbers:**
  - It has a letter-digit-hyphen-digit shape, unlike the plain integers in the reference index.
  - It is drawn in a **diamond** glyph, not a circle.
  - Every surface says **"Map key"**, and the legend states: "Map keys are this app's own references. They
    are not official LPU block numbers."
  - Screen readers read it as "Map key C 4, 7".

**Stability rules:**

1. **Lock file.** Keys live in `data/curated/directory-keys.json`, which is committed:
   `{ version, gridOrigin, cellM, keys: { [buildingId]: key }, retired: { [key]: { id, retiredAt } } }`.
   `npm run data:build` **reads** it and never writes it. That keeps builds deterministic, as the manifest
   requires.
2. **New buildings.** A separate, explicit `npm run data:keys` assigns them the next free sequence in their
   cell. A new building is **appended**, not inserted, so no existing key moves. `data:validate` fails if an
   eligible, keyable building has no key. Until keys are assigned, those buildings show without a key and a
   quality warning is raised.
3. **Removed buildings.** Their keys are **retired**, never reused within a lock `version`.
4. **Replaced OSM ways** (new id, same building). The old key carries over when the new footprint overlaps
   the retired one with intersection-over-union ≥ 0.5. The transfer is recorded in the lock file and reported
   in the quality report.
5. **Renumbering** (to restore perfect Hilbert order after many appends) is a deliberate `data:keys --renumber`
   that bumps `version`. It is listed in the changelog, and saved favourites keep working because they store
   `id`, not the key.
6. Without a lock file, a simple recompute after deleting one building in the middle shifted **57 of 116**
   keys (`numbering.mjs`). That is why rules 1–3 are needed.

### 7.4 Service API (proposed)

```ts
// src/directory/types.ts
export type CampusStatus = 'inside' | 'straddling' | 'outside';
export type DirectoryKey = `${string}${number}-${string}`; // validated by DIRECTORY_KEY_RE
export const DIRECTORY_KEY_RE = /^[A-Z][1-9]\d?-\d{2}$/;

export interface OfficialBlockLabel {
  label: string; // exactly as the cited source prints it
  sourceId: string; // manifest source id
  sourceRef: string; // URL or document reference
}

export interface BuildingDirectoryEntry {
  id: string;
  key: DirectoryKey | null; // null = small structure or not yet keyed
  title: string; // name ?? `Building ${key}` ?? displayName
  displayName: string; // honest pipeline label
  name: string | null;
  officialBlock: OfficialBlockLabel | null;
  categoryId: string;
  location: LngLat;
  cell: string | null; // 'C4'
  areaM2: number;
  heightM: number;
  heightSource: HeightSource;
  levels: number | null;
  campusStatus: CampusStatus;
  insideFraction: number;
  facilityIds: string[]; // from located_in / part_of
  organizationIds: string[];
  routable: boolean;
  provenance: Provenance;
}

export interface BuildingDirectory {
  readonly entries: readonly BuildingDirectoryEntry[]; // sorted by key, then unkeyed by title
  get(id: string): BuildingDirectoryEntry | undefined;
  byKey(key: string): BuildingDirectoryEntry | undefined;
  inCell(cell: string): readonly BuildingDirectoryEntry[];
  groups(by: 'cell' | 'category'): ReadonlyMap<string, readonly BuildingDirectoryEntry[]>;
}

export function createBuildingDirectory(input: {
  buildings: BuildingsFile;
  places: Place[];
  relations: Relation[];
}): BuildingDirectory;
```

Search integration: the key and the official block label are added as **aliases** in the search docs
(`src/search/docs.ts`), so typing `C4-07` finds the building. Exact key matches rank first.

### 7.5 Directory UI

- New panel id `'directory'` (desktop `SidePanel`; mobile `BottomSheet` with snaps peek, half and full).
- Rows show the key diamond, title, honest subtitle, height badge (estimated or placeholder), facility count,
  and a routable or "not routable" badge.
- Groups are by grid cell (default) or category.
- The same panel serves all three modes, and is the **accessible alternative** to every canvas (§8.5).

---

## 8. Mode switching (Decision D7)

### 8.1 State model

```ts
// src/app/store/types.ts (MapSlice is replaced by ViewSlice; mode3d becomes a derived selector during migration)
export type ViewMode = 'realistic3d' | 'isometric' | 'standard2d';
export type MapViewMode = Exclude<ViewMode, 'isometric'>;

export interface IsoView {
  center: LngLat;
  pxPerMetre: number;
  rotation: 0 | 1 | 2 | 3;
}

export interface ViewSlice {
  viewMode: ViewMode;
  /** The map mode to return to (e.g. when navigation starts from the overview). */
  lastMapMode: MapViewMode;
  iso: IsoView | null; // per-mode camera, not shared
  showLabels: boolean;
  visibleGroups: ReadonlySet<LayerGroupId>; // shared, unchanged
  setViewMode(mode: ViewMode, opts?: { reason?: 'user' | 'deep-link' | 'navigation' | 'fallback' }): void;
  setIsoView(v: IsoView): void;
}

/** Back-compat for existing callers: */
export const selectMode3d = (s: AppState) => s.viewMode === 'realistic3d';
```

**Shared across modes:**

- selection (`selectedPlaceId`), search, favourites and recents;
- route endpoints, alternatives and the active alternative;
- panels, theme, labels and layer groups (the overview honours the groups it draws).

**Per mode:** the camera. On a switch, the new mode is centred on the same ground point at an equivalent
scale. MapLibre's metres per pixel at the current latitude and zoom maps to `pxPerMetre`, and back. The
selection stays highlighted.

**Shared controller.** `IsoController` implements the existing `MapController` interface:

- `flyTo`, `fitCoordinates`, `resetView`, `zoomIn`/`zoomOut` and `setPadding` work as usual;
- `resetNorth` resets rotation to the default `r`;
- `follow` is a **no-op**.

This lets `MapStage`'s focus-request logic move into a `ViewStage` that mounts `MapStage` or `IsoStage`.

### 8.2 Capability matrix and unsupported interactions

| Interaction                                  | Realistic 3D | Isometric                             | Standard 2D |
| -------------------------------------------- | ------------ | ------------------------------------- | ----------- |
| Select building or place, details            | ✓            | ✓ (buildings, gates, route endpoints) | ✓           |
| Search, directory, favourites                | ✓            | ✓                                     | ✓           |
| Plan a route, show alternatives              | ✓            | ✓ (overlay)                           | ✓           |
| Pick an endpoint on the map                  | ✓            | ✓ (building, or exact ground point)   | ✓           |
| **Live GPS position, navigation, follow-me** | ✓            | **✗**                                 | ✓           |
| Rotate / pitch                               | free         | 90° steps / fixed                     | ✗           |
| Needs WebGL2                                 | yes          | **no**                                | yes         |

How unsupported interactions are communicated:

- **Starting navigation while in the overview** switches to `lastMapMode` with the reason `'navigation'` and
  announces it through the existing live region: "Live navigation uses the map view. Switched to 2D map."
- While navigation is active, the overview option in the mode switcher is `aria-disabled="true"` with the
  description "Not available during live navigation". It is never silently hidden.

### 8.3 URL and deep links

- `?view=3d|iso|2d` is parsed with the same validation style as `?place=` and written with
  `history.replaceState`. Unknown values are ignored.
- Without the parameter, the device default applies (unchanged: 3D at ≥ 768 px, otherwise 2D). The overview
  becomes the phone default **only after** §9 budgets pass on a real mid-range device.
- `?view=iso&place=osm:way/…` opens the overview centred on that building with it selected.
- Without WebGL2, `view=3d` and `view=2d` fall back to `iso` (not to the list) and announce the fallback.
- Rotation and scale are not put in the URL. Rotation is a per-viewer preference.

### 8.4 Layouts

- **Desktop:** a mode switcher (a segmented control with three options, labelled "3D", "Overview" and "2D")
  goes into `MapControls` and replaces the 3D toggle button. Directory and place details stay in the
  `SidePanel`. The overview legend docks bottom-left inside the canvas area.
- **Mobile:** the switcher moves into the map controls stack. The directory is a `BottomSheet` panel:
  - Peek shows the selected building, or "137 campus buildings · Browse" when nothing is selected.
  - Half and full show the grouped list.
  - Map padding (`map-padding.ts`) feeds `IsoController.setPadding` so fits avoid the sheet.

### 8.5 Accessibility

- Each canvas has `role="img"` with a summary label and `aria-describedby` pointing at a visually hidden
  instruction: "Use the Directory for a full list of buildings." It is keyboard-focusable: arrows pan,
  `+`/`−` zoom, `R` rotates (overview only), and `D` opens the directory. The visible map-controls group
  repeats these actions.
- The directory list (roving tabindex) is the **equivalent of the canvas**. Every building drawn is listed,
  and selecting a row highlights and frames it in any mode.
- Mode changes are announced, and focus stays on the switcher.
- Reduced motion turns all transitions into jumps (mode easing, overview pan and zoom animations).
- Overview colours are contrast-tested (§6.5). Face tones must not be the only cue: selection also gets a
  thicker outline and its marker.
- Axe scans (`tests/e2e/accessibility.spec.ts`) cover the overview and the directory sheet.

---

## 9. Performance budgets and how to measure them (Decision D8)

### 9.1 Budgets

These are **targets**, as with `APP_CONFIG.performance`. They are not results; record the measurements in
`docs/PERFORMANCE.md`.

| Metric                                                  | Budget                                                  | Gate                        |
| ------------------------------------------------------- | ------------------------------------------------------- | --------------------------- |
| Isometric chunk (gzip)                                  | ≤ 25 kB; no `maplibre-gl` import                        | CI (build check)            |
| Scene build (data → scene, one rotation)                | ≤ 30 ms unthrottled; ≤ 120 ms at 4× CPU throttle        | CI perf project             |
| Full static redraw                                      | ≤ 8 ms unthrottled; ≤ 25 ms at 4×                       | CI perf project             |
| Gesture frames (pan/pinch over the cached bitmap)       | rAF interval p95 ≤ 20 ms at 4×; ≤ 2 % of frames > 50 ms | CI perf project             |
| Hit-test                                                | ≤ 1 ms at 4×                                            | unit (bench) + CI           |
| Mode switch → first overview frame (chunk cached)       | ≤ 300 ms at 4×                                          | CI perf project             |
| JS heap growth after opening the overview (after GC)    | ≤ 8 MB                                                  | CI perf project             |
| Realistic 3D, rAF p95 during a scripted 2 s camera move | ≤ 33 ms on the reference mid-range Android phone        | **Device only**             |
| Realistic 3D, extruded features rendered on phones      | ≤ 150 (campus layer only)                               | CI (feature count via hook) |

A 4× CDP CPU throttle on the documented test machine is the **proxy** for a mid-range phone. The host CPU
must be recorded, as `docs/PERFORMANCE.md` already does. Canvas2D cost is CPU-bound, so this proxy is
meaningful for the overview. **It is not meaningful for WebGL frame timings**, because headless Chromium
renders WebGL on SwiftShader (`playwright.config.ts`). Those must be measured on a real device: Android
Chrome over USB through `chrome://inspect`, or Playwright `connectOverCDP`.

### 9.2 Harness

Add a `perf` Playwright project, excluded from the default run:

- The perf project sets `testMatch: /.*\.perf\.spec\.ts/`.
- The existing five projects add `testIgnore: /.*\.perf\.spec\.ts/`, because `testDir` is `tests/e2e`.
- Run it with `npx playwright test --project=perf`; it writes JSON to `test-results/perf/`.
- Use Chromium only, because CDP is required.

```ts
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await cdp.send('Performance.enable');
await cdp.send('HeapProfiler.collectGarbage');
const heapBefore = (await cdp.send('Performance.getMetrics')).metrics.find(
  (m) => m.name === 'JSHeapUsedSize',
)!.value;

// rAF frame-interval recorder (installed before the interaction)
await page.evaluate(() => {
  const t: number[] = [];
  let last = performance.now();
  const tick = (now: number) => {
    t.push(now - last);
    last = now;
    if ((window as any).__REC__) requestAnimationFrame(tick);
  };
  (window as any).__REC__ = t;
  requestAnimationFrame(tick);
});
// Drive the camera through the UI (keyboard pan/zoom, or a scripted drag with page.mouse),
// never through write access to the read-only test hooks.
// ... then stop, read __REC__, compute p50/p95/max and the share of frames > 50 ms.
```

For the overview's internal timings, the e2e-only hook `window.__ATLAS_ISO__` (installed with `?e2e=1`, read-only
like `__ATLAS_MAP__`) exposes:

- `getFrameStats()`: last scene-build ms, last full-redraw ms, hit-test ms, cycle count;
- `getView()`, `getSelectedId()`, `getRouteCoordinateCount()`;
- `projectToViewport(lngLat, z?)`, `getDrawOrder()`, `getKey(id)`.

Use `performance.mark`/`measure` around scene build and redraw so the numbers also show in DevTools traces.

**Run** the perf project with `contextOptions: { reducedMotion: 'no-preference' }` so animations happen. The
main config forces `reduce` (`playwright.config.ts`).

### 9.3 Fallbacks

| Situation                       | Fallback                                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| Realistic 3D too slow           | Watchdog hides the context layer, then suggests the overview (toast). It never switches by itself. |
| WebGL context lost              | Standard 2D, then the overview (not the list).                                                     |
| No WebGL2                       | Overview + directory. The list layout stays available.                                             |
| Overview misses gesture budgets | Lower the DPR cap to 1.5, then 1; hide labels during gestures; move the scene build to a worker.   |
| No `OffscreenCanvas`            | Hidden `<canvas>` cache.                                                                           |

---

## 10. Risks and open questions

- **Data gaps dominate the user experience.** OSM has no hostels or canteens on campus (lead's finding,
  consistent with §1). 134 of 137 campus buildings are unnamed, 0 have measured heights, and 1 has a facility.
  The overview will look emptier than the illustration. That is honest and intended.
- **Microsoft building footprints** (ODbL): 99 unmatched footprints inside the boundary are **leads only**.
  They have no height (−1) and no names, are machine-learned, and are of unknown date. If they are ever
  imported, they must carry `geometrySource: 'ms-ml-footprint'`, a distinct "unverified footprint" style, no
  key until surveyed, and attribution in the manifest. Not in scope for this phase.
- **Quality flags for the data agent:**
  - 2 footprints with `building:levels = 0.2`;
  - the nested footprint `osm:way/675395630` inside `osm:way/422437890`;
  - the 8 true overlaps (§1.1).
    These cause z-fighting in 3D and need explicit ordering in the overview.
- **Open questions:**
  - Should the overview become the phone default once §9 passes? (Proposed: yes, pending a device test.)
  - Should flat off-campus footprints appear in the overview at all? (Proposed: yes, muted, so the Law Gate
    area still has context.)

---

## 11. Module and file plan, ownership and data contract

### 11.1 Ownership (parallel work packages)

| Area                                                                                                                                                                                                                                                                                  | Owner                                | Notes                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/data/schema.ts`, `src/app/store/types.ts`, `src/app/store/map-slice.ts` → `view-slice.ts`, `src/app/deep-link.ts`, `src/components/layout/*`, `src/components/map-controls/MapControls.tsx`, `src/config/index.ts`                                                               | **Integration lead** (single writer) | Shared contracts. Other agents propose diffs to the lead.                                                                                      |
| `scripts/lib/membership.ts` (insideFraction, status), `scripts/lib/directory-keys.ts`, `scripts/assign-directory-keys.ts` (`npm run data:keys`), `scripts/lib/build-buildings.ts` additions, `scripts/lib/validate.ts` checks, `data/curated/directory-keys.json`, `src/directory/**` | **Data agent**                       | Builds stay deterministic; only `data:keys` writes the lock.                                                                                   |
| `src/buildings3d/layers.ts` (two-layer LOD), `src/buildings3d/lighting.ts`, `src/buildings3d/lod.ts`, `src/buildings3d/models/{registry,maybe-add-model-layer}.ts`, `src/map/style.ts` (light), `src/map/MapView.tsx` (pixelRatio, watchdog)                                          | **Realistic-3D agent**               | No `three` dependency.                                                                                                                         |
| `src/isometric/{projection,depth-order,scene,draw,hit-test,labels,markers,iso-theme,iso-controller,test-hooks}.ts`, `IsoView.tsx`, `IsoStage.tsx`, `src/components/directory/*` (panel UI)                                                                                            | **Isometric agent**                  | Must not import `maplibre-gl`. Consumes `src/directory` and `src/data` only.                                                                   |
| Tests                                                                                                                                                                                                                                                                                 | Each owner for its own code          | Unit tests in `tests/unit/{isometric,directory,buildings3d}/**`; e2e in `tests/e2e/overview.spec.ts`; perf in `tests/e2e/perf/*.perf.spec.ts`. |

**Interface freeze, in order:**

1. The §11.3 schema and the `BuildingDirectory` API (§7.4), owned by data + lead.
2. `ViewSlice` (§8.1), owned by the lead.
3. After that, the 3D and isometric agents work independently.

The isometric agent can start right away on projection, depth order and drawing, using the current
`buildings.geojson` (the `campusZone` filter is available today).

### 11.2 Pipeline outputs

- `buildings.geojson` gains the flat properties below.
- `places.json` building places gain `directoryKey` and `officialBlock`.
- The manifest gains `counts['directory:eligible']`, `counts['directory:keyed']` and
  `counts['buildings:straddling']`.
- The quality report flags levels below 1, true overlaps, nested footprints and unkeyed eligible buildings.
- Bump `DATA_SCHEMA_VERSION` to 2 and the service-worker `cache.dataCache` with it.

### 11.3 Data contract additions (TypeScript)

GeoJSON properties are kept **flat and primitive**. MapLibre expressions and its worker-side tiling of
GeoJSON work best with scalar properties; nested objects would have to be stringified.

```ts
// src/data/schema.ts (proposed; zod schemas mirror these)
export type GeometrySource =
  | 'osm' // OpenStreetMap way/relation (all 535 today)
  | 'curated-survey' // dated physical survey in data/curated
  | 'ms-ml-footprint'; // Microsoft ML footprint: lead only, never keyed until surveyed

export type FidelityLevel =
  | 'footprint' // outline only; height is a placeholder (heightSource 'fallback')
  | 'footprint+levels' // building:levels × metresPerLevel (estimate)
  | 'footprint+height' // tagged height (measured by a mapper)
  | 'surveyed' // dated survey of footprint + height
  | 'model'; // a ModelEntry exists (realistic 3D only)

export type CampusStatus = 'inside' | 'straddling' | 'outside';

export interface BuildingPropsV2 {
  // existing (unchanged)
  id: string;
  name: string | null;
  displayName: string;
  levels: number | null;
  heightM: number;
  minHeightM: number;
  heightSource: 'osm-height' | 'osm-levels-estimate' | 'fallback';
  categoryId: string;
  /** Kept for compatibility: 'on-campus' iff campusStatus !== 'outside' && insideFraction >= 0.5. */
  campusZone: 'on-campus' | 'off-campus-nearby';

  // provenance / fidelity
  geometrySource: GeometrySource;
  sourceRef: string; // e.g. 'way/422437885'
  fidelityLevel: FidelityLevel;

  // campus membership (computed against boundary.geojson)
  campusStatus: CampusStatus;
  /** Share of footprint area inside the boundary, 0–1, 2 decimals. */
  insideFraction: number;
  membershipMethod: 'grid-sample' | 'polygon-clip';

  // geometry helpers (avoid recomputation in both renderers)
  areaM2: number;
  /** Point-on-surface used for keys, labels and routing anchors. */
  anchorLon: number;
  anchorLat: number;

  // tag pass-through (null when untagged; never inferred)
  roofShape: string | null; // OSM roof:shape
  roofMaterial: string | null; // OSM roof:material
  roofColour: string | null; // OSM roof:colour (validated CSS colour or null)
  roofLevels: number | null; // OSM roof:levels
  buildingMaterial: string | null; // OSM building:material
  buildingColour: string | null; // OSM building:colour
  isBuildingPart: boolean; // OSM building:part present

  // directory
  directoryKey: string | null; // from data/curated/directory-keys.json
  directoryCell: string | null; // 'C4'
  officialBlockLabel: string | null; // only from cited curated aliases
  officialBlockSourceId: string | null;
}

/** data/curated/directory-keys.json */
export interface DirectoryKeysLock {
  $comment: string;
  version: number;
  gridOrigin: [lon: number, lat: number]; // must equal APP_CONFIG.directory.gridOrigin
  cellM: number; // 200
  keys: Record<string, string>; // buildingId → key
  retired: Record<string, { id: string; retiredAt: string; replacedBy?: string }>;
}

/** Curated alias extension for official block labels (data/curated/aliases.json entries). */
export interface OfficialBlockAlias {
  target: string; // exact footprint id
  officialBlock: string; // as printed by the source
  source: { name: string; url: string; retrievedAt: string };
  check: 'official-publication' | 'physical-survey';
}
```

Config additions (`src/config/index.ts`, owned by the lead):

```ts
directory: { gridOrigin: [75.6975, 31.261], cellM: 200, minKeyAreaM2: 20, minInsideFraction: 0.5 },
isometric: { elevationDeg: 30, maxPxPerMetre: 8, dprCap: 2 },
```

---

## 12. Reproduce the measurements

```sh
S="C:/Users/shubh_qypqua6/AppData/Local/Temp/claude/c--Users-shubh-qypqua6-Documents-LPU/e111b9d0-0d61-4344-b92c-327d477048d2/scratchpad/geo"
R="C:/Users/shubh_qypqua6/Documents/LPU/lpu-campus-atlas"
node "$S/iso3d/analyze.mjs" "$R" "$S/iso3d/campus-buildings.json"        # §1.1, §1.3
node "$S/iso3d/relations.mjs" "$R"                                          # §1.3 relations
node "$S/iso3d/tags.mjs" "$R/data/raw/osm/campus-bbox.osm"                  # §1.2
node "$S/iso3d/numbering.mjs" "$S/iso3d/campus-buildings.json"              # §7.3 ordering and stability
node "$S/iso3d/gridkeys-origin.mjs" "$S/iso3d/campus-buildings.json" "$R"   # §7.3 grid statistics
node "$S/iso3d/overlaps.mjs" "$S/iso3d/campus-buildings.json"               # §6.4 draw order and cycles
node "$S/count.mjs" "$S/ms.csv.gz" "$S/iso3d/ms-unmatched-recheck.json"     # §1.4 (the lead's script)
```

The scratch folder is temporary. If the numbers need to last, the data agent should port `analyze.mjs` checks
into `scripts/lib/quality.ts`, so that `quality-report.json` carries them.
