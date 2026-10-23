import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useIsMobile, useReducedMotion, useTheme } from '../../accessibility/index.ts';
import { useDeepLink } from '../../app/hooks/useDeepLink.ts';
import { useGeoFeedback } from '../../app/hooks/useGeoFeedback.ts';
import { useGlobalShortcuts } from '../../app/hooks/useGlobalShortcuts.ts';
import { useHistoryLayers } from '../../app/hooks/useHistoryLayers.ts';
import { useRouteSolver } from '../../app/hooks/useRouteSolver.ts';
import { useAppStore } from '../../app/store/index.ts';
import { supportsWebGL } from '../../buildings3d/index.ts';
// Direct file import (not the map index) so MapLibre stays out of the initial chunk.
import { MAP_MESSAGES } from '../../map/errors.ts';
import { Spinner } from '../ui/index.ts';
import { CommandPalette } from '../search/CommandPalette.tsx';
import { DesktopLayout } from './DesktopLayout.tsx';
import { LazyReportDialog, usePrefetchDeferredPanels } from './deferred-panels.ts';
import { ListLayout } from './ListLayout.tsx';
import { useDesktopPadding, useMobilePadding, useViewportHeight } from './map-padding.ts';
import { MobileLayout } from './MobileLayout.tsx';

// MapLibre is ~1 MB: load it in its own chunk so search and panels are usable sooner.
const MapStage = lazy(() => import('../../app/MapStage.tsx').then((m) => ({ default: m.MapStage })));

/** Chooses desktop / mobile / list layout and mounts the app-wide behaviours. */
export function AppShell() {
  useRouteSolver();
  useDeepLink();
  useHistoryLayers();
  useGlobalShortcuts();
  useGeoFeedback();
  usePrefetchDeferredPanels();

  const isMobile = useIsMobile();
  const reducedMotion = useReducedMotion();
  const { resolved } = useTheme();
  const listMode = useAppStore((s) => s.listMode);
  const reportOpen = useAppStore((s) => s.reportTarget !== null);
  const enterListMode = useAppStore((s) => s.enterListMode);
  const viewportH = useViewportHeight();
  const desktopPadding = useDesktopPadding();
  const mobilePadding = useMobilePadding(viewportH);

  const [noWebGL] = useState(() => !supportsWebGL());
  useEffect(() => {
    if (noWebGL) enterListMode(MAP_MESSAGES.webglUnavailable);
  }, [noWebGL, enterListMode]);

  const onFatal = useCallback((message: string) => enterListMode(message), [enterListMode]);

  let body;
  if (listMode || noWebGL) body = <ListLayout />;
  else {
    const map = (
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center bg-surface-sunken">
            <Spinner label="Loading the map…" />
          </div>
        }
      >
        <MapStage
          theme={resolved}
          reducedMotion={reducedMotion}
          padding={isMobile ? mobilePadding : desktopPadding}
          onFatalError={onFatal}
        />
      </Suspense>
    );
    body = isMobile ? <MobileLayout map={map} /> : <DesktopLayout map={map} />;
  }

  return (
    <>
      {body}
      <CommandPalette />
      {reportOpen ? (
        <Suspense fallback={<LoadingOverlay label="Loading the correction form…" />}>
          <LazyReportDialog />
        </Suspense>
      ) : null}
    </>
  );
}

/** Fallback while a lazily loaded dialog downloads: a labelled status over a scrim. */
function LoadingOverlay({ label }: { label: string }) {
  return (
    <div className="fixed inset-0 z-(--ds-z-dialog) flex items-center justify-center bg-overlay">
      <div className="rounded-lg bg-surface-raised p-4 shadow-3">
        <Spinner label={label} />
      </div>
    </div>
  );
}
