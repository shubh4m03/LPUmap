import { useEffect, useState, type RefObject } from 'react';
import { useAppStore } from '../../app/store/index.ts';
import { snapHeightsPx } from '../ui/index.ts';
import { QUICKBAR_PX } from './map-padding.ts';

/** Room kept for the MapLibre attribution (compact button or one line of text) plus a gap. */
export const ATTRIBUTION_CLEARANCE_PX = 32;
/** Gap between the toast stack and the top edge of the measured attribution. */
export const ATTRIBUTION_GAP_PX = 8;
/** The attribution control as MapLibre renders it (one line, or several when an imagery credit wraps). */
export const ATTRIBUTION_SELECTOR = '.maplibregl-ctrl-attrib';

/**
 * Bottom offset that puts the toast stack above the attribution's top edge
 * (viewport px). An imagery credit can wrap over several lines on a phone, so a
 * fixed one-line clearance is not enough. Null when no attribution is on screen.
 */
export function aboveAttributionPx(viewportH: number, attributionTop: number | null): number | null {
  if (attributionTop === null || !Number.isFinite(attributionTop)) return null;
  if (attributionTop <= 0 || attributionTop >= viewportH) return null;
  return Math.ceil(viewportH - attributionTop + ATTRIBUTION_GAP_PX);
}

/** The larger of the layout's own offset and the one that clears the measured attribution. */
export function toastOffsetPx(
  baseOffsetPx: number,
  viewportH: number,
  attributionTop: number | null,
): number {
  return Math.max(baseOffsetPx, aboveAttributionPx(viewportH, attributionTop) ?? 0);
}

/**
 * Top edge (viewport px) of the map attribution inside `root`, or null while
 * none is shown. Follows the attribution as it appears, wraps, expands or
 * collapses (ResizeObserver, class changes) and when `layoutKey` changes (e.g.
 * the sheet lifts it).
 */
export function useAttributionTop(root: RefObject<HTMLElement | null>, layoutKey: unknown): number | null {
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    let observed: Element | null = null;
    let frame = 0;
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => schedule()) : null;
    const measure = () => {
      frame = 0;
      const el = host.querySelector(ATTRIBUTION_SELECTOR);
      if (el !== observed) {
        if (observed) resize?.unobserve(observed);
        observed = el;
        if (el) resize?.observe(el);
      }
      const r = el?.getBoundingClientRect();
      setTop(r && r.height > 0 ? r.top : null);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const mutations = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null;
    mutations?.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    window.addEventListener('resize', schedule);
    measure();
    schedule();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      mutations?.disconnect();
      resize?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [root, layoutKey]);
  return top;
}

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

export function useMobileToastOffset(viewportH: number, attributionTop: number | null = null): void {
  const open = useAppStore((s) => s.activePanel !== 'none');
  const snap = useAppStore((s) => s.sheetSnap);
  useToastOffset(toastOffsetPx(mobileToastOffsetPx(viewportH, open, snap), viewportH, attributionTop));
}
