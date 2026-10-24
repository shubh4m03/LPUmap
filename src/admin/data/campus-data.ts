/**
 * The base dataset (public/data, the same files the public app loads) for the
 * admin: the map, base-place search for overrides and access-point
 * candidates. Loaded once per page and shared; a failure is not cached.
 * Never written: owner changes go through the API only.
 */
import { useEffect, useState } from 'react';
import type { CampusData } from '../../data/campus-data.ts';
import { DatasetError, loadCampusData } from '../../data/loader.ts';

let pending: Promise<CampusData> | null = null;

export function loadAdminCampusData(load: () => Promise<CampusData> = loadCampusData): Promise<CampusData> {
  if (!pending) {
    const p = load();
    pending = p;
    p.catch(() => {
      if (pending === p) pending = null;
    });
  }
  return pending;
}

/** Test hook: forget the cached dataset. */
export function resetAdminCampusData(): void {
  pending = null;
}

export type CampusDataState =
  | { status: 'loading' }
  | { status: 'ready'; data: CampusData }
  | { status: 'error'; message: string; retry(): void };

export const CAMPUS_DATA_FAILED =
  'The campus dataset could not be loaded, so the map and base-place lists are unavailable. Check your connection and try again.';

export function useAdminCampusData(): CampusDataState {
  const [state, setState] = useState<CampusDataState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    loadAdminCampusData().then(
      (data) => {
        if (!cancelled) setState({ status: 'ready', data });
      },
      (err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof DatasetError && err.code === 'schema-version'
            ? 'The campus dataset has a schema version this admin does not read. Reload the page to get the matching version.'
            : CAMPUS_DATA_FAILED;
        setState({
          status: 'error',
          message,
          retry: () => {
            setState({ status: 'loading' });
            setAttempt((n) => n + 1);
          },
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  return state;
}
