import { useEffect, useRef, type RefObject } from 'react';
import { useAppStore } from '../../app/store/index.ts';

function focusLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || !active.isConnected;
}

/**
 * When the panel content changes under the user (a row they activated is
 * replaced by the details view, or the panel's close button unmounts), focus
 * would fall back to <body> and keyboard / screen-reader users would restart
 * from the top of the page. This moves it to the new panel's heading, or to
 * the search field when no panel is left. Focus that is still somewhere
 * meaningful (the map, the palette's opener, …) is never moved, and nothing
 * happens on the first render (page load / deep link).
 */
export function usePanelFocusRescue(container: RefObject<HTMLElement | null>): void {
  const key = useAppStore((s) => `${s.activePanel}|${s.selectedPlaceId ?? ''}|${s.categoryId ?? ''}`);
  const previous = useRef(key);

  useEffect(() => {
    if (previous.current === key) return;
    previous.current = key;
    if (!focusLost()) return;
    const heading = container.current?.querySelector<HTMLElement>('h2');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      return;
    }
    document.querySelector<HTMLElement>('[data-search-trigger]')?.focus({ preventScroll: true });
  }, [key, container]);
}
