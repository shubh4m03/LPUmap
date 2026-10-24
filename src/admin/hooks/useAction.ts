/**
 * One write at a time: `run` sends it, exposes `busy`, and keeps the error of
 * a failed attempt until the next attempt or `clear()`. Resolves to the data
 * only on a confirmed success (null otherwise) — callers never assume one.
 */
import { useCallback, useRef, useState } from 'react';
import type { AdminApiError } from '../api/errors.ts';
import type { AdminResult } from '../api/http.ts';

export interface Action {
  busy: boolean;
  error: AdminApiError | null;
  run<T>(call: () => Promise<AdminResult<T>>): Promise<T | null>;
  clear(): void;
}

export function useAction(): Action {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminApiError | null>(null);
  const inFlight = useRef(false);
  const run = useCallback(async <T>(call: () => Promise<AdminResult<T>>): Promise<T | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await call();
      if (r.ok) return r.data;
      setError(r.error);
      return null;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);
  const clear = useCallback(() => setError(null), []);
  return { busy, error, run, clear };
}
