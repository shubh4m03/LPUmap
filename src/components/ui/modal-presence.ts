import { useEffect, useSyncExternalStore } from 'react';

/**
 * Counts open modal dialogs so app-wide layers (the toast stack) can keep clear
 * of them: a toast must never cover a dialog's action buttons.
 */
let openCount = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const isOpen = () => openCount > 0;

/** Registers a modal as open while `open` is true. */
export function useModalPresence(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    openCount += 1;
    emit();
    return () => {
      openCount -= 1;
      emit();
    };
  }, [open]);
}

/** True while at least one modal dialog is open. */
export function useAnyModalOpen(): boolean {
  return useSyncExternalStore(subscribe, isOpen, () => false);
}
