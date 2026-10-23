import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';
import { useGeolocation } from '../../../src/geolocation/index.ts';
import { createFakeGeolocation } from './fake-geolocation.ts';

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useGeolocation', () => {
  afterEach(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });

  it('stays idle and does not request location until start() is called', () => {
    const fake = createFakeGeolocation();
    const { result } = renderHook(() =>
      useGeolocation({ geolocation: fake.geolocation, secureContext: true }),
    );
    expect(result.current.status).toBe('idle');
    expect(result.current.lastSample).toBeNull();
    expect(fake.watchPosition).not.toHaveBeenCalled();
  });

  it('starts, receives samples and stops', () => {
    const fake = createFakeGeolocation();
    const { result } = renderHook(() =>
      useGeolocation({ geolocation: fake.geolocation, secureContext: true }),
    );
    act(() => result.current.start());
    expect(result.current.status).toBe('requesting');
    expect(result.current.message).toMatch(/never stored or sent/);
    act(() => fake.emitPosition(75.7, 31.25, { accuracy: 6, timestamp: 5000 }));
    expect(result.current.status).toBe('active');
    expect(result.current.lastSample?.lngLat).toEqual([75.7, 31.25]);
    act(() => result.current.stop());
    expect(result.current.status).toBe('idle');
    expect(fake.clearWatch).toHaveBeenCalledTimes(1);
  });

  it('exposes the denial message', () => {
    const fake = createFakeGeolocation();
    const { result } = renderHook(() =>
      useGeolocation({ geolocation: fake.geolocation, secureContext: true }),
    );
    act(() => result.current.start());
    act(() => fake.emitError(1));
    expect(result.current.status).toBe('denied');
    expect(result.current.message).toMatch(/site settings/);
  });

  it('stops the watch on unmount', () => {
    const fake = createFakeGeolocation();
    const { result, unmount } = renderHook(() =>
      useGeolocation({ geolocation: fake.geolocation, secureContext: true }),
    );
    act(() => result.current.start());
    expect(fake.watchCount).toBe(1);
    unmount();
    expect(fake.clearWatch).toHaveBeenCalledTimes(1);
    expect(fake.watchCount).toBe(0);
  });

  it('marks the last sample stale when the tab becomes visible after staleAfterMs', () => {
    const fake = createFakeGeolocation();
    let clock = 100_000;
    const { result } = renderHook(() =>
      useGeolocation({ geolocation: fake.geolocation, secureContext: true, now: () => clock }),
    );
    act(() => result.current.start());
    act(() => fake.emitPosition(75.7, 31.25, { timestamp: clock }));
    expect(result.current.stale).toBe(false);

    act(() => setVisibility('hidden'));
    clock += APP_CONFIG.geolocation.staleAfterMs - 1;
    act(() => setVisibility('visible'));
    expect(result.current.stale).toBe(false);

    act(() => setVisibility('hidden'));
    clock += 2;
    act(() => setVisibility('visible'));
    expect(result.current.stale).toBe(true);

    act(() => fake.emitPosition(75.7, 31.25, { timestamp: clock }));
    expect(result.current.stale).toBe(false);
  });

  it('reports unsupported when no Geolocation API exists', () => {
    const { result } = renderHook(() => useGeolocation({ geolocation: undefined }));
    act(() => result.current.start());
    expect(result.current.status).toBe('unsupported');
    expect(result.current.message).toBeTruthy();
  });
});
