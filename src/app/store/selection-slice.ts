import type { SelectionSlice, SliceCreator } from './types.ts';

let focusSeq = 0;

export const createSelectionSlice: SliceCreator<SelectionSlice> = (set, get) => ({
  selectedPlaceId: null,
  focusRequest: null,
  unconfirmedMatch: null,

  selectPlace(id, opts = {}) {
    const { focus = true, openDetails = true } = opts;
    set({ selectedPlaceId: id, unconfirmedMatch: null });
    if (openDetails) get().openPanel('details');
    if (focus) get().requestFocus({ kind: 'place', placeId: id });
  },

  clearSelection() {
    const { panelStack } = get();
    if (panelStack[panelStack.length - 1] === 'details') get().closePanel();
    set({ selectedPlaceId: null, unconfirmedMatch: null });
  },

  showUnconfirmedMatch(buildingId, label) {
    set({ unconfirmedMatch: { buildingId, label } });
    get().requestFocus({ kind: 'place', placeId: buildingId });
  },

  requestFocus(target) {
    focusSeq += 1;
    set({ focusRequest: { ...target, seq: focusSeq } });
  },
});
