import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../app/store/index.ts';
import type { MapPadding } from '../../map/index.ts';
import { snapHeightsPx } from '../ui/index.ts';

/** Panel width (w-96) plus its 16px gutters, so a focused place is not hidden behind the panel. */
const PANEL_SPACE_PX = 16 + 384 + 16;
/** Height of the mobile quick-actions bar under the map (the sheet overlaps it). */
export const QUICKBAR_PX = 60;

export function useDesktopPadding(): MapPadding {
  const open = useAppStore((s) => s.activePanel !== 'none' && !s.panelCollapsed);
  return useMemo(() => ({ top: 80, right: 72, bottom: 32, left: open ? PANEL_SPACE_PX : 16 }), [open]);
}

export function useViewportHeight(): number {
  const [h, setH] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight));
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return h;
}

/** Pixels of the map hidden behind the mobile bottom sheet (0 when closed or full-height). */
export function useSheetCoverPx(viewportH: number): number {
  const open = useAppStore((s) => s.activePanel !== 'none');
  const snap = useAppStore((s) => s.sheetSnap);
  return open && snap !== 'full' ? Math.max(0, snapHeightsPx(viewportH)[snap] - QUICKBAR_PX) : 0;
}

/** Bottom padding follows the sheet's snap height so the selection stays visible above it. */
export function useMobilePadding(viewportH: number): MapPadding {
  const covered = useSheetCoverPx(viewportH);
  return useMemo(() => ({ top: 72, right: 60, bottom: covered + 16, left: 16 }), [covered]);
}
