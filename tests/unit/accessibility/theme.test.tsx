import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  THEME_COLORS,
  THEME_STORAGE_KEY,
  createThemeStore,
  initTheme,
  useTheme,
  type ThemeStore,
} from '../../../src/accessibility/index.ts';

function fakeMatchMedia(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<() => void>();
  const mm = vi.fn((query: string) => ({
    get matches() {
      return query.includes('dark') ? dark : false;
    },
    media: query,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  })) as unknown as (q: string) => MediaQueryList;
  return {
    mm,
    setDark(v: boolean) {
      dark = v;
      listeners.forEach((l) => l());
    },
    listenerCount: () => listeners.size,
  };
}

function ThemeProbe({ store }: { store: ThemeStore }) {
  const { preference, resolved, setPreference } = useTheme(store);
  return (
    <div>
      <p>
        {preference}/{resolved}
      </p>
      <button type="button" onClick={() => setPreference('dark')}>
        Dark
      </button>
      <button type="button" onClick={() => setPreference('system')}>
        System
      </button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset['theme'];
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
});
afterEach(cleanup);

describe('theme store', () => {
  it('uses the documented storage key', () => {
    expect(THEME_STORAGE_KEY).toBe('lpu-atlas:v1:theme');
  });

  it('defaults to system and follows prefers-color-scheme', () => {
    const media = fakeMatchMedia(true);
    const store = createThemeStore({ matchMedia: media.mm });
    expect(store.getPreference()).toBe('system');
    expect(store.getResolved()).toBe('dark');
  });

  it('persists explicit choices and removes the key for system', () => {
    const store = createThemeStore({ matchMedia: undefined });
    store.setPreference('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(createThemeStore({ matchMedia: undefined }).getPreference()).toBe('dark');
    store.setPreference('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('ignores corrupt stored values', () => {
    localStorage.setItem(THEME_STORAGE_KEY, '"purple"');
    expect(createThemeStore({ matchMedia: undefined }).getPreference()).toBe('system');
  });

  it('survives a localStorage that throws on every access', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const store = createThemeStore({ matchMedia: undefined });
    expect(store.getPreference()).toBe('system');
    expect(() => store.setPreference('dark')).not.toThrow();
    expect(store.getPreference()).toBe('dark');
    expect(store.getResolved()).toBe('dark');
  });

  it('survives storage being unavailable entirely', () => {
    const store = createThemeStore({
      storage: () => {
        throw new Error('no storage');
      },
      matchMedia: undefined,
    });
    expect(store.getPreference()).toBe('system');
    store.setPreference('light');
    expect(store.getResolved()).toBe('light');
  });

  it('methods work when detached from the store object', () => {
    const { getResolved, setPreference, getPreference } = createThemeStore({ matchMedia: undefined });
    setPreference('dark');
    expect(getPreference()).toBe('dark');
    expect(getResolved()).toBe('dark');
  });

  it('rejects invalid preferences at runtime', () => {
    const store = createThemeStore({ matchMedia: undefined });
    store.setPreference('neon' as never);
    expect(store.getPreference()).toBe('system');
  });

  it('initTheme applies the resolved theme before first render', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(initTheme(createThemeStore({ matchMedia: undefined }))).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', THEME_COLORS.dark);
  });
});

describe('useTheme', () => {
  it('applies data-theme and theme-color, and updates on change', async () => {
    const media = fakeMatchMedia(false);
    const store = createThemeStore({ matchMedia: media.mm });
    render(<ThemeProbe store={store} />);
    expect(screen.getByText('system/light')).toBeInTheDocument();
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', THEME_COLORS.light);

    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(screen.getByText('dark/dark')).toBeInTheDocument();
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('tracks OS changes live while on system, and stops listening on unmount', async () => {
    const media = fakeMatchMedia(false);
    const store = createThemeStore({ matchMedia: media.mm });
    const { unmount } = render(<ThemeProbe store={store} />);
    expect(media.listenerCount()).toBe(1);
    act(() => media.setDark(true));
    expect(screen.getByText('system/dark')).toBeInTheDocument();
    expect(document.documentElement.dataset['theme']).toBe('dark');
    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it('keeps every hook instance in sync', async () => {
    const store = createThemeStore({ matchMedia: undefined });
    render(
      <>
        <ThemeProbe store={store} />
        <ThemeProbe store={store} />
      </>,
    );
    await userEvent.click(screen.getAllByRole('button', { name: 'Dark' })[0]!);
    expect(screen.getAllByText('dark/dark')).toHaveLength(2);
  });

  it('works when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const store = createThemeStore({ matchMedia: undefined });
    render(<ThemeProbe store={store} />);
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(screen.getByText('dark/dark')).toBeInTheDocument();
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });
});

describe('clearing local data', () => {
  it('resets the in-memory theme preference of the default store', async () => {
    const { defaultThemeStore } = await import('../../../src/accessibility/theme.ts');
    const { usePrivacySettings } = await import('../../../src/privacy/index.ts');
    defaultThemeStore.setPreference('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    usePrivacySettings.getState().clearAllLocalData();
    expect(defaultThemeStore.getPreference()).toBe('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
});
