/**
 * The app store: one Zustand store composed of slice files. Components read it
 * through narrow selectors (`useAppStore((s) => s.mode3d)`) or `useShallow` so
 * unrelated updates — e.g. a new GPS fix — never re-render the map shell.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { ViewMode } from '../view-mode.ts';
import { createMapSlice, defaultViewMode, type MapDefaults } from './map-slice.ts';
import { createNavSlice, type WatcherFactory } from './nav-slice.ts';
import { createRouteSlice } from './route-slice.ts';
import { createSelectionSlice } from './selection-slice.ts';
import type { AppState } from './types.ts';
import { createUiSlice } from './ui-slice.ts';

export interface AppStoreOptions {
  /** `mode3d` is the legacy way to pick realistic3d/standard2d; `viewMode` wins when both are given. */
  map?: Partial<MapDefaults> & { mode3d?: boolean };
  /** Injectable geolocation watcher (tests). */
  watcherFactory?: WatcherFactory;
}

const legacyViewMode = (mode3d: boolean | undefined): ViewMode | undefined =>
  mode3d === undefined ? undefined : mode3d ? 'realistic3d' : 'standard2d';

export function createAppStore(opts: AppStoreOptions = {}): UseBoundStore<StoreApi<AppState>> {
  const mapDefaults: MapDefaults = {
    viewMode: opts.map?.viewMode ?? legacyViewMode(opts.map?.mode3d) ?? defaultViewMode(),
    showLabels: opts.map?.showLabels ?? true,
  };
  return create<AppState>()((...a) => ({
    ...createUiSlice(...a),
    ...createSelectionSlice(...a),
    ...createMapSlice(mapDefaults)(...a),
    ...createRouteSlice(...a),
    ...createNavSlice(opts.watcherFactory)(...a),
  }));
}

export const useAppStore = createAppStore();

export * from './selectors.ts';
export type * from './types.ts';
export { DEFAULT_VISIBLE_GROUPS, defaultViewMode } from './map-slice.ts';
export { pushPanel } from './ui-slice.ts';
