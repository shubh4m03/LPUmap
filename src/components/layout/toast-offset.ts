import { useEffect } from 'react';
import { useAppStore } from '../../app/store/index.ts';
import { snapHeightsPx } from '../ui/index.ts';
import { QUICKBAR_PX } from './map-padding.ts';

/** Room kept for the MapLibre attribution (compact button or one line of text) plus a gap. */
export const ATTRIBUTION_CLEARANCE_PX = 32;

/**
 * Bottom offset of the mobile toast stack: above the sheet (its peek height while it is
 * at full height, so toasts never ride up over the sheet's header) or, with no sheet,
 * above the quick-actions bar — and always above the map attribution.
 */
export function mobileToastOffsetPx(
  viewportH: number,
  sheetOpen: boolean,
  snap: 'peek' | 'half' | 'full',
): number {
  const heights = snapHeightsPx(viewportH);
  const base = sheetOpen ? (snap === 'full' ? heights.peek : heights[snap]) : QUICKBAR_PX;
  return Math.round(base + ATTRIBUTION_CLEARANCE_PX);
}

/** Writes `--ds-toast-offset` on <html> while mounted (reset on unmount). */
export function useToastOffset(px: number): void {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--ds-toast-offset', `${px}px`);
    return () => {
      root.style.removeProperty('--ds-toast-offset');
    };
  }, [px]);
}

export function useMobileToastOffset(viewportH: number): void {
  const open = useAppStore((s) => s.activePanel !== 'none');
  const snap = useAppStore((s) => s.sheetSnap);
  useToastOffset(mobileToastOffsetPx(viewportH, open, snap));
}
