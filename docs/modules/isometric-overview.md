# Module: isometric overview and building directory panel

**Paths:**

- `src/isometric/`: the Canvas2D overview (Decision D4 in `docs/ISOMETRIC_AND_3D_DESIGN.md`)
- `src/components/directory/`: the building directory panel UI (§7.5), the accessible alternative to
  every canvas (§8.5)
- Tests: `tests/unit/isometric/**`, `tests/unit/directory-ui/**`; browser checks and the D8 budget
  harness in `tests/perf/**`

## Purpose

The overview draws the **real campus footprints** from the loaded dataset (`buildings.geojson`,
`basemap.geojson`, `boundary.geojson`; nothing is copied or invented) as a parallel 2:1 dimetric
illustration. It works without WebGL, never imports `maplibre-gl`, and shares selection, search,
the route and "pick on map" with the map modes through the app store. The directory panel lists every
campus building with honest titles, map keys and routability, and selecting a row selects the building
in whichever view is active.

The visual language (warm brick walls, light roofs, green grounds, dark roads, crisp edges, clean
labels) follows the roles observed in the owner's reference illustration (§2). Every colour is our own
(`iso-theme.ts`, contrast-tested); no layout, numbers or text come from the illustration.

## Public interface

```ts
// Lazy-load like MapStage; the chunk never imports maplibre-gl.
IsoStage({ theme, reducedMotion, padding, studioModels?, onOpenDirectory? })   // store-wired
IsoView(props: IsoViewProps)                                                  // pure view (tests, harness)
createIsoController({ frame, campusPoints, width?, height?, initial? }): IsoController
// IsoController implements MapController (flyTo, fitCoordinates, resetView, zoomIn/Out, setPadding;
// resetNorth = default rotation; follow = no-op) plus getView, setView, panBy, zoomAt, rotateBy,
// applyScreenTransform, transformFor, defaultRotation, minPxPerMetre, subscribe.
createLocalFrame(origin?), createIsoProjection(r, elevationDeg?), defaultRotation(points, aspect)
pxPerMetreForZoom(zoom, lat), zoomForPxPerMetre(k, lat)       // mode switches keep an equivalent scale
buildGround({ basemap, boundary }, frame?), buildIsoScene(input, rotation, frame?, campusPoints?)
ISO_THEME_COLORS, spokenMapKey(key)                            // 'C4-07' → "Map key C 4, 7"
isoStudioModel(record, { baseFootprint? })                     // src/isometric/studio.ts (separate import)

// src/components/directory
DirectoryPanel()                    // panel body (search, category filter, grouping, rows)
DirectoryPeek({ onBrowse })         // mobile sheet peek: selection or "N campus buildings · Browse"
MapKeyGlyph({ mapKey })             // diamond + key, read as "Map key C 4, 7"
useCampusDirectory(), campusDirectoryFor(data)   // one createDirectory() per loaded dataset
directoryView, categoryOptions, heightBadge, facilityText, directorySummary      // pure view model
```

The e2e-only hook `window.__ATLAS_ISO__` (installed with `?e2e=1`, read-only, no user position) has
`getFrameStats`, `getView`, `getSelectedId`, `getRouteCoordinateCount`, `projectToViewport(lngLat, z?)`,
`getDrawOrder`, `getKey` and `getPlacedLabelIds`.

## How it works

1. **Projection (§6.3).** Local equirectangular metres at `APP_CONFIG.map.center`; view rotation
   θ = 45° + 90°·r (θ is the compass direction at the top); `x = a`, `y = −(b·sin30° + z·cos30°)`.
   The ground inverse is exact (hit-testing and "pick on map"). Heights are drawn 1:1. The default r is
   the one whose projected campus extent best matches the viewport's aspect ratio.
2. **Scene build** (`scene.ts`, per data or rotation change, pure). Ground stays in metres and is
   drawn through an affine canvas transform, so road widths are true metres. Each campus-inventory
   building becomes a footprint prism (walls + flat roof) or, when an owner-authored studio model exists
   for its id, the **same `StudioMesh` faces** that Realistic 3D draws (S1). Back faces are culled.
3. **Draw order (§6.4).** Footprints are compared column by column in the view frame (exact between
   vertex abscissas). The nearer of two ground-disjoint intervals is drawn last wherever the two
   prisms overlap on screen (heights matter only there). Three cases cannot be ordered building by
   building, and each becomes a **draw unit** whose faces are sorted together:
   - truly overlapping footprints (≥ 1 m²), where the normative height rule is applied face by face;
   - interleaved pairs, such as a tall building in the courtyard of a U;
   - cycles (strongly connected components).

   Units are then ordered with Kahn's algorithm. Within a unit, faces are ordered by Newell plane tests,
   then by an exact ray-depth sample at a shared screen point. Ties draw roofs last.

4. **Drawing** (`draw.ts`). Static layer: surroundings, campus ground, basemap, the map-key grid, the
   planned route on the ground, then buildings back to front with three wall tones and two roof tones
   from a light fixed to north (azimuth 200°). Placeholder heights are paler with a dashed roof
   outline. Dynamic layer: the route seen through buildings (dashed, by design), the selection (tinted
   roof, thick outline with a halo), a pin for a selected non-building place, route endpoints, and
   map-key diamonds with labels.
5. **Labels** (`labels.ts`). Named buildings show their name; unnamed buildings show **only** their key
   in a diamond (never "Unnamed building", never an official block number). Priority: selected >
   named > route endpoints > keyed by area. Collision uses a uniform screen grid. Text is ≥ 12 px and
   every marker's hit box is ≥ 24 × 24 px.
6. **Hit-testing** (`hit-test.ts`). Markers first, then buildings in reverse draw order against the
   footprint prism (also for studio models: picking uses the footprint, S1), then the exact ground
   point.
7. **Interaction** (`IsoView.tsx`):
   - Pan, pinch and wheel move the cached bitmaps with a CSS transform on their own compositor layer,
     with one full redraw per settle (pointer up, or 120 ms after the last wheel event).
   - Keys: arrows pan, `+`/`−` zoom, `R`/`Shift+R` rotate, `0` shows the whole campus, `D` opens the
     directory.
   - Visible rotate buttons show which direction is at the top.
   - With reduced motion every move jumps.
   - The DPR is capped at `APP_CONFIG.isometric.dprCap`.
8. **Info panel and legend.** The selected building's honest title, map key (marked "this app's
   reference, not an official block number") and height wording. Owner models carry the S3 labels
   ("Illustrative model placed by the site owner — not verified" and "Colours and materials are
   appearance only"), plus "Model unavailable" for the S2 fallback prism. On narrow canvases the panel
   moves to the bottom so it never covers the focused building. The legend is collapsible and explains
   the ground roles, the height honesty and the map keys.

## Measured results (dataset `ceb0ac0`, 131 campus buildings, 794 visible faces at r = 0)

- **Chunk:** `IsoStage-*.js` is 44.9 kB raw / **16.8 kB gzip** (budget ≤ 25 kB) in the production
  harness build. It contains no `maplibre-gl`. The studio schema and mesh generator are not in it.
- **Depth order:** unit cycles 0 at all 4 rotations (tested). There are 11–13 interleaved pairs and
  7 true-overlap pairs per rotation, and 1 resolved strongly connected component.
- **Painter check:** the exact ray-depth check at about 3,000 sample points per rotation finds 0
  errors at r = 0–2 and 6 at r = 3. All 6 are inside the stacked, truly overlapping group
  `osm:way/422823424…28`.
- **Studio meshes:** box with flat, gable, hip and shed roofs, L, closed and open U, tower on podium,
  and stepped all show 0 painter errors at every rotation.
- **D8 browser numbers** are written by `tests/perf/iso.perf.spec.ts` to `test-results/perf/iso.json`.
  Below are five runs on 2026-10-24: headless Chromium, 1280 × 800, DPR 1, Intel Core 7 240H. The
  machine was **shared with other agents' builds and test runs** (CPU load 19–100 %). Re-measure on
  an idle test machine before recording these in `docs/PERFORMANCE.md`.

  | Metric (budget)                                       | Five runs                                                         |
  | ----------------------------------------------------- | ----------------------------------------------------------------- |
  | Scene build, unthrottled max (≤ 30 ms)                | 5.8 – 7.4 ms                                                      |
  | Full redraw, unthrottled p95 (≤ 8 ms)                 | 1.2 – 1.9 ms                                                      |
  | Scene build at 4×, max (≤ 120 ms)                     | 31 – 53 ms                                                        |
  | Full redraw at 4×, p95 of 14 (≤ 25 ms)                | 14.7, 15.0, 22.0 ms; **25.6 and 29.3 ms in 2 runs (over budget)** |
  | Gesture frames at 4× (p95 ≤ 20 ms; ≤ 2 % over 50 ms)  | p95 16.7 – 16.8 ms; 0 % over 50 ms                                |
  | Hit-test at 4×, max (≤ 1 ms)                          | 0.2 – 1.0 ms                                                      |
  | Mode switch → first frame at 4×, chunk cached (≤ 300) | 144 – 167 ms                                                      |
  | JS heap growth after GC (≤ 8 MB)                      | 2.2 MB                                                            |

  How the gesture frames are measured:
  - The gated gesture runs dispatch DOM pointer and wheel events in the page every 16 ms.
  - Playwright's CDP mouse is also recorded (`cdpDriven`), but it is not gated: each CDP event waits
    for a renderer round trip, which at 4× splits a wheel gesture into one commit per notch. That run
    measures p95 50 ms for pan and 100 ms for wheel.

## Testing

```sh
npx vitest run tests/unit/isometric tests/unit/directory-ui
npx playwright test -c tests/perf/playwright.iso.config.ts                     # harness + perf
npx playwright test -c tests/perf/playwright.iso.config.ts --project=perf      # D8 budgets only
```

The harness (`tests/perf/iso-harness/`) is a production build of IsoStage plus DirectoryPanel on the
real `public/data`. It is served on port 4420 and built into the OS temp folder, never into the
repository. It exists until the integration lead mounts `IsoStage` in the app shell; after that, the
same checks belong in `tests/e2e/overview.spec.ts` against the app.

## Integration (lead-owned files; not changed by this module)

- `src/app/store/types.ts`: add `'directory'` to `PanelId` and give it a title. `PanelBody` then
  renders `<DirectoryPanel/>`, and the mobile sheet peek uses `<DirectoryPeek onBrowse={…}/>`.
- `src/components/layout/AppShell.tsx` (a `ViewStage`): mount
  `lazy(() => import('../../isometric/IsoStage.tsx'))` when `viewMode === 'isometric'`, and pass
  `onOpenDirectory={() => openPanel('directory')}`. Use `pxPerMetreForZoom` and `zoomForPxPerMetre` to
  carry the camera across a mode switch. Without WebGL2, fall back to `isometric`, not to the list (§8.3).
- `studioModels`: integrate passes `studioModels.map((m) => isoStudioModel(m, …))` from the
  publication merge (§11.2 of the Building Studio design).
- Search: map keys as aliases in `src/search/docs.ts` (search owner, §7.4).
