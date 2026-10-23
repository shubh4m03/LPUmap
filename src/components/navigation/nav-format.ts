/** Pure wording and state helpers for the navigation HUD and walk tracking. */
import { APP_CONFIG } from '../../config/index.ts';
import type { GeoSample, GeoStatus } from '../../geolocation/index.ts';
import type { Movement, ProgressState } from '../../navigation/index.ts';

export type GpsState =
  | { kind: 'waiting' }
  | { kind: 'good'; accuracyM: number }
  | { kind: 'weak'; reason: 'low-accuracy' | 'stale' | 'jump'; accuracyM: number };

/** Quality of the latest fix, judged with the same thresholds the progress filter uses. */
export function gpsState(sample: GeoSample | null, now: number, progress?: ProgressState | null): GpsState {
  if (!sample) return { kind: 'waiting' };
  const g = APP_CONFIG.geolocation;
  if (now - sample.timestamp > g.staleAfterMs)
    return { kind: 'weak', reason: 'stale', accuracyM: sample.accuracyM };
  if (sample.accuracyM > g.maxAcceptedAccuracyM || progress?.rejection === 'low-accuracy') {
    return { kind: 'weak', reason: 'low-accuracy', accuracyM: sample.accuracyM };
  }
  // A fix the progress filter just refused (an implausible jump) is not trusted either.
  if (progress && !progress.lastSampleAccepted && progress.rejection === 'implausible-jump') {
    return { kind: 'weak', reason: 'jump', accuracyM: sample.accuracyM };
  }
  return { kind: 'good', accuracyM: sample.accuracyM };
}

/** "GPS ±12 m" / "Weak GPS signal — progress paused" / "Waiting for GPS…". */
export function gpsLabel(state: GpsState, mode: 'navigation' | 'tracking'): string {
  if (state.kind === 'waiting') return 'Waiting for GPS…';
  if (state.kind === 'good') return `GPS ±${Math.round(state.accuracyM)} m`;
  return `Weak GPS signal — ${mode === 'navigation' ? 'progress' : 'distance'} paused`;
}

/** Location problems worth a line in the HUD (the toast explains them in full too). */
export function geoProblem(status: GeoStatus): { text: string; retry: boolean } | null {
  switch (status) {
    case 'denied':
      return {
        text: "Location access is blocked, so your position can't be followed. Allow location for this site in your browser's site settings.",
        retry: false,
      };
    case 'unsupported':
      return { text: 'Location is not available in this browser.', retry: false };
    case 'unavailable':
      return { text: "Your device can't determine a location right now. Still trying.", retry: true };
    case 'timeout':
      return { text: 'Getting a location fix is taking longer than expected.', retry: true };
    case 'error':
      return { text: 'Something went wrong while reading your location.', retry: true };
    default:
      return null;
  }
}

export const MOVEMENT_LABEL: Record<Movement, string> = {
  moving: 'Moving',
  stationary: 'Not moving',
  unknown: 'Movement not known yet',
};

/** Share of the planned route covered, 0–100 (integer). */
export function progressPercent(p: ProgressState | null): number {
  if (!p || !(p.plannedDistanceM > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((p.distanceAlongM / p.plannedDistanceM) * 100)));
}

/** Elapsed seconds since `startedAt` (never negative). */
export function elapsedSince(startedAt: number | null, now: number): number {
  return startedAt === null ? 0 : Math.max(0, (now - startedAt) / 1000);
}
