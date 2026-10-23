/**
 * React binding for the geolocation watcher. Call `start()` only from a user
 * gesture (button press). The watch is stopped on unmount. Samples live in
 * component state only.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_CONFIG } from '../config/index.ts';
import type { GeoSample, GeoStatus } from './types.ts';
import { createGeolocationWatcher } from './watcher.ts';
import type { GeolocationWatcher } from './watcher.ts';

export interface UseGeolocationOptions {
  /** Injectable for tests; defaults to navigator.geolocation. */
  geolocation?: Geolocation;
  secureContext?: boolean;
  /** Clock used for staleness checks; defaults to Date.now. */
  now?: () => number;
}

export interface UseGeolocationResult {
  status: GeoStatus;
  lastSample: GeoSample | null;
  /** True when the last sample is older than `staleAfterMs` (checked when the tab becomes visible). */
  stale: boolean;
  message?: string;
  start(): void;
  stop(): void;
}

export function useGeolocation(options: UseGeolocationOptions = {}): UseGeolocationResult {
  const [status, setStatus] = useState<GeoStatus>('idle');
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [lastSample, setLastSample] = useState<GeoSample | null>(null);
  const [stale, setStale] = useState(false);
  const watcherRef = useRef<GeolocationWatcher | null>(null);
  const lastSampleRef = useRef<GeoSample | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  });

  const start = useCallback(() => {
    if (!watcherRef.current) {
      const { geolocation, secureContext } = optionsRef.current;
      watcherRef.current = createGeolocationWatcher({
        ...('geolocation' in optionsRef.current ? { geolocation } : {}),
        ...(secureContext === undefined ? {} : { secureContext }),
        onSample: (s) => {
          lastSampleRef.current = s;
          setLastSample(s);
          setStale(false);
        },
        onStatus: (s, msg) => {
          setStatus(s);
          setMessage(msg);
        },
      });
    }
    watcherRef.current.start();
  }, []);

  const stop = useCallback(() => {
    watcherRef.current?.stop();
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const sample = lastSampleRef.current;
      const now = (optionsRef.current.now ?? Date.now)();
      if (sample && now - sample.timestamp > APP_CONFIG.geolocation.staleAfterMs) setStale(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(
    () => () => {
      watcherRef.current?.stop();
      watcherRef.current = null;
    },
    [],
  );

  return message === undefined
    ? { status, lastSample, stale, start, stop }
    : { status, lastSample, stale, message, start, stop };
}
