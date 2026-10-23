import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';
import { GEO_MESSAGES, createGeolocationWatcher } from '../../../src/geolocation/index.ts';
import type { GeoSample, GeoStatus } from '../../../src/geolocation/index.ts';
import { createFakeGeolocation } from './fake-geolocation.ts';

function setup(fake = createFakeGeolocation(), secureContext = true) {
  const samples: GeoSample[] = [];
  const statuses: Array<[GeoStatus, string | undefined]> = [];
  const watcher = createGeolocationWatcher({
    geolocation: fake.geolocation,
    secureContext,
    onSample: (s) => samples.push(s),
    onStatus: (s, m) => statuses.push([s, m]),
  });
  return { fake, watcher, samples, statuses };
}

describe('createGeolocationWatcher', () => {
  afterEach(() => vi.restoreAllMocks());

  it('watches with high accuracy and configured timeout/maximumAge', () => {
    const { fake, watcher, statuses } = setup();
    watcher.start();
    expect(fake.watchPosition).toHaveBeenCalledTimes(1);
    expect(fake.watchPosition.mock.calls[0]![2]).toEqual({
      enableHighAccuracy: true,
      timeout: APP_CONFIG.geolocation.timeoutMs,
      maximumAge: APP_CONFIG.geolocation.maximumAgeMs,
    });
    expect(watcher.active).toBe(true);
    expect(statuses[0]![0]).toBe('requesting');
  });

  it('maps positions to samples and becomes active', () => {
    const { fake, watcher, samples } = setup();
    watcher.start();
    fake.emitPosition(75.7, 31.25, { accuracy: 12, speed: 1.2, heading: 45, timestamp: 1000 });
    fake.emitPosition(75.7, 31.25, { accuracy: 12, speed: 0, heading: 45, timestamp: 2000 });
    expect(watcher.status).toBe('active');
    expect(samples[0]).toEqual({
      lngLat: [75.7, 31.25],
      accuracyM: 12,
      timestamp: 1000,
      speedMps: 1.2,
      headingDeg: 45,
    });
    expect(samples[1]!.headingDeg).toBeNull();
  });

  it('drops fixes with invalid coordinates', () => {
    const { fake, watcher, samples } = setup();
    watcher.start();
    fake.emitPosition(Number.NaN, 31.25);
    expect(samples).toHaveLength(0);
  });

  it('reports permission denied with an explanation and clears the watch', () => {
    const { fake, watcher, statuses } = setup();
    watcher.start();
    fake.emitError(1);
    expect(watcher.status).toBe('denied');
    expect(watcher.active).toBe(false);
    expect(fake.clearWatch).toHaveBeenCalledTimes(1);
    const message = statuses.at(-1)![1]!;
    expect(message).toBe(GEO_MESSAGES.denied);
    expect(message).toMatch(/only on this device/);
    expect(message).toMatch(/site settings/);
    watcher.stop();
    expect(fake.clearWatch).toHaveBeenCalledTimes(1);
  });

  it('clears the watch when denial is reported synchronously', () => {
    const { fake, watcher } = setup(createFakeGeolocation({ syncError: 1 }));
    watcher.start();
    expect(watcher.status).toBe('denied');
    expect(fake.clearWatch).toHaveBeenCalledTimes(1);
    expect(fake.watchCount).toBe(0);
  });

  it('reports unavailable and timeout but keeps watching, recovering on the next fix', () => {
    const { fake, watcher, statuses } = setup();
    watcher.start();
    fake.emitError(2);
    expect(watcher.status).toBe('unavailable');
    expect(statuses.at(-1)![1]).toBe(GEO_MESSAGES.unavailable);
    fake.emitError(3);
    expect(watcher.status).toBe('timeout');
    expect(statuses.at(-1)![1]).toBe(GEO_MESSAGES.timeout);
    expect(watcher.active).toBe(true);
    fake.emitPosition(75.7, 31.25);
    expect(watcher.status).toBe('active');
  });

  it('maps unknown error codes to error', () => {
    const { fake, watcher } = setup();
    watcher.start();
    fake.emitError(99);
    expect(watcher.status).toBe('error');
  });

  it('is unsupported when the API is absent or the context is insecure', () => {
    const statuses: GeoStatus[] = [];
    const absent = createGeolocationWatcher({
      geolocation: undefined,
      onSample: () => {},
      onStatus: (s) => statuses.push(s),
    });
    absent.start();
    expect(absent.status).toBe('unsupported');
    expect(absent.active).toBe(false);

    const { fake, watcher, statuses: st } = setup(createFakeGeolocation(), false);
    watcher.start();
    expect(watcher.status).toBe('unsupported');
    expect(st.at(-1)![1]).toBe(GEO_MESSAGES.unsupported);
    expect(fake.watchPosition).not.toHaveBeenCalled();
  });

  it('reports error if watchPosition throws', () => {
    const fake = createFakeGeolocation();
    fake.watchPosition.mockImplementation(() => {
      throw new Error('blocked');
    });
    const { watcher } = setup(fake);
    watcher.start();
    expect(watcher.status).toBe('error');
    expect(watcher.active).toBe(false);
  });

  it('stop() clears the watch exactly once and is idempotent', () => {
    const { fake, watcher, statuses } = setup();
    watcher.start();
    watcher.start(); // second start is a no-op while active
    expect(fake.watchPosition).toHaveBeenCalledTimes(1);
    watcher.stop();
    watcher.stop();
    expect(fake.clearWatch).toHaveBeenCalledTimes(1);
    expect(fake.clearWatch).toHaveBeenCalledWith(1);
    expect(watcher.status).toBe('idle');
    expect(statuses.filter(([s]) => s === 'idle')).toHaveLength(1);
  });

  it('ignores callbacks delivered after stop', () => {
    const fake = createFakeGeolocation();
    let late: PositionCallback | null = null;
    fake.watchPosition.mockImplementation((ok: PositionCallback) => {
      late = ok;
      return 7;
    });
    const { watcher, samples } = setup(fake);
    watcher.start();
    watcher.stop();
    late!({
      timestamp: 1,
      coords: { longitude: 75.7, latitude: 31.25, accuracy: 5, heading: null, speed: null },
    } as unknown as GeolocationPosition);
    expect(samples).toHaveLength(0);
    expect(watcher.status).toBe('idle');
  });

  it('never writes coordinates to the console', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const { fake, watcher } = setup();
    watcher.start();
    fake.emitPosition(75.70321, 31.25337);
    fake.emitError(2);
    fake.emitError(1);
    watcher.stop();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
