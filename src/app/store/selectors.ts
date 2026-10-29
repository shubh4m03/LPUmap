/** Pure selectors over AppState. Keep them cheap and referentially stable. */
import type { MapRouteOverlay } from '../../map/index.ts';
import type { RouteOk } from '../../routing/index.ts';
import type { AppState } from './types.ts';

export const selectActivePanel = (s: AppState) => s.activePanel;
export const selectSelectedPlaceId = (s: AppState) => s.selectedPlaceId;
export const selectPaletteOpen = (s: AppState) => s.paletteOpen;
export const selectReportTarget = (s: AppState) => s.reportTarget;
export const selectLastSample = (s: AppState) => s.lastSample;

/** The route currently shown (the chosen alternative), or null. */
export function selectActiveRoute(s: AppState): RouteOk | null {
  return s.alternatives[s.activeAlternative] ?? null;
}

/** Number of history layers the browser back button can close (palette + panels). */
export function selectOverlayDepth(s: AppState): number {
  return s.panelStack.length + (s.paletteOpen ? 1 : 0);
}

/**
 * Map overlay for the active route. While navigating, the walked part is drawn
 * as `completed` and only the remaining part as the main line.
 */
export function buildRouteOverlay(
  alternatives: readonly RouteOk[],
  activeAlternative: number,
  progress: AppState['progress'],
  navigationActive: boolean,
): MapRouteOverlay | null {
  const active = alternatives[activeAlternative];
  if (!active) return null;
  const others = alternatives.filter((_, i) => i !== activeAlternative).map((r) => r.coordinates);
  if (navigationActive && progress && progress.remainingCoords.length >= 2) {
    return { coordinates: progress.remainingCoords, completed: progress.completedCoords, alternatives: [] };
  }
  return { coordinates: active.coordinates, alternatives: others };
}
