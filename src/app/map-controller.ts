/**
 * Holder for the live MapController (set by MapStage once the map has loaded).
 * Kept outside the Zustand store: it is an imperative handle, not state.
 */
import type { MapController } from '../map/types.ts';

let current: MapController | null = null;

export function setMapController(controller: MapController | null): void {
  current = controller;
}

/** The live controller, or null in list mode / before the map has loaded. */
export function getMapController(): MapController | null {
  return current;
}
