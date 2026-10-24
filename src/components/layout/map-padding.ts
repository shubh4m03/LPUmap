import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../app/store/index.ts';
import type { MapPadding } from '../../map/index.ts';
import { snapHeightsPx } from '../ui/index.ts';

/** Panel width (w-96) plus its 16px gutters, so a focused place is not hidden behind the panel. */
const PANEL_SPACE_PX = 16 + 384 + 16;
/** Height of the mobile quick-actions bar under the map (the sheet overlaps it). */
export const QUICKBAR_PX = 60;

/** The right-hand control column (the 56px view-mode switcher) plus its 16px gutters. */
const CONTROLS_SPACE_PX = 16 + 56 + 16;

export function useDesktopPadding(): MapPadding {
  const open = useAppStore((s) => s.activePanel !== 'none' && !s.panelCollapsed);
  return useMemo(
    () => ({ top: 80, right: CONTROLS_SPACE_PX, bottom: 32, left: open ? PANEL_SPACE_PX : 16 }),
    [open],
  );
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

/** Map area under the search pill (and above the navigation card). */
export const MOBILE_TOP_PX = 72;
/** Gap kept below the navigation card and the smallest map height padding may leave. */
const HUD_GAP_PX = 8;
const MIN_VISIBLE_PX = 48;

/**
 * Mobile map padding. Bottom follows the sheet's snap height; top grows by the live
 * navigation card so the user's dot (follow-me, recentre) is never under the card.
 * The top is capped so some map height always remains between the two.
 */
export function mobilePadding(viewportH: number, sheetCoverPx: number, hudCoverPx: number): MapPadding {
  const bottom = sheetCoverPx + 16;
  const wanted = hudCoverPx > 0 ? MOBILE_TOP_PX + hudCoverPx + HUD_GAP_PX : MOBILE_TOP_PX;
  const mapH = viewportH - QUICKBAR_PX;
  const top = Math.max(MOBILE_TOP_PX, Math.min(wanted, mapH - bottom - MIN_VISIBLE_PX));
  return { top, right: 60, bottom, left: 16 };
}

export function useMobilePadding(viewportH: number): MapPadding {
  const covered = useSheetCoverPx(viewportH);
  const hud = useAppStore((s) => s.hudCoverPx);
  return useMemo(() => mobilePadding(viewportH, covered, hud), [viewportH, covered, hud]);
}
