import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  applyTheme,
  defaultThemeStore,
  type ResolvedTheme,
  type ThemePreference,
  type ThemeStore,
} from './theme.ts';

export interface UseThemeResult {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference(p: ThemePreference): void;
}

/**
 * Theme preference shared by every caller, persisted under `lpu-atlas:v1:theme`.
 * 'system' follows prefers-color-scheme live. Applies html[data-theme] and the
 * theme-color meta tag whenever the resolved theme changes.
 */
export function useTheme(store: ThemeStore = defaultThemeStore): UseThemeResult {
  const subscribe = useCallback((l: () => void) => store.subscribe(l), [store]);
  const preference = useSyncExternalStore(
    subscribe,
    () => store.getPreference(),
    () => 'system' as const,
  );
  const resolved = useSyncExternalStore(
    subscribe,
    () => store.getResolved(),
    () => 'light' as const,
  );

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  const setPreference = useCallback((p: ThemePreference) => store.setPreference(p), [store]);
  return { preference, resolved, setPreference };
}
