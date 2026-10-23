/**
 * Cumulative distance / time tracking for a walk or ride.
 *
 * Only accepted fixes count. Distance is accumulated anchor-to-anchor: the
 * anchor moves (and distance is added) only when a fix is farther from the
 * current anchor than max(minStepM, accuracy × accuracyFactor). Standing still
 * with GPS wander inside half that threshold therefore adds nothing; larger
 * independent jitter is damped but can still add some distance (it is far
 * below summing raw sample hops). The path is kept in memory only.
 */
import { APP_CONFIG } from '../config/index.ts';
import type { LngLat } from '../data/schema.ts';
import { haversineM } from '../distance/index.ts';
// Internal imports (same owner) keep this pure module free of the React hook in the barrel.
import { classifySample } from '../geolocation/filter.ts';
import type { GeoSample } from '../geolocation/types.ts';

/** Recent window used to classify moving vs stationary. */
export const MOVEMENT_WINDOW_MS = 20_000;
/** The window must span at least this long before movement is reported. */
const MOVEMENT_MIN_SPAN_MS = 5_000;
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

  function addSample(s: GeoSample, now: number = Date.now()): TrackingSnapshot {
    if (ended) return snapshot();
    const verdict = classifySample(s, lastAccepted, now);
    if (!verdict.accepted) {
      rejected++;
      return snapshot(now);
    }
    accepted++;
    lastAccepted = s;
    if (!anchor) {
      anchor = s.lngLat;
      path.push(s.lngLat);
    } else {
      const stepM = haversineM(anchor, s.lngLat);
      if (stepM > Math.max(cfg.minStepM, s.accuracyM * cfg.accuracyFactor)) {
        travelledM += stepM;
        anchor = s.lngLat;
        path.push(s.lngLat);
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
