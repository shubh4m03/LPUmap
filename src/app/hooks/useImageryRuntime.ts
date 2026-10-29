import { useCallback, useContext, useEffect } from 'react';
import { useAnnounce } from '../../accessibility/index.ts';
import { ToastContext } from '../../components/ui/index.ts';
import type { ProviderFailure } from '../../map/providers/index.ts';
import { useAppStore } from '../store/index.ts';
import { VIEW_MODE_NAMES } from '../view-mode.ts';

/** Shown and announced when the view leaves imagery (never a blank map: the campus map takes over). */
export function imageryFallbackMessage(reason: string, from: 'satellite' | '3d'): string {
  return from === 'satellite'
    ? reason
    : `${reason.replace(/ Showing the campus map instead\.$/, '')} Campus 3D continues without imagery.`;
}

/**
 * Reports imagery trouble to the store and tells the user what happened.
 * Returns the reporter MapStage hands to MapView (`onImageryFailure`).
 */
export function useImageryFailureReporter(): (failure: ProviderFailure) => void {
  const announce = useAnnounce();
  const toast = useContext(ToastContext);
  return useCallback(
    (failure: ProviderFailure) => {
      const s = useAppStore.getState();
      if (s.imageryRuntime.failure !== null) return;
      const wasMode = s.viewMode;
      s.setImageryRuntime({ ...s.imageryRuntime, failure });
      const reason = useAppStore.getState().availability.satellite;
      if (!reason) return;
      const message = imageryFallbackMessage(reason, wasMode === 'satellite2d' ? 'satellite' : '3d');
      announce(message);
      toast?.show({ message, tone: 'warning', durationMs: 10000 });
    },
    [announce, toast],
  );
}

/**
 * Keeps imagery availability in step with the connection: offline makes the
 * imagery modes unavailable (Satellite 2D falls back to the campus map, with a
 * notice); back online clears a network failure (auth and quota failures last
 * for the session). The mode is never switched back automatically.
 */
export function useImageryRuntimeSync(): void {
  const announce = useAnnounce();
  const toast = useContext(ToastContext);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = (online: boolean) => {
      const s = useAppStore.getState();
      const rt = s.imageryRuntime;
      const failure = online && rt.failure === 'network' ? null : rt.failure;
      if (rt.online === online && rt.failure === failure) return;
      const resolved = s.setImageryRuntime({ online, failure });
      if (resolved?.reason) {
        const message = `${VIEW_MODE_NAMES[resolved.fallbackFrom ?? 'satellite2d']}: ${resolved.reason}`;
        announce(message);
        toast?.show({ message, tone: 'warning', durationMs: 10000 });
      }
    };
    const onOnline = () => update(true);
    const onOffline = () => update(false);
    update(navigator.onLine !== false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [announce, toast]);
}
