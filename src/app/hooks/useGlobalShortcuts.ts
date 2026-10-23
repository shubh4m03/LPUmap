import { useEffect } from 'react';
import { useAppStore } from '../store/index.ts';

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Ctrl/⌘+K toggles the command palette, '/' opens it (outside text fields),
 * and Escape closes the topmost panel when no dialog/sheet handled it first.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const s = useAppStore.getState();
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (s.paletteOpen) s.closePalette();
        else if (!s.reportTarget) {
          // Never stack two modal dialogs (their focus traps would fight).
          if (s.menuOpen) s.setMenuOpen(false);
          s.openPalette();
        }
        return;
      }
      if (e.defaultPrevented) return;
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target)) {
        if (s.paletteOpen || s.reportTarget || s.menuOpen) return;
        e.preventDefault();
        s.openPalette();
        return;
      }
      if (e.key === 'Escape') {
        if (s.paletteOpen || s.reportTarget || s.menuOpen) return;
        if (s.pickingOnMap) {
          s.setPickingOnMap(null);
          return;
        }
        if (s.panelStack.length > 0) {
          e.preventDefault();
          s.closePanel();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
