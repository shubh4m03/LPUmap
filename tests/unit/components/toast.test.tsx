import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast, type ToastOptions } from '../../../src/components/ui/index.ts';

let api: ReturnType<typeof useToast> | null = null;

function Grab() {
  const toast = useToast();
  useEffect(() => {
    api = toast;
  }, [toast]);
  return null;
}

function setup() {
  render(
    <ToastProvider>
      <Grab />
    </ToastProvider>,
  );
  const show = (o: ToastOptions) => act(() => void api!.show(o));
  return { show };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  api = null;
});

describe('Toast', () => {
  it('renders toasts inside a polite live region that exists before any toast', () => {
    const { show } = setup();
    const region = document.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region).toBeEmptyDOMElement();
    show({ message: 'Route copied' });
    expect(region).toHaveTextContent('Route copied');
    expect(screen.getByRole('region', { name: 'Notifications' })).toContainElement(region as HTMLElement);
  });

  it('auto-dismisses after the default duration', () => {
    const { show } = setup();
    show({ message: 'Saved' });
    act(() => vi.advanceTimersByTime(4999));
    expect(screen.queryByText('Saved')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('pauses auto-dismiss while hovered or focused and resumes with remaining time', () => {
    const { show } = setup();
    show({ message: 'Hover me', durationMs: 1000 });
    const item = screen.getByText('Hover me').closest('li')!;
    act(() => vi.advanceTimersByTime(600));
    fireEvent.pointerEnter(item);
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByText('Hover me')).not.toBeNull();
    fireEvent.pointerLeave(item);
    act(() => vi.advanceTimersByTime(399));
    expect(screen.queryByText('Hover me')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Hover me')).toBeNull();
  });

  it('pauses while focus is inside the toast', () => {
    const { show } = setup();
    show({ message: 'Focus me', durationMs: 500 });
    act(() => screen.getByRole('button', { name: 'Dismiss notification' }).focus());
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByText('Focus me')).not.toBeNull();
  });

  it('keeps persistent toasts until dismissed and runs actions', () => {
    const onAction = vi.fn();
    const { show } = setup();
    show({ message: 'Update available', durationMs: null, action: { label: 'Reload', onAction } });
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.queryByText('Update available')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Update available')).toBeNull();
  });

  it('caps the stack at three, dropping the oldest', () => {
    const { show } = setup();
    for (const m of ['one', 'two', 'three', 'four']) show({ message: m });
    expect(screen.queryByText('one')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('useToast throws outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Grab />)).toThrow(/ToastProvider/);
  });
});
