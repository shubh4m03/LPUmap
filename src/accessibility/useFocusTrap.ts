import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { getTabbable } from './focusable.ts';

export interface FocusTrapOptions {
  /** Element to focus on activation; defaults to the first tabbable, then the container. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Return focus to the previously focused element on deactivation (default true). */
  restoreFocus?: boolean;
}

/**
 * Keeps keyboard focus inside `containerRef` while `active`: Tab/Shift+Tab wrap, and
 * focus that escapes (e.g. a click outside) is pulled back. The container should have
 * tabIndex={-1} so it can hold focus when it has no tabbable children.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  options: FocusTrapOptions = {},
): void {
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;
    const doc = container.ownerDocument;
    const previous = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    const { initialFocus, restoreFocus = true } = optionsRef.current;

    const target = initialFocus?.current ?? getTabbable(container)[0] ?? container;
    if (!container.contains(doc.activeElement)) target.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const tabbable = getTabbable(container);
      const first = tabbable[0];
      const last = tabbable[tabbable.length - 1];
      if (!first || !last) {
        e.preventDefault();
        container.focus();
        return;
      }
      const current = doc.activeElement;
      if (e.shiftKey && (current === first || current === container || !container.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !container.contains(current))) {
        e.preventDefault();
        first.focus();
      }
    };

    const onFocusIn = (e: FocusEvent) => {
      const t = e.target;
      if (t instanceof Node && !container.contains(t)) {
        (getTabbable(container)[0] ?? container).focus();
      }
    };

    doc.addEventListener('keydown', onKeyDown, true);
    doc.addEventListener('focusin', onFocusIn);
    return () => {
      doc.removeEventListener('keydown', onKeyDown, true);
      doc.removeEventListener('focusin', onFocusIn);
      if (restoreFocus && previous && previous.isConnected) previous.focus();
    };
  }, [active, containerRef]);
}
