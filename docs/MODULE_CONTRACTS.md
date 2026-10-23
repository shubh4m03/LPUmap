# Module contracts

This file fixes the public interface and file ownership of every module so
they can be built and tested independently. A module's `index.ts` is its only
public entry point; other modules import from it, never from internals.

## Global conventions

- **Imports**: every relative import uses an explicit extension (`./foo.ts`,
  `./Bar.tsx`). Required because `src/data/schema.ts`, `src/config/*`,
  `src/distance/*` and `src/routing/*` are also executed by Node 24's native
  TypeScript type-stripping from `scripts/*.ts`.
- **Erasable TypeScript only** (`erasableSyntaxOnly`): no `enum`, no
  `namespace`, no constructor parameter properties.
- **Coordinates** are `LngLat = [lon, lat]` (GeoJSON order) everywhere.
- **Distances** come only from `src/distance` (`haversineM`, projections).
- **Config** comes only from `src/config` (`APP_CONFIG`, `CATEGORIES`). No
  magic numbers for speeds, thresholds or colours inside feature code.
- **Data types** come only from `src/data/schema.ts` (Zod-inferred).
- **Truthfulness**: never fabricate names, coordinates, hours, routes, people,
  or live status. Unknown is rendered as unknown.
- **No HTML injection**: React text rendering only; ESLint bans
  `dangerouslySetInnerHTML`. External URLs pass through `safeExternalUrl`.
- **Privacy**: never log, persist or transmit precise user coordinates unless
  the user explicitly opts in to a documented local feature.
- **Tests**: Vitest under `tests/unit/<module>/` and
  `tests/integration/`; fixtures under `tests/fixtures/` and named
  `synthetic-*` when they are invented geometry.
- Pure domain modules (`data` loader aside) must not import React, MapLibre
  or the DOM, so they stay testable and reusable by scripts.

## Generated dataset (public/data/) — owner: data pipeline

Validated by schemas in `src/data/schema.ts` (**schema version 2**; see
[v2 geographic contract](#v2-geographic-contract-data_schema_version-2)). Startup files:
`manifest.json`, `boundary.geojson`, `buildings.geojson`, `basemap.geojson`,
`places.json`, `relations.json`, `graph.json`; also `quality-report.json`. Lazy
(v2): `context-places.json`, `detections.geojson`, `boundary-review.json`.

Place ids: `osm:node/<id>`, `osm:way/<id>`, `osm:relation/<id>`,
`cur:<slug>` for curated records. Building feature `properties.id` equals the
building place id.

## src/data — owner: data pipeline

```ts
export * from './schema.ts';
export interface CampusData {
  manifest: Manifest;
  boundary: BoundaryFile;
  buildings: BuildingsFile;
  basemap: BasemapFile;
  places: Place[];
  relations: Relation[];
  graph: GraphFile;
}
export class DatasetError extends Error {
  code: 'network' | 'schema-version' | 'invalid';
}
// Fetches manifest first; rejects with code 'schema-version' if
// manifest.schemaVersion !== DATA_SCHEMA_VERSION; validates every file with Zod.
export function loadCampusData(opts?: { baseUrl?: string; fetchImpl?: typeof fetch }): Promise<CampusData>;
```

## src/distance — owner: geo

```ts
// geodesic.ts (already written — do not change signatures)
haversineM, bearingDeg, destinationPoint, isValidLngLat, createLocalProjection, EARTH_RADIUS_M
// polyline.ts
polylineLengthM(coords: LngLat[]): number
cumulativeLengthsM(coords: LngLat[]): number[]
interface PolylineProjection { segmentIndex: number; t: number; point: LngLat; distanceFromLineM: number; distanceAlongM: number }
projectOntoPolyline(p: LngLat, coords: LngLat[], cumulative?: number[]): PolylineProjection | null
slicePolyline(coords: LngLat[], fromM: number, toM: number, cumulative?: number[]): LngLat[]
// spatial-index.ts — uniform grid over a local projection
createGridIndex<T>(items: T[], getLocation: (t: T) => LngLat | null, cellSizeM?: number): {
  nearest(p: LngLat, k: number, maxDistanceM?: number): Array<{ item: T; distanceM: number }>;
  within(p: LngLat, radiusM: number): Array<{ item: T; distanceM: number }>;
}
// format.ts
formatDistance(m: number): string   // "45 m", "1.2 km"
formatDuration(s: number): string   // "under 1 min", "7 min", "1 h 5 min"
```

## src/routing — owner: routing (pure; also importable by scripts)

```ts
export type RouteProfileId = 'walk' | 'cycle' | 'step-free';
export type RoutePreference = 'shortest' | 'fastest';
export type RouteEndpoint =
  | { kind: 'place'; placeId: string; label: string; location: LngLat; nodeId?: number }
  | { kind: 'point'; label: string; location: LngLat };
export interface RouteRequest {
  from: RouteEndpoint;
  to: RouteEndpoint;
  profile: RouteProfileId;
  preference?: RoutePreference;
}
export type RouteStepKind = 'path' | 'road' | 'steps' | 'connector' | 'push-bike';
export interface RouteStep {
  kind: RouteStepKind;
  name: string | null;
  distanceM: number;
  durationS: number;
  instruction: string;
  startIndex: number;
}
export type RouteCaveatCode =
  | 'accessibility-unverified'
  | 'contains-steps'
  | 'push-bike'
  | 'start-connector'
  | 'end-connector'
  | 'unnamed-paths';
export interface RouteCaveat {
  code: RouteCaveatCode;
  message: string;
}
export interface RouteOk {
  ok: true;
  profile: RouteProfileId;
  preference: RoutePreference;
  coordinates: LngLat[]; // includes the off-network connector legs
  distanceM: number; // == polylineLengthM(coordinates)
  durationS: number; // from documented speeds in APP_CONFIG.routing
  edgeIds: number[];
  steps: RouteStep[];
  caveats: RouteCaveat[];
  snap: { fromM: number; toM: number }; // straight connector lengths
}
export type RouteFailureReason =
  'invalid-input' | 'same-point' | 'origin-unsnappable' | 'destination-unsnappable' | 'no-path';
export interface RouteFailure {
  ok: false;
  reason: RouteFailureReason;
  message: string;
}
export type RouteResult = RouteOk | RouteFailure;
export interface Router {
  route(req: RouteRequest): RouteResult;
  /** Best route first; extra entries only if they differ by ≥ alternativeMinDifference. */
  alternatives(req: RouteRequest): RouteResult[];
  snap(p: LngLat, profile: RouteProfileId): { nodeId: number; distanceM: number } | null;
  readonly nodeCount: number;
  readonly edgeCount: number;
}
export function createRouter(graph: GraphFile): Router;
export const ROUTE_PROFILES: Record<RouteProfileId, { id; label; description; speedMps: number }>;
```

Rules: A* with an admissible heuristic (straight-line distance ÷ the
profile's fastest possible speed); deterministic tie-breaking by node id;
never invent connections between disconnected components; step-free excludes
`steps` and `wheelchair: 'no'` edges and always adds an
`accessibility-unverified` caveat when any used edge has `wheelchair: 'unknown'`.

## src/geolocation — owner: geo

```ts
export interface GeoSample {
  lngLat: LngLat;
  accuracyM: number;
  timestamp: number;
  speedMps: number | null;
  headingDeg: number | null;
}
export type GeoStatus =
  'idle' | 'requesting' | 'active' | 'denied' | 'unavailable' | 'timeout' | 'unsupported' | 'error';
export type SampleRejection = 'invalid' | 'low-accuracy' | 'stale' | 'out-of-order' | 'implausible-jump';
export function classifySample(
  sample: GeoSample,
  prev: GeoSample | null,
  now: number,
): { accepted: true } | { accepted: false; reason: SampleRejection };
export interface GeolocationWatcher {
  start(): void;
  stop(): void;
  readonly status: GeoStatus;
  readonly active: boolean;
}
export function createGeolocationWatcher(opts: {
  geolocation?: Geolocation; // injectable for tests; defaults to navigator.geolocation
  onSample(s: GeoSample): void;
  onStatus(s: GeoStatus, message?: string): void;
}): GeolocationWatcher;
export function useGeolocation(): {
  status;
  lastSample: GeoSample | null;
  start(): void;
  stop(): void;
  message?: string;
}; // React hook
```

`start()` is only ever called from a user gesture. `stop()` must clear the
browser watch id. Nothing in this module persists or transmits samples.

## src/navigation — owner: geo

```ts
export interface ProgressState {
  distanceAlongM: number;
  remainingM: number;
  remainingS: number;
  plannedDistanceM: number;
  straightLineToDestinationM: number;
  snappedPoint: LngLat | null;
  distanceFromRouteM: number | null;
  offRoute: boolean; // only after `offRouteConsecutive` accepted samples
  arrived: boolean; // only after `arrivalConsecutive` accepted samples
  completedCoords: LngLat[];
  remainingCoords: LngLat[];
  lastSampleAccepted: boolean;
  rejection?: SampleRejection;
}
export function createRouteProgress(route: { coordinates: LngLat[]; distanceM: number; durationS: number }): {
  update(sample: GeoSample, now?: number): ProgressState;
  readonly state: ProgressState | null;
};
export interface TrackingSnapshot {
  travelledM: number;
  elapsedS: number;
  averageSpeedMps: number | null;
  movement: 'moving' | 'stationary' | 'unknown';
  acceptedSamples: number;
  rejectedSamples: number;
  path: LngLat[];
}
export function createTrackingSession(startedAt: number): {
  addSample(s: GeoSample, now?: number): TrackingSnapshot;
  snapshot(now?: number): TrackingSnapshot;
  stop(now?: number): TrackingSnapshot & { endedAt: number };
};
```

Travelled distance sums only accepted, de-jittered movement (see
`APP_CONFIG.tracking`), never raw sample-to-sample hops.

## src/search — owner: search (pure)

```ts
export type SearchDocKind = 'place' | 'category' | 'layer' | 'command';
export interface SearchDoc {
  id: string;
  kind: SearchDocKind;
  title: string;
  subtitle?: string;
  aliases: string[];
  codes: string[];
  keywords: string[];
  categoryId?: string;
  ref: string;
  boost?: number;
  hasLocation: boolean;
}
export type MatchKind = 'exact' | 'alias' | 'code' | 'prefix' | 'word' | 'multiword' | 'synonym' | 'fuzzy';
export interface SearchHit {
  doc: SearchDoc;
  score: number;
  matchKind: MatchKind;
  highlights: Array<[number, number]>;
}
export interface SearchIndex {
  search(query: string, opts?: { limit?: number; kinds?: SearchDocKind[] }): SearchHit[];
  readonly size: number;
}
export function createSearchIndex(docs: SearchDoc[]): SearchIndex;
export function docsFromPlaces(places: Place[]): SearchDoc[];
export function docsFromCategories(
  categories: readonly CategoryDef[],
  counts: Record<string, number>,
): SearchDoc[];
export function highlightSegments(
  text: string,
  ranges: Array<[number, number]>,
): Array<{ text: string; match: boolean }>;
export function normalize(s: string): string;
```

Deterministic ranking order: exact name/alias → code/abbreviation → prefix
→ word-boundary → multiword (all tokens) → synonym (category) → fuzzy
subsequence. Ties broken by boost, then title length, then id. Unnamed
buildings must not flood generic queries (rank them below named matches).

## src/facilities — owner: facilities (pure)

```ts
// hours.ts — conservative OSM opening_hours subset
export type HoursState = 'open' | 'closed' | 'unknown' | 'stale';
export interface HoursEvaluation {
  state: HoursState;
  label: string;
  nextChange?: Date;
  reason?: string;
}
export function parseOpeningHours(raw: string): ParsedHours | null; // null = unsupported → unknown
export function evaluateHours(
  raw: string | undefined,
  now: Date,
  opts?: { retrievedAt?: string; freshnessDays?: number },
): HoursEvaluation;
// directory.ts
export interface FacilityDirectory {
  all: Place[];
  get(id: string): Place | undefined;
  byCategory(categoryId: string): Place[];
  countsByCategory(): Record<string, number>; // derived from data only
  related(id: string): Array<{ relation: Relation; place: Place }>;
  isRoutable(place: Place): boolean; // has location and graphNodeId
}
export function createFacilityDirectory(places: Place[], relations: Relation[]): FacilityDirectory;
// nearest.ts
export interface NearestResult {
  place: Place;
  distanceM: number;
  distanceKind: 'route' | 'straight-line';
  durationS?: number;
}
export function findNearest(args: {
  origin: LngLat;
  categoryId: string;
  directory: FacilityDirectory;
  router?: Router;
  profile?: RouteProfileId;
  limit?: number;
}): NearestResult[];
// relations.ts
export function validateRelations(
  places: Place[],
  relations: Relation[],
): Array<{ level: 'error' | 'warning'; code: string; message: string; ids: string[] }>;
```

## src/utils — no barrel file; import the specific file

```ts
// src/utils/safe-url.ts — owner: facilities
export function safeExternalUrl(raw: string | undefined): string | null; // http(s) only
export function telHref(phone: string): string | null;
export function mailHref(email: string): string | null;
// src/utils/storage.ts — owner: platform
export function createStorage<T>(
  key: string,
  schema: ZodType<T>,
  fallback: T,
): { get(): T; set(v: T): void; clear(): void }; // versioned, validated, try/catch
```

## src/map and src/buildings3d — owner: map

```ts
export interface MapRouteOverlay {
  coordinates: LngLat[];
  completed?: LngLat[];
  alternatives?: LngLat[][];
}
export interface MapUserLocation {
  lngLat: LngLat;
  accuracyM: number;
  stale: boolean;
}
export interface MapViewProps {
  data: CampusData;
  theme: 'light' | 'dark';
  mode3d: boolean;
  reducedMotion: boolean;
  visibleGroups: ReadonlySet<LayerGroupId>;
  showLabels: boolean;
  selectedPlaceId: string | null;
  route: MapRouteOverlay | null;
  userLocation: MapUserLocation | null;
  onSelectPlace(id: string | null): void;
  onMapClick?(lngLat: LngLat): void;
  onReady?(controller: MapController): void;
  onError?(message: string): void;
}
export interface MapController {
  flyTo(lngLat: LngLat, zoom?: number): void;
  fitCoordinates(coords: LngLat[], padding?: number): void;
  resetView(): void;
  zoomIn(): void;
  zoomOut(): void;
  resetNorth(): void;
  setPadding(p: { top; right; bottom; left }): void;
}
export function MapView(props: MapViewProps): JSX.Element;
// buildings3d
export function supportsWebGL(): boolean;
export function buildingExtrusionLayers(theme, opts): LayerSpecification[];
export function setBuildingMode(map, mode3d: boolean, opts: { reducedMotion: boolean }): void;
```

Basemap comes only from our GeoJSON (no third-party tiles, no API key).
Glyphs are self-hosted under `public/fonts/`.

## src/components/ui — owner: design system

Reusable primitives: `Button`, `IconButton`, `TextInput`, `Dialog`,
`BottomSheet`, `SidePanel`, `Badge`, `ToggleChip`, `ResultRow`, `EmptyState`,
`ErrorState`, `Spinner`, `LiveRegion` (aria-live announcer), `Icon`
(inline SVG set keyed by `CategoryDef.icon`). Tokens in `src/styles/tokens.css`
(light + dark), Tailwind v4 `@theme` mapping in `src/styles/index.css`.

## src/favorites, src/privacy, src/feedback, src/offline — owner: platform

```ts
// favorites
export function useFavorites(): { ids: string[]; isFavorite(id): boolean; toggle(id): void; clear(): void };
export function useRecents(): { ids: string[]; push(id): void; clear(): void }; // respects privacy.saveHistory
// privacy
export function usePrivacySettings(): {
  saveHistory: boolean;
  setSaveHistory(v: boolean): void;
  clearAllLocalData(): void;
};
// feedback
export type CorrectionKind =
  | 'missing-facility'
  | 'wrong-name'
  | 'wrong-hours'
  | 'wrong-entrance'
  | 'closed'
  | 'accessibility'
  | 'geometry'
  | 'other';
export interface CorrectionDraft {
  kind: CorrectionKind;
  placeId?: string;
  placeName?: string;
  details: string;
  sourceUrl?: string;
}
export function validateCorrection(
  d: unknown,
): { ok: true; value: CorrectionDraft } | { ok: false; errors: string[] };
export function correctionToText(d: CorrectionDraft, datasetVersion: string): string;
export function correctionIssueUrl(d: CorrectionDraft, datasetVersion: string): string | null; // null when VITE_CORRECTIONS_URL unset
// offline
export const pwaOptions: Partial<VitePWAOptions>;
export function useOnlineStatus(): boolean;
export function useServiceWorkerUpdate(): {
  updateAvailable: boolean;
  offlineReady: boolean;
  applyUpdate(): void;
  dismiss(): void;
};
```

## v2 geographic contract (DATA_SCHEMA_VERSION 2)

**Owner:** integration lead (single writer). **Status:** frozen at Gate 2 on 2026-10-24. Other
agents propose changes to the lead; nothing in this section changes without a schema review.

Code: `src/data/schema.ts`, `src/data/loader.ts`, `src/geo/boundary.ts`,
`src/directory/{types,directory}.ts`, `src/app/view-mode.ts`, `src/app/store/map-slice.ts`,
`src/config/index.ts` (`geo`, `optionalLayers`, `directory`, `isometric`, `cache.dataCache`).
Tests: `tests/unit/geo/boundary.test.ts`, `tests/unit/data/schema-v2.test.ts`,
`tests/unit/app/view-mode.test.ts`, `tests/unit/directory/directory.test.ts`.

### Owner decisions as enforced invariants

| Decision                                                                                                                                                                    | Enforced by                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Machine-detected footprints appear only in a flat, dashed "Unverified detected footprints" layer: never extruded, searched, routed, keyed or counted as campus buildings | They live only in `detections.geojson` (`detectionsFileSchema`), never in `buildings.geojson` (whose `geometrySource` is `osm` or `curated` only). Loaded lazily (`createOptionalLoaders().detections()`), off by default (`APP_CONFIG.optionalLayers.detectedFootprints`). The loader refuses detections whose source has no licensed manifest record. |
| 1a. The ~5.6 m Microsoft–OSM offset is never "corrected"                                                                                                                    | Detections keep their source geometry; the id hashes that geometry. The offset is documented in docs/CAMPUS_GEOGRAPHY_AUDIT.md §5.1.                                                                                                                                                                                                                    |
| 2. No off-campus buildings anywhere                                                                                                                                         | `buildingPropsSchema` rejects `campusStatus: 'outside'`; detections reject `'outside'`; `context-places.json` rejects `kind: 'building'` and any `buildingId`.                                                                                                                                                                                          |
| 2a. Off-campus POIs only in the opt-in "Nearby, outside campus" layer                                                                                                       | `places.json` must be all `on-campus`; `context-places.json` all `off-campus-nearby` (lazy, `createOptionalLoaders().contextPlaces()`, off by default, badge "Outside campus").                                                                                                                                                                         |
| 3. Uncertain boundary sections hold nearby buildings out of the inventory for review                                                                                        | `data/curated/boundary-review.json` (`curatedBoundaryReviewSchema`) feeds rule R3. Results are `campusStatus: 'uncertain'`, `inCampusInventory: false`, listed in `boundary-review.json` `items` for docs and admin data quality.                                                                                                                       |

Hostel, Agriculture Block, canteen and auxiliary candidates, and the Behance index, are **review
leads**: never facilities, names or block numbers. `officialBlockLabel` requires
`officialBlockSourceId` (schema-enforced) from a cited curated alias for that exact footprint.

### Files

| File                   | When loaded                | Schema                     | Content                                                                                                       |
| ---------------------- | -------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `manifest.json`        | first, `cache: 'no-cache'` | `manifestSchema`           | lists every key in `REQUIRED_MANIFEST_FILE_KEYS`; unique source ids; `osm` source required                    |
| `buildings.geojson`    | startup                    | `buildingsFileSchema`      | BuildingPropsV2; `inside` and `crossing` (inventory) and `uncertain` (review) only; Polygon/MultiPolygon only |
| `places.json`          | startup                    | `placesFileSchema`         | campus places only (`on-campus`)                                                                              |
| `context-places.json`  | lazy (layer enabled)       | `contextPlacesFileSchema`  | off-campus POIs, point kinds only                                                                             |
| `detections.geojson`   | lazy (layer enabled)       | `detectionsFileSchema`     | `det:<source>:<hash>` footprints with `reviewStatus` (the pipeline emits `unreviewed`)                        |
| `boundary-review.json` | lazy (admin, docs)         | `boundaryReviewFileSchema` | thresholds used, sections with `affectedIds`, curated decisions, every `uncertain` and `crossing` item        |
| other files            | startup, unchanged shapes  | as before                  | `schemaVersion: 2`                                                                                            |

Manifest sources for the v2 inputs: `osm` (ODbL 1.0); `microsoft-ml-buildings`
(CDLA-Permissive-2.0: set `licenseUrl` and ship the licence text at `licenseTextPath`);
`google-open-buildings` (ODbL 1.0, as chosen by the owner). Detection `source` maps to these ids
through `DETECTION_MANIFEST_SOURCE_IDS`.

### BuildingPropsV2 (flat and primitive, so MapLibre reads them directly)

- **Facts, identity and provenance:** `id` (= place id), `name|null`, `displayName`, `categoryId`,
  `geometrySource` (`osm`|`curated`), `sourceId`, `sourceRef`, `retrievedAt|null`,
  `verificationStatus`, `lastVerifiedAt|null`.
- **Facts, membership:** `campusStatus`, `inCampusInventory` (= status is inside or crossing),
  `insideFraction|null` (4 decimals), `distanceToBoundaryM|null`, `membershipMethod`
  (`polygon-clip`|`curated-decision`|`none`), `membershipReasonCode`, `membershipReason` (text),
  `membershipDecision` (`auto`|`curated`), `membershipDecisionSource|null`, `reviewSectionId|null`,
  `pointAreaDisagreement`.
- **Facts, geometry:** `areaM2|null`, `anchorLon`/`anchorLat` (point-on-surface; vertex mean for
  invalid geometry via `vertexMeanAnchor`), `isBuildingPart`.
- **Facts, tag pass-throughs (null when untagged, never inferred):** `levels`, `levelsSource`,
  `minLevel`, `osmHeightM`, `osmMinHeightM`, `roofShape`, `roofMaterial`, `roofColour`,
  `roofLevels`, `buildingMaterial`, `buildingColour`.
- **Fidelity:** `fidelityLevel` 0 (outline, placeholder height), 1 (levels estimate), 2 (tagged
  height), 3 (verified survey); `fidelityReason`. Levels 0–2 must match `renderHeightSource`.
- **Directory:** `directoryKey|null` (`DIRECTORY_KEY_RE`, inventory only), `directoryCell|null`,
  `officialBlockLabel|null` with `officialBlockSourceId|null` (both or neither).
- **Render only, not facts:** `renderHeightM`, `renderMinHeightM`, `renderHeightSource`
  (`osm-height` needs `osmHeightM`; `osm-levels-estimate` needs `levels`).

`buildingPropsProblems()` lists the cross-field invariants; the pipeline's validator should call it.
`Place` is unchanged from v1 (its optional `heightM`/`heightSource` remain for building places).

### Campus membership rules (`classifyFootprint`, src/geo/boundary.ts)

Area is measured in local metres. The area of footprint ∩ boundary is exact: edges are classified
by Green's theorem, which is valid for concave boundaries, holes and MultiPolygons (no convex-hull
clipping). Tests cross-check it against 0.25 m grid sampling (absolute difference ≤ 0.005). The
fraction is rounded to 4 decimals **before** the thresholds apply. Thresholds:
`APP_CONFIG.geo.membership`.

| Rule | Condition (first match wins)                                                       | Result                                                                 |
| ---- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| R1   | invalid polygon (`geometryProblems`)                                               | `uncertain`, `invalid-geometry`; never dropped                         |
| R2   | a curated decision exists for the id                                               | its status, `curated-decision`, with the source label                  |
| R3   | touches, or is within `bufferM` of, an **open** review section                     | `uncertain`, `review-section`, with the section id                     |
| R4   | f ≥ 0.995                                                                          | `inside`, `interior`                                                   |
| R5   | f ≤ 0.005                                                                          | `outside`, `exterior`                                                  |
| R6   | otherwise, f ≥ 0.5 and no conflicting evidence (`FootprintInput.conflicts`)        | `crossing`, `crossing-majority` (in the inventory)                     |
| R6   | otherwise, f ≥ 0.5 with conflicting evidence (for example a non-campus `operator`) | `uncertain`, `crossing-conflict`                                       |
| R6   | otherwise, f < 0.5                                                                 | `uncertain`, `crossing-minority`                                       |
| R7   | the point-on-surface or area-centroid test disagrees with f ≥ 0.5                  | `pointAreaDisagreement: true` and the reason says so; status unchanged |

Area fraction is evidence, not the sole criterion: R1–R3 and the R6 conflict test come first.
Nothing is clipped, discarded or repositioned: a crossing footprint keeps its full geometry.

Points (contributions, admin locations): `validatePointLocation(p, boundary, contextArea)` returns
`inside`, `outside-in-context-area` (eligible only for the context layer) or `outside-area`. The
default context area is `APP_CONFIG.map.maxBounds` (unchanged).

```ts
// src/geo
createBoundary(geoms: PolygonalGeometry | PolygonalGeometry[]): CampusBoundary; // throws InvalidGeometryError
boundaryFromFeatureCollection(fc): CampusBoundary;
interface CampusBoundary {
  polygons; bbox; origin; projection; areaM2;
  containsPoint(p): boolean;
  distanceToBoundaryM(p): number;
  footprintDistanceToBoundaryM(g): number;
  areaOf(g): number;
  intersectionAreaM2(g): number;
  insideFraction(g): number;
}
classifyFootprint({ id, geometry, conflicts? }, boundary, reviewSections?, curatedDecisions?, thresholds?): MembershipResult;
geometryProblems(g): string[];
polygonAreaM2(g): number;
pointOnSurface(g): LngLat | null;
vertexMeanAnchor(g): LngLat | null;
distanceToReviewGeometryM(g, sectionGeometry, projection): number;
validatePointLocation(p, boundary, contextArea?): 'inside' | 'outside-in-context-area' | 'outside-area';
```

Checked against the current dataset (`datasetVersion` b628c5855b1d): `classifyFootprint` gives 130
inside, 7 crossing, 1 uncertain (`osm:way/422738892`, 0.4056) and 397 outside, with the same
inside areas as docs/CAMPUS_GEOGRAPHY_AUDIT.md §3. That run used no review sections.

### Counts (manifest `counts`, all derived from the processed files)

`buildings` counts inventory features only (inside and crossing). Also `buildings:inside`,
`buildings:crossing`, `buildings:uncertain`, `detections`, `detections:<source>`, `contextPlaces`
and `boundaryReview:items`. The existing place, relation and graph keys count `places.json` only
(campus). `heightSource:*` counts inventory buildings by `renderHeightSource`.
`src/community/merge.ts` `recount` follows these definitions.

### Loader

```ts
loadCampusData(opts?): Promise<CampusData>; // startup files only; rejects v1 with code 'schema-version'
checkSchemaVersion(rawManifest): void;
createOptionalLoaders(manifest, opts?): {
  contextPlaces(): Promise<Place[]>;
  detections(): Promise<DetectionsFile>;
  boundaryReview(): Promise<BoundaryReviewFile>;
}; // fetched on first call with ?v=<datasetVersion>, memoised, retried after a failure
```

### Directory (`src/directory`)

`createDirectory({ buildings, places, relations })` returns
`{ entries, byKey, byId, search(q), filter(categoryIds) }`. Entries are the buildings with
`inCampusInventory` only. `title` = name ?? `Building <key>` ?? displayName. `subtitle` is the
pipeline label for unnamed buildings, or the key wording. Facilities and organizations come from
incoming `located_in`/`part_of` relations. Each entry has `routable`, `routableReason` and a
user-facing `routableNote`. Provenance comes from the place record, else from the feature. The lock
file type and schema: `directoryKeysLockSchema`.

### View modes (`src/app/view-mode.ts`, map slice)

`viewMode: 'realistic3d' | 'isometric' | 'standard2d'`, with `lastMapMode` and `viewModeReason`.
`mode3d` is kept in sync (true only in realistic3d) for existing callers, and `setMode3d` and
`toggleMode3d` map onto `setViewMode`. `setViewMode(mode, { reason })` returns false and changes
nothing for `isometric` during live navigation. `?view=3d|iso|2d` is handled by `parseViewParam`
and `buildViewUrl`; unknown values are ignored. The capability matrix with user-facing reasons is
`VIEW_MODE_SUPPORT` / `supports(mode, cap)`.

### Compatibility, migration and rollback

- **Ids are unchanged** (`osm:way/…`, `cur:…`) and so is `Place`. Favourites, deep links and the
  D1 overrides and hidden records keyed by base place ids keep working. An override whose target
  moved to `context-places.json` (off campus) shows up as an orphan in `mergePublication`'s report
  until the community merge also consults context places. It is reported, never silently dropped.
- **Migration:** the pipeline regenerates the data (`npm run data:build`); nothing is converted in
  place. App and data ship together in one Workbox precache, and `APP_CONFIG.cache.dataCache` is
  `lpu-atlas-data-v2`. A v2 app given v1 data, or the reverse, fails fast with `schema-version` and
  asks for a reload.
- **Rollback:** redeploy the previous commit, with the v1 app **and** its v1 `public/data`
  together. The v1 service worker's precache replaces the v2 one. The D1 database needs no change,
  because overrides are keyed by ids that exist in both versions. Never deploy v1 data under a v2
  app, or the reverse. `tests/unit/data/schema-v2.test.ts` tests this in isolation (v1 rejection,
  unchanged Place shape, cache name).
