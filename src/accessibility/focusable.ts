const TABBABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

/** Keyboard-tabbable descendants in DOM order (skips hidden, inert and tabindex=-1). */
export function getTabbable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => {
    if (el.tabIndex < 0) return false;
    if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    const style = el.ownerDocument.defaultView?.getComputedStyle(el);
    return !(style && (style.display === 'none' || style.visibility === 'hidden'));
  });
}
