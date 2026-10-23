import { useCallback, useRef } from 'react';
import { useAppStore } from '../../app/store/index.ts';

/**
 * A modal dialog opened from inside a full-height mobile sheet would fight the
 * sheet's own focus trap (the sheet is modal at 'full'). Before opening such a
 * dialog, drop the sheet to 'half' (a non-modal region) and put it back after.
 * Harmless on desktop, where the sheet snap is not used.
 */
export function useSheetYield(): { yieldSheet: () => void; restoreSheet: () => void } {
  const previous = useRef<'full' | null>(null);
  const yieldSheet = useCallback(() => {
    const s = useAppStore.getState();
    if (s.sheetSnap === 'full') {
      previous.current = 'full';
      s.setSheetSnap('half');
    }
  }, []);
  const restoreSheet = useCallback(() => {
    if (previous.current) {
      useAppStore.getState().setSheetSnap(previous.current);
      previous.current = null;
    }
  }, []);
  return { yieldSheet, restoreSheet };
}
