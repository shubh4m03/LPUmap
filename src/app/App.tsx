import { lazy, Suspense, useEffect } from 'react';
import { SkipLink } from '../accessibility/index.ts';
import { OfflineStatus } from '../components/offline/OfflineStatus.tsx';
import { DataProvider } from './data/DataProvider.tsx';
import { LoadingScreen } from './data/LoadingScreen.tsx';

// The shell (panels, search UI, layouts) is only needed once the dataset is ready, so it
// lives in its own chunk. Its download starts right away, in parallel with the dataset.
const loadShell = () => import('../components/layout/AppShell.tsx').then((m) => ({ default: m.AppShell }));
const shellRequest = loadShell();
shellRequest.catch(() => undefined); // A failed prefetch is retried when the shell renders.
const AppShell = lazy(() => shellRequest.catch(loadShell));

/** Root component: data loading boundary + the app shell. Providers live in main.tsx. */
export function App() {
  useEffect(() => {
    // Prefetch only; a failure is retried (and surfaced) when the shell renders.
    loadShell().catch(() => undefined);
  }, []);
  return (
    <>
      <SkipLink targetId="main">Skip to the map and panels</SkipLink>
      <DataProvider>
        <Suspense fallback={<LoadingScreen />}>
          <AppShell />
        </Suspense>
      </DataProvider>
      <OfflineStatus />
    </>
  );
}
