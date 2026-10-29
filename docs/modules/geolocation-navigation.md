# Module: geolocation and navigation

**Paths:**

- `src/geolocation/`: the watcher and React hook (browser API), and the sample filter (pure)
- `src/navigation/`: route progress and walk tracking (pure)

## Purpose

This module turns the browser's Geolocation API into a stream of **trustworthy** position samples.
It then tracks progress along a route (remaining distance and time, off-route, arrival), or measures
a free walk. It never stores or transmits a position.

## Public interface

### `src/geolocation/index.ts`

```ts
type GeoSample = { lngLat: LngLat; accuracyM: number; timestamp: number; speedMps: number | null; headingDeg: number | null };
type GeoStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'unavailable' | 'timeout' | 'unsupported' | 'error';
type SampleRejection = 'invalid' | 'low-accuracy' | 'stale' | 'out-of-order' | 'implausible-jump';

classifySample(sample, prevAccepted: GeoSample | null, now): { accepted: true } | { accepted: false; reason }
isWellFormedSample(v): boolean
toGeoSample(position: GeolocationPosition): GeoSample
createGeolocationWatcher({ geolocation?, secureContext?, onSample, onStatus }): { start(); stop(); status; active }
useGeolocation({ geolocation?, secureContext?, now? }?): { status, lastSample, stale, message?, start(), stop() }
GEO_MESSAGES   // user-facing status messages
```

### `src/navigation/index.ts`

```ts
createRouteProgress({ coordinates, distanceM, durationS }): { update(sample, now?): ProgressState; readonly state }
// ProgressState: distanceAlongM, remainingM, remainingS, plannedDistanceM, straightLineToDestinationM,
//   snappedPoint, distanceFromRouteM, offRoute, arrived, completedCoords, remainingCoords,
//   lastSampleAccepted, rejection?
createTrackingSession(startedAt): { addSample(s, now?); snapshot(now?); stop(now?) }
// TrackingSnapshot: travelledM, elapsedS, averageSpeedMps | null, movement: 'moving' | 'stationary' | 'unknown',
//   acceptedSamples, rejectedSamples, path
BACKWARD_WINDOW_M, FORWARD_WINDOW_MIN_M, MOVEMENT_WINDOW_MS, AVERAGE_SPEED_MIN_SAMPLES, AVERAGE_SPEED_MIN_ELAPSED_S
```

## Behaviour and invariants

- **Gesture-only start.** `start()` must be called from a user action. The app's nav slice exposes
  `startLocation`, `startNavigation` and `startTracking` only to buttons and commands.
- **Watcher options.** `enableHighAccuracy`, with `timeout` 15 s and `maximumAge` 5 s
  (`APP_CONFIG.geolocation`).
- **Watcher errors.**
  - Error 1 → `denied`, and the watch is cleared.
  - Error 2 → `unavailable`; error 3 → `timeout`. In both cases the watcher keeps watching.
  - No API, or an insecure context → `unsupported`, without prompting.
  - `stop()` clears the watch id, is idempotent, and late callbacks are ignored.
- **Sample filter**, in order:
  - invalid
  - `low-accuracy` (> 50 m)
  - `stale` (> 30 s old)
  - `out-of-order`
  - `implausible-jump` (implied speed after subtracting both accuracy radii > 8 m/s)

  Rejected samples never move progress or add distance.

- **Progress.**
  - Each accepted fix is projected onto the route inside a monotonic window: 30 m back, and forward
    by at least 150 m or 1.5 × the displacement.
  - `offRoute` becomes true only after `offRouteConsecutive` (3) accepted fixes farther than
    max(30 m, accuracy) from the route.
  - `arrived` becomes true after `arrivalConsecutive` (2) fixes either within `arrivalRadiusM` (20 m)
    of the end with at most 150 m of route remaining, or with less than 20 m of route remaining.
  - `remainingS` scales the route's planned duration by the remaining distance.
  - `straightLineToDestinationM` is `NaN` (shown as "—") until the first accepted fix.
- **Tracking.** Distance accumulates only when the current position estimate is farther than
  max(`minStepM` 4 m, accuracy × 0.6) from the last counted anchor. Raw sample-to-sample hops are
  never summed.
  - **Jitter suppression (G-25).** While fixes arrive densely (at least 3 accepted fixes within
    5 s), the position estimate is the accuracy-weighted mean (weight 1/accuracy²) of the accepted
    fixes in the last 6 s. Otherwise it is the latest fix, as before. Standing still, the mean barely
    moves. When walking, it trails the walker by about half the window, so distance is delayed, not
    lost.
  - The average speed is shown only after 3 fixes and 10 s.
  - Movement is classified over a 20 s window (stationary below 0.3 m/s).
- **Privacy.** Nothing in these modules persists, logs or sends samples. The tracking path is kept in
  memory and returned as copies.

## Tests

`tests/unit/geolocation/*` (3 files) and `tests/unit/navigation/*` (3 test files and the `gps-fixtures.ts` generator):

- filter rules and edge cases
- the watcher against a fake Geolocation (`tests/unit/geolocation/fake-geolocation.ts`): denied,
  timeout, unavailable, unsupported or insecure context, idempotent stop, late callbacks
- hook staleness on `visibilitychange`
- progress (windows, off-route, arrival, out-and-back routes)
- tracker jitter suppression
- tracker accuracy on seeded synthetic tracks (`tests/unit/navigation/tracker-accuracy.test.ts`,
  generated by `gps-fixtures.ts`)

UI integration is tested in `tests/unit/navigation-ui/*` and `tests/unit/directions/*`.

## Known limitations

- **Tracker accuracy (G-25).** The tolerances are checked on deterministic synthetic tracks (ten
  seeds each, 1 Hz fixes reporting 10 m accuracy). The noise is invented, not recorded, so these
  figures are regression bounds, not a claim about real devices. Measured on 2026-10-29:

  | Track                                          | Before (mean / max) | After (mean / max) | Tolerance in the test      |
  | ---------------------------------------------- | ------------------- | ------------------ | -------------------------- |
  | Standing, 50 fixes, uniform ±5 m               | 113.6 m / 154.7 m   | 1.3 m / 6.4 m      | max ≤ 10 m, mean ≤ 3 m     |
  | Standing 2 min, Gaussian (95 % radius 10 m)    | 687.5 m / 785.1 m   | 12.0 m / 32.4 m    | max ≤ 40 m, mean ≤ 20 m    |
  | Standing 2 min, Gaussian 20 m (accuracy 20 m)  | 1374.9 m / 1570.2 m | 24.0 m / 64.7 m    | mean ≤ 40 m                |
  | Standing 2 min, correlated AR(1) 10 m          | 81.8 m / 107.8 m    | 25.4 m / 37.6 m    | mean ≤ 40 m                |
  | Slow walk 200 m at 0.5 m/s, ±5 m               | 782.3 m / 920.5 m   | 201.2 m / 204.6 m  | each run ±5 %              |
  | Slow walk 200 m, Gaussian 10 m                 | 2328.8 m / 2502.6 m | 215.4 m / 241.8 m  | mean ±10 %, each run ±25 % |
  | Normal walk 200 m at 1.3 m/s, ±5 m             | 380.4 m / 452.3 m   | 194.7 m / 198.9 m  | each run ±6 %              |
  | Normal walk 200 m, Gaussian 10 m               | 915.7 m / 1026.9 m  | 202.0 m / 220.5 m  | mean ±5 %, each run ±15 %  |
  | L-shaped 200 m with a 60 s stop, Gaussian 10 m | 1239.6 m / 1410.4 m | 211.8 m / 239.6 m  | mean ±10 %, each run ±25 % |

  Remaining limits: slowly wandering (correlated) error cannot be told apart from creeping, so a
  long stationary period can still add a few tens of metres. Sparse fixes (fewer than 3 within 5 s)
  are not smoothed, so they get only the anchor rule. A walk's last 2–3 s may not be counted. None of
  this has been checked on a real device yet. An independent check on the same generator (2026-10-29,
  ten seeds, Gaussian 10 m; not in the test file) also measured: with one fix every 3 s nothing is
  smoothed and a 199 m walk counts 373.2 m (the same as before G-25); a 156 m zigzag turning ±60°
  every 10 s counts 110.0 m (−30 %), because the 6 s average cuts the corners; standing 10 minutes
  counts 62.8 m mean, 98.9 m max (was 3,419 m).

- **Walking backwards** more than 30 m behind progress counts as leaving the route window.
  `distanceFromRouteM` is then the distance to the window edge, and `offRoute` follows after 3 fixes.
- **Parallel legs.** On switchbacks with legs about 20 m apart, one noisy accepted fix can advance
  progress onto the next leg permanently. This is inherent to the forward-window design.
- **Window constants** (30 m back, 150 m forward, 20 s movement window) are module constants, not
  `APP_CONFIG` keys.
- **Device testing.** These modules have been tested only with fake geolocation, in jsdom and
  Playwright. Real permission prompts, background-tab behaviour and accuracy on campus are
  **unverified** (see [QA_STRATEGY.md](../QA_STRATEGY.md#what-needs-human-or-on-device-verification)).
