import { useEffect } from 'react';

/** While `dirty`, the browser asks before the page is closed or reloaded. */
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Some browsers still require returnValue to be set.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}

export const UNSAVED_CONFIRM = 'You have unsaved changes. Leave without saving?';
