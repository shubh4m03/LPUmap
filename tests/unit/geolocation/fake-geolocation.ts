import { vi } from 'vitest';

/** Minimal controllable stand-in for the browser Geolocation API. */
export function createFakeGeolocation(opts: { syncError?: number } = {}) {
  let nextId = 1;
  const watches = new Map<number, { ok: PositionCallback; err: PositionErrorCallback | null | undefined }>();
  const watchPosition = vi.fn(
    (ok: PositionCallback, err?: PositionErrorCallback | null, _options?: PositionOptions): number => {
      const id = nextId++;
      watches.set(id, { ok, err });
      if (opts.syncError !== undefined) err?.(positionError(opts.syncError));
      return id;
    },
  );
  const clearWatch = vi.fn((id: number) => {
    watches.delete(id);
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
    get watchCount() {
      return watches.size;
    },
    emitPosition(
      lng: number,
      lat: number,
      extra: Partial<GeolocationCoordinates> & { timestamp?: number } = {},
    ) {
      const { timestamp = Date.now(), ...coords } = extra;
      const position = {
        timestamp,
        coords: {
          longitude: lng,
          latitude: lat,
          accuracy: 8,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          ...coords,
        },
      } as unknown as GeolocationPosition;
      for (const w of [...watches.values()]) w.ok(position);
    },
    emitError(code: number) {
      for (const w of [...watches.values()]) w.err?.(positionError(code));
    },
  };
}

function positionError(code: number): GeolocationPositionError {
  return {
    code,
    message: 'fake',
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  } as GeolocationPositionError;
}
