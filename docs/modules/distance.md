# Module: distance

**Path:** `src/distance/` (pure TypeScript; also imported by `scripts/` and other pure modules)

## Purpose

Distances, bearings and polyline geometry for the whole app, plus a spatial index and human-readable
formatting. The contract requires every metric distance in the codebase to come from here.

## Public interface (`src/distance/index.ts`)

```ts
// geodesic.ts
EARTH_RADIUS_M                                   // 6_371_008.8 (mean Earth radius)
haversineM(a: LngLat, b: LngLat): number
bearingDeg(a: LngLat, b: LngLat): number
destinationPoint(p: LngLat, bearingDeg: number, distanceM: number): LngLat
isValidLngLat(v: unknown): v is LngLat
createLocalProjection(origin: LngLat): LocalProjection   // metres east/north ↔ lon/lat, for short spans
// polyline.ts
polylineLengthM(coords: readonly LngLat[]): number
cumulativeLengthsM(coords: readonly LngLat[]): number[]  // cum[0] = 0; [] for empty input
projectOntoPolyline(p, coords, cumulative?): PolylineProjection | null
  // { segmentIndex, t, point, distanceFromLineM, distanceAlongM }; ties → earliest segment
projectOntoPolylineRange(p, coords, fromM, toM, cumulative?, cost?)   // windowed projection (used by navigation)
pointAtDistance(coords, m, cumulative?): LngLat | null                 // clamped
slicePolyline(coords, fromM, toM, cumulative?): LngLat[]               // interpolated ends
// spatial-index.ts
createGridIndex<T>(items, getLocation, cellSizeM = DEFAULT_GRID_CELL_SIZE_M /* 100 */): GridIndex<T>
  // { nearest(p, k, maxDistanceM?), within(p, radiusM), size } → Array<{ item, distanceM }>
// format.ts
formatDistance(m): string   // '< 10 m', 5 m steps < 100 m, 10 m steps < 1 km, '1.2 km', '12 km'
formatDuration(s): string   // 'under 1 min', '7 min', '1 h 5 min', '2 h'
formatSpeed(mps | null): string   // 'x.x km/h'
UNKNOWN_LABEL               // '—', used for invalid input (e.g. NaN)
```

## Invariants

- Coordinates are `[lon, lat]`. Invalid inputs return `null`, `[]` or `UNKNOWN_LABEL`; nothing throws
  on bad coordinates.
- Grid-index results use haversine distances and are sorted by distance, then input order. They are
  **exact** against brute force, thanks to a 0.99 safety factor on the local-projection cell
  geometry. Invalid item locations are skipped. `cellSizeM <= 0` throws `RangeError`.
- `polylineLengthM(coords)` is the sum of haversine segment lengths. The router guarantees
  `RouteOk.distanceM === polylineLengthM(coordinates)`.
- Formatting never shows false precision: 5 m steps below 100 m, 10 m steps below 1 km.

## Tests

`tests/unit/distance/*` (4 files): haversine and bearing against reference values, destination
round-trips, projection and slicing edge cases (empty, degenerate, reversed ranges), grid index
against brute force at several spreads, and formatting boundaries.

## Known limitations

- A spherical model: up to about 0.5 % error against the WGS-84 ellipsoid, which is negligible at
  campus scale (see [ARCHITECTURE.md](../ARCHITECTURE.md#key-decisions)).
- Local projections are intended for spans of up to hundreds of kilometres. Distortion beyond that is
  not handled, and is never needed here.
- The functions accept `readonly` arrays, a widening of the original contract.
