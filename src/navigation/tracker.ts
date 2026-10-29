/**
 * Cumulative distance / time tracking for a walk or ride.
 *
 * Only accepted fixes count. Distance is accumulated anchor-to-anchor: the
 * anchor moves (and distance is added) only when the current position
 * estimate is farther from the anchor than max(minStepM, accuracy ×
 * accuracyFactor). Raw sample-to-sample hops are never summed.
 *
 * Jitter suppression (G-25). Comparing single noisy fixes with that threshold
 * over-counts badly while standing still: two independent fixes with 10 m
 * accuracy are often more than 6 m apart. So once fixes arrive densely (at
 * least DENSE_MIN_FIXES within DENSE_WINDOW_MS), the position estimate is the
 * accuracy-weighted mean of the fixes in the last SMOOTHING_WINDOW_MS instead
 * of the latest fix. Standing still, the mean barely moves; walking, it trails
 * the walker by about half the window but still covers the same ground, so
 * distance is delayed, not lost. An isolated fix carries no information about
 * its noise and is still taken at face value, as before.
 *
 * Measured on the seeded tracks in tests/unit/navigation/gps-fixtures.ts (see
 * tracker-accuracy.test.ts for the tolerances). The path is kept in memory only.
 */
import { APP_CONFIG } from '../config/index.ts';
import type { LngLat } from '../data/index.ts';
import { haversineM } from '../distance/index.ts';
// Internal imports (same owner) keep this pure module free of the React hook in the barrel.
import { classifySample } from '../geolocation/filter.ts';
import type { GeoSample } from '../geolocation/types.ts';

/** Recent window used to classify moving vs stationary. */
export const MOVEMENT_WINDOW_MS = 20_000;
/** The window must span at least this long before movement is reported. */
const MOVEMENT_MIN_SPAN_MS = 5_000;
/** Fixes are averaged over this trailing window once they arrive densely. */
export const SMOOTHING_WINDOW_MS = 6_000;
/** "Densely" means at least DENSE_MIN_FIXES accepted fixes (the new one included) within DENSE_WINDOW_MS. */
export const DENSE_WINDOW_MS = 5_000;
export const DENSE_MIN_FIXES = 3;
/** Accuracy values below this are clamped when weighting, so a 0 m claim cannot dominate. */
const MIN_WEIGHT_ACCURACY_M = 1;
/** Average speed needs this many accepted fixes and this much elapsed time. */
export const AVERAGE_SPEED_MIN_SAMPLES = 3;
export const AVERAGE_SPEED_MIN_ELAPSED_S = 10;

export type Movement = 'moving' | 'stationary' | 'unknown';

export interface TrackingSnapshot {
  travelledM: number;
  elapsedS: number;
  averageSpeedMps: number | null;
  movement: Movement;
  acceptedSamples: number;
  rejectedSamples: number;
  path: LngLat[];
}

export interface TrackingSession {
  addSample(s: GeoSample, now?: number): TrackingSnapshot;
  snapshot(now?: number): TrackingSnapshot;
  stop(now?: number): TrackingSnapshot & { endedAt: number };
}

export function createTrackingSession(startedAt: number): TrackingSession {
  const cfg = APP_CONFIG.tracking;
  let lastAccepted: GeoSample | null = null;
  let anchor: LngLat | null = null;
  let travelledM = 0;
  let accepted = 0;
  let rejected = 0;
  const path: LngLat[] = [];
  // (timestamp, travelled) after each accepted fix, trimmed to the movement window.
  let recent: Array<{ t: number; travelledM: number }> = [];
  // Accepted fixes inside the smoothing window, oldest first.
  let smoothing: GeoSample[] = [];
  let ended: (TrackingSnapshot & { endedAt: number }) | null = null;

  function movement(now: number): Movement {
    const last = recent[recent.length - 1];
    const first = recent[0];
    if (!last || !first || now - last.t > APP_CONFIG.geolocation.staleAfterMs) return 'unknown';
    const spanMs = last.t - first.t;
    if (spanMs < MOVEMENT_MIN_SPAN_MS) return 'unknown';
    const speed = (last.travelledM - first.travelledM) / (spanMs / 1000);
    return speed >= cfg.stationarySpeedMps ? 'moving' : 'stationary';
  }

  function snapshot(now: number = Date.now()): TrackingSnapshot {
    if (ended) {
      const { endedAt: _endedAt, ...frozen } = ended;
      return { ...frozen, path: [...frozen.path] };
    }
    const elapsedS = Math.max(0, (now - startedAt) / 1000);
    const averageSpeedMps =
      accepted >= AVERAGE_SPEED_MIN_SAMPLES && elapsedS >= AVERAGE_SPEED_MIN_ELAPSED_S
        ? travelledM / elapsedS
        : null;
    return {
      travelledM,
      elapsedS,
      averageSpeedMps,
      movement: movement(now),
      acceptedSamples: accepted,
      rejectedSamples: rejected,
      path: [...path],
    };
  }

  /** The latest fix when fixes are sparse; otherwise the weighted mean of the smoothing window. */
  function estimate(s: GeoSample): LngLat {
    let dense = 0;
    for (const w of smoothing) if (s.timestamp - w.timestamp <= DENSE_WINDOW_MS) dense++;
    if (dense < DENSE_MIN_FIXES) return s.lngLat;
    let sw = 0;
    let lng = 0;
    let lat = 0;
    for (const w of smoothing) {
      const acc = Math.max(MIN_WEIGHT_ACCURACY_M, w.accuracyM);
      const weight = 1 / (acc * acc);
      sw += weight;
      lng += weight * w.lngLat[0];
      lat += weight * w.lngLat[1];
    }
    // Averaging degrees is exact enough over a few tens of metres.
    return [lng / sw, lat / sw];
  }

  function addSample(s: GeoSample, now: number = Date.now()): TrackingSnapshot {
    if (ended) return snapshot();
    const verdict = classifySample(s, lastAccepted, now);
    if (!verdict.accepted) {
      rejected++;
      return snapshot(now);
    }
    accepted++;
    lastAccepted = s;
    smoothing.push(s);
    smoothing = smoothing.filter((w) => s.timestamp - w.timestamp <= SMOOTHING_WINDOW_MS);
    const position = estimate(s);
    if (!anchor) {
      anchor = position;
      path.push(position);
    } else {
      const stepM = haversineM(anchor, position);
      if (stepM > Math.max(cfg.minStepM, s.accuracyM * cfg.accuracyFactor)) {
        travelledM += stepM;
        anchor = position;
        path.push(position);
      }
    }
    recent.push({ t: s.timestamp, travelledM });
    recent = recent.filter((r) => s.timestamp - r.t <= MOVEMENT_WINDOW_MS);
    return snapshot(now);
  }

  function stop(now: number = Date.now()): TrackingSnapshot & { endedAt: number } {
    if (!ended) ended = { ...snapshot(now), endedAt: now };
    return { ...ended, path: [...ended.path] };
  }

  return { addSample, snapshot, stop };
}
