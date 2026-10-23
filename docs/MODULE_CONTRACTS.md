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

Validated by schemas in `src/data/schema.ts`. Files: `manifest.json`,
`boundary.geojson`, `buildings.geojson`, `basemap.geojson`, `places.json`,
`relations.json`, `graph.json`, `quality-report.json`.

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
