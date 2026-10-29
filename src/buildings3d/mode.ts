import type { Map as MapLibreMap } from 'maplibre-gl';
import { APP_CONFIG } from '../config/index.ts';
import { BUILDING_LAYER_IDS, flatFillMaxZoom } from './layers.ts';

/** The slice of the MapLibre Map API that switching modes needs (kept small for testing). */
export type BuildingModeMap = Pick<
  MapLibreMap,
  'easeTo' | 'jumpTo' | 'getLayer' | 'setLayoutProperty' | 'setLayerZoomRange' | 'dragRotate' | 'touchPitch'
>;

export const MODE_TRANSITION_MS = 700;

/** Campus 3D pitch for the screen: phones (`compact`) tilt less than larger screens. */
export function pitch3dFor(compact: boolean): number {
  return compact ? APP_CONFIG.map.pitch3dCompact : APP_CONFIG.map.pitch3d;
}

/**
 * Switches between flat 2D footprints and 3D extrusions: eases the camera to
 * the configured 3D pitch (lower on phones) and bearing (or straight-down north-up for 2D), swaps
 * layer visibility and enables rotate/pitch gestures only in 3D.
 */
export function setBuildingMode(
  map: BuildingModeMap,
  mode3d: boolean,
  opts: { reducedMotion: boolean; compact?: boolean },
): void {
  const camera = mode3d
    ? { pitch: pitch3dFor(opts.compact ?? false), bearing: APP_CONFIG.map.bearing3d }
    : { pitch: 0, bearing: 0 };
  if (opts.reducedMotion) map.jumpTo(camera);
  // `essential`: the caller's reducedMotion decides, not MapLibre's construction-time global flag.
  else map.easeTo({ ...camera, duration: MODE_TRANSITION_MS, essential: true });

  if (map.getLayer(BUILDING_LAYER_IDS.extrusion)) {
    map.setLayoutProperty(BUILDING_LAYER_IDS.extrusion, 'visibility', mode3d ? 'visible' : 'none');
  }
  if (map.getLayer(BUILDING_LAYER_IDS.fill)) {
    map.setLayerZoomRange(BUILDING_LAYER_IDS.fill, 0, flatFillMaxZoom(mode3d));
  }

  if (mode3d) {
    map.dragRotate.enable();
    map.touchPitch.enable();
  } else {
    map.dragRotate.disable();
    map.touchPitch.disable();
  }
}
