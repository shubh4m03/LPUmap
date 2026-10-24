import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetWebGLSupportCache } from '../../../src/buildings3d/index.ts';
import type * as Realistic3DModule from '../../../src/buildings3d/realistic3d.ts';
import type { Realistic3DHandle, Realistic3DOptions } from '../../../src/buildings3d/realistic3d.ts';
import { APP_CONFIG } from '../../../src/config/index.ts';
import { LAYER_GROUPS, type LayerGroupId } from '../../../src/config/categories.ts';
import type { DetectionsFile, LngLat, Place } from '../../../src/data/schema.ts';
import { FOOTPRINT, model } from '../building-studio/fixtures.ts';
import { LAYER_IDS, MAP_MESSAGES, MapView, SOURCE_IDS, type MapViewProps } from '../../../src/map/index.ts';
import { syntheticCampusData } from './synthetic-campus-data.ts';

const fake = vi.hoisted(() => {
  const instances: FakeMapLike[] = [];
  const ctor = { throwOnCreate: false };
  interface FakeMapLike {
    options: Record<string, unknown>;
    [k: string]: unknown;
  }
  class FakeMap {
    options: Record<string, unknown>;
    handlers = new Map<string, Array<(ev?: unknown) => void>>();
    layerHandlers = new Map<string, Array<(ev?: unknown) => void>>();
    canvas = document.createElement('canvas');
    sources: Record<string, { setData: ReturnType<typeof vi.fn> }> = {};
    layerIds: Set<string>;
    setStyle = vi.fn();
    remove = vi.fn();
    addControl = vi.fn();
    setPaintProperty = vi.fn();
    setLayoutProperty = vi.fn();
    getLayoutProperty = vi.fn(() => 'visible');
    setFilter = vi.fn();
    setFeatureState = vi.fn();
    removeFeatureState = vi.fn();
    setLayerZoomRange = vi.fn();
    setLight = vi.fn();
    addLayer = vi.fn((layer: { id: string }) => {
      this.layerIds.add(layer.id);
    });
    removeLayer = vi.fn((id: string) => {
      this.layerIds.delete(id);
    });
    addSource = vi.fn((id: string) => {
      this.sources[id] = { setData: vi.fn(() => Promise.resolve()) };
    });
    removeSource = vi.fn((id: string) => {
      delete this.sources[id];
    });
    triggerRepaint = vi.fn();
    off = vi.fn();
    getLayersOrder = () => [...this.layerIds];
    queryRenderedFeatures = vi.fn((): unknown[] => []);
    project = vi.fn(([lng, lat]: [number, number]) => ({ x: (lng - 75.7) * 1e4, y: (31.26 - lat) * 1e4 }));
    easeTo = vi.fn();
    jumpTo = vi.fn();
    flyTo = vi.fn();
    fitBounds = vi.fn();
    zoomIn = vi.fn();
    zoomOut = vi.fn();
    resetNorth = vi.fn();
    setPadding = vi.fn();
    getPadding = () => ({ top: 0, right: 0, bottom: 0, left: 0 });
    getCenter = () => ({ lng: 75.7, lat: 31.25 });
    getZoom = () => 15;
    getPitch = () => 0;
    getBearing = () => 0;
    isStyleLoaded = () => true;
    dragRotate = { enable: vi.fn(), disable: vi.fn() };
    touchPitch = { enable: vi.fn(), disable: vi.fn() };
    constructor(options: Record<string, unknown>) {
      if (ctor.throwOnCreate) throw new Error('Failed to initialize WebGL');
      this.options = options;
      const style = options.style as { sources: Record<string, unknown>; layers: Array<{ id: string }> };
      for (const id of Object.keys(style.sources))
        this.sources[id] = { setData: vi.fn(() => Promise.resolve()) };
      this.layerIds = new Set(style.layers.map((l) => l.id));
      instances.push(this as unknown as FakeMapLike);
    }
    on(type: string, a: unknown, b?: unknown) {
      if (typeof a === 'function') {
        this.handlers.set(type, [...(this.handlers.get(type) ?? []), a as (ev?: unknown) => void]);
      } else {
        this.layerHandlers.set(type, [...(this.layerHandlers.get(type) ?? []), b as (ev?: unknown) => void]);
      }
      return this;
    }
    once(type: string, fn: (ev?: unknown) => void) {
      return this.on(type, fn);
    }
    fire(type: string, ev?: unknown) {
      for (const h of this.handlers.get(type) ?? []) h(ev);
    }
    fireLayer(type: string, ev?: unknown) {
      for (const h of this.layerHandlers.get(type) ?? []) h(ev);
    }
    getSource(id: string) {
      return this.sources[id];
    }
    getLayer(id: string) {
      return this.layerIds.has(id) ? { id } : undefined;
    }
    getCanvas() {
      return this.canvas;
    }
  }
  return { FakeMap, instances, ctor };
});

vi.mock('maplibre-gl', () => ({ Map: fake.FakeMap }));

// The real realistic-3D controller, with its options and handle captured for assertions.
const r3d = vi.hoisted(() => ({ opts: [] as unknown[], handles: [] as unknown[] }));
vi.mock('../../../src/buildings3d/realistic3d.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof Realistic3DModule>();
  return {
    ...mod,
    attachRealistic3D: (map: Parameters<typeof mod.attachRealistic3D>[0], opts: Realistic3DOptions) => {
      r3d.opts.push(opts);
      const handle = mod.attachRealistic3D(map, opts);
      r3d.handles.push(handle);
      return handle;
    },
  };
});
const lastR3d = () => ({
  opts: r3d.opts.at(-1) as Realistic3DOptions,
  handle: r3d.handles.at(-1) as Realistic3DHandle,
});

type FakeMap = InstanceType<typeof fake.FakeMap>;
const lastMap = () => fake.instances[fake.instances.length - 1] as unknown as FakeMap;

const ALL_GROUPS = new Set<LayerGroupId>(LAYER_GROUPS.map((g) => g.id));
const DATA = syntheticCampusData();

function baseProps(over: Partial<MapViewProps> = {}): MapViewProps {
  return {
    data: DATA,
    theme: 'light',
    mode3d: false,
    reducedMotion: false,
    visibleGroups: ALL_GROUPS,
    showLabels: true,
    selectedPlaceId: null,
    route: null,
    userLocation: null,
    onSelectPlace: vi.fn(),
    onMapClick: vi.fn(),
    onReady: vi.fn(),
    onError: vi.fn(),
    ...over,
  };
}

function mount(over: Partial<MapViewProps> = {}) {
  const props = baseProps(over);
  const utils = render(<MapView {...props} />);
  const rerender = (next: Partial<MapViewProps>) => {
    Object.assign(props, next);
    utils.rerender(<MapView {...props} />);
  };
  return { ...utils, props, rerender };
}

function load(map: FakeMap) {
  act(() => map.fire('load'));
}

const ROUTE: LngLat[] = [
  [75.7, 31.25],
  [75.701, 31.25],
  [75.702, 31.251],
];

beforeEach(() => {
  fake.instances.length = 0;
  fake.ctor.throwOnCreate = false;
  resetWebGLSupportCache();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ getExtension: () => null }) as unknown as RenderingContext,
  );
});

afterEach(() => {
  // Unmount explicitly: without vitest globals, Testing Library does not auto-clean between tests.
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('MapView', () => {
  it('creates the map once with campus bounds, OSM attribution, an accessible canvas label and no navigation control', () => {
    const { rerender } = mount();
    expect(fake.instances).toHaveLength(1);
    const map = lastMap();
    expect(map.options).toMatchObject({
      center: APP_CONFIG.map.center,
      zoom: APP_CONFIG.map.zoom,
      minZoom: APP_CONFIG.map.minZoom,
      maxZoom: APP_CONFIG.map.maxZoom,
      maxBounds: APP_CONFIG.map.maxBounds,
      pitch: 0,
      dragRotate: false,
      touchPitch: false,
    });
    const attribution = map.options.attributionControl as { customAttribution: string; compact?: boolean };
    expect(attribution.customAttribution).toContain('© OpenStreetMap contributors (ODbL)');
    expect(attribution.customAttribution).toContain('https://www.openstreetmap.org/copyright');
    // Leaving `compact` unset keeps MapLibre's responsive behaviour: compact below 640 px.
    expect(attribution.compact).toBeUndefined();
    expect((map.options.locale as Record<string, string>)['Map.Title']).toMatch(/arrow keys/);
    load(map);
    rerender({ theme: 'dark', showLabels: false, mode3d: true, route: { coordinates: ROUTE } });
    expect(fake.instances).toHaveLength(1);
    expect(map.addControl).not.toHaveBeenCalled();
  });

  it('removes the map on unmount', () => {
    const { unmount } = mount();
    const map = lastMap();
    unmount();
    expect(map.remove).toHaveBeenCalledTimes(1);
  });

  it('reports a ready controller after load', () => {
    const { props } = mount();
    expect(props.onReady).not.toHaveBeenCalled();
    load(lastMap());
    expect(props.onReady).toHaveBeenCalledTimes(1);
    const controller = vi.mocked(props.onReady!).mock.calls[0]![0];
    controller.zoomIn();
    expect(lastMap().zoomIn).toHaveBeenCalled();
  });

  it('updates only the route source via setData when the route changes — never setStyle', () => {
    const { rerender } = mount();
    const map = lastMap();
    load(map);
    const route = { coordinates: ROUTE };
    rerender({ route });
    expect(map.sources[SOURCE_IDS.route]!.setData).toHaveBeenCalledTimes(1);
    const sent = map.sources[SOURCE_IDS.route]!.setData.mock.calls[0]![0] as { features: unknown[] };
    expect(sent.features).toHaveLength(1);
    rerender({ route, theme: 'light' });
    expect(map.sources[SOURCE_IDS.route]!.setData).toHaveBeenCalledTimes(1);
    for (const id of [SOURCE_IDS.basemap, SOURCE_IDS.buildings, SOURCE_IDS.places, SOURCE_IDS.userLocation]) {
      expect(map.sources[id]!.setData).not.toHaveBeenCalled();
    }
    rerender({ route: null });
    expect(map.sources[SOURCE_IDS.route]!.setData).toHaveBeenCalledTimes(2);
    expect(map.setStyle).not.toHaveBeenCalled();
  });

  it('defers source updates until the style has loaded, then applies only real changes', () => {
    const { rerender } = mount();
    const map = lastMap();
    rerender({ userLocation: { lngLat: [75.7, 31.25], accuracyM: 12, stale: false } });
    expect(map.sources[SOURCE_IDS.userLocation]!.setData).not.toHaveBeenCalled();
    load(map);
    expect(map.sources[SOURCE_IDS.userLocation]!.setData).toHaveBeenCalledTimes(1);
    expect(map.sources[SOURCE_IDS.route]!.setData).not.toHaveBeenCalled();
  });

  it('selects the clicked POI, else clears selection and reports the map click', () => {
    const { props } = mount();
    const map = lastMap();
    load(map);
    map.queryRenderedFeatures.mockImplementationOnce(() => [{ properties: { id: 'osm:node/30' } }]);
    map.fire('click', { point: { x: 10, y: 10 }, lngLat: { lng: 75.7, lat: 31.25 } });
    expect(props.onSelectPlace).toHaveBeenLastCalledWith('osm:node/30');
    expect(props.onMapClick).not.toHaveBeenCalled();

    map.fire('click', { point: { x: 20, y: 20 }, lngLat: { lng: 75.71, lat: 31.26 } });
    expect(props.onSelectPlace).toHaveBeenLastCalledWith(null);
    expect(props.onMapClick).toHaveBeenCalledWith([75.71, 31.26]);
  });

  it('selects a clicked building footprint', () => {
    const { props } = mount();
    const map = lastMap();
    load(map);
    map.queryRenderedFeatures
      .mockImplementationOnce(() => [])
      .mockImplementationOnce(() => [{ properties: { id: 'osm:way/10' } }]);
    map.fire('click', { point: { x: 5, y: 5 }, lngLat: { lng: 75.7, lat: 31.25 } });
    expect(props.onSelectPlace).toHaveBeenCalledWith('osm:way/10');
  });

  it('shows a pointer cursor over interactive features', () => {
    mount();
    const map = lastMap();
    map.fireLayer('mouseenter');
    expect(map.canvas.style.cursor).toBe('pointer');
    map.fireLayer('mouseleave');
    expect(map.canvas.style.cursor).toBe('');
  });

  it('changes theme via paint properties without recreating the map or touching data', () => {
    const { rerender } = mount();
    const map = lastMap();
    load(map);
    rerender({ theme: 'dark' });
    expect(fake.instances).toHaveLength(1);
    expect(map.setStyle).not.toHaveBeenCalled();
    expect(map.setPaintProperty).toHaveBeenCalledWith(LAYER_IDS.background, 'background-color', '#0f1419');
    for (const s of Object.values(map.sources)) expect(s.setData).not.toHaveBeenCalled();
  });

  it('feature-state highlights the selected building, then the selected POI, without moving the camera', () => {
    const { rerender } = mount();
    const map = lastMap();
    load(map);
    rerender({ selectedPlaceId: 'osm:way/10' });
    expect(map.setFeatureState).toHaveBeenLastCalledWith(
      { source: SOURCE_IDS.buildings, id: 'osm:way/10' },
      { selected: true },
    );
    rerender({ selectedPlaceId: 'osm:node/30' });
    expect(map.removeFeatureState).toHaveBeenLastCalledWith(
      { source: SOURCE_IDS.buildings, id: 'osm:way/10' },
      'selected',
    );
    expect(map.setFeatureState).toHaveBeenLastCalledWith(
      { source: SOURCE_IDS.places, id: 'osm:node/30' },
      { selected: true },
    );
    rerender({ selectedPlaceId: 'cur:test-office' });
    expect(map.removeFeatureState).toHaveBeenLastCalledWith(
      { source: SOURCE_IDS.places, id: 'osm:node/30' },
      'selected',
    );
    expect(map.flyTo).not.toHaveBeenCalled();
    expect(map.easeTo).not.toHaveBeenCalled();
    expect(map.jumpTo).not.toHaveBeenCalled();
  });

  it('refilters POIs only when the visible groups actually change', () => {
    const { rerender } = mount();
    const map = lastMap();
    load(map);
    rerender({ visibleGroups: new Set(ALL_GROUPS) });
    expect(map.setFilter).not.toHaveBeenCalled();
    rerender({ visibleGroups: new Set<LayerGroupId>(['food']) });
    expect(map.setFilter).toHaveBeenCalledWith(LAYER_IDS.poiCircle, expect.anything());
    expect(map.setFilter).toHaveBeenCalledWith(LAYER_IDS.labelPoi, expect.anything());
  });

  it('toggles labels and 3D mode incrementally', () => {
    const { rerender } = mount();
    const map = lastMap();
    load(map);
    rerender({ showLabels: false });
    expect(map.setLayoutProperty).toHaveBeenCalledWith(LAYER_IDS.labelBuilding, 'visibility', 'none');
    rerender({ mode3d: true });
    expect(map.easeTo).toHaveBeenCalledWith(
      expect.objectContaining({ pitch: APP_CONFIG.map.pitch3d, bearing: APP_CONFIG.map.bearing3d }),
    );
    expect(map.setLayoutProperty).toHaveBeenCalledWith(LAYER_IDS.buildingExtrusion, 'visibility', 'visible');
    expect(map.dragRotate.enable).toHaveBeenCalled();
  });

  it('reports a lost WebGL context and real style errors, but not missing glyph ranges', () => {
    const { props } = mount();
    const map = lastMap();
    map.fire('webglcontextlost', {});
    expect(props.onError).toHaveBeenCalledWith(MAP_MESSAGES.contextLost);
    map.fire('error', { error: { message: 'x', url: 'http://h/fonts/Noto Sans Regular/2304-2559.pbf' } });
    expect(props.onError).toHaveBeenCalledTimes(1);
    map.fire('error', { error: { message: 'bad' }, sourceId: 'places' });
    expect(props.onError).toHaveBeenLastCalledWith(MAP_MESSAGES.dataError);
  });

  it('reports WebGL unavailable instead of creating a map', () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(() => null);
    resetWebGLSupportCache();
    const { props } = mount();
    expect(fake.instances).toHaveLength(0);
    expect(props.onError).toHaveBeenCalledWith(MAP_MESSAGES.webglUnavailable);
  });

  it('reports WebGL unavailable when MapLibre fails to start', () => {
    fake.ctor.throwOnCreate = true;
    const { props } = mount();
    expect(props.onError).toHaveBeenCalledWith(MAP_MESSAGES.webglUnavailable);
  });

  it('exposes the read-only e2e hook only with ?e2e=1 and removes it on unmount', () => {
    window.history.replaceState(null, '', '/?e2e=1');
    const { unmount, rerender } = mount();
    const map = lastMap();
    load(map);
    const api = window.__ATLAS_MAP__!;
    expect(api.getRouteCoordinateCount()).toBe(0);
    rerender({
      route: { coordinates: ROUTE },
      selectedPlaceId: 'osm:way/10',
      userLocation: { lngLat: [75.7, 31.25], accuracyM: 8, stale: false },
    });
    expect(api.getRouteCoordinateCount()).toBe(3);
    expect(api.getSelectedId()).toBe('osm:way/10');
    expect(api.isUserLocationShown()).toBe(true);
    expect(api.getLayerVisibility(LAYER_IDS.labelBuilding)).toBe('visible');
    expect(api.getLayerVisibility('no-such-layer')).toBeNull();
    // Ground point → viewport pixels (canvas offset added); invalid input → null.
    vi.spyOn(map.canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 800, 600));
    const projected = api.projectToViewport([75.701, 31.25]);
    expect(projected!.x).toBeCloseTo(20);
    expect(projected!.y).toBeCloseTo(120);
    expect(api.projectToViewport([999, 0])).toBeNull();
    unmount();
    expect(window.__ATLAS_MAP__).toBeUndefined();
  });

  it('the e2e hook never returns the user position or accuracy', () => {
    window.history.replaceState(null, '', '/?e2e=1');
    const { rerender } = mount();
    const map = lastMap();
    load(map);
    // Distinctive values that differ from the fake camera centre.
    rerender({ userLocation: { lngLat: [75.69123, 31.24567], accuracyM: 37.5, stale: false } });
    const api = window.__ATLAS_MAP__!;
    const outputs = JSON.stringify([
      api.getCamera(),
      api.getSelectedId(),
      api.getRouteCoordinateCount(),
      api.isStyleLoaded(),
      api.queryRenderedBuildingIds(),
      api.getLayerVisibility(LAYER_IDS.userDot),
      api.isUserLocationShown(),
    ]);
    expect(outputs).not.toMatch(/75\.69123|31\.24567|37\.5/);
    expect(api.isUserLocationShown()).toBe(true);
    rerender({ userLocation: null });
    expect(api.isUserLocationShown()).toBe(false);
  });

  it('switches 3D mode without animation when reduced motion is requested', () => {
    const { rerender } = mount({ reducedMotion: true });
    const map = lastMap();
    load(map);
    rerender({ mode3d: true });
    expect(map.jumpTo).toHaveBeenCalledWith({
      pitch: APP_CONFIG.map.pitch3d,
      bearing: APP_CONFIG.map.bearing3d,
    });
    expect(map.easeTo).not.toHaveBeenCalled();
  });

  it('does not install the e2e hook without the flag', () => {
    mount();
    load(lastMap());
    expect(window.__ATLAS_MAP__).toBeUndefined();
  });
});

describe('MapView: realistic 3D', () => {
  const offCampus: Place = {
    id: 'osm:node/900',
    name: 'Synthetic Outside Shop',
    displayName: 'Synthetic Outside Shop',
    aliases: [],
    kind: 'facility',
    categoryId: 'food',
    location: [75.711, 31.27],
    campusZone: 'off-campus-nearby',
    wheelchair: 'unknown',
    provenance: { sourceId: 'synthetic', verificationStatus: 'unverified' },
  };
  const placesData = (map: FakeMap) => {
    const calls = map.sources[SOURCE_IDS.places]!.setData.mock.calls as unknown[][];
    return calls.at(-1)?.[0] as
      { features: Array<{ id: string; properties: { badge?: string } }> } | undefined;
  };

  it('caps the device pixel ratio at 2', () => {
    const dpr = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true });
    try {
      mount();
      expect(lastMap().options.pixelRatio).toBe(2);
    } finally {
      if (dpr) Object.defineProperty(window, 'devicePixelRatio', dpr);
    }
  });

  it('puts the map-anchored light in the style', () => {
    mount({ theme: 'dark' });
    const style = lastMap().options.style as { light: { anchor: string; intensity: number } };
    expect(style.light).toMatchObject({ anchor: 'map', intensity: 0.35 });
  });

  it('draws nearby off-campus places only while "Nearby, outside campus" is on, with the badge', () => {
    const { rerender } = mount({ contextPlaces: [offCampus] });
    const map = lastMap();
    const initial = (
      map.options.style as { sources: Record<string, { data: { features: Array<{ id: string }> } }> }
    ).sources[SOURCE_IDS.places]!.data.features;
    expect(initial.map((f) => f.id)).not.toContain(offCampus.id);
    load(map);
    rerender({ showNearbyOutsideCampus: true });
    const shown = placesData(map)!.features.find((f) => f.id === offCampus.id);
    expect(shown?.properties.badge).toBe(APP_CONFIG.optionalLayers.nearbyOutsideCampus.badge);
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'poi-outside-badge' }));
    rerender({ showNearbyOutsideCampus: false });
    expect(placesData(map)!.features.map((f) => f.id)).not.toContain(offCampus.id);
    expect(map.removeLayer).toHaveBeenCalledWith('poi-outside-badge');
  });

  it('adds the detections layer with the licensed sources’ attribution only when enabled and loaded', () => {
    const data = {
      ...DATA,
      manifest: {
        ...DATA.manifest,
        sources: [
          ...DATA.manifest.sources,
          {
            id: 'microsoft-ml-buildings',
            name: 'Microsoft Global ML Building Footprints',
            url: 'https://github.com/microsoft/GlobalMLBuildingFootprints',
            license: 'CDLA-Permissive-2.0',
            licenseUrl: 'https://cdla.dev/permissive-2-0/',
            attribution: 'Building footprints © Microsoft, CDLA Permissive 2.0',
            retrievedAt: '2026-10-23T21:50:45Z',
          },
        ],
      },
    };
    const detections = { type: 'FeatureCollection', features: [] } as unknown as DetectionsFile;
    const { rerender } = mount({ data });
    const map = lastMap();
    load(map);
    rerender({ showDetectedFootprints: true }); // not loaded yet
    expect(map.addSource).not.toHaveBeenCalled();
    rerender({ detections });
    expect(map.addSource).toHaveBeenCalledWith(
      'detections',
      expect.objectContaining({
        attribution: expect.stringContaining('href="https://cdla.dev/permissive-2-0/"'),
      }),
    );
    rerender({ showDetectedFootprints: false });
    expect(map.removeSource).toHaveBeenCalledWith('detections');
  });

  it('passes studio models to the controller (lazy renderer) and leaves the buildings source alone', () => {
    const { rerender } = mount();
    const map = lastMap();
    load(map);
    expect(lastR3d().handle.debug().studio).toBe('idle');
    rerender({
      studioModels: [
        {
          publicId: 'osm:way/10',
          recordId: 'stu:abcdefghijklmnopqrstuvwxyz',
          version: 1,
          footprint: FOOTPRINT,
          model: model(),
        },
      ],
    });
    expect(lastR3d().handle.debug().studio).toBe('loading');
    expect(map.sources[SOURCE_IDS.buildings]!.setData).not.toHaveBeenCalled();
  });

  it('shows a degradation notice inline (no toast provider, no handler) until dismissed', () => {
    mount();
    load(lastMap());
    act(() => lastR3d().opts.onNotice({ id: 'studio-slow', message: 'Models are plain blocks now.' }));
    expect(screen.getByRole('status')).toHaveTextContent('Models are plain blocks now.');
    act(() => screen.getByRole('button', { name: 'Dismiss' }).click());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('hands notices to onRenderNotice when given', () => {
    const onRenderNotice = vi.fn();
    mount({ onRenderNotice });
    load(lastMap());
    const notice = { id: 'suggest-overview' as const, message: 'Try the Overview.' };
    act(() => lastR3d().opts.onNotice(notice));
    expect(onRenderNotice).toHaveBeenCalledWith(notice);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('disposes the controller on unmount', () => {
    const { unmount } = mount();
    load(lastMap());
    const map = lastMap();
    unmount();
    expect(map.off).toHaveBeenCalledWith('webglcontextlost', expect.any(Function));
  });
});
