/**
 * Test-only harness page: the isometric overview (IsoStage, lazily loaded as
 * in the app) next to the building directory panel, on the real dataset from
 * public/data. Used by the D8 perf project and the harness a11y/screenshot
 * spec until the integration lead mounts IsoStage in the app shell.
 * Built with tests/perf/vite.iso-harness.config.ts; never part of the app build.
 */
import { lazy, StrictMode, Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  initTheme,
  LiveRegion,
  useIsMobile,
  useReducedMotion,
  useTheme,
} from '../../../src/accessibility/index.ts';
import { DataProvider } from '../../../src/app/data/DataProvider.tsx';
import { DirectoryPanel } from '../../../src/components/directory/index.ts';
import { Spinner, ToastProvider } from '../../../src/components/ui/index.ts';
import './harness.css';

const IsoStage = lazy(() => import('../../../src/app/IsoStage.tsx').then((m) => ({ default: m.IsoStage })));
const NO_PADDING = { top: 0, right: 0, bottom: 0, left: 0 };

function focusDirectory() {
  document.querySelector<HTMLInputElement>('#harness-directory input')?.focus();
}

/** `?perf=1`: a toggle that unmounts/mounts the overview, standing in for a mode switch (chunk cached). */
const PERF = new URLSearchParams(window.location.search).get('perf') === '1';

function Harness() {
  const isMobile = useIsMobile();
  const reducedMotion = useReducedMotion();
  const { resolved } = useTheme();
  const [shown, setShown] = useState(true);
  const stage = (
    <>
      {PERF ? (
        <button
          type="button"
          className="absolute top-2 right-2 z-10 rounded border border-border bg-surface-raised px-2 py-1 text-sm"
          onClick={() => setShown((v) => !v)}
        >
          {shown ? 'Hide overview' : 'Show overview'}
        </button>
      ) : null}
      {shown ? (
        <Suspense fallback={<Spinner label="Loading the overview…" />}>
          <IsoStage
            theme={resolved}
            reducedMotion={reducedMotion}
            padding={NO_PADDING}
            onOpenDirectory={focusDirectory}
          />
        </Suspense>
      ) : null}
    </>
  );
  const directory = (
    <section
      id="harness-directory"
      aria-labelledby="harness-directory-title"
      className={
        isMobile
          ? 'min-h-0 flex-1 overflow-y-auto border-t border-border'
          : 'w-96 shrink-0 overflow-y-auto border-r border-border'
      }
    >
      <h1 id="harness-directory-title" className="px-4 pt-3 text-lg font-semibold">
        Building directory
      </h1>
      <DirectoryPanel />
    </section>
  );
  return isMobile ? (
    <main className="flex h-dvh flex-col bg-surface text-text">
      <div className="relative h-[55dvh] shrink-0">{stage}</div>
      {directory}
    </main>
  ) : (
    <main className="flex h-dvh bg-surface text-text">
      {directory}
      <div className="relative min-w-0 flex-1">{stage}</div>
    </main>
  );
}

initTheme();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <DataProvider>
        <Harness />
      </DataProvider>
    </ToastProvider>
    <LiveRegion />
  </StrictMode>,
);
