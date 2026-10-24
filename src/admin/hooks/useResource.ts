/**
 * Loads one admin API resource: cancels the previous request when the key
 * changes or the component unmounts, keeps the last good data while
 * reloading the SAME key, and never turns a failure into data.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminApiError } from '../api/errors.ts';
import type { AdminResult } from '../api/http.ts';

export type ResourceState<T> =
  | { status: 'loading'; data: T | null; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'error'; data: T | null; error: AdminApiError };

export interface Resource<T> {
  state: ResourceState<T>;
  /** Fetches again (keeps the current data visible meanwhile). */
  reload(): void;
  /** Replaces the data after a successful write that returned the new record. */
  setData(update: (current: T | null) => T): void;
}

interface Settled<T> {
  key: string;
  attempt: number;
  state: ResourceState<T>;
}

export function useResource<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<AdminResult<T>>,
): Resource<T> {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    const ctl = new AbortController();
    void loadRef.current(ctl.signal).then((r) => {
      if (ctl.signal.aborted) return;
      if (r.ok) setSettled({ key, attempt, state: { status: 'ready', data: r.data, error: null } });
      else if (r.error.kind !== 'aborted')
        setSettled((s) => ({
          key,
          attempt,
          state: { status: 'error', data: s?.key === key ? s.state.data : null, error: r.error },
        }));
    });
    return () => ctl.abort();
  }, [key, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const setData = useCallback(
    (update: (current: T | null) => T) =>
      setSettled((s) =>
        s ? { ...s, state: { status: 'ready', data: update(s.state.data), error: null } } : s,
      ),
    [],
  );

  let state: ResourceState<T>;
  if (settled && settled.key === key && settled.attempt === attempt) state = settled.state;
  else if (settled && settled.key === key)
    state = { status: 'loading', data: settled.state.data, error: null };
  else state = { status: 'loading', data: null, error: null };
  return { state, reload, setData };
}
