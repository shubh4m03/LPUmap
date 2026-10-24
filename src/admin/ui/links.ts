import type { MouseEvent } from 'react';

/** Click handler for in-app links: plain left clicks navigate in place, others keep browser behaviour. */
export function onInAppClick(go: () => void) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go();
  };
}
