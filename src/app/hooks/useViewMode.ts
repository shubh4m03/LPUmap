import { useEffect } from 'react';
import { useAnnounce } from '../../accessibility/index.ts';
import { isIllustratedShown } from '../../isometric-art/variant-state.ts';
import { carryCamera } from '../map-controller.ts';
import { useAppStore } from '../store/index.ts';
import { useImageryRuntimeSync } from './useImageryRuntime.ts';
import {
  buildViewUrl,
  deepLinkViewMode,
  illustratedHandoffReason,
  isMapViewMode,
  locationSwitchAnnouncement,
  navigationSwitchAnnouncement,
  VIEW_PARAM,
} from '../view-mode.ts';

/** Mirrors the view mode in `?view=` without adding a history entry (null removes it). */
export function writeViewParam(mode: Parameters<typeof buildViewUrl>[1]): void {
  if (typeof window === 'undefined') return;
  const next = buildViewUrl(window.location.href, mode);
  if (next === window.location.href) return;
  try {
    window.history.replaceState(window.history.state, '', next);
  } catch {
    // Some embedded browsers forbid replaceState; the deep link is a convenience only.
  }
}

/**
 * View-mode behaviour shared by every layout (docs/ISOMETRIC_AND_3D_DESIGN.md §8):
 *  - `?view=` is read by the store at start-up; an unknown value is dropped from
 *    the URL, and every later change is written back (not fallbacks: a link
 *    shared from a browser without WebGL must not force the overview elsewhere);
 *  - crossing between the overview and a map mode carries the camera (same
 *    ground point, equivalent scale) instead of re-flying to an old focus;
 *  - live navigation or live location started in the overview switches to the
 *    last map mode and says so (the overview has no live GPS, §8.2);
 *  - while the Illustrated overview is shown, a newly found route or "choose
 *    on map" switches to the last map mode with the stated reason (the
 *    illustration is not geographically exact: no route or point is drawn on it);
 *  - imagery availability follows the connection (useImageryRuntimeSync).
 */
export function useViewModeSync(): void {
  const announce = useAnnounce();
  useImageryRuntimeSync();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Unknown values and modes that are not available here are dropped from the URL.
    const { availability } = useAppStore.getState();
    if (params.has(VIEW_PARAM) && deepLinkViewMode(window.location.search, availability) === null)
      writeViewParam(null);
  }, []);

  useEffect(
    () =>
      useAppStore.subscribe((s, prev) => {
        if (s.viewMode !== prev.viewMode) {
          if (isMapViewMode(s.viewMode) !== isMapViewMode(prev.viewMode)) {
            carryCamera();
            if (s.focusRequest) useAppStore.setState({ focusRequest: null });
          }
          if (s.viewModeReason !== 'fallback') writeViewParam(s.viewMode);
        }
        if (s.viewMode !== 'isometric') return;
        const handoff = illustratedHandoffReason(s, prev, isIllustratedShown());
        if (handoff) {
          const to = s.lastMapMode;
          if (s.setViewMode(to, { reason: 'user' })) announce(handoff);
          return;
        }
        if (s.navigationActive && !prev.navigationActive) {
          const to = s.lastMapMode;
          if (s.setViewMode(to, { reason: 'navigation' })) announce(navigationSwitchAnnouncement(to));
        } else if (s.locationActive && !prev.locationActive) {
          const to = s.lastMapMode;
          if (s.setViewMode(to, { reason: 'user' })) announce(locationSwitchAnnouncement(to));
        }
      }),
    [announce],
  );
}
