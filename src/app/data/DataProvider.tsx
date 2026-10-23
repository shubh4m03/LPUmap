import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { DatasetError, loadCampusData, type CampusData, type DatasetErrorCode } from '../../data/index.ts';
import { AtlasContext } from './atlas-context.ts';
import { DataErrorScreen } from './DataErrorScreen.tsx';
import { LoadingScreen } from './LoadingScreen.tsx';
import type { AtlasServices } from './services.ts';

// Search index, router and directory code load in parallel with the dataset download.
const loadServices = () => import('./services.ts');

type LoadState =
  | { status: 'loading'; attempt: number }
  | { status: 'ready'; data: CampusData; services: AtlasServices }
  | { status: 'error'; code: DatasetErrorCode | 'unknown'; attempt: number };

/** Loads the dataset once, shows loading/error screens, and provides derived services. */
export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LoadState>({ status: 'loading', attempt: 0 });
  const attempt = state.status === 'ready' ? -1 : state.attempt;

  useEffect(() => {
    if (attempt < 0) return;
    let cancelled = false;
    Promise.all([loadCampusData(), loadServices()]).then(
      ([data, { buildServices }]) => {
        if (cancelled) return;
        setState({ status: 'ready', data, services: buildServices(data) });
      },
      (err: unknown) => {
        if (cancelled) return;
        const code = err instanceof DatasetError ? err.code : 'unknown';
        setState({ status: 'error', code, attempt });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState((s) => ({ status: 'loading', attempt: s.status === 'ready' ? 0 : s.attempt + 1 }));
  }, []);

  const services = state.status === 'ready' ? state.services : null;

  if (state.status === 'error') {
    return <DataErrorScreen code={state.code} onRetry={retry} />;
  }
  if (!services) return <LoadingScreen />;
  return <AtlasContext.Provider value={services}>{children}</AtlasContext.Provider>;
}
