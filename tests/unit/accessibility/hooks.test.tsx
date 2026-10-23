import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LiveRegion,
  SkipLink,
  announce,
  clearAnnouncements,
  useAnnounce,
  useFocusTrap,
  useIsMobile,
  useMediaQuery,
  useReducedMotion,
} from '../../../src/accessibility/index.ts';

afterEach(() => {
  cleanup();
  clearAnnouncements();
});

describe('LiveRegion / useAnnounce', () => {
  it('renders empty polite and assertive regions up front', () => {
    render(<LiveRegion />);
    expect(screen.getByTestId('live-region-polite')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByTestId('live-region-assertive')).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getByTestId('live-region-polite')).toBeEmptyDOMElement();
  });

  it('routes messages by politeness and ignores blank messages', () => {
    render(<LiveRegion />);
    const { result } = renderHook(() => useAnnounce());
    act(() => result.current('Route found: 450 m, 6 min'));
    act(() => result.current('Location permission denied', 'assertive'));
    act(() => result.current('   '));
    expect(screen.getByTestId('live-region-polite')).toHaveTextContent('Route found: 450 m, 6 min');
    expect(screen.getByTestId('live-region-assertive')).toHaveTextContent('Location permission denied');
  });

  it('re-inserts the node when the same text is announced twice', () => {
    render(<LiveRegion />);
    act(() => announce('Off route'));
    const first = screen.getByTestId('live-region-polite').firstElementChild;
    act(() => announce('Off route'));
    const second = screen.getByTestId('live-region-polite').firstElementChild;
    expect(second).toHaveTextContent('Off route');
    expect(second).not.toBe(first);
  });

  it('returns a stable function', () => {
    const { result, rerender } = renderHook(() => useAnnounce());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

function TrapHarness({ empty = false }: { empty?: boolean }) {
  const [active, setActive] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, active);
  return (
    <>
      <button type="button" onClick={() => setActive(true)}>
        Activate
      </button>
      <div ref={ref} tabIndex={-1} data-testid="trap">
        {empty ? (
          <p>No controls</p>
        ) : (
          <>
            <button type="button">A</button>
            <button type="button" disabled>
              Disabled
            </button>
            <div hidden>
              <button type="button">Hidden</button>
            </div>
            <button type="button" onClick={() => setActive(false)}>
              Deactivate
            </button>
          </>
        )}
      </div>
      <button type="button">Outside</button>
    </>
  );
}

describe('useFocusTrap', () => {
  it('skips disabled and hidden elements and restores focus on deactivate', async () => {
    render(<TrapHarness />);
    const activate = screen.getByRole('button', { name: 'Activate' });
    await userEvent.click(activate);
    expect(screen.getByRole('button', { name: 'A' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Deactivate' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'A' })).toHaveFocus();
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}{Enter}');
    expect(activate).toHaveFocus();
  });

  it('pulls escaped focus back inside', async () => {
    render(<TrapHarness />);
    await userEvent.click(screen.getByRole('button', { name: 'Activate' }));
    act(() => screen.getByRole('button', { name: 'Outside' }).focus());
    expect(screen.getByTestId('trap')).toContainElement(document.activeElement as HTMLElement);
  });

  it('holds focus on the container when it has nothing tabbable', async () => {
    render(<TrapHarness empty />);
    await userEvent.click(screen.getByRole('button', { name: 'Activate' }));
    expect(screen.getByTestId('trap')).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByTestId('trap')).toHaveFocus();
  });
});

describe('media query hooks', () => {
  it('fall back to false without matchMedia', () => {
    const original = window.matchMedia;
    // jsdom may or may not provide matchMedia; force the missing case.
    Object.defineProperty(window, 'matchMedia', { value: undefined, configurable: true, writable: true });
    const { result } = renderHook(() => [useIsMobile(), useReducedMotion(), useMediaQuery('(x)', true)]);
    expect(result.current).toEqual([false, false, true]);
    Object.defineProperty(window, 'matchMedia', { value: original, configurable: true, writable: true });
  });

  it('react to media changes and query the 768px breakpoint', () => {
    const listeners = new Set<() => void>();
    let matches = false;
    const queries: string[] = [];
    const original = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn((q: string) => {
        queries.push(q);
        return {
          get matches() {
            return matches;
          },
          addEventListener: (_: string, l: () => void) => listeners.add(l),
          removeEventListener: (_: string, l: () => void) => listeners.delete(l),
        };
      }),
    });
    const { result, unmount } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    expect(queries.some((q) => /max-width: 767\.98px/.test(q))).toBe(true);
    act(() => {
      matches = true;
      listeners.forEach((l) => l());
    });
    expect(result.current).toBe(true);
    unmount();
    expect(listeners.size).toBe(0);
    Object.defineProperty(window, 'matchMedia', { value: original, configurable: true, writable: true });
  });
});

describe('SkipLink', () => {
  it('moves focus to the main landmark', async () => {
    render(
      <>
        <SkipLink targetId="main" />
        <main id="main">Map</main>
      </>,
    );
    await userEvent.click(screen.getByRole('link', { name: 'Skip to main content' }));
    expect(screen.getByRole('main')).toHaveFocus();
    expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1');
  });

  it('hides only while unfocused so focus keeps its fixed position and padding', () => {
    render(<SkipLink targetId="main" />);
    const classes = screen.getByRole('link').className.split(/\s+/);
    // Tailwind's `focus:not-sr-only` sets position:static and padding:0, which would
    // undo `fixed` and the padding on focus; the link must use `not-focus:sr-only`.
    expect(classes).toContain('not-focus:sr-only');
    expect(classes).not.toContain('sr-only');
    expect(classes).not.toContain('focus:not-sr-only');
    expect(classes).toEqual(expect.arrayContaining(['fixed', 'px-4', 'py-3']));
  });

  it('falls back to normal hash navigation when the target is missing', async () => {
    render(<SkipLink targetId="nowhere">Skip</SkipLink>);
    expect(screen.getByRole('link', { name: 'Skip' })).toHaveAttribute('href', '#nowhere');
  });
});
