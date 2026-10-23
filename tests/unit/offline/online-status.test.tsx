import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { useOnlineStatus } from '../../../src/offline/use-online-status.ts';

function setOnLine(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useOnlineStatus', () => {
  it('reflects the initial navigator.onLine value', () => {
    setOnLine(false);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);
  });

  it('updates on offline and online events', () => {
    setOnLine(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    act(() => {
      setOnLine(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe(false);

    act(() => {
      setOnLine(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current).toBe(true);
  });

  it('removes its listeners on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useOnlineStatus());
    unmount();
    const removed = remove.mock.calls.map((c) => c[0]);
    expect(removed).toContain('online');
    expect(removed).toContain('offline');
  });

  it('renders as online on the server', () => {
    setOnLine(false);
    function Probe() {
      return createElement('span', null, useOnlineStatus() ? 'online' : 'offline');
    }
    expect(renderToString(createElement(Probe))).toContain('online');
  });
});
