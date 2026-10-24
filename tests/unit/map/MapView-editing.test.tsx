/** MapView wiring of the editing contract (src/map/editing): clicks, preview model, reticle, exit. */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetWebGLSupportCache } from '../../../src/buildings3d/index.ts';
import type * as Realistic3DModule from '../../../src/buildings3d/realistic3d.ts';
import type { StudioRenderSource } from '../../../src/building-studio/render/maplibre/index.ts';
import { LAYER_GROUPS, type LayerGroupId } from '../../../src/config/categories.ts';
import { EDIT_LAYER_IDS } from '../../../src/map/editing/layers.ts';
import type { MapEditingProps } from '../../../src/map/editing/types.ts';
import { MapView, type MapViewProps } from '../../../src/map/index.ts';
import { FOOTPRINT, model } from '../building-studio/fixtures.ts';
import { syntheticCampusData } from './synthetic-campus-data.ts';

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
    handlers = new Map<string, Array<(ev?: unknown) => void>>();
    canvas = document.createElement('canvas');
    sources: Record<string, { setData: (d: unknown) => Promise<void> }> = {};
    layerIds: Set<string>;
    dragPan = toggle();
    dragRotate = toggle();
    touchZoomRotate = toggle();
    touchPitch = toggle();
    constructor(options: { style: { sources: Record<string, unknown>; layers: Array<{ id: string }> } }) {
      for (const id of Object.keys(options.style.sources)) this.addSource(id);
      this.layerIds = new Set(options.style.layers.map((l) => l.id));
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
    addSource(id: string) {
      this.sources[id] = { setData: () => Promise.resolve() };
    }
    removeSource(id: string) {
      delete this.sources[id];
    }
    getSource(id: string) {
      return this.sources[id];
    }
    addLayer(l: { id: string }) {
      this.layerIds.add(l.id);
    }
    removeLayer(id: string) {
      this.layerIds.delete(id);
    }
    getLayer(id: string) {
      return this.layerIds.has(id) ? { id } : undefined;
    }
    getLayersOrder() {
      return [...this.layerIds];
    }
    queryRenderedFeatures = vi.fn((): unknown[] => []);
    getCanvas() {
      return this.canvas;
    }
    getCenter() {
      return { lng: 75.7032, lat: 31.2533 };
    }
    isStyleLoaded() {
      return true;
    }
    getZoom = () => 15;
    getPitch = () => 0;
    getBearing = () => 0;
    getPadding = () => ({ top: 0, right: 0, bottom: 0, left: 0 });
    project = () => ({ x: 0, y: 0 });
    remove = vi.fn();
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

const studio = vi.hoisted(() => ({ models: [] as unknown[] }));
vi.mock('../../../src/buildings3d/realistic3d.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof Realistic3DModule>();
  return {
    ...mod,
    attachRealistic3D: (
      map: Parameters<typeof mod.attachRealistic3D>[0],
      opts: Parameters<typeof mod.attachRealistic3D>[1],
    ) => {
      const handle = mod.attachRealistic3D(map, opts);
      return {
        ...handle,
        setStudioModels: (m: readonly unknown[]) => {
          studio.models.push(m);
          handle.setStudioModels(m as never);
        },
      };
    },
  };
});

type Fake = InstanceType<typeof fake.FakeMap>;
const lastMap = () => fake.instances.at(-1) as Fake;
const GROUPS = new Set<LayerGroupId>(LAYER_GROUPS.map((g) => g.id));

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
    onMapClick: vi.fn(),
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

const PREVIEW: StudioRenderSource = {
  publicId: 'stu:abcdefghijklmnopqrstuvwxyz',
  recordId: 'stu:abcdefghijklmnopqrstuvwxyz',
  version: 0,
  footprint: FOOTPRINT,
  model: model(),
};

beforeEach(() => {
  fake.instances.length = 0;
  studio.models.length = 0;
  resetWebGLSupportCache();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ getExtension: () => null }) as unknown as RenderingContext,
  );
});
afterEach(() => cleanup());

describe('MapView editing', () => {
  it('while editing, a click goes to the editor and never selects a place; exit restores selection', () => {
    const onPointer = vi.fn();
    const editing: MapEditingProps = {
      input: 'pointer',
      preview: null,
      previewModel: null,
      handles: [],
      onPointer,
    };
    const { props, rerender } = mount({ editing });
    const map = lastMap();
    expect(map.getLayer(EDIT_LAYER_IDS.handles)).toBeDefined();
    map.queryRenderedFeatures.mockImplementation(() => [{ properties: { id: 'osm:node/30' } }]);
    map.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: 75.701, lat: 31.251 } });
    expect(onPointer).toHaveBeenCalledWith({
      type: 'click',
      lngLat: [75.701, 31.251],
      placeId: 'osm:node/30',
    });
    expect(props.onSelectPlace).not.toHaveBeenCalled();

    rerender({ editing: null });
    expect(map.getLayer(EDIT_LAYER_IDS.handles)).toBeUndefined();
    map.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: 75.701, lat: 31.251 } });
    expect(props.onSelectPlace).toHaveBeenCalledWith('osm:node/30');
  });

  it('draws the editor preview model as a preview through the studio layer, and drops it on exit', () => {
    const { rerender } = mount({
      editing: { input: 'pointer', preview: null, previewModel: PREVIEW, handles: [] },
    });
    expect(studio.models.at(-1)).toEqual([{ ...PREVIEW, preview: true }]);
    rerender({ editing: null });
    expect(studio.models.at(-1)).toEqual([]);
  });

  it('shows the centre reticle only in reticle input', () => {
    const onReticleChange = vi.fn();
    const { rerender } = mount({
      editing: { input: 'reticle', preview: null, previewModel: null, handles: [], onReticleChange },
    });
    expect(screen.getByTestId('edit-reticle')).toBeInTheDocument();
    expect(onReticleChange).toHaveBeenCalledWith([75.7032, 31.2533]);
    rerender({ editing: null });
    expect(screen.queryByTestId('edit-reticle')).toBeNull();
  });
});
