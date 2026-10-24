/**
 * Panels and dialogs that are not needed for the first screen (map, search, place
 * details) load in their own chunks. Render them inside PanelSuspense (an accessible
 * loading fallback) or another Suspense boundary. All of them are prefetched once
 * the browser is idle so opening one stays instant
 * (the service worker also precaches every chunk for offline use).
 */
import { createElement, lazy, useEffect, useState, type ComponentType } from 'react';

const loaders = {
  about: () => import('../about/AboutPanel.tsx').then((m) => ({ default: m.AboutPanel })),
  settings: () => import('../settings/SettingsPanel.tsx').then((m) => ({ default: m.SettingsPanel })),
  info: () => import('../info/CampusInfoPanel.tsx').then((m) => ({ default: m.CampusInfoPanel })),
  favorites: () => import('../favorites/FavoritesPanel.tsx').then((m) => ({ default: m.FavoritesPanel })),
  directions: () => import('../directions/DirectionsPanel.tsx').then((m) => ({ default: m.DirectionsPanel })),
  report: () => import('../report/ReportDialog.tsx').then((m) => ({ default: m.ReportDialog })),
  suggest: () => import('../suggest/SuggestPanel.tsx').then((m) => ({ default: m.SuggestPanel })),
  navCard: () => import('../navigation/NavCard.tsx').then((m) => ({ default: m.NavCard })),
  trackingCard: () => import('../navigation/TrackingCard.tsx').then((m) => ({ default: m.TrackingCard })),
  trackingSummary: () =>
    import('../navigation/TrackingSummaryDialog.tsx').then((m) => ({ default: m.TrackingSummaryDialog })),
};

/**
 * React.lazy that renders synchronously once its chunk has been loaded (by the idle
 * prefetch, or by an earlier render), so a prefetched panel never flashes a spinner.
 */
function lazyWithPreload<P extends object>(loader: () => Promise<{ default: ComponentType<P> }>) {
  let loaded: ComponentType<P> | null = null;
  const load = () =>
    loader().then((m) => {
      loaded = m.default;
      return m;
    });
  const Lazy = lazy(load);
  function Deferred(props: P) {
    // Chosen once per mount: switching between the two later would remount the panel.
    const [Loaded] = useState(() => loaded);
    return Loaded ? createElement(Loaded, props) : createElement(Lazy, props);
  }
  return Object.assign(Deferred, { preload: load });
}

export const LazyAboutPanel = lazyWithPreload(loaders.about);
export const LazySettingsPanel = lazyWithPreload(loaders.settings);
export const LazyCampusInfoPanel = lazyWithPreload(loaders.info);
export const LazyFavoritesPanel = lazyWithPreload(loaders.favorites);
export const LazyDirectionsPanel = lazyWithPreload(loaders.directions);
export const LazyReportDialog = lazyWithPreload(loaders.report);
export const LazySuggestPanel = lazyWithPreload(loaders.suggest);
export const LazyNavCard = lazyWithPreload(loaders.navCard);
export const LazyTrackingCard = lazyWithPreload(loaders.trackingCard);
export const LazyTrackingSummaryDialog = lazyWithPreload(loaders.trackingSummary);

const DEFERRED = [
  LazyAboutPanel,
  LazySettingsPanel,
  LazyCampusInfoPanel,
  LazyFavoritesPanel,
  LazyDirectionsPanel,
  LazyReportDialog,
  LazySuggestPanel,
  LazyNavCard,
  LazyTrackingCard,
  LazyTrackingSummaryDialog,
];

/** Loads every deferred chunk; afterwards they all render synchronously. */
export function preloadDeferredPanels(): Promise<void> {
  return Promise.all(DEFERRED.map((c) => c.preload())).then(() => undefined);
}

/** Starts downloading the deferred chunks when the browser is idle (once per page). */
let prefetched = false;
export function usePrefetchDeferredPanels(): void {
  useEffect(() => {
    if (prefetched || typeof window === 'undefined') return;
    const run = () => {
      prefetched = true;
      // Offline with a cold cache a chunk may fail; it is retried when the panel opens.
      preloadDeferredPanels().catch(() => undefined);
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(run);
      return () => window.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(run, 2000);
    return () => window.clearTimeout(id);
  }, []);
}
