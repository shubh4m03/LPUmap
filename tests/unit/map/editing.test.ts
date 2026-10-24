import { describe, expect, it, vi } from 'vitest';
import { createEditingController, type EditingMap } from '../../../src/map/editing/controller.ts';
import {
  EDIT_LAYER_IDS,
  EDIT_SOURCE_IDS,
  editLayers,
  handleCollection,
} from '../../../src/map/editing/layers.ts';
import {
  mapInteractionPolicy,
  type EditHandle,
  type HandleDragEvent,
  type MapEditingProps,
} from '../../../src/map/editing/types.ts';

type Listener = (e: unknown) => void;

function toggle(enabled: boolean) {
  let on = enabled;
  return {
    enable: vi.fn(() => {
      on = true;
    }),
    disable: vi.fn(() => {
      on = false;
    }),
    isEnabled: () => on,
  };
}

/** Minimal MapLibre stand-in: sources/layers, events, gesture toggles, a handle hit-test. */
function fakeMap(opts: { dragRotate?: boolean } = {}) {
  const listeners = new Map<string, Set<Listener>>();
  const layers = new Map<string, unknown>();
  const sources = new Map<string, { data: unknown; setData: (d: unknown) => Promise<void> }>();
  const canvas = document.createElement('canvas');
  let center = { lng: 75.7032, lat: 31.2533 };
  let handleUnderPointer: Record<string, unknown> | null = null;
  const map = {
    on: (t: string, l: Listener) => {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t)!.add(l);
    },
    off: (t: string, l: Listener) => listeners.get(t)?.delete(l),
    getCenter: () => center,
    getCanvas: () => canvas,
    getLayer: (id: string) => layers.get(id),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, s: { data: unknown }) => {
      const src = {
        data: s.data,
        setData: (d: unknown) => {
          src.data = d;
          return Promise.resolve();
        },
      };
      sources.set(id, src);
    },
    addLayer: (l: { id: string }) => layers.set(l.id, l),
    removeLayer: (id: string) => layers.delete(id),
    removeSource: (id: string) => sources.delete(id),
    queryRenderedFeatures: (_g: unknown, o: { layers: string[] }) =>
      handleUnderPointer && o.layers.every((id) => layers.has(id))
        ? [{ properties: handleUnderPointer }]
        : [],
    isStyleLoaded: () => true,
    dragPan: toggle(true),
    dragRotate: toggle(opts.dragRotate ?? true),
    touchZoomRotate: toggle(true),
    touchPitch: toggle(true),
  };
  const fire = (t: string, e: Record<string, unknown> = {}) => {
    for (const l of listeners.get(t) ?? [])
      l({ point: { x: 10, y: 10 }, lngLat: { lng: 75.7, lat: 31.25 }, ...e });
  };
  return {
    map: map as unknown as EditingMap,
    raw: map,
    layers,
    sources,
    canvas,
    fire,
    listenerCount: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
    setHandleUnderPointer: (p: Record<string, unknown> | null) => {
      handleUnderPointer = p;
    },
    setCenter: (c: { lng: number; lat: number }) => {
      center = c;
    },
  };
}

const HANDLES: EditHandle[] = [
  { id: 'move', kind: 'move', position: [75.7, 31.25], label: 'Move the building' },
  { id: 'resize:e', kind: 'resize', axis: 'e', position: [75.7001, 31.25], label: 'Change the width' },
];

function editing(over: Partial<MapEditingProps> = {}): MapEditingProps {
  return { input: 'pointer', preview: null, previewModel: null, handles: HANDLES, ...over };
}

describe('mapInteractionPolicy', () => {
  it('normal map when not editing; clicks to the editor while editing; gestures off only while dragging', () => {
    expect(mapInteractionPolicy(null, false)).toEqual({
      selectPlaces: true,
      clicksToEditor: false,
      mapGestures: true,
      handles: false,
      reticle: false,
    });
    expect(mapInteractionPolicy({ input: 'pointer' }, false)).toMatchObject({
      selectPlaces: false,
      clicksToEditor: true,
      mapGestures: true,
      handles: true,
    });
    expect(mapInteractionPolicy({ input: 'pointer' }, true).mapGestures).toBe(false);
    expect(mapInteractionPolicy({ input: 'reticle', suspendMapGestures: true }, false)).toMatchObject({
      mapGestures: false,
      handles: false,
      reticle: true,
    });
  });
});

describe('editing layers', () => {
  it('builds valid-looking layers on the two editing sources, handles as points', () => {
    const layers = editLayers();
    expect(layers.map((l) => l.id)).toEqual([
      EDIT_LAYER_IDS.previewFill,
      EDIT_LAYER_IDS.previewGuide,
      EDIT_LAYER_IDS.previewLine,
      EDIT_LAYER_IDS.previewPoint,
      EDIT_LAYER_IDS.handles,
    ]);
    for (const l of layers) expect(Object.values(EDIT_SOURCE_IDS)).toContain(l.source);
    expect(handleCollection(HANDLES).features[1]).toEqual({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [75.7001, 31.25] },
      properties: { id: 'resize:e', kind: 'resize', axis: 'e' },
    });
  });
});

describe('editing controller (MapView side)', () => {
  it('adds layers on entry, removes them and every gesture change on exit', () => {
    const f = fakeMap({ dragRotate: false });
    const ctl = createEditingController(f.map);
    ctl.update(editing());
    expect([...f.layers.keys()]).toContain(EDIT_LAYER_IDS.handles);
    expect((f.sources.get(EDIT_SOURCE_IDS.handles)!.data as { features: unknown[] }).features).toHaveLength(
      2,
    );
    ctl.update(null);
    expect(f.layers.size).toBe(0);
    expect(f.sources.size).toBe(0);
    expect(f.raw.dragPan.isEnabled()).toBe(true);
    expect(f.raw.dragRotate.isEnabled()).toBe(false); // 2D map: stays off, exactly as before
  });

  it('routes clicks to the editor (never selection) only while editing', () => {
    const f = fakeMap();
    const ctl = createEditingController(f.map);
    expect(ctl.handleClick([75.7, 31.25], 'osm:way/1')).toBe(false);
    const onPointer = vi.fn();
    ctl.update(editing({ onPointer }));
    expect(ctl.handleClick([75.7, 31.25], 'osm:way/1')).toBe(true);
    expect(onPointer).toHaveBeenCalledWith({ type: 'click', lngLat: [75.7, 31.25], placeId: 'osm:way/1' });
    ctl.update(null);
    expect(ctl.handleClick([75.7, 31.25], null)).toBe(false);
  });

  it('drags a handle in lon/lat, suspending pan only during the drag and restoring it after', () => {
    const f = fakeMap();
    const ctl = createEditingController(f.map);
    const events: HandleDragEvent[] = [];
    const onPointer = vi.fn();
    ctl.update(editing({ onHandleDrag: (e) => events.push(e), onPointer }));

    f.setHandleUnderPointer({ id: 'resize:e', kind: 'resize', axis: 'e' });
    const preventDefault = vi.fn();
    f.fire('mousedown', { lngLat: { lng: 75.7001, lat: 31.25 }, preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(ctl.isDragging()).toBe(true);
    expect(f.raw.dragPan.isEnabled()).toBe(false);
    expect(f.raw.touchZoomRotate.isEnabled()).toBe(false);
    expect(f.canvas.style.cursor).toBe('ew-resize');

    f.fire('mousemove', { lngLat: { lng: 75.7002, lat: 31.25 }, originalEvent: { altKey: true } });
    f.fire('mouseup', { lngLat: { lng: 75.7003, lat: 31.25 } });
    expect(events.map((e) => [e.phase, e.current])).toEqual([
      ['start', [75.7001, 31.25]],
      ['move', [75.7002, 31.25]],
      ['end', [75.7003, 31.25]],
    ]);
    expect(events[1]!.modifiers).toEqual({ shift: false, alt: true });
    expect(events.every((e) => e.handleId === 'resize:e' && e.kind === 'resize')).toBe(true);
    expect(ctl.isDragging()).toBe(false);
    expect(f.raw.dragPan.isEnabled()).toBe(true);
    expect(f.raw.dragRotate.isEnabled()).toBe(true);

    // The click MapLibre fires after the handle's mouseup is swallowed; the next real click is not.
    expect(ctl.handleClick([75.7003, 31.25], null)).toBe(true);
    expect(onPointer).not.toHaveBeenCalled();
    f.setHandleUnderPointer(null);
    f.fire('mousedown');
    ctl.handleClick([75.7, 31.25], null);
    expect(onPointer).toHaveBeenCalledTimes(1);
  });

  it('cancels an unfinished drag on exit (start position) and on touchcancel', () => {
    const f = fakeMap();
    const ctl = createEditingController(f.map);
    const onHandleDrag = vi.fn();
    ctl.update(editing({ onHandleDrag }));
    f.setHandleUnderPointer({ id: 'move', kind: 'move', axis: '' });
    f.fire('touchstart', { lngLat: { lng: 75.7, lat: 31.25 } });
    f.fire('touchcancel');
    expect(onHandleDrag).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'cancel', current: [75.7, 31.25], start: [75.7, 31.25] }),
    );
    f.fire('touchstart', { lngLat: { lng: 75.7, lat: 31.25 } });
    ctl.update(null);
    expect(onHandleDrag).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'cancel' }));
    expect(f.raw.dragPan.isEnabled()).toBe(true);
  });

  it('honours suspendMapGestures from the editor and restores on release', () => {
    const f = fakeMap();
    const ctl = createEditingController(f.map);
    ctl.update(editing({ suspendMapGestures: true }));
    expect(f.raw.dragPan.isEnabled()).toBe(false);
    ctl.update(editing({ suspendMapGestures: false }));
    expect(f.raw.dragPan.isEnabled()).toBe(true);
  });

  it('reticle mode: no handles, reports the centre on entry and after each settled move', () => {
    const f = fakeMap();
    const ctl = createEditingController(f.map);
    const onReticleChange = vi.fn();
    ctl.update(editing({ input: 'reticle', onReticleChange }));
    expect(onReticleChange).toHaveBeenLastCalledWith([75.7032, 31.2533]);
    expect((f.sources.get(EDIT_SOURCE_IDS.handles)!.data as { features: unknown[] }).features).toHaveLength(
      0,
    );
    f.setCenter({ lng: 75.704, lat: 31.254 });
    f.fire('moveend');
    expect(onReticleChange).toHaveBeenLastCalledWith([75.704, 31.254]);
    // A tap on a handle position does nothing in reticle mode.
    f.setHandleUnderPointer({ id: 'move', kind: 'move', axis: '' });
    f.fire('mousedown');
    expect(ctl.isDragging()).toBe(false);
  });

  it('re-adds its layers after a basemap style swap and detaches every listener on dispose', () => {
    const f = fakeMap();
    const before = f.listenerCount();
    const ctl = createEditingController(f.map);
    ctl.update(editing());
    f.layers.clear();
    f.sources.clear();
    f.fire('styledata');
    expect(f.layers.has(EDIT_LAYER_IDS.handles)).toBe(true);
    ctl.dispose();
    expect(f.listenerCount()).toBe(before);
    expect(f.layers.size).toBe(0);
  });
});
