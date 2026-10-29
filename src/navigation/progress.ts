/**
 * Follows a user's progress along a planned route.
 *
 * Progress is monotonic: each accepted fix is projected only onto a forward
 * window of the route around the last progress, so a route that doubles back
 * on itself cannot make progress leap to the return leg. Off-route and
 * arrival are debounced over consecutive accepted fixes so one bad sample
 * never changes either flag. Remaining time scales the planner's own
 * duration estimate; nothing here invents a speed.
 */
import { APP_CONFIG } from '../config/index.ts';
import type { LngLat } from '../data/index.ts';
import {
  cumulativeLengthsM,
  haversineM,
  pointAtDistance,
  projectOntoPolylineRange,
  slicePolyline,
} from '../distance/index.ts';
// Internal imports (same owner) keep this pure module free of the React hook in the barrel.
import { classifySample } from '../geolocation/filter.ts';
import type { GeoSample, SampleRejection } from '../geolocation/types.ts';

/** How far behind the last progress a fix may still snap (GPS noise). */
export const BACKWARD_WINDOW_M = 30;
/** Minimum forward search distance from the last progress. */
export const FORWARD_WINDOW_MIN_M = 150;
/** Forward window also grows with observed displacement × this factor (routes wind). */
const FORWARD_WINDOW_DISPLACEMENT_FACTOR = 1.5;
/**
 * Where a fix is equally close to two parts of the route (a path walked out
 * and back), prefer the part nearest the current progress, and going
 * backwards much less than going forwards: metres of route behind progress
 * cost 1 m each, metres ahead 0.1 m each. So a fix a few metres "behind" on
 * the outbound leg stays there, while after the turn-around the return leg
 * (ahead) wins over the outbound leg the same distance behind.
 */
const BEHIND_COST_PER_M = 1;
const AHEAD_COST_PER_M = 0.1;

function continuityCost(progressM: number) {
  return (c: { distanceFromLineM: number; distanceAlongM: number }) =>
    c.distanceFromLineM +
    (c.distanceAlongM < progressM
      ? (progressM - c.distanceAlongM) * BEHIND_COST_PER_M
      : (c.distanceAlongM - progressM) * AHEAD_COST_PER_M);
}

export interface ProgressState {
  distanceAlongM: number;
  remainingM: number;
  remainingS: number;
  plannedDistanceM: number;
  /** As-the-crow-flies distance to the destination — not a route distance. NaN until a fix is accepted. */
  straightLineToDestinationM: number;
  snappedPoint: LngLat | null;
  distanceFromRouteM: number | null;
  offRoute: boolean;
  arrived: boolean;
  completedCoords: LngLat[];
  remainingCoords: LngLat[];
  lastSampleAccepted: boolean;
  rejection?: SampleRejection;
}

export interface RouteProgressInput {
  coordinates: LngLat[];
  distanceM: number;
  durationS: number;
}

export interface RouteProgress {
  update(sample: GeoSample, now?: number): ProgressState;
  readonly state: ProgressState | null;
}

export function createRouteProgress(route: RouteProgressInput): RouteProgress {
  const coords = route.coordinates;
  if (coords.length === 0) throw new RangeError('Route has no coordinates');
  const cumulative = cumulativeLengthsM(coords);
  const totalM = cumulative[cumulative.length - 1]!;
  const destination = coords[coords.length - 1]!;
  const secondsPerM = route.distanceM > 0 && route.durationS >= 0 ? route.durationS / route.distanceM : 0;
  const cfg = APP_CONFIG.tracking;

  let state: ProgressState | null = null;
  let lastAccepted: GeoSample | null = null;
  let progressM = 0;
  let snapped: LngLat | null = null;
  let distanceFromRouteM: number | null = null;
  let straightLineM = Number.NaN;
  let farCount = 0;
  let aheadCount = 0;
  let aheadCandidateM = 0;
  let arrivalCount = 0;
  let arrived = false;

  function build(accepted: boolean, rejection?: SampleRejection): ProgressState {
    const remainingM = Math.max(0, totalM - progressM);
    const next: ProgressState = {
      distanceAlongM: progressM,
      remainingM,
      remainingS: remainingM * secondsPerM,
      plannedDistanceM: totalM,
      straightLineToDestinationM: straightLineM,
      snappedPoint: snapped,
      distanceFromRouteM,
      offRoute: farCount >= cfg.offRouteConsecutive,
      arrived,
      completedCoords: snapped ? slicePolyline(coords, 0, progressM, cumulative) : [],
      remainingCoords: slicePolyline(coords, progressM, totalM, cumulative),
      lastSampleAccepted: accepted,
    };
    if (rejection) next.rejection = rejection;
    return next;
  }

  function update(sample: GeoSample, now: number = Date.now()): ProgressState {
    const verdict = classifySample(sample, lastAccepted, now);
    if (!verdict.accepted) {
      state = build(false, verdict.reason);
      return state;
    }
    const prev = lastAccepted;
    lastAccepted = sample;
    const p = sample.lngLat;
    const thresholdM = Math.max(cfg.offRouteBaseM, sample.accuracyM);
    straightLineM = haversineM(p, destination);

    const displacementM = prev ? haversineM(prev.lngLat, p) : 0;
    const forwardM = Math.max(
      FORWARD_WINDOW_MIN_M,
      displacementM * FORWARD_WINDOW_DISPLACEMENT_FACTOR + sample.accuracyM,
    );
    const cost = continuityCost(progressM);
    let windowed = projectOntoPolylineRange(
      p,
      coords,
      progressM - BACKWARD_WINDOW_M,
      progressM + forwardM,
      cumulative,
      cost,
    )!;
    if (!prev && windowed.distanceFromLineM > thresholdM) {
      // First fix: nothing to protect yet, so acquire wherever the user is on the route.
      windowed = projectOntoPolylineRange(p, coords, 0, totalM, cumulative, cost)!;
    }

    // Where this fix itself lies along the route (null when it is not on the route).
    let fixAlongM: number | null = null;
    if (windowed.distanceFromLineM <= thresholdM) {
      fixAlongM = windowed.distanceAlongM;
      farCount = 0;
      aheadCount = 0;
      distanceFromRouteM = windowed.distanceFromLineM;
      progressM = Math.max(progressM, windowed.distanceAlongM);
    } else {
      // Not near the expected stretch. If the fix sits on the route further
      // ahead (e.g. a shortcut), re-acquire there after enough confirmations;
      // otherwise count it towards off-route.
      const ahead = projectOntoPolylineRange(p, coords, progressM + forwardM, totalM, cumulative);
      if (ahead && ahead.distanceFromLineM <= thresholdM) {
        farCount = 0;
        aheadCount = aheadCount > 0 && ahead.distanceAlongM >= aheadCandidateM ? aheadCount + 1 : 1;
        aheadCandidateM = ahead.distanceAlongM;
        distanceFromRouteM = ahead.distanceFromLineM;
        if (aheadCount >= cfg.offRouteConsecutive) {
          progressM = ahead.distanceAlongM;
          fixAlongM = progressM;
          aheadCount = 0;
        }
      } else {
        aheadCount = 0;
        farCount++;
        distanceFromRouteM = windowed.distanceFromLineM;
      }
    }
    snapped = pointAtDistance(coords, progressM, cumulative);

    // Arrival is judged on this fix, not the monotonic high-water mark, so an
    // overshooting fix followed by one well short of the end does not count.
    // The straight-line test is limited to the last stretch of the route so a
    // destination that happens to lie near the start cannot trigger it early.
    const nearByStraightLine =
      straightLineM <= cfg.arrivalRadiusM && totalM - progressM <= FORWARD_WINDOW_MIN_M;
    const nearByRoute = fixAlongM !== null && totalM - fixAlongM < cfg.arrivalRadiusM;
    if (nearByStraightLine || nearByRoute) arrivalCount++;
    else arrivalCount = 0;
    if (arrivalCount >= cfg.arrivalConsecutive) arrived = true;

    state = build(true);
    return state;
  }

  return {
    update,
    get state() {
      return state;
    },
  };
}
