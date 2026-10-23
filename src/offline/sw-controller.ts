/**
 * Service-worker registration in "prompt" mode, built directly on
 * workbox-window. It mirrors vite-plugin-pwa's own `registerSW` (prompt
 * branch) but avoids the `virtual:pwa-register/*` module, which only exists
 * inside a Vite build with the PWA plugin and cannot be resolved under Vitest.
 */

export interface SwLifecycleEvent {
  isUpdate?: boolean;
  isExternal?: boolean;
}

/** The subset of workbox-window's `Workbox` this controller needs. */
export interface WorkboxLike {
  on(type: 'installed' | 'waiting' | 'controlling', listener: (event: SwLifecycleEvent) => void): void;
  register(): Promise<unknown>;
  messageSkipWaiting(): void;
}

export interface SwState {
  /** False in development builds and in browsers without service workers. */
  supported: boolean;
  updateAvailable: boolean;
  offlineReady: boolean;
  error: string | null;
}

export interface SwController {
  getState(): SwState;
  subscribe(listener: () => void): () => void;
  /** Registers the worker once; later calls are no-ops. */
  start(): void;
  applyUpdate(): void;
  dismiss(): void;
}

export interface SwControllerOptions {
  enabled: boolean;
  swUrl: string;
  scope: string;
  createWorkbox?: (swUrl: string, scope: string) => Promise<WorkboxLike>;
  hasServiceWorker?: () => boolean;
  reload?: () => void;
}

async function loadWorkbox(swUrl: string, scope: string): Promise<WorkboxLike> {
  const { Workbox } = await import('workbox-window');
  const wb = new Workbox(swUrl, { scope });
  return {
    on: (type, listener) =>
      wb.addEventListener(type, (e) => listener({ isUpdate: e.isUpdate, isExternal: e.isExternal })),
    register: () => wb.register(),
    messageSkipWaiting: () => wb.messageSkipWaiting(),
  };
}

function describe(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err);
}

export function createSwController(opts: SwControllerOptions): SwController {
  const hasServiceWorker =
    opts.hasServiceWorker ?? (() => typeof navigator !== 'undefined' && 'serviceWorker' in navigator);
  const createWorkbox = opts.createWorkbox ?? loadWorkbox;
  const reload = opts.reload ?? (() => window.location.reload());

  let state: SwState = {
    supported: opts.enabled && hasServiceWorker(),
    updateAvailable: false,
    offlineReady: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  const patch = (next: Partial<SwState>): void => {
    state = { ...state, ...next };
    for (const l of listeners) l();
  };

  let workbox: Promise<WorkboxLike | null> | null = null;
  let promptShown = false;

  const start = (): void => {
    if (workbox || !state.supported) return;
    workbox = createWorkbox(opts.swUrl, opts.scope)
      .then((wb) => {
        const showPrompt = (): void => {
          if (!promptShown) {
            promptShown = true;
            // Reload only once the new worker has taken control, after the user accepted.
            wb.on('controlling', (e) => {
              if (e.isUpdate) reload();
            });
          }
          patch({ updateAvailable: true });
        };
        wb.on('installed', (e) => {
          if (e.isUpdate === undefined && e.isExternal) showPrompt();
          else if (!e.isUpdate && !promptShown) patch({ offlineReady: true });
        });
        wb.on('waiting', showPrompt);
        wb.register().catch((err: unknown) => {
          patch({ error: `Offline support could not be enabled: ${describe(err)}` });
        });
        return wb;
      })
      .catch((err: unknown) => {
        patch({ error: `Offline support could not be enabled: ${describe(err)}` });
        return null;
      });
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start,
    applyUpdate() {
      if (!workbox) return;
      void workbox.then((wb) => {
        try {
          wb?.messageSkipWaiting();
        } catch (err) {
          patch({ error: `The update could not be applied: ${describe(err)}` });
        }
      });
    },
    dismiss() {
      patch({ updateAvailable: false, offlineReady: false });
    },
  };
}
