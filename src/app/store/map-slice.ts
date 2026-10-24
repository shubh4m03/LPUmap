import { LAYER_GROUPS, type LayerGroupId } from '../../config/categories.ts';
import { APP_CONFIG } from '../../config/index.ts';
import { isMapViewMode, mode3dFor, type MapViewMode, type ViewMode } from '../view-mode.ts';
import type { MapSlice, SliceCreator } from './types.ts';

export const DEFAULT_VISIBLE_GROUPS: ReadonlySet<LayerGroupId> = new Set(LAYER_GROUPS.map((g) => g.id));

/** 3D on wide screens, 2D on phones (less GPU work, easier one-hand panning). */
export function defaultMode3d(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  try {
    return window.matchMedia('(min-width: 768px)').matches;
  } catch {
    return true;
  }
}

/** Device default view mode (unchanged behaviour: 3D at ≥ 768 px, otherwise 2D). */
export function defaultViewMode(): MapViewMode {
  return defaultMode3d() ? 'realistic3d' : 'standard2d';
}

export interface MapDefaults {
  viewMode: ViewMode;
  showLabels: boolean;
}

export const createMapSlice =
  (defaults: MapDefaults): SliceCreator<MapSlice> =>
  (set, get) => ({
    viewMode: defaults.viewMode,
    lastMapMode: isMapViewMode(defaults.viewMode) ? defaults.viewMode : 'realistic3d',
    viewModeReason: null,
    mapUnavailable: null,
    mode3d: mode3dFor(defaults.viewMode),
    showLabels: defaults.showLabels,
    visibleGroups: DEFAULT_VISIBLE_GROUPS,
    showNearbyOutsideCampus: APP_CONFIG.optionalLayers.nearbyOutsideCampus.defaultVisible,
    showDetectedFootprints: APP_CONFIG.optionalLayers.detectedFootprints.defaultVisible,

    setViewMode(mode, opts = {}) {
      const s = get();
      // The overview has no live GPS: refuse it while navigating (the switcher shows why).
      if (mode === 'isometric' && s.navigationActive) return false;
      // Without WebGL only the overview can draw anything.
      if (isMapViewMode(mode) && s.mapUnavailable !== null) return false;
      if (s.viewMode === mode && s.mode3d === mode3dFor(mode)) return true;
      set({
        viewMode: mode,
        mode3d: mode3dFor(mode),
        viewModeReason: opts.reason ?? 'user',
        ...(isMapViewMode(mode) ? { lastMapMode: mode } : {}),
      });
      return true;
    },
    setMapUnavailable(reason) {
      set({
        mapUnavailable: reason,
        viewMode: 'isometric',
        mode3d: false,
        viewModeReason: 'fallback',
      });
    },
    setMode3d: (on) => {
      get().setViewMode(on ? 'realistic3d' : 'standard2d');
    },
    toggleMode3d: () => {
      get().setViewMode(get().mode3d ? 'standard2d' : 'realistic3d');
    },
    setShowLabels: (showLabels) => set({ showLabels }),
    setShowNearbyOutsideCampus: (showNearbyOutsideCampus) => set({ showNearbyOutsideCampus }),
    setShowDetectedFootprints: (showDetectedFootprints) => set({ showDetectedFootprints }),

    setGroupVisible(id, visible) {
      const current = get().visibleGroups;
      if (current.has(id) === visible) return;
      const next = new Set(current);
      if (visible) next.add(id);
      else next.delete(id);
      set({ visibleGroups: next });
    },

    toggleGroup(id) {
      get().setGroupVisible(id, !get().visibleGroups.has(id));
    },

    restoreDefaults() {
      set({
        visibleGroups: DEFAULT_VISIBLE_GROUPS,
        showLabels: true,
        showNearbyOutsideCampus: APP_CONFIG.optionalLayers.nearbyOutsideCampus.defaultVisible,
        showDetectedFootprints: APP_CONFIG.optionalLayers.detectedFootprints.defaultVisible,
      });
    },
  });
