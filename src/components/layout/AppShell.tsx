import { Suspense, useCallback, useEffect, useState } from 'react';
import { useAnnounce, useIsMobile, useReducedMotion, useTheme } from '../../accessibility/index.ts';
import { useDeepLink } from '../../app/hooks/useDeepLink.ts';
import { useGeoFeedback } from '../../app/hooks/useGeoFeedback.ts';
import { useGlobalShortcuts } from '../../app/hooks/useGlobalShortcuts.ts';
import { useHistoryLayers } from '../../app/hooks/useHistoryLayers.ts';
import { useRouteSolver } from '../../app/hooks/useRouteSolver.ts';
import { useViewModeSync } from '../../app/hooks/useViewMode.ts';
import { useAppStore } from '../../app/store/index.ts';
import {
  MAP_UNAVAILABLE_REASON,
  OVERVIEW_FALLBACK_ANNOUNCEMENT,
  supportsCanvas2D,
} from '../../app/view-mode.ts';
import { ViewStage } from '../../app/ViewStage.tsx';
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

/** Chooses desktop / mobile / list layout and mounts the app-wide behaviours. */
export function AppShell() {
  useRouteSolver();
  useDeepLink();
  useHistoryLayers();
  useGlobalShortcuts();
  useGeoFeedback();
  useViewModeSync();
  usePrefetchDeferredPanels();
  const announce = useAnnounce();

  const isMobile = useIsMobile();
  const reducedMotion = useReducedMotion();
  const { resolved } = useTheme();
  const listMode = useAppStore((s) => s.listMode);
  const reportOpen = useAppStore((s) => s.reportTarget !== null);
  const enterListMode = useAppStore((s) => s.enterListMode);
  const setMapUnavailable = useAppStore((s) => s.setMapUnavailable);
  const viewportH = useViewportHeight();
  const desktopPadding = useDesktopPadding();
  const mobilePadding = useMobilePadding(viewportH);

  // Without WebGL the Canvas2D overview still draws the campus (§8.3); the list is the last resort.
  const [noWebGL] = useState(() => !supportsWebGL());
  const [canvas2d] = useState(() => supportsCanvas2D());
  const toOverview = useCallback(() => {
    setMapUnavailable(MAP_UNAVAILABLE_REASON);
    announce(OVERVIEW_FALLBACK_ANNOUNCEMENT);
  }, [setMapUnavailable, announce]);
  useEffect(() => {
    if (!noWebGL) return;
    if (canvas2d) toOverview();
    else enterListMode(MAP_MESSAGES.webglUnavailable);
  }, [noWebGL, canvas2d, toOverview, enterListMode]);

  const onFatal = useCallback(
    (message: string) => {
      if (message === MAP_MESSAGES.webglUnavailable && canvas2d) toOverview();
      else enterListMode(message);
    },
    [canvas2d, toOverview, enterListMode],
  );

  let body;
  if (listMode || (noWebGL && !canvas2d)) body = <ListLayout />;
  else {
    const map = (
      <ViewStage
        theme={resolved}
        reducedMotion={reducedMotion}
        padding={isMobile ? mobilePadding : desktopPadding}
        onFatalError={onFatal}
        forceOverview={noWebGL}
      />
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
