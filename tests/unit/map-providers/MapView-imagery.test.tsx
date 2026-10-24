/**
 * MapView wiring of basemap imagery: the raster is added and removed without
 * setStyle; imagery tile errors go to onImageryFailure (never the campus-data
 * banner, never with the URL); maxPitch; camera reports; editing keeps working
 * on top of imagery.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetWebGLSupportCache } from '../../../src/buildings3d/index.ts';
import { LAYER_GROUPS, type LayerGroupId } from '../../../src/config/categories.ts';
import { EDIT_LAYER_IDS } from '../../../src/map/editing/layers.ts';
import { MapView, type MapViewProps } from '../../../src/map/index.ts';
import { eoxSentinel2016 } from '../../../src/map/providers/eox.ts';
import { esriWorldImagery } from '../../../src/map/providers/esri.ts';
import { IMAGERY_LAYER_ID, IMAGERY_SOURCE_ID } from '../../../src/map/providers/imagery-layer.ts';
import { syntheticCampusData } from '../map/synthetic-campus-data.ts';

const fake = vi.hoisted(() => {
  const instances: unknown[] = [];
  const toggle = () => {
    let on = true;
    return {
      enable: () => {
        on = true;
      },
      disable: () => {
        on = false;
      },
      isEnabled: () => on,
    };
  };
  class FakeMap {
    options: Record<string, unknown>;
    handlers = new Map<string, Array<(ev?: unknown) => void>>();
    canvas = document.createElement('canvas');
    sources: Record<string, { setData: (d: unknown) => Promise<void>; spec?: unknown }> = {};
    layerIds: string[];
    maxZoom = 20;
    dragPan = toggle();
    dragRotate = toggle();
    touchZoomRotate = toggle();
    touchPitch = toggle();
    constructor(options: {
      style: { sources: Record<string, unknown>; layers: Array<{ id: string }> };
      [k: string]: unknown;
    }) {
      this.options = options;
      for (const id of Object.keys(options.style.sources)) this.addSource(id);
      this.layerIds = options.style.layers.map((l) => l.id);
      instances.push(this);
    }
    on(type: string, a: unknown, b?: unknown) {
      const fn = (typeof a === 'function' ? a : b) as (ev?: unknown) => void;
      if (typeof a === 'function') this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
      return this;
    }
    once(type: string, fn: (ev?: unknown) => void) {
      return this.on(type, fn);
    }
    off() {
      return this;
    }
    fire(type: string, ev?: unknown) {
      for (const h of this.handlers.get(type) ?? []) h(ev);
    }
    addSource(id: string, spec?: unknown) {
      this.sources[id] = { setData: () => Promise.resolve(), spec };
    }
    removeSource(id: string) {
      delete this.sources[id];
    }
    getSource(id: string) {
      return this.sources[id];
    }
    addLayer(l: { id: string }, before?: string) {
      const i = before ? this.layerIds.indexOf(before) : -1;
      if (i >= 0) this.layerIds.splice(i, 0, l.id);
      else this.layerIds.push(l.id);
    }
    removeLayer(id: string) {
      this.layerIds = this.layerIds.filter((x) => x !== id);
    }
    getLayer(id: string) {
      return this.layerIds.includes(id) ? { id } : undefined;
    }
    getLayersOrder() {
      return [...this.layerIds];
    }
    setMaxZoom(z: number) {
      this.maxZoom = z;
    }
    maxBounds: unknown = null;
    setMaxBounds(b: unknown) {
      this.maxBounds = b;
    }
    queryRenderedFeatures = vi.fn((): unknown[] => []);
    getCanvas() {
      return this.canvas;
    }
    getCenter() {
      return { lng: 75.7032, lat: 31.2533 };
    }
    getBounds() {
      return { getWest: () => 75.69, getSouth: () => 31.24, getEast: () => 75.71, getNorth: () => 31.26 };
    }
    isStyleLoaded() {
      return true;
    }
    getZoom = () => 15.4;
    getPitch = () => 0;
    getBearing = () => 0;
    getPadding = () => ({ top: 0, right: 0, bottom: 0, left: 0 });
    project = () => ({ x: 0, y: 0 });
    remove = vi.fn();
    setStyle = vi.fn();
    setPaintProperty = vi.fn();
    setLayoutProperty = vi.fn();
    getLayoutProperty = vi.fn(() => 'visible');
    setFilter = vi.fn();
    setFeatureState = vi.fn();
    removeFeatureState = vi.fn();
    setLayerZoomRange = vi.fn();
    setLight = vi.fn();
    triggerRepaint = vi.fn();
    easeTo = vi.fn();
    jumpTo = vi.fn();
  }
  return { FakeMap, instances };
});
vi.mock('maplibre-gl', () => ({ Map: fake.FakeMap }));

type Fake = InstanceType<typeof fake.FakeMap>;
const lastMap = () => fake.instances.at(-1) as Fake;
const GROUPS = new Set<LayerGroupId>(LAYER_GROUPS.map((g) => g.id));
const ESRI = esriWorldImagery('TEST_ONLY_fake_arcgis_key_0123456789abcdef');

function mount(over: Partial<MapViewProps> = {}) {
  const props: MapViewProps = {
    data: syntheticCampusData(),
    theme: 'light',
    mode3d: false,
    reducedMotion: false,
    visibleGroups: GROUPS,
    showLabels: true,
    selectedPlaceId: null,
    route: null,
    userLocation: null,
    onSelectPlace: vi.fn(),
    onError: vi.fn(),
    onImageryFailure: vi.fn(),
    ...over,
  };
  const utils = render(<MapView {...props} />);
  const rerender = (next: Partial<MapViewProps>) => {
    Object.assign(props, next);
    utils.rerender(<MapView {...props} />);
  };
  act(() => lastMap().fire('load'));
  return { props, rerender };
}

beforeEach(() => {
  fake.instances.length = 0;
  resetWebGLSupportCache();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ getExtension: () => null }) as unknown as RenderingContext,
  );
});
afterEach(() => cleanup());

describe('MapView imagery', () => {
  it('starts as the campus map (no imagery source) with maxPitch 60', () => {
    mount();
    const map = lastMap();
    expect(map.getSource(IMAGERY_SOURCE_ID)).toBeUndefined();
    expect(map.options.maxPitch).toBe(60);
  });

  it('adds and removes the raster incrementally, never with setStyle', () => {
    const { rerender } = mount();
    const map = lastMap();
    rerender({ imagery: ESRI });
    expect(map.getSource(IMAGERY_SOURCE_ID)).toBeDefined();
    expect(map.getLayer(IMAGERY_LAYER_ID)).toBeDefined();
    rerender({ imagery: eoxSentinel2016(true) });
    expect(map.maxZoom).toBe(14);
    rerender({ imagery: null });
    expect(map.getSource(IMAGERY_SOURCE_ID)).toBeUndefined();
    expect(map.maxZoom).toBe(20);
    expect(map.setStyle).not.toHaveBeenCalled();
  });

  it('routes imagery tile errors to onImageryFailure, not the campus-data banner', () => {
    const { props } = mount({ imagery: ESRI });
    const map = lastMap();
    act(() =>
      map.fire('error', {
        sourceId: IMAGERY_SOURCE_ID,
        error: { status: 403, message: 'AJAXError: Forbidden (403): https://x/tile?token=SECRET' },
      }),
    );
    expect(props.onImageryFailure).toHaveBeenCalledWith('auth');
    expect(props.onError).not.toHaveBeenCalled();
    // Only once per provider.
    act(() => map.fire('error', { sourceId: IMAGERY_SOURCE_ID, error: { status: 429 } }));
    expect(props.onImageryFailure).toHaveBeenCalledTimes(1);
  });

  it('a quota answer fails at once; scattered network errors need several in a row', () => {
    const { props } = mount({ imagery: ESRI });
    const map = lastMap();
    for (let i = 0; i < 3; i++)
      act(() => map.fire('error', { sourceId: IMAGERY_SOURCE_ID, error: { status: 0 } }));
    act(() => map.fire('data', { sourceId: IMAGERY_SOURCE_ID, tile: {} }));
    for (let i = 0; i < 3; i++)
      act(() => map.fire('error', { sourceId: IMAGERY_SOURCE_ID, error: { status: 0 } }));
    expect(props.onImageryFailure).not.toHaveBeenCalled();
    act(() => map.fire('error', { sourceId: IMAGERY_SOURCE_ID, error: { status: 0 } }));
    expect(props.onImageryFailure).toHaveBeenCalledWith('network');
  });

  it('other sources still report through onError', () => {
    const { props } = mount({ imagery: ESRI });
    act(() => lastMap().fire('error', { sourceId: 'buildings', error: { message: 'bad' } }));
    expect(props.onError).toHaveBeenCalled();
    expect(props.onImageryFailure).not.toHaveBeenCalled();
  });

  it('reports the camera at load and after each move', () => {
    const onCameraIdle = vi.fn();
    mount({ onCameraIdle });
    expect(onCameraIdle).toHaveBeenCalledWith({
      center: [75.7032, 31.2533],
      zoom: 15.4,
      bounds: [75.69, 31.24, 75.71, 31.26],
    });
    act(() => lastMap().fire('moveend'));
    expect(onCameraIdle).toHaveBeenCalledTimes(2);
  });

  it('the editing interface keeps working on imagery: its layers sit above the raster', () => {
    const onPointer = vi.fn();
    const { props } = mount({
      imagery: ESRI,
      editing: { input: 'pointer', preview: null, previewModel: null, handles: [], onPointer },
    });
    const map = lastMap();
    const order = map.getLayersOrder();
    expect(order.indexOf(EDIT_LAYER_IDS.handles)).toBeGreaterThan(order.indexOf(IMAGERY_LAYER_ID));
    map.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: 75.701, lat: 31.251 } });
    expect(onPointer).toHaveBeenCalled();
    expect(props.onSelectPlace).not.toHaveBeenCalled();
  });
});
