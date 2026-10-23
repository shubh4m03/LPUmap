import { useEffect } from 'react';
import { writePlaceParam } from '../deep-link.ts';
import { selectOverlayDepth, useAppStore } from '../store/index.ts';

const MARK = 'atlasLayer';

/** Minimal slice of `window.history` the controller needs (injectable for tests). */
export interface HistoryLike {
  readonly state: unknown;
  pushState(data: unknown, unused: string, url?: string | URL | null): void;
  go(delta: number): void;
}

export interface HistoryLayers {
  /** Bring the history entries in step with the number of open layers. */
  sync(target: number): void;
  /** Handle a `popstate`; returns true when it was a user "back" that should close a layer. */
  onPopState(): boolean;
}

/**
 * Keeps one history entry per open layer (palette, panels). Closing from the UI
 * rewinds entries with `history.go(-n)`, which is asynchronous: until its
 * `popstate` arrives, no new entry may be pushed — a `pushState` issued while a
 * traversal is pending races it, and the browser ends up on the wrong entry, so
 * a later "back" leaves the app instead of closing a panel. Syncs requested
 * meanwhile are replayed once the rewind has landed.
 */
export function createHistoryLayers(
  history: HistoryLike,
  getHref: () => string,
  getTarget: () => number,
): HistoryLayers {
  let depth = 0;
  let rewinding = false;

  const sync = (target: number) => {
    if (rewinding) return;
    if (target > depth) {
      const base = (history.state ?? {}) as Record<string, unknown>;
      for (let d = depth + 1; d <= target; d += 1) history.pushState({ ...base, [MARK]: d }, '', getHref());
      depth = target;
    } else if (target < depth) {
      const n = depth - target;
      depth = target;
      rewinding = true;
      history.go(-n);
    }
  };

  const onPopState = () => {
    if (rewinding) {
      rewinding = false;
      sync(getTarget());
      return false;
    }
    if (depth === 0) return false;
    depth -= 1;
    return true;
  };

  return { sync, onPopState };
}

/**
 * Browser back closes the topmost layer (palette, then panels). Each opened
 * layer pushes one history entry; closing from the UI rewinds those entries
 * silently so history stays in step.
 */
export function useHistoryLayers(): void {
  useEffect(() => {
    const layers = createHistoryLayers(
      window.history,
      () => window.location.href,
      () => selectOverlayDepth(useAppStore.getState()),
    );

    const onPopState = () => {
      if (layers.onPopState()) {
        const s = useAppStore.getState();
        if (s.paletteOpen) s.closePalette();
        else s.closePanel();
      }
      // The entry we landed on may carry an older ?place=; re-mirror the current selection.
      writePlaceParam(useAppStore.getState().selectedPlaceId);
    };

    layers.sync(selectOverlayDepth(useAppStore.getState()));
    const unsubscribe = useAppStore.subscribe((s) => layers.sync(selectOverlayDepth(s)));
    window.addEventListener('popstate', onPopState);
    return () => {
      unsubscribe();
      window.removeEventListener('popstate', onPopState);
    };
  }, []);
}
