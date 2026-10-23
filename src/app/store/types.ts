/**
 * Shapes of the app store. Each slice lives in its own file; the combined
 * `AppState` is what every slice creator receives (so a slice may read or
 * update another slice's fields through `set`/`get`).
 */
import type { StateCreator } from 'zustand';
import type { SheetSnap } from '../../components/ui/sheet-snap.ts';
import type { LayerGroupId } from '../../config/categories.ts';
import type { LngLat } from '../../data/schema.ts';
import type { CorrectionKind } from '../../feedback/index.ts';
import type { NavSlice } from './nav-types.ts';
import type { RouteSlice } from './route-types.ts';

export type PanelId =
  | 'none'
  | 'results'
  | 'details'
  | 'directions'
  | 'layers'
  | 'favorites'
  | 'settings'
  | 'about'
  | 'info'
  | 'category';
export type OpenPanelId = Exclude<PanelId, 'none'>;

/** What the correction dialog is about. `{}` = a general report not tied to a place. */
export interface ReportTarget {
  placeId?: string;
  placeName?: string;
  kind?: CorrectionKind;
}

export interface UiSlice {
  /** Topmost open panel (== last entry of panelStack, or 'none'). */
  activePanel: PanelId;
  /** Open panels, bottom to top. Browser back / Escape pop the top one. */
  panelStack: OpenPanelId[];
  /** Desktop only: panel body hidden so the map is unobstructed. */
  panelCollapsed: boolean;
  sheetSnap: SheetSnap;
  paletteOpen: boolean;
  /** The app menu dialog (MoreMenu) is open. */
  menuOpen: boolean;
  /** Text the palette starts with when opened. */
  paletteInitialQuery: string;
  reportTarget: ReportTarget | null;
  /** Category shown by the 'category' panel. */
  categoryId: string | null;
  /** Query shown by the 'results' panel. */
  resultsQuery: string;
  /** The map failed or was switched off; the list-based layout is used. */
  listMode: boolean;
  listModeReason: string | null;
  /** Mobile: height in px of the live navigation/tracking card over the top of the map (0 = none). */
  hudCoverPx: number;
  openPanel(panel: OpenPanelId): void;
  closePanel(): void;
  closeAllPanels(): void;
  setPanelCollapsed(collapsed: boolean): void;
  setSheetSnap(snap: SheetSnap): void;
  openPalette(initialQuery?: string): void;
  closePalette(): void;
  setMenuOpen(open: boolean): void;
  openReport(target: ReportTarget): void;
  closeReport(): void;
  openCategory(categoryId: string): void;
  showResults(query: string): void;
  enterListMode(reason: string): void;
  setHudCoverPx(px: number): void;
}

export type FocusTarget =
  | { kind: 'place'; placeId: string }
  | { kind: 'point'; lngLat: LngLat; zoom?: number }
  | { kind: 'fit'; coordinates: LngLat[] }
  | { kind: 'reset' };

/** A camera request for the map; `seq` makes repeated identical requests distinct. */
export type FocusRequest = FocusTarget & { seq: number };

export interface SelectOptions {
  /** Move the camera to the place (default true; ignored for places without a position). */
  focus?: boolean;
  /** Open the details panel (default true). */
  openDetails?: boolean;
}

export interface SelectionSlice {
  selectedPlaceId: string | null;
  focusRequest: FocusRequest | null;
  selectPlace(id: string, opts?: SelectOptions): void;
  clearSelection(): void;
  requestFocus(target: FocusTarget): void;
}

export interface MapSlice {
  mode3d: boolean;
  showLabels: boolean;
  visibleGroups: ReadonlySet<LayerGroupId>;
  setMode3d(on: boolean): void;
  toggleMode3d(): void;
  setShowLabels(on: boolean): void;
  setGroupVisible(id: LayerGroupId, visible: boolean): void;
  toggleGroup(id: LayerGroupId): void;
  restoreDefaults(): void;
}

// Route and nav slice shapes are owned by the directions/navigation workstream.
export type { PickTarget, RouteSlice } from './route-types.ts';
export type { LocationReason, NavSlice, TrackingSummary } from './nav-types.ts';

export type AppState = UiSlice & SelectionSlice & MapSlice & RouteSlice & NavSlice;

export type SliceCreator<T> = StateCreator<AppState, [], [], T>;
