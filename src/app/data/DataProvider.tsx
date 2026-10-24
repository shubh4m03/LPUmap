import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ToastContext } from '../../components/ui/toast-context.ts';
import {
  createOptionalLoaders,
  DatasetError,
  loadCampusData,
  type DatasetErrorCode,
  type Place,
} from '../../data/index.ts';
import { useAppStore } from '../store/index.ts';
import { AtlasContext } from './atlas-context.ts';
import { DataErrorScreen } from './DataErrorScreen.tsx';
import { LoadingScreen } from './LoadingScreen.tsx';
import type { AtlasServices } from './services.ts';

// Search index, router, directory and the publication merge load in parallel with the dataset download.
const loadServices = () => import('./services.ts');
// The owner's publication (GET /api/locations) is fetched in parallel too; it never fails the app.
const loadPublication = () => import('./publication.ts').then((m) => m.loadPublication());

type LoadState =
  | { status: 'loading'; attempt: number }
  | {
      status: 'ready';
      services: AtlasServices;
      publicationContextPlaces: Place[];
      withContextPlaces: (base: AtlasServices, places: readonly Place[]) => AtlasServices;
    }
  | { status: 'error'; code: DatasetErrorCode | 'unknown'; attempt: number };

export const NEARBY_LOAD_FAILED = 'Could not load the places outside the campus. Try the layer again later.';

/**
 * Loads the dataset and the publication once, shows loading/error screens,
 * and provides derived services. The base dataset alone always works: a
 * missing or failing publication API only changes `services.publication`.
 * While the "Nearby, outside campus" layer is on, its places are added to
 * the provided services (search, selection) and removed again when it is off.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LoadState>({ status: 'loading', attempt: 0 });
  const attempt = state.status === 'ready' ? -1 : state.attempt;
  const toast = useContext(ToastContext);

  useEffect(() => {
    if (attempt < 0) return;
    let cancelled = false;
    Promise.all([loadCampusData(), loadServices(), loadPublication()])
      .then(async ([base, mod, publication]) => {
        const built = await mod.buildAppServices(base, publication, createOptionalLoaders(base.manifest));
        return { ...built, withContextPlaces: mod.withContextPlaces };
      })
      .then(
        (built) => {
          if (cancelled) return;
          setState({ status: 'ready', ...built });
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

  // "Nearby, outside campus": context-places.json (lazy) + the publication's off-campus results.
  const nearbyOn = useAppStore((s) => s.showNearbyOutsideCampus);
  const [staticContext, setStaticContext] = useState<Place[] | null>(null);
  const ready = state.status === 'ready' ? state : null;
  const optional = ready?.services.optional ?? null;
  useEffect(() => {
    if (!nearbyOn || !optional || staticContext) return;
    let cancelled = false;
    optional.contextPlaces().then(
      (places) => {
        if (!cancelled) setStaticContext(places);
      },
      () => {
        if (!cancelled) toast?.show({ message: NEARBY_LOAD_FAILED, tone: 'warning' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [nearbyOn, optional, staticContext, toast]);

  const value = useMemo(() => {
    if (!ready) return null;
    if (!nearbyOn) return ready.services;
    // The publication's own results win over a static copy with the same id.
    const places = [...ready.publicationContextPlaces, ...(staticContext ?? [])];
    return ready.withContextPlaces(ready.services, places);
  }, [ready, nearbyOn, staticContext]);

  if (state.status === 'error') {
    return <DataErrorScreen code={state.code} onRetry={retry} />;
  }
  if (!value) return <LoadingScreen />;
  return <AtlasContext.Provider value={value}>{children}</AtlasContext.Provider>;
}
