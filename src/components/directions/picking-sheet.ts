/**
 * "Choose on map" lowers the phone sheet so the map is visible; once picking
 * ends (a point was chosen or it was cancelled) the sheet goes back to where
 * it was, so the user sees the updated route instead of a bare peek handle.
 */
import { useEffect } from 'react';
import { useAppStore, type PickTarget } from '../../app/store/index.ts';
import type { SheetSnap } from '../ui/index.ts';

let restoreSnap: SheetSnap | null = null;

/** Enters map-picking mode for `target`, lowering the sheet if it hides the map. */
export function startMapPicking(target: PickTarget): void {
  const s = useAppStore.getState();
  s.setPickingOnMap(target);
  if (s.sheetSnap !== 'peek') {
    restoreSnap = s.sheetSnap;
    s.setSheetSnap('peek');
  }
}

/** Restores the sheet when picking ends. Mount once (the directions panel does). */
export function usePickingSheetRestore(): void {
  useEffect(
    () =>
      useAppStore.subscribe((s, prev) => {
        if (!prev.pickingOnMap || s.pickingOnMap) return;
        const snap = restoreSnap;
        restoreSnap = null;
        // Only undo our own change: if the user moved the sheet meanwhile, leave it.
        if (snap && s.sheetSnap === 'peek' && s.activePanel === 'directions') s.setSheetSnap(snap);
      }),
    [],
  );
}
