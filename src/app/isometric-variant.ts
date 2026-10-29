/**
 * Which isometric variant the user asked for (`?view=iso&iso=art|map`,
 * src/app/view-mode.ts). Kept for the session so leaving the overview and
 * coming back shows the same variant; mirrored in the URL without adding a
 * history entry. The variant actually shown also depends on whether the
 * artwork loaded (resolveIsometricVariant).
 */
import { useSyncExternalStore } from 'react';
import { buildIsometricViewUrl, parseIsometricVariantParam, type IsometricVariant } from './view-mode.ts';

type Listener = () => void;

let requested: IsometricVariant | null =
  typeof window === 'undefined' ? null : parseIsometricVariantParam(window.location.search);
const listeners = new Set<Listener>();

export function getRequestedIsometricVariant(): IsometricVariant | null {
  return requested;
}

/** Sets the requested variant and writes `iso=` into the URL (replaceState). */
export function setRequestedIsometricVariant(variant: IsometricVariant | null): void {
  if (variant === requested) return;
  requested = variant;
  if (typeof window !== 'undefined') {
    const next = buildIsometricViewUrl(window.location.href, variant);
    if (next !== window.location.href) {
      try {
        window.history.replaceState(window.history.state, '', next);
      } catch {
        // Some embedded browsers forbid replaceState; the URL is a convenience only.
      }
    }
  }
  for (const l of listeners) l();
}

function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useRequestedIsometricVariant(): IsometricVariant | null {
  return useSyncExternalStore(subscribe, getRequestedIsometricVariant, () => null);
}

/**
 * True while the Illustrated overview is actually on screen (set by its stage
 * on mount/unmount). The app uses it to hand route drawing and map picking
 * over to a map view (ILLUSTRATED_ROUTE_REASON / ILLUSTRATED_PICK_REASON).
 */
let illustratedShown = false;
export function setIllustratedShown(shown: boolean): void {
  illustratedShown = shown;
}
export function isIllustratedShown(): boolean {
  return illustratedShown;
}

/** Test helper. */
export function resetRequestedIsometricVariant(value: IsometricVariant | null = null): void {
  requested = value;
  for (const l of listeners) l();
}
