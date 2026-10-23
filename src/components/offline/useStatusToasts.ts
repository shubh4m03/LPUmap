import { useEffect, useRef } from 'react';
import type { ServiceWorkerUpdate } from '../../offline/index.ts';
import { useToast } from '../ui/index.ts';

/**
 * One-off notifications for connection and service-worker events: back
 * online (only after having been offline), offline copy ready (once per page
 * load) and a registration error (once per distinct message).
 */
export function useStatusToasts(online: boolean, sw: ServiceWorkerUpdate): void {
  const toast = useToast();
  const wasOffline = useRef(!online);
  const readyShown = useRef(false);
  const lastError = useRef<string | null>(null);

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return;
    }
    if (wasOffline.current) {
      wasOffline.current = false;
      toast.show({ message: 'Back online.', tone: 'success' });
    }
  }, [online, toast]);

  useEffect(() => {
    if (!sw.offlineReady || readyShown.current) return;
    readyShown.current = true;
    toast.show({ message: 'Ready to work offline: the map and campus data are saved on this device.' });
  }, [sw.offlineReady, toast]);

  useEffect(() => {
    if (!sw.error || sw.error === lastError.current) return;
    lastError.current = sw.error;
    toast.show({
      // The controller's messages are complete sentences (registration or update failure).
      message: sw.error,
      tone: 'warning',
      durationMs: 10000,
    });
  }, [sw.error, toast]);
}
