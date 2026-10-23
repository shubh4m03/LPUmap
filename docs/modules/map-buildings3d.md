# Module: map and buildings3d

**Paths:**

- `src/map/`: MapLibre view, style, overlays, controller, errors, e2e hook
- `src/buildings3d/`: extrusion and footprint layers, 2D/3D mode, WebGL2 probe

## Purpose

This module renders the campus with MapLibre GL JS 6 **entirely from the project's own GeoJSON**:
boundary, basemap, buildings, places, the route and the user's position. There are no tile servers,
API keys or third-party fonts. It offers a 2D map and a 3D building view built with `fill-extrusion`,
and gives the app a small camera controller. It stays a "dumb" view: the app store decides what is
selected, routed or visible, and the map applies that.

## Public interface

### `src/map/index.ts`

```ts
MapView(props: MapViewProps): JSX.Element
interface MapViewProps {
  data: CampusData; theme: 'light' | 'dark'; mode3d: boolean; reducedMotion: boolean;
  visibleGroups: ReadonlySet<LayerGroupId>; showLabels: boolean; selectedPlaceId: string | null;
  route: MapRouteOverlay | null;            // { coordinates, completed?, alternatives? }
  userLocation: MapUserLocation | null;     // { lngLat, accuracyM, stale }
  onSelectPlace(id: string | null): void; onMapClick?(lngLat): void;
  onUserPan?(): void;                       // the user dragged or keyboard-panned (stops follow-me)
  onReady?(controller: MapController): void; onError?(message: string): void; className?: string;
}
interface MapController {
  flyTo(lngLat, zoom?); follow(lngLat); fitCoordinates(coords, padding?); resetView();
  zoomIn(); zoomOut(); resetNorth(); setPadding({ top, right, bottom, left });
}
// MapControllerWithCamera adds getCamera(): { center, zoom, pitch, bearing, padding }
createMapController(map, { reducedMotion(), mode3d() }), FOCUS_ZOOM, FIT_MAX_ZOOM, DEFAULT_FIT_PADDING
buildMapStyle, buildLayers, glyphsUrl, OSM_ATTRIBUTION_HTML, groupFilter, labelVisibility, LABEL_SORT_KEY,
SOURCE_IDS, LAYER_IDS, LABEL_LAYER_IDS, MAP_ARIA_LABEL
poiCollection, routeCollection, routeCoordinateCount, accuracyCircle, userLocationCollection, anchoredOrganizations
MAP_THEME_COLORS, mapThemeColors, contrastRatio, relativeLuminance, parseHexColor
classifyMapError, MAP_MESSAGES, isE2EMode, type AtlasMapTestHooks
```

### `src/buildings3d/index.ts`

```ts
supportsWebGL(): boolean                     // cached WebGL2 probe (MapLibre 6 requires WebGL2); resetWebGLSupportCache()
buildingExtrusionLayers(theme, { sourceId?, mode3d?, minzoom? }): FillExtrusionLayerSpecification[]
buildingFootprintLayers(theme, opts), buildingLegend(theme)   // legend: measured / estimated from floors / placeholder
extrusionColorExpression, flatFillMaxZoom, BUILDINGS_SOURCE_ID, BUILDING_LAYER_IDS
setBuildingMode(map, mode3d, { reducedMotion }), MODE_TRANSITION_MS
```

## Behaviour and invariants

- **One map instance.** The map is created once and removed on unmount. Later prop changes are
  applied incrementally:
  - `setData` per source, only when that input changes
  - paint properties for the theme
  - `setFilter` for layer groups
  - layout visibility for labels
  - feature-state `selected` for the selection
  - `setBuildingMode` for 3D

  The style is never rebuilt.

- **Selection never moves the camera by itself.** Camera moves are explicit controller calls from the
  app (`flyTo`, `fitCoordinates`, `follow`).
- **Reduced motion.** With reduced motion, `flyTo` and fits jump instead of animating, and mode
  changes jump too.
- **3D.**
  - Extrusion uses `heightM` and `minHeightM`, and starts at `extrusionMinZoom` (14.5).
  - The colour encodes `heightSource`: placeholder heights use a lighter neutral tone, and the
    selected building has its own colour.
  - In 3D the camera eases to `pitch3d` 55° and `bearing3d` −20°. Rotation and pitch gestures are
    enabled only in 3D.
  - The app starts in 3D at widths of 768 px and above.
- **Basemap and glyphs.**
  - Glyphs load from `BASE_URL/fonts/{fontstack}/{range}.pbf`: Noto Sans Regular and Bold, ranges
    0–511 and 8192–8447, with SHA-256 hashes in `public/fonts/SOURCE.md`.
  - The OSM attribution is always shown.
- **Markers and labels.** POI markers are a circle layer. Labels are a separate symbol layer with
  collision, so a colliding label hides and its marker stays. Organizations anchored to a building
  get no separate marker (`anchoredOrganizations`).
- **Errors.** No WebGL2, a lost WebGL context, and data or style errors each call
  `onError(message)` with a plain-language message (`MAP_MESSAGES`). The app then switches to list
  mode. Missing glyph ranges are ignored.
- **The e2e hook** is installed only with `?e2e=1`: a frozen `window.__ATLAS_MAP__` with
  `getCamera`, `getSelectedId`, `getRouteCoordinateCount`, `isStyleLoaded`,
  `queryRenderedBuildingIds`, `getLayerVisibility` and `isUserLocationShown`. It never returns user
  coordinates.
- **The MapLibre worker** is emitted as a same-origin asset and registered through `setWorkerUrl`
  (`src/app/maplibre-worker.ts`), as the CSP requires.

## Tests

`tests/unit/map/*` (7 files) and `tests/unit/buildings3d/*` (1 file), 102 tests:

- The style is validated with `@maplibre/maplibre-gl-style-spec`'s `validateStyleMin`, in several
  states. The style spec is a dependency of `maplibre-gl`, not listed in `package.json`.
- Layer filters and expressions are evaluated (`tests/unit/map/style-eval.ts`).
- The glyph file hashes are checked.
- Controller camera maths, including reduced motion, are tested.
- GeoJSON overlays are tested, including the geodesic accuracy circle.
- Theme palette contrast is tested.
- `MapView` is tested with a mocked MapLibre.
- Extrusion layers, the legend and mode switching are tested.

Real rendering is exercised by the Playwright specs through the e2e hook.

## Known limitations

- `supportsWebGL()` accepts WebGL2 only, because MapLibre 6 needs it. The original contract said
  "WebGL2 or WebGL1".
- MapLibre's `reduceMotion` map option is set at creation and is process-wide. A later change to the
  reduced-motion preference affects camera moves (which follow the live prop), but not gesture
  inertia.
- After `webglcontextrestored`, no "recovered" signal is sent. The context-lost message may need
  dismissing.
- Glyph coverage is Latin, Latin-1, Latin Extended-A/B and general punctuation only. Other scripts
  in OSM names render as blank on the map, and this is not reported as an error.
- Map colours are hex values in `src/map/theme-colors.ts`, because MapLibre cannot read CSS custom
  properties. They must be kept in step with `src/styles/tokens.css` by hand.
- Some category fill colours in `src/config/categories.ts` miss their own 3:1 target against the map
  surface. Markers stay distinguishable because of a high-contrast ring.
- Heights are only as good as OSM: no measured heights, 137 estimated from floors, 398 placeholders.
