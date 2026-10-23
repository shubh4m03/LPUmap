import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createSwController } from '../../../src/offline/sw-controller.ts';
import type { SwLifecycleEvent, WorkboxLike } from '../../../src/offline/sw-controller.ts';
import {
  createServiceWorkerUpdateHook,
  useServiceWorkerUpdate,
} from '../../../src/offline/use-service-worker-update.ts';

type EventType = 'installed' | 'waiting' | 'controlling';

function fakeWorkbox(register: () => Promise<unknown> = () => Promise.resolve({})) {
  const handlers: Record<EventType, Array<(e: SwLifecycleEvent) => void>> = {
    installed: [],
    waiting: [],
    controlling: [],
  };
  const wb: WorkboxLike & { emit(type: EventType, e?: SwLifecycleEvent): void } = {
    on: (type, l) => void handlers[type].push(l),
    register: vi.fn(register),
    messageSkipWaiting: vi.fn(),
    emit: (type, e = {}) => handlers[type].forEach((l) => l(e)),
  };
  return wb;
}

function setup(wb = fakeWorkbox(), extra: { enabled?: boolean; hasSW?: boolean } = {}) {
  const reload = vi.fn();
  const createWorkbox = vi.fn(() => Promise.resolve(wb));
  const controller = createSwController({
    enabled: extra.enabled ?? true,
    swUrl: '/sw.js',
    scope: '/',
    createWorkbox,
    hasServiceWorker: () => extra.hasSW ?? true,
    reload,
  });
  const useHook = createServiceWorkerUpdateHook(controller);
  return { wb, reload, createWorkbox, controller, useHook };
}

describe('useServiceWorkerUpdate', () => {
  it('registers once with the configured URL and starts with no prompts', async () => {
    const { wb, createWorkbox, useHook } = setup();
    const { result, rerender } = renderHook(() => useHook());
    rerender();
    await waitFor(() => expect(wb.register).toHaveBeenCalledTimes(1));
    expect(createWorkbox).toHaveBeenCalledWith('/sw.js', '/');
    expect(result.current).toMatchObject({
      supported: true,
      updateAvailable: false,
      offlineReady: false,
      error: null,
    });
  });

  it('reports offlineReady after the first install', async () => {
    const { wb, useHook } = setup();
    const { result } = renderHook(() => useHook());
    await waitFor(() => expect(wb.register).toHaveBeenCalled());
    act(() => wb.emit('installed', { isUpdate: false }));
    expect(result.current.offlineReady).toBe(true);
  });

  it('shows the update prompt on waiting and reloads only after the user applies it', async () => {
    const { wb, reload, useHook } = setup();
    const { result } = renderHook(() => useHook());
    await waitFor(() => expect(wb.register).toHaveBeenCalled());
    act(() => wb.emit('waiting', { isUpdate: true }));
    expect(result.current.updateAvailable).toBe(true);
    expect(reload).not.toHaveBeenCalled();

    act(() => result.current.applyUpdate());
    await waitFor(() => expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1));
    act(() => wb.emit('controlling', { isUpdate: true }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('prompts for a worker installed by another tab and ignores update installs', async () => {
    const { wb, reload, useHook } = setup();
    const { result } = renderHook(() => useHook());
    await waitFor(() => expect(wb.register).toHaveBeenCalled());
    act(() => wb.emit('installed', { isUpdate: true }));
    expect(result.current).toMatchObject({ updateAvailable: false, offlineReady: false });
    act(() => wb.emit('installed', { isExternal: true }));
    expect(result.current.updateAvailable).toBe(true);
    // offlineReady is not announced once an update prompt is showing.
    act(() => wb.emit('installed', { isUpdate: false }));
    expect(result.current.offlineReady).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload when a worker takes control without an update (first install)', async () => {
    const { wb, reload, useHook } = setup();
    renderHook(() => useHook());
    await waitFor(() => expect(wb.register).toHaveBeenCalled());
    act(() => wb.emit('waiting', { isUpdate: true }));
    act(() => wb.emit('controlling', { isUpdate: false }));
    expect(reload).not.toHaveBeenCalled();
  });

  it('dismiss hides both prompts', async () => {
    const { wb, useHook } = setup();
    const { result } = renderHook(() => useHook());
    await waitFor(() => expect(wb.register).toHaveBeenCalled());
    act(() => {
      wb.emit('installed', { isUpdate: false });
      wb.emit('waiting', { isUpdate: true });
    });
    act(() => result.current.dismiss());
    expect(result.current.updateAvailable).toBe(false);
    expect(result.current.offlineReady).toBe(false);
  });

  it('surfaces registration errors instead of swallowing them', async () => {
    const wb = fakeWorkbox(() => Promise.reject(new Error('SecurityError: insecure origin')));
    const { useHook } = setup(wb);
    const { result } = renderHook(() => useHook());
    await waitFor(() => expect(result.current.error).toMatch(/insecure origin/));
  });

  it('surfaces a failure to load workbox-window', async () => {
    const controller = createSwController({
      enabled: true,
      swUrl: '/sw.js',
      scope: '/',
      hasServiceWorker: () => true,
      createWorkbox: () => Promise.reject(new Error('chunk load failed')),
    });
    const { result } = renderHook(createServiceWorkerUpdateHook(controller));
    await waitFor(() => expect(result.current.error).toMatch(/chunk load failed/));
  });

  it('surfaces a failed skip-waiting message', async () => {
    const { wb, useHook } = setup();
    vi.mocked(wb.messageSkipWaiting).mockImplementation(() => {
      throw new Error('no waiting worker');
    });
    const { result } = renderHook(() => useHook());
    await waitFor(() => expect(wb.register).toHaveBeenCalled());
    act(() => result.current.applyUpdate());
    await waitFor(() => expect(result.current.error).toMatch(/no waiting worker/));
  });

  it.each([
    { enabled: false, hasSW: true },
    { enabled: true, hasSW: false },
  ])('does not register when unsupported (%o)', async (opts) => {
    const { createWorkbox, useHook } = setup(fakeWorkbox(), opts);
    const { result } = renderHook(() => useHook());
    expect(result.current.supported).toBe(false);
    act(() => result.current.applyUpdate());
    await Promise.resolve();
    expect(createWorkbox).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it('is unsupported (and inert) in non-production builds such as tests', () => {
    const { result } = renderHook(() => useServiceWorkerUpdate());
    expect(result.current).toMatchObject({ supported: false, updateAvailable: false, error: null });
  });
});
