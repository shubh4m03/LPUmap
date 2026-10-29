/**
 * Map-editing contract shared by the Building Studio (studio-ui) and the
 * owner location editor (admin-ui); MapView implements it (src/map/editing/
 * controller.ts) and map-providers keeps it working on every basemap.
 *
 * Rules:
 *  - Everything stored or reported is a ground position [lon, lat]; screen
 *    pixels never leave MapView.
 *  - While `MapViewProps.editing` is set, a map click NEVER selects a place:
 *    it is reported to the editor (`onPointer`, with the place under the
 *    pointer as information only).
 *  - Desktop (`input: 'pointer'`): handles are drawn at the given positions;
 *    dragging one reports `onHandleDrag` start → move… → end|cancel. From
 *    handle pointer-down to pointer-up MapView suspends map pan/rotate (so the
 *    drag moves the handle, not the map) and restores exactly what was
 *    enabled before. `suspendMapGestures` lets the editor extend that.
 *  - Mobile (`input: 'reticle'`): no handles; a fixed centre reticle is shown
 *    and `onReticleChange` reports the map centre after every settled move
 *    (and once on entry). The editor offers step buttons and Save/Cancel.
 *  - Setting `editing` back to null/undefined removes every editing layer,
 *    listener and reticle and restores normal selection and navigation.
 */
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { StudioRenderSource } from '../../building-studio/render/maplibre/index.ts';
import type { LngLat } from '../../data/index.ts';

/** Styling role of a preview feature (src/map/editing/layers.ts). */
export type EditPreviewRole =
  /** The footprint (or point) being edited, translucent. */
  | 'footprint'
  /** The same, while validation reports an error. */
  | 'footprint-invalid'
  /** Snapping guide, e.g. an UNVERIFIED detected outline (dashed; never treated as data). */
  | 'guide'
  /** The guide or edge currently snapped to. */
  | 'snap'
  /** Area or outline a warning is about (overlap, boundary crossing). */
  | 'warning'
  /** Nearby path / access line feedback. */
  | 'path'
  /** A point being placed (location editor). */
  | 'point';

export const EDIT_PREVIEW_ROLES: readonly EditPreviewRole[] = [
  'footprint',
  'footprint-invalid',
  'guide',
  'snap',
  'warning',
  'path',
  'point',
];

export interface EditPreviewProperties {
  role: EditPreviewRole;
  /** Optional id (e.g. the overlapped building) for tests and debugging. */
  id?: string;
}

export type EditPreviewFeature = Feature<Geometry, EditPreviewProperties>;
export type EditPreviewCollection = FeatureCollection<Geometry, EditPreviewProperties>;

export type EditHandleKind = 'move' | 'rotate' | 'resize' | 'vertex';
export type ResizeAxis = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface EditHandle {
  /** Stable while the edit lasts, e.g. 'move', 'rotate', 'resize:e'. */
  id: string;
  kind: EditHandleKind;
  position: LngLat;
  /** Resize handles: the edge or corner (drives the cursor). */
  axis?: ResizeAxis;
  /**
   * Accessible description of what the handle does. Map handles are pointer
   * only: every handle action must also exist as a keyboard / numeric control.
   */
  label: string;
}

export type HandleDragPhase = 'start' | 'move' | 'end' | 'cancel';

export interface HandleDragEvent {
  handleId: string;
  kind: EditHandleKind;
  phase: HandleDragPhase;
  /** Ground position where the drag started. */
  start: LngLat;
  /** Current ground position (on 'cancel': equals `start`, so the editor can revert). */
  current: LngLat;
  /** Alt held: the editor should skip snapping for this drag (snapping is always optional). */
  modifiers: { shift: boolean; alt: boolean };
}

export interface EditPointerEvent {
  type: 'click';
  lngLat: LngLat;
  /** Campus place / building under the pointer, as information (MapView does not select it). */
  placeId: string | null;
}

export type EditInputMode = 'pointer' | 'reticle';

export interface MapEditingProps {
  input: EditInputMode;
  /** Translucent preview geometry, or null. */
  preview: EditPreviewCollection | null;
  /** The studio model being edited (drawn by the studio layer with `preview: true`), or null. */
  previewModel: StudioRenderSource | null;
  /** Drawn only in 'pointer' input. */
  handles: readonly EditHandle[];
  /** The editor asks MapView to keep pan/rotate suspended (e.g. a numeric drag in a panel). */
  suspendMapGestures?: boolean;
  onPointer?(e: EditPointerEvent): void;
  onHandleDrag?(e: HandleDragEvent): void;
  onReticleChange?(center: LngLat): void;
}

/** What the map may do right now (pure; see `mapInteractionPolicy`). */
export interface MapInteractionPolicy {
  /** A click may select a place (onSelectPlace / onMapClick). */
  selectPlaces: boolean;
  /** A click is reported to the editor instead. */
  clicksToEditor: boolean;
  /** Pan / rotate / pitch gestures are allowed. */
  mapGestures: boolean;
  /** Handles are drawn and draggable. */
  handles: boolean;
  /** The centre reticle is shown and reported. */
  reticle: boolean;
}

/** The interaction policy for an editing state (null/undefined = not editing: normal map). */
export function mapInteractionPolicy(
  editing: Pick<MapEditingProps, 'input' | 'suspendMapGestures'> | null | undefined,
  handleDragActive: boolean,
): MapInteractionPolicy {
  if (!editing) {
    return { selectPlaces: true, clicksToEditor: false, mapGestures: true, handles: false, reticle: false };
  }
  return {
    selectPlaces: false,
    clicksToEditor: true,
    mapGestures: !handleDragActive && !editing.suspendMapGestures,
    handles: editing.input === 'pointer',
    reticle: editing.input === 'reticle',
  };
}
