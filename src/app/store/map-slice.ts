import { LAYER_GROUPS, type LayerGroupId } from '../../config/categories.ts';
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

export interface MapDefaults {
  mode3d: boolean;
  showLabels: boolean;
}

export const createMapSlice =
  (defaults: MapDefaults): SliceCreator<MapSlice> =>
  (set, get) => ({
    mode3d: defaults.mode3d,
    showLabels: defaults.showLabels,
    visibleGroups: DEFAULT_VISIBLE_GROUPS,

    setMode3d: (mode3d) => set({ mode3d }),
    toggleMode3d: () => set({ mode3d: !get().mode3d }),
    setShowLabels: (showLabels) => set({ showLabels }),

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
      set({ visibleGroups: DEFAULT_VISIBLE_GROUPS, showLabels: true });
    },
  });
