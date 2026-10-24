/**
 * MapView side of the editing contract (./types.ts). Created once per map;
 * `update(editing)` applies the latest props, `handleClick` routes map clicks
 * while editing, `dispose()` removes everything. Positions reported to the
 * editor are always [lon, lat].
 */
import type { LngLat } from '../../data/schema.ts';
import {
  EDIT_LAYER_IDS,
  EDIT_LAYER_ORDER,
  EDIT_SOURCE_IDS,
  EMPTY_PREVIEW,
  editLayers,
  handleCollection,
  handleCursor,
  type HandleFeatureProps,
} from './layers.ts';
import {
  mapInteractionPolicy,
  type EditHandleKind,
  type HandleDragEvent,
  type HandleDragPhase,
  type MapEditingProps,
  type ResizeAxis,
} from './types.ts';

/** Extra hit area around handles (touch). */
export const HANDLE_HIT_TOLERANCE_PX = 10;

interface Toggle {
  enable(): void;
  disable(): void;
  isEnabled(): boolean;
}

interface PointerEvt {
  point: { x: number; y: number };
  lngLat: { lng: number; lat: number };
  originalEvent?: Event;
  preventDefault?(): void;
}

type Listener = (e: PointerEvt) => void;

/** The subset of a MapLibre map the controller uses (a fake implements it in tests). */
export interface EditingMap {
  on(type: string, listener: Listener): unknown;
  off(type: string, listener: Listener): unknown;
  getCenter(): { lng: number; lat: number };
  getCanvas(): HTMLElement;
  getLayer(id: string): unknown;
  getSource(id: string): unknown;
  addSource(id: string, source: { type: 'geojson'; data: unknown }): unknown;
  addLayer(layer: { id: string }): unknown;
  removeLayer(id: string): unknown;
  removeSource(id: string): unknown;
  queryRenderedFeatures(
    geometry: [[number, number], [number, number]],
    options: { layers: string[] },
  ): Array<{ properties?: Record<string, unknown> | null }>;
  isStyleLoaded(): boolean | void;
  dragPan: Toggle;
  dragRotate: Toggle;
  touchZoomRotate: Toggle;
  touchPitch: Toggle;
}

export interface EditingController {
  update(editing: MapEditingProps | null | undefined): void;
  /** True between handle pointer-down and pointer-up. */
  isDragging(): boolean;
  /** Called by MapView for every map click; true when editing consumed it (no place selection). */
  handleClick(lngLat: LngLat, placeId: string | null): boolean;
  dispose(): void;
}

const GESTURES = ['dragPan', 'dragRotate', 'touchZoomRotate', 'touchPitch'] as const;
type Gesture = (typeof GESTURES)[number];

const toLngLat = (l: { lng: number; lat: number }): LngLat => [l.lng, l.lat];

function modifiersOf(e: PointerEvt): HandleDragEvent['modifiers'] {
  const o = e.originalEvent as { shiftKey?: unknown; altKey?: unknown } | undefined;
  return { shift: o?.shiftKey === true, alt: o?.altKey === true };
}

export function createEditingController(map: EditingMap): EditingController {
  let editing: MapEditingProps | null = null;
  let drag: { id: string; kind: EditHandleKind; axis: ResizeAxis | ''; start: LngLat; last: LngLat } | null =
    null;
  /** Gestures that were enabled before we suspended them (restored exactly). */
  let suspended: Gesture[] | null = null;
  /** The next click belongs to a handle interaction and must not reach the editor. */
  let swallowClick = false;
  let lastPreview: unknown = null;
  let lastHandles: unknown = null;
  let disposed = false;

  const layersPresent = () => map.getLayer(EDIT_LAYER_IDS.handles) !== undefined;

  function addLayers(): void {
    if (!map.getSource(EDIT_SOURCE_IDS.preview))
      map.addSource(EDIT_SOURCE_IDS.preview, { type: 'geojson', data: EMPTY_PREVIEW });
    if (!map.getSource(EDIT_SOURCE_IDS.handles))
      map.addSource(EDIT_SOURCE_IDS.handles, { type: 'geojson', data: handleCollection([]) });
    for (const layer of editLayers()) if (!map.getLayer(layer.id)) map.addLayer(layer);
    lastPreview = null;
    lastHandles = null;
  }

  function removeLayers(): void {
    lastPreview = null;
    lastHandles = null;
    try {
      for (const id of [...EDIT_LAYER_ORDER].reverse()) if (map.getLayer(id)) map.removeLayer(id);
      for (const id of Object.values(EDIT_SOURCE_IDS)) if (map.getSource(id)) map.removeSource(id);
    } catch {
      // The style is being replaced or the map removed: nothing of ours is left to draw.
    }
  }

  function setData(sourceId: string, data: unknown): void {
    const src = map.getSource(sourceId) as { setData?: (d: unknown) => unknown } | undefined;
    const r = src?.setData?.(data);
    // MapLibre returns a promise; failures surface through the map's `error` event.
    if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => {});
  }

  function syncData(): void {
    if (!editing) return;
    const preview = editing.preview ?? EMPTY_PREVIEW;
    if (preview !== lastPreview) {
      setData(EDIT_SOURCE_IDS.preview, preview);
      lastPreview = preview;
    }
    const handles = editing.input === 'pointer' ? editing.handles : [];
    if (handles !== lastHandles) {
      setData(EDIT_SOURCE_IDS.handles, handleCollection(handles));
      lastHandles = handles;
    }
  }

  function applyGestures(): void {
    const allow = mapInteractionPolicy(editing, drag !== null).mapGestures;
    if (!allow && suspended === null) {
      suspended = GESTURES.filter((g) => map[g].isEnabled());
      for (const g of suspended) map[g].disable();
    } else if (allow && suspended !== null) {
      for (const g of suspended) map[g].enable();
      suspended = null;
    }
  }

  function emit(phase: HandleDragPhase, current: LngLat, e: PointerEvt | null): void {
    if (!drag) return;
    editing?.onHandleDrag?.({
      handleId: drag.id,
      kind: drag.kind,
      phase,
      start: drag.start,
      current,
      modifiers: e ? modifiersOf(e) : { shift: false, alt: false },
    });
  }

  function cancelDrag(): void {
    if (!drag) return;
    emit('cancel', drag.start, null);
    drag = null;
    map.getCanvas().style.cursor = '';
    applyGestures();
  }

  function handleAt(point: { x: number; y: number }): HandleFeatureProps | null {
    if (!editing || editing.input !== 'pointer' || !layersPresent()) return null;
    const t = HANDLE_HIT_TOLERANCE_PX;
    const hits = map.queryRenderedFeatures(
      [
        [point.x - t, point.y - t],
        [point.x + t, point.y + t],
      ],
      { layers: [EDIT_LAYER_IDS.handles] },
    );
    const p = hits[0]?.properties;
    if (!p || typeof p.id !== 'string') return null;
    return { id: p.id, kind: p.kind as EditHandleKind, axis: (p.axis as ResizeAxis | '') ?? '' };
  }

  const onDown: Listener = (e) => {
    const h = handleAt(e.point);
    if (!h) {
      swallowClick = false;
      return;
    }
    // Stops MapLibre's own drag-pan for this gesture synchronously; applyGestures covers the rest.
    e.preventDefault?.();
    const at = toLngLat(e.lngLat);
    drag = { id: h.id, kind: h.kind, axis: h.axis, start: at, last: at };
    swallowClick = true;
    applyGestures();
    map.getCanvas().style.cursor = handleCursor(h.kind, h.axis, true);
    emit('start', at, e);
  };

  const onMove: Listener = (e) => {
    if (drag) {
      drag.last = toLngLat(e.lngLat);
      emit('move', drag.last, e);
      return;
    }
    if (!editing || editing.input !== 'pointer') return;
    const h = handleAt(e.point);
    map.getCanvas().style.cursor = h ? handleCursor(h.kind, h.axis, false) : '';
  };

  const onUp: Listener = (e) => {
    if (!drag) return;
    const at = e.lngLat ? toLngLat(e.lngLat) : drag.last;
    emit('end', at, e);
    drag = null;
    map.getCanvas().style.cursor = '';
    applyGestures();
  };

  const onCancel: Listener = () => cancelDrag();

  const onMoveEnd: Listener = () => {
    if (editing?.input === 'reticle') editing.onReticleChange?.(toLngLat(map.getCenter()));
  };

  // A basemap switch (setStyle) drops our layers: put them back while editing.
  const onStyleData: Listener = () => {
    if (editing && !disposed && map.isStyleLoaded() && !layersPresent()) {
      addLayers();
      syncData();
    }
  };

  const listeners: Array<[string, Listener]> = [
    ['mousedown', onDown],
    ['touchstart', onDown],
    ['mousemove', onMove],
    ['touchmove', onMove],
    ['mouseup', onUp],
    ['touchend', onUp],
    ['touchcancel', onCancel],
    ['moveend', onMoveEnd],
    ['styledata', onStyleData],
  ];
  for (const [type, l] of listeners) map.on(type, l);

  return {
    update(next) {
      if (disposed) return;
      const prev = editing;
      editing = next ?? null;
      if (!editing) {
        if (prev) {
          // Exit: the previous editor still gets the cancel of an unfinished drag.
          editing = prev;
          cancelDrag();
          editing = null;
          removeLayers();
          swallowClick = false;
          map.getCanvas().style.cursor = '';
        }
        applyGestures();
        return;
      }
      if (prev && prev.input === 'pointer' && editing.input !== 'pointer') {
        editing = prev;
        cancelDrag();
        editing = next ?? null;
      }
      if (!layersPresent()) addLayers();
      syncData();
      applyGestures();
      if (editing && editing.input === 'reticle' && prev?.input !== 'reticle') {
        editing.onReticleChange?.(toLngLat(map.getCenter()));
      }
    },
    isDragging: () => drag !== null,
    handleClick(lngLat, placeId) {
      if (!editing) return false;
      if (swallowClick) {
        swallowClick = false;
        return true;
      }
      editing.onPointer?.({ type: 'click', lngLat, placeId });
      return true;
    },
    dispose() {
      if (disposed) return;
      if (editing) {
        cancelDrag();
        editing = null;
        removeLayers();
      }
      applyGestures();
      for (const [type, l] of listeners) map.off(type, l);
      disposed = true;
    },
  };
}
