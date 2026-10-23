/** Scriptable stand-in for `navigator.geolocation` (synthetic positions only). */
import { vi } from 'vitest';
import type { LngLat } from '../../../src/data/index.ts';

export interface FakeGeolocation {
  geolocation: Geolocation;
  watchPosition: ReturnType<typeof vi.fn>;
  clearWatch: ReturnType<typeof vi.fn>;
  /** Delivers a fix to the current watch. */
  emit(lngLat: LngLat, accuracyM: number, timestamp: number): void;
  /** Delivers an error (1 = denied, 2 = unavailable, 3 = timeout). */
  fail(code: 1 | 2 | 3): void;
  /** Installs this fake as navigator.geolocation; returns an undo function. */
  install(): () => void;
}

export function createFakeGeolocation(): FakeGeolocation {
  let onSuccess: PositionCallback | null = null;
  let onError: PositionErrorCallback | null = null;
  let nextId = 1;
  const watchPosition = vi.fn((s: PositionCallback, e?: PositionErrorCallback | null) => {
    onSuccess = s;
    onError = e ?? null;
    return nextId++;
  });
  const clearWatch = vi.fn(() => {
    onSuccess = null;
    onError = null;
  });
  const geolocation = {
    watchPosition,
    clearWatch,
    getCurrentPosition: vi.fn(),
  } as unknown as Geolocation;

  return {
    geolocation,
    watchPosition,
    clearWatch,
    emit(lngLat, accuracyM, timestamp) {
      onSuccess?.({
        timestamp,
        coords: {
          longitude: lngLat[0],
          latitude: lngLat[1],
          accuracy: accuracyM,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
      } as unknown as GeolocationPosition);
    },
    fail(code) {
      onError?.({ code, message: 'synthetic' } as unknown as GeolocationPositionError);
    },
    install() {
      const had = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
      Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true });
      return () => {
        if (had) Object.defineProperty(navigator, 'geolocation', had);
        else delete (navigator as { geolocation?: Geolocation }).geolocation;
      };
    },
  };
}

/** Snapshot of both web storages, to prove nothing was written. */
export function storageSnapshot(): string {
  const dump = (s: Storage) => {
    const out: Record<string, string | null> = {};
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k !== null) out[k] = s.getItem(k);
    }
    return out;
  };
  return JSON.stringify({ local: dump(localStorage), session: dump(sessionStorage) });
}
