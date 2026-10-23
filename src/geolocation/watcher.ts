/**
 * Thin, testable wrapper around `Geolocation.watchPosition`.
 *
 * Privacy: samples are handed to `onSample` and nothing else — no logging,
 * storage or network. `start()` must only be called from a user gesture.
 */
import { APP_CONFIG } from '../config/index.ts';
import { isValidLngLat } from '../distance/index.ts';
import type { GeoSample, GeoStatus } from './types.ts';

export interface GeolocationWatcher {
  start(): void;
  stop(): void;
  readonly status: GeoStatus;
  readonly active: boolean;
}

export interface GeolocationWatcherOptions {
  /** Injectable for tests; defaults to navigator.geolocation. */
  geolocation?: Geolocation;
  /** Defaults to the browser's `isSecureContext` (true when it cannot be determined). */
  secureContext?: boolean;
  onSample(s: GeoSample): void;
  onStatus(s: GeoStatus, message?: string): void;
}

const WHY =
  'Campus Atlas uses your location only on this device, to show where you are and follow your route.';

export const GEO_MESSAGES = {
  denied: `Location access is blocked. ${WHY} To turn it back on, allow location for this site in your browser's site settings, then tap the location button again.`,
  unavailable:
    "Your device can't determine a location right now. Check that location services are switched on, or move somewhere with a clearer view of the sky. Still trying.",
  timeout:
    'Getting a location fix is taking longer than expected. Check that location services are switched on. Still trying.',
  unsupported:
    'Location is not available in this browser (it needs location support and a secure https connection). You can still browse and search the map.',
  error: 'Something went wrong while reading your location. Please try again.',
  requesting: `Asking for your location. ${WHY} It is never stored or sent anywhere.`,
} as const;

function defaultGeolocation(): Geolocation | undefined {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator ? navigator.geolocation : undefined;
}

function defaultSecureContext(): boolean {
  const flag = (globalThis as { isSecureContext?: boolean }).isSecureContext;
  return flag !== false;
}

const finiteOrNull = (n: number | null | undefined) =>
  typeof n === 'number' && Number.isFinite(n) ? n : null;

export function toGeoSample(position: GeolocationPosition): GeoSample {
  const c = position.coords;
  const speedMps = finiteOrNull(c.speed);
  return {
    lngLat: [c.longitude, c.latitude],
    accuracyM: c.accuracy,
    timestamp: position.timestamp,
    speedMps,
    // Browsers report a meaningless heading while stationary.
    headingDeg: speedMps === 0 ? null : finiteOrNull(c.heading),
  };
}

export function createGeolocationWatcher(opts: GeolocationWatcherOptions): GeolocationWatcher {
  const geolocation = 'geolocation' in opts ? opts.geolocation : defaultGeolocation();
  const secure = opts.secureContext ?? defaultSecureContext();
  let status: GeoStatus = 'idle';
  let watchId: number | null = null;
  // Incremented on every start/stop so callbacks from an old watch are ignored.
  let generation = 0;

  const setStatus = (next: GeoStatus, message?: string) => {
    if (next === status) return;
    status = next;
    opts.onStatus(next, message);
  };

  const clear = () => {
    if (watchId === null) return;
    const id = watchId;
    watchId = null;
    geolocation?.clearWatch(id);
  };

  function start(): void {
    if (watchId !== null) return;
    if (!geolocation || typeof geolocation.watchPosition !== 'function' || !secure) {
      setStatus('unsupported', GEO_MESSAGES.unsupported);
      return;
    }
    const gen = ++generation;
    let deniedBeforeIdKnown = false;
    setStatus('requesting', GEO_MESSAGES.requesting);
    const onPosition = (position: GeolocationPosition) => {
      if (gen !== generation) return;
      const sample = toGeoSample(position);
      if (!isValidLngLat(sample.lngLat)) return;
      setStatus('active');
      opts.onSample(sample);
    };
    const onError = (err: GeolocationPositionError) => {
      if (gen !== generation) return;
      if (err.code === 1) {
        // Permission denial is final for this watch; the browser will not retry.
        if (watchId === null) deniedBeforeIdKnown = true;
        clear();
        setStatus('denied', GEO_MESSAGES.denied);
      } else if (err.code === 2) setStatus('unavailable', GEO_MESSAGES.unavailable);
      else if (err.code === 3) setStatus('timeout', GEO_MESSAGES.timeout);
      else setStatus('error', GEO_MESSAGES.error);
    };
    try {
      const id = geolocation.watchPosition(onPosition, onError, {
        enableHighAccuracy: true,
        timeout: APP_CONFIG.geolocation.timeoutMs,
        maximumAge: APP_CONFIG.geolocation.maximumAgeMs,
      });
      // Some implementations report denial synchronously, before the id is returned.
      if (deniedBeforeIdKnown) geolocation.clearWatch(id);
      else watchId = id;
    } catch {
      watchId = null;
      setStatus('error', GEO_MESSAGES.error);
    }
  }

  function stop(): void {
    generation++;
    clear();
    setStatus('idle');
  }

  return {
    start,
    stop,
    get status() {
      return status;
    },
    get active() {
      return watchId !== null;
    },
  };
}
