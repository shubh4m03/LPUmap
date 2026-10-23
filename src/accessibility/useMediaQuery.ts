import { useCallback, useSyncExternalStore } from 'react';

/** Mobile/desktop split used across the app (matches Tailwind `md`). */
export const MOBILE_BREAKPOINT_PX = 768;

function getMql(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  try {
    return window.matchMedia(query);
  } catch {
    return null;
  }
}

/** Live `matchMedia` result. Returns `fallback` where matchMedia is unavailable (SSR, old jsdom). */
export function useMediaQuery(query: string, fallback = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = getMql(query);
      if (!mql) return () => {};
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  const getSnapshot = () => getMql(query)?.matches ?? fallback;
  return useSyncExternalStore(subscribe, getSnapshot, () => fallback);
}

export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT_PX - 0.02}px)`);
}

export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)');
}
