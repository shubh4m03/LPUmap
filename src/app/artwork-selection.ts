/**
 * Selection of directory rows, by stable ids only, shared by the directory
 * panel, search (palette and results) and `?place=` deep links
 * (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §3, §5). The selection lives in the
 * store's `selectedPlaceId`, so every mode shows the same thing:
 *
 *  - a map building (including one VERIFIED to be an illustration item) is
 *    selected by its building id: the same entry, footprint and details in
 *    every mode;
 *  - an artwork-only item (approximate or unresolved) is selected by its own
 *    `art:` id. Its focus request names that id: the illustrated overview
 *    frames its outline, while the map modes and the map-accurate drawing find
 *    no position for it and stay where they are. An approximate item's
 *    candidate building is never selected ("Unconfirmed match" only).
 *
 * The illustrated renderer maps hotspot clicks and highlights itself
 * (src/isometric-art/hotspot-model.ts subjectsForSelection) with the same rule.
 */
import type { CampusDirectory, DirectoryEntry, DirectoryItem } from '../directory/index.ts';
import { useAppStore } from './store/index.ts';

export { isArtworkId } from './deep-link.ts';

export interface SelectItemOptions {
  /** Ask the active view to frame the selection (default true; never in list mode). */
  focus?: boolean;
}

/**
 * Selects a directory row in whichever view is active. A building without a
 * place record is framed without opening details; every other row opens its
 * details.
 */
export function selectDirectoryItem(item: DirectoryItem, opts: SelectItemOptions = {}): void {
  const s = useAppStore.getState();
  const focus = (opts.focus ?? true) && !s.listMode;
  if (item.kind === 'artwork') {
    s.selectPlace(item.id, { focus });
    return;
  }
  selectBuildingEntry(item.entry, focus);
}

function selectBuildingEntry(e: DirectoryEntry, focus: boolean): void {
  const s = useAppStore.getState();
  if (e.routableReason === 'no-place-record') {
    // Not a place record: frame it without opening details for a record that does not exist.
    s.selectPlace(e.id, { focus: false, openDetails: false });
    if (focus) s.requestFocus({ kind: 'point', lngLat: e.location });
    return;
  }
  s.selectPlace(e.id, { focus });
}

/**
 * The candidate building a selected approximate illustration item points at
 * ("Unconfirmed match"), for a view to frame or name — never to select, label
 * as this item, or route to.
 */
export function unconfirmedMatchFor(
  dir: CampusDirectory,
  selectedId: string | null,
): { subjectId: string; buildingId: string; entry: DirectoryEntry } | null {
  if (!selectedId) return null;
  const art = dir.artwork?.byId.get(selectedId);
  const buildingId = art?.unconfirmedMatch?.buildingId;
  const entry = buildingId ? dir.byId.get(buildingId) : undefined;
  return art && buildingId && entry ? { subjectId: art.id, buildingId, entry } : null;
}
