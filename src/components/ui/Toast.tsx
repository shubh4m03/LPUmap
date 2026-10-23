import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../icons/Icon.tsx';
import type { IconName } from '../icons/icon-paths.ts';
import { IconButton } from './IconButton.tsx';
import { cx, FOCUS_RING } from './cx.ts';
import {
  DEFAULT_ACTION_TOAST_MS,
  DEFAULT_TOAST_MS,
  MAX_VISIBLE_TOASTS,
  ToastContext,
  type ToastApi,
  type ToastOptions,
  type ToastRecord,
  type ToastTone,
} from './toast-context.ts';

const TONE_ICON: Record<ToastTone, IconName> = {
  neutral: 'info',
  success: 'check',
  warning: 'warning',
  danger: 'warning',
};

const TONE_CLASS: Record<ToastTone, string> = {
  neutral: 'text-muted',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

/**
 * Provides `useToast()` and renders the toast stack inside a polite live region that
 * exists from first render, so new toasts are announced by screen readers.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const show = useCallback((options: ToastOptions) => {
    const id = nextId.current++;
    setToasts((ts) => [...ts, { ...options, id }].slice(-MAX_VISIBLE_TOASTS));
    return id;
  }, []);
  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext value={api}>
      {children}
      <section
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-(--ds-z-toast) flex justify-center px-4 pb-safe sm:justify-end"
      >
        <ol aria-live="polite" aria-relevant="additions text" className="flex w-full max-w-sm flex-col gap-2">
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </ol>
      </section>
    </ToastContext>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: number) => void }) {
  const tone = toast.tone ?? 'neutral';
  const duration =
    toast.durationMs === undefined
      ? toast.action
        ? DEFAULT_ACTION_TOAST_MS
        : DEFAULT_TOAST_MS
      : toast.durationMs;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const remaining = useRef(duration ?? 0);

  useEffect(() => {
    if (duration === null || paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [duration, paused, onDismiss, toast.id]);

  return (
    <li
      data-paused={paused || undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      className="pointer-events-auto flex items-start gap-3 rounded-lg border border-border bg-surface-raised p-3 text-sm text-text shadow-2"
    >
      <Icon name={TONE_ICON[tone]} size={20} className={cx('mt-0.5', TONE_CLASS[tone])} />
      <p className="min-w-0 flex-1 py-0.5">{toast.message}</p>
      {toast.action ? (
        <button
          type="button"
          onClick={() => {
            toast.action?.onAction();
            onDismiss(toast.id);
          }}
          className={cx(
            'shrink-0 rounded-sm px-2 py-0.5 font-semibold text-accent-text hover:underline',
            FOCUS_RING,
          )}
        >
          {toast.action.label}
        </button>
      ) : null}
      <IconButton icon="close" label="Dismiss notification" size="sm" onClick={() => onDismiss(toast.id)} />
    </li>
  );
}
