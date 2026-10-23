import { useEffect } from 'react';
import { useAnnounce } from '../../accessibility/index.ts';
import { useToast } from '../../components/ui/index.ts';
import { APP_CONFIG } from '../../config/index.ts';
import type { LngLat } from '../../data/index.ts';
import type { GeoStatus } from '../../geolocation/index.ts';
import { useAppStore } from '../store/index.ts';

const PROBLEM_TONE: Partial<Record<GeoStatus, 'warning' | 'danger'>> = {
  denied: 'danger',
  unsupported: 'warning',
  error: 'danger',
  unavailable: 'warning',
  timeout: 'warning',
};

export const OUTSIDE_CAMPUS_MESSAGE = 'You appear to be outside the campus area';

/** True when the point lies inside the map's bounds [west, south, east, north]. */
export function insideMapBounds(
  [lng, lat]: LngLat,
  [west, south, east, north]: readonly [number, number, number, number] = APP_CONFIG.map.maxBounds,
): boolean {
  return lng >= west && lng <= east && lat >= south && lat <= north;
}

/**
 * Explains location problems in a toast, and centres the map on the first fix
 * after the user turns location on — only when that fix is inside the campus map
 * bounds; otherwise the map stays on campus and a notice says why. Coordinates are never shown or logged.
 */
export function useGeoFeedback(): void {
  const toast = useToast();
  const announce = useAnnounce();

  useEffect(() => {
    let awaitingFirstFix = false;
    return useAppStore.subscribe((s, prev) => {
      if (s.geoStatus !== prev.geoStatus) {
        const tone = PROBLEM_TONE[s.geoStatus];
        if (tone && s.geoMessage) toast.show({ message: s.geoMessage, tone, durationMs: 9000 });
        if (s.geoStatus === 'requesting') awaitingFirstFix = true;
        if (s.geoStatus === 'idle') awaitingFirstFix = false;
      }
      if (awaitingFirstFix && s.lastSample && s.lastSample !== prev.lastSample) {
        awaitingFirstFix = false;
        if (!insideMapBounds(s.lastSample.lngLat)) {
          toast.show({ message: OUTSIDE_CAMPUS_MESSAGE, tone: 'neutral' });
          return;
        }
        announce('Showing your location on the map');
        if (!s.navigationActive) s.requestFocus({ kind: 'point', lngLat: s.lastSample.lngLat });
      }
    });
  }, [toast, announce]);
}
