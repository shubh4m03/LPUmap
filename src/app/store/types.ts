/**
 * Shapes of the app store. Each slice lives in its own file; the combined
 * `AppState` is what every slice creator receives (so a slice may read or
 * update another slice's fields through `set`/`get`).
 */
import type { StateCreator } from 'zustand';
import type { SheetSnap } from '../../components/ui/index.ts';
import type { LayerGroupId } from '../../config/index.ts';
import type { LngLat } from '../../data/index.ts';
import type { CorrectionKind } from '../../feedback/index.ts';
import type { NavSlice } from './nav-types.ts';
import type { RouteSlice } from './route-types.ts';
import type { ImageryRuntime } from '../../map/providers/index.ts';
import type { ProviderRegistry } from '../../map/providers/index.ts';
import type {
  MapViewMode,
  ResolvedViewMode,
  ViewMode,
  ViewModeAvailability,
  ViewModeChangeReason,
} from '../view-mode.ts';

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
  | 'category'
  /** The building directory (docs/ISOMETRIC_AND_3D_DESIGN.md §7.5): the accessible list of every drawn building. */
  | 'directory'
  /** "Suggest a missing place" (src/components/suggest): map placement + form; nothing is published by it. */
  | 'suggest';
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
  /**
   * A reviewed CANDIDATE building of an illustration item shown on the map as a dashed,
   * labelled "Unconfirmed match" outline (never the selection, never routed). Cleared by
   * the next selection change.
   */
  unconfirmedMatch: { buildingId: string; label: string } | null;
  selectPlace(id: string, opts?: SelectOptions): void;
  clearSelection(): void;
  requestFocus(target: FocusTarget): void;
  /** Frames the candidate building and outlines it as an unconfirmed match. */
  showUnconfirmedMatch(buildingId: string, label: string): void;
}

export interface MapSlice {
  /** Current view mode (Decision D7). */
  viewMode: ViewMode;
  /** The map mode to return to (e.g. when live navigation starts from the overview). */
  lastMapMode: MapViewMode;
  /** Why the last change happened; null before any change. */
  viewModeReason: ViewModeChangeReason | null;
  /**
   * Non-null when the map modes cannot run in this browser (no WebGL): the
   * user-facing reason the switcher shows; only the overview is offered.
   */
  mapUnavailable: string | null;
  /**
   * Satellite / photorealistic availability with user-facing reasons, derived from this build's
   * provider registry and `imageryRuntime` (src/map/providers). The switcher shows the reasons.
   */
  availability: ViewModeAvailability;
  /** This build's map providers (src/map/providers/runtime.ts; injectable in tests). */
  providers: ProviderRegistry;
  /** Imagery trouble seen this session and online/offline. */
  imageryRuntime: ImageryRuntime;
  /**
   * Records imagery trouble or recovery and recomputes `availability`. When the current mode can
   * no longer be shown (Satellite 2D after an imagery failure) it moves to the fallback and
   * returns it (announce `reason`); otherwise returns null.
   */
  setImageryRuntime(runtime: ImageryRuntime): ResolvedViewMode | null;
  /**
   * Derived, kept in sync by the slice: true iff viewMode === 'realistic3d'.
   * Kept for existing callers; new code reads viewMode.
   */
  mode3d: boolean;
  showLabels: boolean;
  visibleGroups: ReadonlySet<LayerGroupId>;
  /** Opt-in "Nearby, outside campus" layer (APP_CONFIG.optionalLayers.nearbyOutsideCampus; off by default). */
  showNearbyOutsideCampus: boolean;
  /** Opt-in "Unverified detected footprints" layer (APP_CONFIG.optionalLayers.detectedFootprints; off by default). */
  showDetectedFootprints: boolean;
  /**
   * Switches mode. Returns false (and changes nothing) when the mode is not
   * allowed now: 'isometric' while live navigation is active, a map mode while
   * `mapUnavailable` is set.
   */
  setViewMode(mode: ViewMode, opts?: { reason?: ViewModeChangeReason }): boolean;
  /** Marks the map modes unavailable (no WebGL) and switches to the overview. */
  setMapUnavailable(reason: string): void;
  /** Back-compat: true → realistic3d, false → standard2d. */
  setMode3d(on: boolean): void;
  /** Back-compat: realistic3d ↔ standard2d (from the overview, goes to realistic3d). */
  toggleMode3d(): void;
  setShowLabels(on: boolean): void;
  setShowNearbyOutsideCampus(on: boolean): void;
  setShowDetectedFootprints(on: boolean): void;
  setGroupVisible(id: LayerGroupId, visible: boolean): void;
  toggleGroup(id: LayerGroupId): void;
  restoreDefaults(): void;
}

// Route and nav slice shapes are owned by the directions/navigation workstream.
export type { PickTarget, RouteSlice } from './route-types.ts';
export type { LocationReason, NavSlice, TrackingSummary } from './nav-types.ts';

export type AppState = UiSlice & SelectionSlice & MapSlice & RouteSlice & NavSlice;

export type SliceCreator<T> = StateCreator<AppState, [], [], T>;
