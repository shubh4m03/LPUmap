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
- **Tracking.** Distance accumulates only when an accepted fix is farther than
  max(`minStepM` 4 m, accuracy × 0.6) from the last counted anchor. Raw sample-to-sample hops are
  never summed.
  - The average speed is shown only after 3 fixes and 10 s.
  - Movement is classified over a 20 s window (stationary below 0.3 m/s).
- **Privacy.** Nothing in these modules persists, logs or sends samples. The tracking path is kept in
  memory and returned as copies.

## Tests

`tests/unit/geolocation/*` (3 files) and `tests/unit/navigation/*` (2 files), 51 tests in all:

- filter rules and edge cases
- the watcher against a fake Geolocation (`tests/unit/geolocation/fake-geolocation.ts`): denied,
  timeout, unavailable, unsupported or insecure context, idempotent stop, late callbacks
- hook staleness on `visibilitychange`
- progress (windows, off-route, arrival, out-and-back routes)
- tracker jitter suppression

UI integration is tested in `tests/unit/navigation-ui/*` and `tests/unit/directions/*`.

## Known limitations

- **Tracker jitter.** The anchor rule cannot suppress independent jitter at the full accuracy radius.
  A simulation of 50 stationary fixes at ±5 m with 10 m accuracy counted about 88 m, against about
  224 m for naive summing. Real GPS error is correlated over time, so this is probably pessimistic.
  It must be checked on a device; fixing it would need a contract change (for example, smoothing
  before the anchor rule).
- **Walking backwards** more than 30 m behind progress counts as leaving the route window.
  `distanceFromRouteM` is then the distance to the window edge, and `offRoute` follows after 3 fixes.
- **Parallel legs.** On switchbacks with legs about 20 m apart, one noisy accepted fix can advance
  progress onto the next leg permanently. This is inherent to the forward-window design.
- **Window constants** (30 m back, 150 m forward, 20 s movement window) are module constants, not
  `APP_CONFIG` keys.
- **Device testing.** These modules have been tested only with fake geolocation, in jsdom and
  Playwright. Real permission prompts, background-tab behaviour and accuracy on campus are
  **unverified** (see [QA_STRATEGY.md](../QA_STRATEGY.md#what-needs-human-or-on-device-verification)).
