# Gate 3 bake-off: how to draw owner-placed studio models in 3D

**Date:** 2026-10-24. **Dataset:** 62e807e6d444 (schema v2, campus-only). **Code:** working tree on top of de688b4 (not yet committed).

## Decision

Adopt the raw-WebGL2 custom layer (path b) for studio models in Realistic 3D, guarded at runtime, with the plain fill-extrusion (path a) as the automatic fallback. OSM buildings stay on fill-extrusion (D1 and D2 unchanged).

Every criterion measurable on this machine passes: chunk size, the layer's CPU cost, context-loss recovery, picking, lighting parity and buffer reuse.

Frame time is only partly measurable here, because headless Chromium draws WebGL with SwiftShader on the CPU:

- Under a 4× CPU throttle, every path is above the 33 ms device budget, including the scene with no studio models at all.
- Against the extrusion path, the custom path tied at p50 in all runs, and at p95 in 3 of 4 viewport runs.
- In the 4th run (mobile, final run) it was one 16.7 ms frame step slower at p95: 83.4 ms against 66.8 ms.

So the custom layer ships guarded. The watchdog drops it to the extrusion fallback with a notice, and watchdog-custom.json shows this works under throttle: state fallback, reason slow-frames, notices studio-slow then suggest-overview.

The device check required by D8 is still open. If it shows that studio models push a mid-range phone above 33 ms p95 when the same scene without them does not, switch phones to the extrusion representation. That is one condition in attachRealistic3D, not a renderer change.

## 1. What was compared

- **(a)** fill-extrusion of the derived footprint × body height: a flat roof in the studio colour class.
- **(b)** the WebGL2 custom layer drawing the generated StudioMesh:
  - roof shapes and procedural windows;
  - a map-anchored light;
  - a depth buffer shared with MapLibre.
- **(c)** the isometric overview (Canvas2D) drawing the same mesh faces. This is the isometric agent's code, used unmodified.
- **base**: no studio models.

The map paths run the app's own loadCampusData, buildMapStyle, poiCollection and pickPlaceId. They also run attachRealistic3D, attached in every map path as MapView does; only (b) receives models.

**Scenario: 50 instances.** Four real footprints, each given a footprint-prism model:

| Key | Footprint                                          | Why chosen                                                               | Caveat                                       |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------- |
| A   | osm:way/354755644 "Lovely Institute of Technology" | Large academic: 1,574 m², 7 floors mapped                                | Data category is building (use not recorded) |
| B   | osm:way/422548297                                  | Non-rectangular: 44 vertices, 5,505 m², 10 floors                        | —                                            |
| C   | osm:way/1550425052                                 | Canteen STAND-IN: the only campus footprint with category food, 1,402 m² | Not confirmed as a canteen                   |
| D   | osm:way/422437895                                  | Hostel STAND-IN: a 46 × 19 m slab, 10 floors                             | Nothing in the data says it is a hostel      |

Plus 46 starter-library models on a 70 m grid of open campus ground. They are harness-only fixtures: never published, and not buildings.

Totals: 39 unique meshes (11 placements reuse a buffer), 3,946 triangles, 376,076 bytes of GPU buffers.

## 2. Method

**Machine and versions:**

- Intel Core 7 240H (16 logical CPUs), 15.7 GB RAM, Windows 11 10.0.26300;
- Node 24.19.0, Playwright 1.64.1, Chromium 156.0.8078.4 headless (SwiftShader);
- other agents' processes were running on the same machine.

**Frame timing:**

- A 90° orbit over 4 s (easeTo, linear), run twice after a 1.5 s warm-up.
- Camera: zoom 15.9, pitch 55°, bearing −20°, with all models in view.
- rAF intervals recorded in the page; CDP throttle 4×.
- Watchdog disabled (watchdog=off) so it cannot swap renderers mid-measurement.

**Other measures:**

- Layer CPU is the custom layer's own render() time per frame.
- Heap is JSHeapUsedSize after a forced GC.
- Overview: a real pointer-drag pan (its gesture path), then "Rotate view right" for a scene build and full redraw at 4×; timings from **ATLAS_ISO**.
- Picking: frame each instance at zoom 17.5. Project the point at 60 % of its body height, above an interior point of its footprint, using MapLibre's own matrix (captured by a probe custom layer, which also checks the placement math in a real browser). Click it with page.mouse. Repeated top-down for the map paths.
- Context loss: WEBGL_lose_context, 300 ms, restore, then a second loss.
- Chunks: vite build, gzip level 9.

**To reproduce:**

```
BAKEOFF_OUT=<tmp> npx vite build -c docs/research/renderer-bakeoff/harness/vite.config.ts
npx playwright test -c docs/research/renderer-bakeoff/harness/playwright.config.ts   # port 4471
BAKEOFF_THROTTLE=1 npx playwright test -c docs/research/renderer-bakeoff/harness/playwright.config.ts --grep "desktop (baseline|extrusion|custom): frames"
node docs/research/renderer-bakeoff/harness/summarize.mjs
BAKEOFF_CHUNKS_OUT=<tmp> npx vite build -c docs/research/renderer-bakeoff/harness/chunks.config.ts
```

## 3. Results

**Verdicts:**

| Criterion                  | Budget used                                              | Result                                                                                                                                                                     | Verdict                  |
| -------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Lazy chunk                 | ≤ 25 kB gzip (the overview's chunk budget, §9.1)         | 17.1 kB gzip (runtime-*.js, 45.9 kB raw); the renderer's own code is ~5.6 kB, the rest is the shared mesh generator and studio schema                                      | pass                     |
| Always-loaded cost         | reported                                                 | map chunk 287.9 → 291.3 kB gzip (HEAD vs working tree, gzip -9); AppShell +0.2 kB                                                                                          | reported                 |
| Layer CPU p95 at 4×        | ≤ 5 ms                                                   | 4.5 ms desktop, 3.4 ms mobile; 0.6 ms at 1×                                                                                                                                | pass                     |
| Frame time vs (a), 4×      | p95 within one 16.7 ms step                              | p50 equal everywhere; p95 equal 3 of 4, +16.6 ms once                                                                                                                      | pass (at the limit once) |
| Absolute device frame time | D8                                                       | not measurable here                                                                                                                                                        | **open**                 |
| Context loss               | map recovers; studio buildings stay visible and pickable | fallback 323 ms after loss; custom layer back 882 ms after restore; a 2nd loss stays on fallback with notice studio-unavailable; picks 3/4 both times (C is occluded by D) | pass                     |
| Picking                    | 100 % unoccluded                                         | top-down 50/50; tilted 43/50, misses identical to (a)                                                                                                                      | pass                     |
| Lighting parity            | same face order                                          | yes; custom is 4–12 RGB levels darker (extrusions are 0.92 opaque over a light ground)                                                                                     | pass                     |
| Memory                     | reported                                                 | JS heap +1.2 MB (11.2 vs 10.0 MB); 376 kB GPU buffers                                                                                                                      | reported                 |
| Buffer reuse               | no duplicate uploads                                     | 50 instances → 39 uploads                                                                                                                                                  | pass                     |

**Frames, final run (rAF ms at 4×):**

| Viewport           | Path      | Frames |  p50 |  p95 |   max | > 50 ms | Layer CPU p95 | Heap MB |
| ------------------ | --------- | -----: | ---: | ---: | ----: | ------: | ------------: | ------: |
| desktop 1440×900   | baseline  |    147 | 50.0 | 66.7 |  83.3 |  43.5 % |             — |    10.0 |
| desktop            | extrusion |    126 | 66.7 | 83.3 |  83.4 |  75.4 % |             — |    10.0 |
| desktop            | custom    |    114 | 66.7 | 83.4 | 100.0 |  96.5 % |           4.5 |    11.2 |
| mobile 390×844 @2× | baseline  |    135 | 66.6 | 66.8 |  83.4 |  65.2 % |             — |     9.5 |
| mobile             | extrusion |    136 | 66.6 | 66.8 |  83.4 |    61 % |             — |     9.4 |
| mobile             | custom    |    119 | 66.7 | 83.4 |  83.4 |  89.9 % |           3.4 |    10.6 |

An earlier run, before the controller was attached in paths (a) and base:

- desktop p50/p95 was 66.7/100 ms for all three paths;
- mobile was 66.7/83.3–83.4 ms for (a) and (b);
- the share of frames over 50 ms was 85.7 % for (b) against 85.2 % for (a).

Intervals fall on 16.7 ms steps. A one-step difference is within the noise between runs on a shared machine. The higher share of frames over 50 ms in the final run is the only sign of extra cost from (b).

Unthrottled reference, desktop (rAF p50/p95): baseline 49.9/50.1, extrusion 33.4/50.1, custom 49.9/50.1 ms. Layer CPU p95 0.6 ms.

**Overview, path (c)** (1,611 faces = 131 buildings + 50 models):

| Viewport | Gesture rAF p95 at 4× | Scene build | Full redraw | Scene build at 4× (rotate) | Full redraw at 4× |
| -------- | --------------------: | ----------: | ----------: | -------------------------: | ----------------: |
| desktop  |               16.8 ms |     27.6 ms |     11.0 ms |                   173.8 ms |           28.6 ms |
| mobile   |               16.8 ms |     28.4 ms |     10.9 ms |                   190.0 ms |           11.3 ms |

Against the overview's own budgets: gesture frames pass (≤ 20 ms). With 50 models added, the scene build at 4× is over its 120 ms budget, and the desktop full redraw is over 25 ms.

Overview picking: 47/50; the 3 misses each returned the building drawn in front. The overview's own code is 16.7 kB gzip with React, zod and the app's startup modules external.

**Screenshots** (docs/research/renderer-bakeoff/screenshots/):

- desktop-{extrusion,custom,iso}-{overview,A,B,C,D}.jpg
- mobile-{baseline,extrusion,custom,iso}-overview.jpg and desktop-baseline-overview.jpg
- desktop-custom-after-context-restore.jpg and desktop-custom-fallback-after-second-loss.jpg
- desktop-detections-layer.jpg

What they show (I looked at them):

- (b) puts every model on its footprint at true scale; B's 44-vertex outline and A's outline match the OSM footprints.
- Gable, hip and shed roofs, U-shaped courtyards and canopies are visible. Windows read as façade at zoom 18 and blend to a flat tone at the overview zoom without shimmer.
- (a) draws the same footprints as blue-grey blocks, clearly distinct from the beige OSM buildings.
- C sits north of D, so from bearing −20° D hides most of C (this is also why C is a tilted-picking miss).
- After a restore, (b) redraws the scene. After the second loss, studio buildings show as blue-grey extrusions and stay pickable.
- The detections layer is flat and dashed, with hollow rings for Google points. The attribution reads: "© OpenStreetMap contributors (ODbL) | Building footprints © Microsoft (Global ML Building Footprints), CDLA Permissive 2.0 · Google Open Buildings (v3), used under the Open Database License 1.0". Hiding the layer removes both names.

**Lighting check** (RGB, extrusion / custom):

- south: 145,136,121 / 136,127,113
- west: 125,118,105 / 115,108,95
- north and east: 99,93,84 / 87,81,72
- roof: 204,191,170 / 201,187,166

The first shader version had the north–south sign of the light inverted, and this check caught it.

## 4. Engineering notes the bake-off produced

- Front-face winding is read from the sign of the live matrix's determinant. The first version drew every model inside-out.
- Precision: vertices are in local metres and the matrices are combined in float64. Error is < 0.05 px at 300 m from the origin at zoom 19; float32 mercator vertices would be > 1 px off (unit test).
- MapLibre does not restore custom layers with the style, so the controller re-adds its layer once after the style reloads.
- Re-exporting the controller from the buildings3d barrel put +2.9 kB gzip into the startup AppShell chunk. It is now imported by path.

## 5. Picking

| Path      | Tilted | Top-down | Tilted misses                                                      |
| --------- | -----: | -------: | ------------------------------------------------------------------ |
| extrusion |  43/50 |    50/50 | C, L6, L8, L9, L11, L30, L31 — each returned the building in front |
| custom    |  43/50 |    50/50 | identical (same invisible footprint extrusion)                     |
| overview  |  47/50 |      n/a | C, L21, L32 — each returned the building drawn in front            |

## 6. Open items

1. Device frame time (D8), via Android Chrome over USB or connectOverCDP, with 0 and with 50 models.
2. The overview's scene build at 4× and its desktop redraw exceed budget with 50 models (isometric agent).
3. docs/PERFORMANCE.md should link this report (not mine to edit).
