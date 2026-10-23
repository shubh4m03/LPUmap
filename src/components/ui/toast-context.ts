import { createContext, useContext } from 'react';

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
