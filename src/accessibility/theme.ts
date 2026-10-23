/**
 * Theme preference store (no React). The preference is persisted in localStorage under
 * `lpu-atlas:v1:theme`; every storage access is guarded because private browsing and
 * blocked site data make localStorage throw.
 */
import { APP_CONFIG } from '../config/index.ts';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = `${APP_CONFIG.storage.prefix}:v${APP_CONFIG.storage.version}:theme`;

/** meta[name=theme-color] per theme; equals --ds-surface (asserted by the contrast test). */
export const THEME_COLORS: Record<ResolvedTheme, string> = { light: '#ffffff', dark: '#0b0f14' };

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function isThemePreference(v: unknown): v is ThemePreference {
  return v === 'system' || v === 'light' || v === 'dark';
}

export interface ThemeStore {
  getPreference(): ThemePreference;
  setPreference(p: ThemePreference): void;
  getResolved(): ResolvedTheme;
  subscribe(listener: () => void): () => void;
}

export interface ThemeStoreEnv {
  storage?: () => Storage | undefined;
  matchMedia?: ((query: string) => MediaQueryList) | undefined;
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function defaultMatchMedia(): ((q: string) => MediaQueryList) | undefined {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia.bind(window)
    : undefined;
}

export function createThemeStore(env: ThemeStoreEnv = {}): ThemeStore {
  const getStorage = env.storage ?? defaultStorage;
  const mm = 'matchMedia' in env ? env.matchMedia : defaultMatchMedia();
  const listeners = new Set<() => void>();
  let preference: ThemePreference | null = null;
  let mql: MediaQueryList | null = null;

  const read = (): ThemePreference => {
    try {
      const raw = getStorage()?.getItem(THEME_STORAGE_KEY);
      return isThemePreference(raw) ? raw : 'system';
    } catch {
      return 'system';
    }
  };

  const systemDark = (): boolean => {
    try {
      return mm ? mm(DARK_QUERY).matches : false;
    } catch {
      return false;
    }
  };

  const emit = () => listeners.forEach((l) => l());

  const getPreference = (): ThemePreference => {
    preference ??= read();
    return preference;
  };

  // Methods close over local state (no `this`), so they work when passed detached,
  // e.g. useSyncExternalStore(store.subscribe, store.getResolved).
  return {
    getPreference,
    setPreference(p) {
      if (!isThemePreference(p)) return;
      preference = p;
      try {
        const s = getStorage();
        if (p === 'system') s?.removeItem(THEME_STORAGE_KEY);
        else s?.setItem(THEME_STORAGE_KEY, p);
      } catch {
        // Persisting is best-effort; the in-memory preference still applies.
      }
      emit();
    },
    getResolved() {
      const p = getPreference();
      if (p !== 'system') return p;
      return systemDark() ? 'dark' : 'light';
    },
    subscribe(listener) {
      listeners.add(listener);
      if (!mql && mm) {
        try {
          mql = mm(DARK_QUERY);
          mql.addEventListener?.('change', emit);
        } catch {
          mql = null;
        }
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && mql) {
          mql.removeEventListener?.('change', emit);
          mql = null;
        }
      };
    },
  };
}

/** Writes data-theme on <html> and updates (or creates) meta[name=theme-color]. */
export function applyTheme(resolved: ResolvedTheme, doc: Document = document): void {
  doc.documentElement.dataset['theme'] = resolved;
  let meta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = doc.createElement('meta');
    meta.name = 'theme-color';
    doc.head.appendChild(meta);
  }
  meta.content = THEME_COLORS[resolved];
}

export const defaultThemeStore: ThemeStore = createThemeStore();

/** Call once before the first render (e.g. in main.tsx) to avoid a theme flash. */
export function initTheme(store: ThemeStore = defaultThemeStore): ResolvedTheme {
  const resolved = store.getResolved();
  if (typeof document !== 'undefined') applyTheme(resolved);
  return resolved;
}
