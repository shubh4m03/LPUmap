/** Behaviour hooks for the navigation HUD. None of them reads out or stores a coordinate. */
import { useCallback, useEffect, useState } from 'react';
import { useAnnounce } from '../../accessibility/index.ts';
import { useAtlas } from '../../app/data/atlas-context.ts';
import { useAppStore } from '../../app/store/index.ts';
import { APP_CONFIG } from '../../config/index.ts';

/**
 * "Recalculate from here": one explicit route request from the latest fix.
 * Never runs on its own — GPS samples only update progress.
 */
export function useReroute(): () => void {
  const { router } = useAtlas();
  const announce = useAnnounce();
  return useCallback(() => {
    const s = useAppStore.getState();
    const sample = s.lastSample;
    if (!s.destination) return;
    if (!sample || Date.now() - sample.timestamp > APP_CONFIG.geolocation.staleAfterMs) {
      useAppStore.setState({
        rerouteError:
          'There is no recent location fix to recalculate from. Still following the original route.',
      });
      announce("Couldn't recalculate: no recent location fix.", 'assertive');
      return;
    }
    const from = { kind: 'point' as const, label: 'Your position (recalculated)', location: sample.lngLat };
    const results = router.alternatives({
      from,
      to: s.destination,
      profile: s.profile,
      preference: s.preference,
    });
    if (s.applyReroute(from, results)) announce('Route recalculated from your position.', 'assertive');
    else announce("Couldn't recalculate. Still following the original route.", 'assertive');
  }, [router, announce]);
}

/** Announces major navigation changes: start/end (polite), off-route and arrival (assertive). */
export function useNavAnnouncements(): void {
  const announce = useAnnounce();
  useEffect(
    () =>
      useAppStore.subscribe((s, prev) => {
        if (s.trackingActive !== prev.trackingActive) {
          announce(s.trackingActive ? 'Tracking your walk.' : 'Tracking stopped.');
        }
        if (s.navigationActive !== prev.navigationActive) {
          announce(
            s.navigationActive
              ? `Navigation started to ${s.destination?.label ?? 'your destination'}.`
              : 'Navigation ended.',
          );
          return;
        }
        const p = s.progress;
        const q = prev.progress;
        if (!s.navigationActive || !p) return;
        if (p.arrived && !q?.arrived) {
          announce(`You have arrived at ${s.destination?.label ?? 'your destination'}.`, 'assertive');
        } else if (p.offRoute && !q?.offRoute) {
          announce('You seem to be off the route. You can recalculate from here.', 'assertive');
        } else if (!p.offRoute && q?.offRoute) {
          announce('Back on the route.');
        }
      }),
    [announce],
  );
}

/**
 * True after the tab returns from the background while navigation or
 * tracking is running and the latest fix is stale (browsers pause location
 * in the background). Cleared by the next fix.
 */
export function useBackgroundPause(): boolean {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const s = useAppStore.getState();
      if (!s.navigationActive && !s.trackingActive) return;
      const last = s.lastSample;
      if (!last || Date.now() - last.timestamp > APP_CONFIG.geolocation.staleAfterMs) setPaused(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    const unsubscribe = useAppStore.subscribe((s, prev) => {
      if (s.lastSample !== prev.lastSample && s.lastSample) setPaused(false);
      if (!s.navigationActive && !s.trackingActive) setPaused(false);
    });
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribe();
    };
  }, []);
  return paused;
}
