import type { MouseEvent, ReactNode } from 'react';

export interface SkipLinkProps {
  /** id of the landmark to jump to (without '#'). */
  targetId: string;
  children?: ReactNode;
}

/** First focusable element on the page; visible only when focused. */
export function SkipLink({ targetId, children = 'Skip to main content' }: SkipLinkProps) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(targetId);
    if (!target) return;
    e.preventDefault();
    // Hash navigation does not move focus to non-focusable elements in every browser.
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus();
  };
  return (
    <a
      href={`#${targetId}`}
      onClick={onClick}
      // `not-focus:sr-only` rather than `sr-only focus:not-sr-only`: the latter resets
      // position to static and padding to 0 on focus, overriding `fixed` and `px-4 py-3`.
      className="fixed top-2 left-2 z-(--ds-z-skip-link) rounded-md bg-surface-raised px-4 py-3 font-medium text-accent-text shadow-2 not-focus:sr-only"
    >
      {children}
    </a>
  );
}
