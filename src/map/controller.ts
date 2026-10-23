import type { Map as MapLibreMap } from 'maplibre-gl';
import { APP_CONFIG } from '../config/index.ts';
import type { LngLat } from '../data/schema.ts';
import { isValidLngLat } from '../distance/geodesic.ts';
import type { MapCamera, MapControllerWithCamera, MapPadding } from './types.ts';

/** Follow-me camera glide per accepted fix (fixes arrive about once a second). */
export const FOLLOW_DURATION_MS = 600;

/** Zoom used when focusing a single place and no zoom is given. */
export const FOCUS_ZOOM = 17.5;
export const FIT_MAX_ZOOM = 18;
export const DEFAULT_FIT_PADDING = 48;

export type ControllerMap = Pick<
  MapLibreMap,
  | 'flyTo'
  | 'jumpTo'
  | 'easeTo'
  | 'fitBounds'
  | 'zoomIn'
  | 'zoomOut'
  | 'resetNorth'
  | 'setPadding'
  | 'getPadding'
  | 'getCenter'
  | 'getZoom'
  | 'getPitch'
  | 'getBearing'
>;

export interface ControllerState {
  reducedMotion(): boolean;
  mode3d(): boolean;
}

function boundsOf(coords: LngLat[]): [[number, number], [number, number]] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [lon, lat] of coords) {
    w = Math.min(w, lon);
    e = Math.max(e, lon);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  return [
    [w, s],
    [e, n],
  ];
}

/**
 * The app's `reducedMotion` prop is the single source of truth. MapLibre's own
 * `reduceMotion` option is a process-wide flag fixed at construction, so every
 * animated move is marked `essential` (otherwise a stale flag would silently
 * turn it into a jump) and reduced motion is honoured by jumping instead.
 */
export function createMapController(map: ControllerMap, state: ControllerState): MapControllerWithCamera {
  const animate = () => !state.reducedMotion();
  const motion = () => ({ animate: animate(), essential: true });

  const flyTo = (lngLat: LngLat, zoom?: number) => {
    if (!isValidLngLat(lngLat)) return;
    const target = { center: lngLat, zoom: zoom ?? Math.max(map.getZoom(), FOCUS_ZOOM) };
    if (animate()) map.flyTo({ ...target, essential: true });
    else map.jumpTo(target);
  };

  return {
    flyTo,
    follow(lngLat) {
      if (!isValidLngLat(lngLat)) return;
      if (animate()) map.easeTo({ center: lngLat, duration: FOLLOW_DURATION_MS, essential: true });
      else map.jumpTo({ center: lngLat });
    },
    fitCoordinates(coords, padding = DEFAULT_FIT_PADDING) {
      const valid = coords.filter((c) => isValidLngLat(c));
      const first = valid[0];
      if (!first) return;
      if (valid.length === 1) {
        flyTo(first);
        return;
      }
      map.fitBounds(boundsOf(valid), { padding, maxZoom: FIT_MAX_ZOOM, ...motion() });
    },
    resetView() {
      const mode3d = state.mode3d();
      const camera = {
        center: APP_CONFIG.map.center,
        zoom: APP_CONFIG.map.zoom,
        pitch: mode3d ? APP_CONFIG.map.pitch3d : 0,
        bearing: mode3d ? APP_CONFIG.map.bearing3d : 0,
      };
      if (animate()) map.easeTo({ ...camera, essential: true });
      else map.jumpTo(camera);
    },
    zoomIn() {
      map.zoomIn(motion());
    },
    zoomOut() {
      map.zoomOut(motion());
    },
    resetNorth() {
      map.resetNorth(motion());
    },
    setPadding(p: MapPadding) {
      map.setPadding(p);
    },
    getCamera(): MapCamera {
      const c = map.getCenter();
      const p = map.getPadding();
      return {
        center: [c.lng, c.lat],
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
        padding: { top: p.top ?? 0, right: p.right ?? 0, bottom: p.bottom ?? 0, left: p.left ?? 0 },
      };
    },
  };
}
