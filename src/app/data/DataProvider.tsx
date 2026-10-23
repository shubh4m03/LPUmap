import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DatasetError, loadCampusData, type CampusData, type DatasetErrorCode } from '../../data/index.ts';
import { AtlasContext } from './atlas-context.ts';
import { DataErrorScreen } from './DataErrorScreen.tsx';
import { LoadingScreen } from './LoadingScreen.tsx';
import { buildServices } from './services.ts';

type LoadState =
  | { status: 'loading'; attempt: number }
  | { status: 'ready'; data: CampusData }
  | { status: 'error'; code: DatasetErrorCode | 'unknown'; attempt: number };

/** Loads the dataset once, shows loading/error screens, and provides derived services. */
export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LoadState>({ status: 'loading', attempt: 0 });
  const attempt = state.status === 'ready' ? -1 : state.attempt;

  useEffect(() => {
    if (attempt < 0) return;
    let cancelled = false;
    loadCampusData().then(
      (data) => {
        if (cancelled) return;
        setState({ status: 'ready', data });
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

  const data = state.status === 'ready' ? state.data : null;
  const services = useMemo(() => (data ? buildServices(data) : null), [data]);

  if (state.status === 'error') {
    return <DataErrorScreen code={state.code} onRetry={retry} />;
  }
  if (!services) return <LoadingScreen />;
  return <AtlasContext.Provider value={services}>{children}</AtlasContext.Provider>;
}
