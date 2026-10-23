import { useEffect } from 'react';

let locks = 0;
let saved: { overflow: string; paddingRight: string } | null = null;

/** Reference-counted body scroll lock so stacked dialogs/sheets release it correctly. */
export function lockBodyScroll(): () => void {
  const body = document.body;
  if (locks === 0) {
    saved = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
  }
  locks++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks--;
    if (locks === 0 && saved) {
      body.style.overflow = saved.overflow;
      body.style.paddingRight = saved.paddingRight;
      saved = null;
    }
  };
}

export function useScrollLock(active: boolean): void {
  useEffect(() => (active ? lockBodyScroll() : undefined), [active]);
}
