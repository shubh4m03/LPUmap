import { useEffect, useSyncExternalStore } from 'react';
import { SW_FILENAME } from './pwa-config.ts';
import { createSwController } from './sw-controller.ts';
import type { SwController } from './sw-controller.ts';

export interface ServiceWorkerUpdate {
  /** False in development builds and in browsers without service workers. */
  supported: boolean;
  /** A new version is installed and waiting; ask the user before reloading. */
  updateAvailable: boolean;
  /** The app and dataset are fully cached and usable offline. */
  offlineReady: boolean;
  /** Activates the waiting service worker; the page reloads once it takes control. */
  applyUpdate(): void;
  /** Hides the current prompt (a waiting update still applies once every tab is closed). */
  dismiss(): void;
  /** Registration or update failure, surfaced so the UI can say offline mode is unavailable. */
  error: string | null;
}

const base = import.meta.env.BASE_URL;

// Only production builds contain a service worker (devOptions are disabled).
const appController = createSwController({
  enabled: import.meta.env.PROD,
  swUrl: `${base}${SW_FILENAME}`,
  scope: base,
});

/** Builds the hook around a controller; exported for tests. */
export function createServiceWorkerUpdateHook(controller: SwController): () => ServiceWorkerUpdate {
  return function useServiceWorkerUpdateHook(): ServiceWorkerUpdate {
    const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
    useEffect(() => controller.start(), []);
    return { ...state, applyUpdate: controller.applyUpdate, dismiss: controller.dismiss };
  };
}

export const useServiceWorkerUpdate = createServiceWorkerUpdateHook(appController);
