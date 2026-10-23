import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { getTabbable } from './focusable.ts';

export interface FocusTrapOptions {
  /** Element to focus on activation; defaults to the first tabbable, then the container. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Return focus to the previously focused element on deactivation (default true). */
  restoreFocus?: boolean;
}

/**
 * Active trap containers in activation order. Only the newest one acts: a trap
 * that is covered by a later one (a confirm dialog opened from a full-height
 * sheet) stands aside instead of pulling focus back, which would make the two
 * traps fight and recurse through focusin.
 */
const trapStack: HTMLElement[] = [];

/** Number of traps currently active (exported for tests). */
export function activeTrapCount(): number {
  return trapStack.length;
}

/**
 * True when `target` sits in a modal that should own focus instead of `container`:
 * a later trap in the stack, or an aria-modal element this hook does not manage
 * (and that does not itself contain the container).
 */
function ownedByOtherModal(container: HTMLElement, target: Node): boolean {
  const mine = trapStack.indexOf(container);
  if (trapStack.slice(mine + 1).some((later) => later.contains(target))) return true;
  const el = target instanceof Element ? target : target.parentElement;
  const modal = el?.closest('[aria-modal="true"]');
  return Boolean(
    modal && modal !== container && !trapStack.includes(modal as HTMLElement) && !modal.contains(container),
  );
}

function isTopTrap(container: HTMLElement): boolean {
  return trapStack[trapStack.length - 1] === container;
}

/**
 * Keeps keyboard focus inside `containerRef` while `active`: Tab/Shift+Tab wrap, and
 * focus that escapes (e.g. a click outside) is pulled back. The container should have
 * tabIndex={-1} so it can hold focus when it has no tabbable children. Nested traps
 * cooperate: only the most recently activated one handles Tab and focus changes.
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
    trapStack.push(container);
    const target = initialFocus?.current ?? getTabbable(container)[0] ?? container;
    if (!container.contains(doc.activeElement)) target.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !isTopTrap(container)) return;
      const current = doc.activeElement;
      if (current && ownedByOtherModal(container, current)) return;
      const tabbable = getTabbable(container);
      const first = tabbable[0];
      const last = tabbable[tabbable.length - 1];
      if (!first || !last) {
        e.preventDefault();
        container.focus();
        return;
      }
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
      if (!(t instanceof Node) || container.contains(t)) return;
      if (!isTopTrap(container) || ownedByOtherModal(container, t)) return;
      (getTabbable(container)[0] ?? container).focus();
    };

    doc.addEventListener('keydown', onKeyDown, true);
    doc.addEventListener('focusin', onFocusIn);
    return () => {
      doc.removeEventListener('keydown', onKeyDown, true);
      doc.removeEventListener('focusin', onFocusIn);
      const i = trapStack.lastIndexOf(container);
      if (i >= 0) trapStack.splice(i, 1);
      if (restoreFocus && previous && previous.isConnected) previous.focus();
    };
  }, [active, containerRef]);
}
