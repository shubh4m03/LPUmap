/**
 * Decides whether a GPS fix is trustworthy enough to drive progress and
 * distance tracking. Pure; the caller passes the previous *accepted* sample.
 */
import { APP_CONFIG } from '../config/index.ts';
import { haversineM, isValidLngLat } from '../distance/index.ts';
import type { GeoSample, SampleClassification } from './types.ts';

export function isWellFormedSample(sample: GeoSample): boolean {
  return (
    isValidLngLat(sample.lngLat) &&
    Number.isFinite(sample.accuracyM) &&
    sample.accuracyM >= 0 &&
    Number.isFinite(sample.timestamp)
  );
}

/**
 * Checks, in order: well-formed → accuracy → freshness → ordering → plausible
 * speed. The speed check subtracts both fixes' accuracy radii from the
 * displacement so two noisy but honest fixes are not called a jump.
 */
export function classifySample(sample: GeoSample, prev: GeoSample | null, now: number): SampleClassification {
  if (!isWellFormedSample(sample)) return { accepted: false, reason: 'invalid' };
  if (sample.accuracyM > APP_CONFIG.geolocation.maxAcceptedAccuracyM) {
    return { accepted: false, reason: 'low-accuracy' };
  }
  if (now - sample.timestamp > APP_CONFIG.geolocation.staleAfterMs)
    return { accepted: false, reason: 'stale' };
  if (prev) {
    if (sample.timestamp <= prev.timestamp) return { accepted: false, reason: 'out-of-order' };
    const dtS = (sample.timestamp - prev.timestamp) / 1000;
    const displacementM = haversineM(prev.lngLat, sample.lngLat);
    const unexplainedM = Math.max(0, displacementM - sample.accuracyM - prev.accuracyM);
    if (unexplainedM / dtS > APP_CONFIG.tracking.maxPlausibleSpeedMps) {
      return { accepted: false, reason: 'implausible-jump' };
    }
  }
  return { accepted: true };
}
