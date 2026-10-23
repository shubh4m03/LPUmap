import { SkipLink } from '../accessibility/index.ts';
import { AppShell } from '../components/layout/AppShell.tsx';
import { OfflineStatus } from '../components/offline/OfflineStatus.tsx';
import { DataProvider } from './data/DataProvider.tsx';

/** Root component: data loading boundary + the app shell. Providers live in main.tsx. */
export function App() {
  return (
    <>
      <SkipLink targetId="main">Skip to the map and panels</SkipLink>
      <DataProvider>
        <AppShell />
      </DataProvider>
      <OfflineStatus />
    </>
  );
}
