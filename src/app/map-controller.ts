/**
 * Holder for the live MapController (set by MapStage or IsoStage once the
 * view has loaded). Kept outside the Zustand store: it is an imperative
 * handle, not state.
 *
 * Switching between the map modes and the overview carries the camera
 * (docs/ISOMETRIC_AND_3D_DESIGN.md §8.1): the outgoing view's ground centre
 * and equivalent scale are remembered and applied to the next controller.
 */
import { zoomForPxPerMetre } from '../isometric/projection.ts';
import type { LngLat } from '../data/schema.ts';
import type { MapCamera, MapController } from '../map/types.ts';

/** Ground centre and Web-Mercator-equivalent zoom of a view. */
export interface CarriedCamera {
  center: LngLat;
  zoom: number;
}

let current: MapController | null = null;
let carried: CarriedCamera | null = null;

export function setMapController(controller: MapController | null): void {
  current = controller;
  if (controller && carried) {
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
  carried = current ? cameraOf(current) : null;
}

/** Test helper: forget any carried camera. */
export function resetCarriedCamera(): void {
  carried = null;
}
