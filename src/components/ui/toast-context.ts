import { createContext, useContext, useMemo } from 'react';

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface ToastOptions {
  message: string;
  tone?: ToastTone;
  /** Auto-dismiss delay; `null` keeps the toast until dismissed. Default 5000 ms (8000 with an action). */
  durationMs?: number | null;
  action?: { label: string; onAction: () => void };
}

export interface ToastRecord extends ToastOptions {
  id: number;
}

export interface ToastApi {
  show(options: ToastOptions): number;
  dismiss(id: number): void;
}

export const DEFAULT_TOAST_MS = 5000;
export const DEFAULT_ACTION_TOAST_MS = 8000;
export const MAX_VISIBLE_TOASTS = 3;

export const ToastContext = createContext<ToastApi | null>(null);

/** Access the toast API. Throws outside <ToastProvider> so a missing provider fails loudly. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>.');
  return api;
}

/** How long a degradation notice (why the map changed what it draws) stays on screen. */
export const NOTICE_TOAST_MS = 10000;

/**
 * A handler that shows a view's degradation notice (MapView's `onRenderNotice`) as a
 * warning toast, or undefined outside <ToastProvider> so the view's own inline
 * notice applies. The views take it as a prop instead of reading this context.
 */
export function useNoticeToast(): ((notice: { message: string }) => void) | undefined {
  const api = useContext(ToastContext);
  return useMemo(
    () =>
      api
        ? (notice: { message: string }) => {
            api.show({ message: notice.message, tone: 'warning', durationMs: NOTICE_TOAST_MS });
          }
        : undefined,
    [api],
  );
}
