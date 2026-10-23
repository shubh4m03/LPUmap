export type SheetSnap = 'peek' | 'half' | 'full';

export const SNAP_ORDER: readonly SheetSnap[] = ['peek', 'half', 'full'];

/** Mirrors --ds-sheet-peek (8rem) and --ds-sheet-top-gap (2.5rem) in tokens.css. */
export const SHEET_PEEK_PX = 128;
export const SHEET_TOP_GAP_PX = 40;

/** Keyboard/tap cycle: peek → half → full → peek. */
export function nextSnap(current: SheetSnap): SheetSnap {
  const i = SNAP_ORDER.indexOf(current);
  return SNAP_ORDER[(i + 1) % SNAP_ORDER.length] ?? 'half';
}

export function snapHeightsPx(viewportH: number): Record<SheetSnap, number> {
  const full = Math.max(SHEET_PEEK_PX, viewportH - SHEET_TOP_GAP_PX);
  return {
    peek: Math.min(SHEET_PEEK_PX, full),
    half: Math.min(full, Math.max(SHEET_PEEK_PX, viewportH / 2)),
    full,
  };
}

/**
 * Snap point nearest to a released drag height. Dragging well below the peek height
 * (under 60 % of it) dismisses the sheet.
 */
export function closestSnap(heightPx: number, viewportH: number): SheetSnap | 'close' {
  const heights = snapHeightsPx(viewportH);
  if (heightPx < heights.peek * 0.6) return 'close';
  let best: SheetSnap = 'peek';
  let bestDist = Infinity;
  for (const s of SNAP_ORDER) {
    const d = Math.abs(heights[s] - heightPx);
    if (d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}
