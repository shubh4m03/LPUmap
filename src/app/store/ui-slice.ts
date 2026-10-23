import type { AppState, OpenPanelId, PanelId, SliceCreator, UiSlice } from './types.ts';

function top(stack: readonly OpenPanelId[]): PanelId {
  return stack[stack.length - 1] ?? 'none';
}

/** Opening a panel already in the stack returns to it (drops what was above it). */
export function pushPanel(stack: readonly OpenPanelId[], panel: OpenPanelId): OpenPanelId[] {
  const at = stack.indexOf(panel);
  if (at >= 0) return stack.slice(0, at + 1);
  return [...stack, panel];
}

export const createUiSlice: SliceCreator<UiSlice> = (set, get) => ({
  activePanel: 'none',
  panelStack: [],
  panelCollapsed: false,
  sheetSnap: 'half',
  paletteOpen: false,
  menuOpen: false,
  paletteInitialQuery: '',
  reportTarget: null,
  categoryId: null,
  resultsQuery: '',
  listMode: false,
  listModeReason: null,
  hudCoverPx: 0,

  openPanel(panel) {
    const stack = pushPanel(get().panelStack, panel);
    const wasEmpty = get().panelStack.length === 0;
    set({
      panelStack: stack,
      activePanel: top(stack),
      panelCollapsed: false,
      ...(wasEmpty ? { sheetSnap: 'half' as const } : {}),
    });
  },

  closePanel() {
    const { panelStack } = get();
    if (panelStack.length === 0) return;
    const closing = panelStack[panelStack.length - 1];
    const stack = panelStack.slice(0, -1);
    const patch: Partial<AppState> = { panelStack: stack, activePanel: top(stack) };
    // Closing the details panel ends the selection it was showing.
    if (closing === 'details' && !stack.includes('details')) patch.selectedPlaceId = null;
    set(patch);
  },

  closeAllPanels() {
    set({ panelStack: [], activePanel: 'none', selectedPlaceId: null });
  },

  setPanelCollapsed: (panelCollapsed) => set({ panelCollapsed }),
  setSheetSnap: (sheetSnap) => set({ sheetSnap }),
  openPalette: (initialQuery = '') => set({ paletteOpen: true, paletteInitialQuery: initialQuery }),
  closePalette: () => set({ paletteOpen: false, paletteInitialQuery: '' }),
  setMenuOpen: (menuOpen) => set({ menuOpen }),
  setHudCoverPx(px) {
    const next = Number.isFinite(px) && px > 0 ? Math.round(px) : 0;
    if (next !== get().hudCoverPx) set({ hudCoverPx: next });
  },
  openReport: (target) => set({ reportTarget: { ...target }, paletteOpen: false }),
  closeReport: () => set({ reportTarget: null }),

  openCategory(categoryId) {
    set({ categoryId });
    get().openPanel('category');
  },

  showResults(query) {
    set({ resultsQuery: query });
    get().openPanel('results');
  },

  enterListMode: (reason) => set({ listMode: true, listModeReason: reason }),
});
