/**
 * Holder for the live MapController (set by MapStage or IsoStage once the
 * view has loaded). Kept outside the Zustand store: it is an imperative
 * handle, not state.
 *
 * Switching between the map modes and the overview carries the camera
 * (docs/ISOMETRIC_AND_3D_DESIGN.md §8.1): the outgoing view's ground centre
 * and equivalent scale are remembered and applied to the next controller.
 */
import { zoomForPxPerMetre } from '../isometric/index.ts';
import type { LngLat } from '../data/index.ts';
import type { MapCamera, MapController } from '../map/index.ts';

/** Ground centre and Web-Mercator-equivalent zoom of a view. */
export interface CarriedCamera {
  center: LngLat;
  zoom: number;
}

let current: MapController | null = null;
/** False while the live view is not geographic (the campus illustration). */
let currentGeographic = true;
let carried: CarriedCamera | null = null;

export interface MapControllerOptions {
  /**
   * False for a view that is not geographically exact (the illustrated
   * overview, src/isometric-art): a geographic camera is never applied to it,
   * and the camera carried from the last map view is kept for the next
   * geographic view (so map → illustration → map-accurate keeps the ground point).
   */
  geographic?: boolean;
}

export function setMapController(controller: MapController | null, opts: MapControllerOptions = {}): void {
  current = controller;
  currentGeographic = controller === null || opts.geographic !== false;
  if (controller && carried && currentGeographic) {
    const cam = carried;
    carried = null;
    controller.flyTo(cam.center, cam.zoom);
  }
}

/** The live controller, or null in list mode / before the map has loaded. */
export function getMapController(): MapController | null {
  return current;
}

type Readable = MapController & {
  getCamera?: () => MapCamera;
  getView?: () => { center: LngLat; pxPerMetre: number };
};

/** The camera of a map controller (getCamera) or of the overview's controller (getView). */
export function cameraOf(controller: MapController): CarriedCamera | null {
  const c = controller as Readable;
  if (typeof c.getCamera === 'function') {
    const cam = c.getCamera();
    return { center: cam.center, zoom: cam.zoom };
  }
  if (typeof c.getView === 'function') {
    const v = c.getView();
    return { center: v.center, zoom: zoomForPxPerMetre(v.pxPerMetre, v.center[1]) };
  }
  return null;
}

/** Remembers the live view so the next controller (the other stage) opens on the same ground point. */
export function carryCamera(): void {
  // Leaving a non-geographic view: it has no ground point; keep the one carried from the last map view.
  if (current && !currentGeographic) return;
  carried = current ? cameraOf(current) : null;
}

/** Test helper: forget any carried camera. */
export function resetCarriedCamera(): void {
  carried = null;
}
