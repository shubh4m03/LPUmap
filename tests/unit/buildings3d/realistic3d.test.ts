import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  StudioCustomLayer,
  StudioLayerOptions,
  StudioRendererModule,
  StudioRenderSource,
} from '../../../src/building-studio/render/maplibre/index.ts';
import { BUILDING_LAYER_IDS, extrusionFilter } from '../../../src/buildings3d/index.ts';
import { DETECTIONS_SOURCE_ID, OPTIONAL_LAYER_IDS } from '../../../src/buildings3d/optional-layers.ts';
import {
  attachRealistic3D,
  RENDER_NOTICES,
  STUDIO_PREVIEW_FALLBACK_LAYER_ID,
  type Realistic3DMap,
  type RenderNotice,
} from '../../../src/buildings3d/realistic3d.ts';
import type { DetectionsFile } from '../../../src/data/schema.ts';
import { FOOTPRINT, model } from '../building-studio/fixtures.ts';

// ---------------------------------------------------------------------------
// Fakes: a map that keeps layer order, sources, filters and handlers, and a
// renderer module whose layer records what the controller asks of it.
// ---------------------------------------------------------------------------

type Handler = (ev?: unknown) => void;

function fakeMap() {
  const order: string[] = ['background', BUILDING_LAYER_IDS.fill, BUILDING_LAYER_IDS.extrusion, 'route-line'];
  const layers = new Map<string, unknown>(order.map((id) => [id, { id }]));
  const sources = new Map<string, Record<string, unknown>>([
    ['buildings', {}],
    ['places', {}],
  ]);
  const handlers = new Map<string, Handler[]>();
  const filters = new Map<string, unknown>();
  const layout = new Map<string, unknown>();
  const map = {
    order,
    sources,
    filters,
    layout,
    zoom: 16,
    styleLoaded: true,
    lights: [] as unknown[],
    addLayer: vi.fn((layer: { id: string; onAdd?: (m: unknown, gl: unknown) => void }, before?: string) => {
      layers.set(layer.id, layer);
      const i = before ? order.indexOf(before) : -1;
      if (i >= 0) order.splice(i, 0, layer.id);
      else order.push(layer.id);
      layer.onAdd?.(map, {});
    }),
    removeLayer: vi.fn((id: string) => {
      layers.delete(id);
      order.splice(order.indexOf(id), 1);
    }),
    getLayer: (id: string) => layers.get(id),
    addSource: vi.fn((id: string, spec: Record<string, unknown>) => {
      sources.set(id, { ...spec, setData: vi.fn() });
    }),
    removeSource: vi.fn((id: string) => {
      sources.delete(id);
    }),
    getSource: (id: string) => sources.get(id),
    setFilter: vi.fn((id: string, f: unknown) => {
      filters.set(id, f);
    }),
    setLight: vi.fn((l: unknown) => {
      map.lights.push(l);
    }),
    setPaintProperty: vi.fn(),
    setLayoutProperty: vi.fn((id: string, name: string, v: unknown) => {
      layout.set(`${id}.${name}`, v);
    }),
    on: (type: string, fn: Handler) => {
      handlers.set(type, [...(handlers.get(type) ?? []), fn]);
    },
    off: (type: string, fn: Handler) => {
      handlers.set(
        type,
        (handlers.get(type) ?? []).filter((h) => h !== fn),
      );
    },
    once: (type: string, fn: Handler) => {
      const wrap: Handler = (ev) => {
        map.off(type, wrap);
        fn(ev);
      };
      map.on(type, wrap);
    },
    fire: (type: string) => {
      for (const h of [...(handlers.get(type) ?? [])]) h();
    },
    handlerCount: () => [...handlers.values()].reduce((s, h) => s + h.length, 0),
    triggerRepaint: vi.fn(),
    getZoom: () => map.zoom,
    isStyleLoaded: () => map.styleLoaded,
    getLayersOrder: () => [...order],
  };
  return map;
}

interface FakeLayerRecord {
  layer: StudioCustomLayer;
  opts: StudioLayerOptions;
  instances: string[][];
  visible: boolean[];
  selected: Array<string | null>;
  contextLost: number;
}

function fakeRenderer(opts: { failOnAdd?: boolean } = {}) {
  const made: FakeLayerRecord[] = [];
  const mod = {
    STUDIO_LAYER_ID: 'studio-models',
    createStudioCustomLayer: (o: StudioLayerOptions) => {
      const rec: FakeLayerRecord = {
        opts: o,
        instances: [],
        visible: [],
        selected: [],
        contextLost: 0,
        layer: undefined as unknown as StudioCustomLayer,
      };
      let failure: string | null = null;
      rec.layer = {
        id: 'studio-models',
        type: 'custom',
        renderingMode: '3d',
        render: () => {},
        onAdd: () => {
          if (opts.failOnAdd) {
            failure = 'program';
            o.onFailure?.('program', 'fake');
          }
        },
        setInstances: (list) => rec.instances.push(list.map((i) => `${i.id}${i.preview ? '(preview)' : ''}`)),
        setSelected: (id) => rec.selected.push(id),
        setStyle: () => {},
        setVisible: (v) => rec.visible.push(v),
        contextLost: () => {
          rec.contextLost += 1;
          failure = 'context-lost';
          o.onFailure?.('context-lost', 'lost');
        },
        stats: () => ({
          instances: 0,
          meshes: 0,
          gpuBytes: 0,
          uploads: 0,
          drawCalls: 0,
          triangles: 0,
          lastRenderMs: 0,
        }),
        get failure() {
          return failure as StudioCustomLayer['failure'];
        },
      } as StudioCustomLayer;
      made.push(rec);
      return rec.layer;
    },
    studioInstanceFor: (src: StudioRenderSource) => ({
      instance: {
        id: src.publicId,
        mesh: {},
        appearance: { wall: '#ffffff', roof: '#ffffff' },
        ...(src.preview ? { preview: true } : {}),
      },
      modelAvailable: src.model.generatorId !== 'dome',
      reason: null,
    }),
    clearStudioInstanceMemo: () => {},
  };
  return { mod: mod as unknown as StudioRendererModule, made };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const src = (publicId: string, over: Partial<StudioRenderSource> = {}): StudioRenderSource => ({
  publicId,
  recordId: publicId.startsWith('stu:') ? publicId : 'stu:abcdefghijklmnopqrstuvwxyz',
  version: 1,
  footprint: FOOTPRINT,
  model: model(),
  ...over,
});

function attach(over: { failOnAdd?: boolean; loadFails?: boolean; mode3d?: boolean } = {}) {
  const map = fakeMap();
  const { mod, made } = fakeRenderer(over);
  const notices: RenderNotice[] = [];
  const load = vi.fn(() => (over.loadFails ? Promise.reject(new Error('offline')) : Promise.resolve(mod)));
  let rafCb: ((t: number) => void) | null = null;
  let t = 0;
  const handle = attachRealistic3D(map as unknown as Realistic3DMap, {
    theme: 'light',
    mode3d: over.mode3d ?? true,
    onNotice: (n) => notices.push(n),
    loadRenderer: load,
    watchdog: {
      now: () => t,
      requestFrame: (cb) => {
        rafCb = cb;
        return 1;
      },
      cancelFrame: () => {
        rafCb = null;
      },
    },
  });
  /** Simulates `frames` frames of `ms` each while the camera moves. */
  const slowFrames = (frames: number, ms: number) => {
    map.fire('movestart');
    for (let i = 0; i < frames && rafCb; i++) {
      t += ms;
      const cb: (t: number) => void = rafCb;
      rafCb = null;
      cb(t);
    }
    map.fire('moveend');
  };
  return { map, made, notices, load, handle, slowFrames };
}

afterEach(() => vi.restoreAllMocks());

describe('attachRealistic3D: studio models', () => {
  it('loads nothing while there are no studio models and the Studio is closed', async () => {
    const { load, handle, map } = attach();
    handle.setStudioModels([]);
    await flush();
    expect(load).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(handle.debug().studio).toBe('idle');
  });

  it('opening the Studio preloads the chunk', async () => {
    const { load, handle } = attach();
    handle.setStudioOpen(true);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('draws published models with the custom layer, leaves them out of the extrusion and keeps them pickable', async () => {
    const { map, made, handle } = attach();
    handle.setStudioModels([src('stu:bbbbbbbbbbbbbbbbbbbbbbbb'), src('osm:way/1')]);
    expect(handle.debug().studio).toBe('loading');
    await flush();
    expect(handle.debug().studio).toBe('custom');
    expect(made).toHaveLength(1);
    expect(made[0]!.instances.at(-1)).toEqual(['stu:bbbbbbbbbbbbbbbbbbbbbbbb', 'osm:way/1']);
    // Layers sit directly above the extrusion, below the overlays.
    expect(map.order.slice(2)).toEqual([
      BUILDING_LAYER_IDS.extrusion,
      BUILDING_LAYER_IDS.studioPick,
      'studio-models',
      'route-line',
    ]);
    expect(map.filters.get(BUILDING_LAYER_IDS.extrusion)).toEqual(
      extrusionFilter(['osm:way/1', 'stu:bbbbbbbbbbbbbbbbbbbbbbbb']),
    );
    expect(handle.debug().excludedIds).toEqual(['osm:way/1', 'stu:bbbbbbbbbbbbbbbbbbbbbbbb']);
  });

  it('a Studio preview is drawn translucent by the layer but never excluded from the extrusion', async () => {
    const { map, made, handle } = attach();
    handle.setStudioModels([
      src('stu:pppppppppppppppppppppppp', { recordId: 'preview', version: 0, preview: true }),
    ]);
    await flush();
    expect(made[0]!.instances.at(-1)).toEqual(['stu:pppppppppppppppppppppppp(preview)']);
    expect(map.getLayer(BUILDING_LAYER_IDS.studioPick)).toBeUndefined();
    expect(map.getLayer(STUDIO_PREVIEW_FALLBACK_LAYER_ID)).toBeUndefined();
  });

  it('hides the layer in 2D and below the extrusion zoom; selection reaches the layer', async () => {
    const { map, made, handle } = attach();
    handle.setStudioModels([src('stu:bbbbbbbbbbbbbbbbbbbbbbbb')]);
    await flush();
    const rec = made[0]!;
    expect(rec.visible.at(-1)).toBe(true);
    handle.setMode3d(false);
    expect(rec.visible.at(-1)).toBe(false);
    expect(map.layout.get(`${BUILDING_LAYER_IDS.studioPick}.visibility`)).toBe('none');
    handle.setMode3d(true);
    map.zoom = 13;
    map.fire('zoom');
    expect(rec.visible.at(-1)).toBe(false);
    handle.setSelected('stu:bbbbbbbbbbbbbbbbbbbbbbbb');
    expect(rec.selected.at(-1)).toBe('stu:bbbbbbbbbbbbbbbbbbbbbbbb');
  });

  it('removing every model restores the plain extrusion filter and removes the pick layer', async () => {
    const { map, handle } = attach();
    handle.setStudioModels([src('stu:bbbbbbbbbbbbbbbbbbbbbbbb')]);
    await flush();
    handle.setStudioModels([]);
    expect(map.filters.get(BUILDING_LAYER_IDS.extrusion)).toEqual(extrusionFilter([]));
    expect(map.getLayer(BUILDING_LAYER_IDS.studioPick)).toBeUndefined();
    expect(handle.debug().studio).toBe('idle');
  });

  it('reports models this build cannot generate (drawn as the fallback prism)', async () => {
    const { handle } = attach();
    handle.setStudioModels([
      src('stu:bbbbbbbbbbbbbbbbbbbbbbbb', { model: { ...model(), generatorId: 'dome' } }),
    ]);
    await flush();
    expect(handle.debug().modelUnavailable).toEqual(['stu:bbbbbbbbbbbbbbbbbbbbbbbb']);
  });
});

describe('attachRealistic3D: fallback to extrusions', () => {
  it('a chunk that fails to load leaves studio models as extrusions and says so', async () => {
    const { map, handle, notices } = attach({ loadFails: true });
    handle.setStudioModels([src('stu:bbbbbbbbbbbbbbbbbbbbbbbb')]);
    await flush();
    expect(handle.debug()).toMatchObject({
      studio: 'fallback',
      fallbackReason: 'load-failed',
      excludedIds: [],
    });
    expect(map.getLayer('studio-models')).toBeUndefined();
    expect(notices.map((n) => n.id)).toEqual(['studio-unavailable']);
  });

  it('a layer that fails in onAdd is removed and the extrusion takes over', async () => {
    const { map, handle, notices } = attach({ failOnAdd: true });
    handle.setStudioModels([src('stu:bbbbbbbbbbbbbbbbbbbbbbbb')]);
    await flush();
    expect(handle.debug()).toMatchObject({ studio: 'fallback', fallbackReason: 'program', excludedIds: [] });
    expect(map.getLayer('studio-models')).toBeUndefined();
    expect(map.getLayer(BUILDING_LAYER_IDS.studioPick)).toBeUndefined();
    expect(notices.map((n) => n.message)).toEqual([RENDER_NOTICES['studio-unavailable']]);
  });

  it('in fallback a Studio preview is drawn as a translucent extrusion of its footprint', async () => {
    const { map, handle } = attach({ loadFails: true });
    handle.setStudioModels([
      src('stu:pppppppppppppppppppppppp', { recordId: 'preview', version: 0, preview: true }),
    ]);
    await flush();
    expect(map.getLayer(STUDIO_PREVIEW_FALLBACK_LAYER_ID)).toBeDefined();
    expect(map.sources.get('studio-preview')).toBeDefined();
    handle.setStudioModels([]);
    expect(map.getLayer(STUDIO_PREVIEW_FALLBACK_LAYER_ID)).toBeUndefined();
    expect(map.sources.get('studio-preview')).toBeUndefined();
  });

  it('context loss: no map calls while lost; one re-mount after restore; a second loss stays on the fallback', async () => {
    const { map, made, handle, notices } = attach();
    handle.setStudioModels([src('stu:bbbbbbbbbbbbbbbbbbbbbbbb')]);
    await flush();
    const calls = () =>
      map.setFilter.mock.calls.length + map.addLayer.mock.calls.length + map.removeLayer.mock.calls.length;
    const before = calls();
    map.fire('webglcontextlost');
    await flush();
    expect(made[0]!.contextLost).toBe(1);
    expect(calls()).toBe(before);
    expect(handle.debug().fallbackReason).toBe('context-lost');

    map.fire('webglcontextrestored');
    await flush();
    expect(handle.debug()).toMatchObject({ studio: 'custom', fallbackReason: null });
    expect(made).toHaveLength(2);
    expect(notices).toEqual([]);

    map.fire('webglcontextlost');
    await flush();
    map.styleLoaded = false;
    map.fire('webglcontextrestored');
    map.styleLoaded = true;
    map.fire('style.load');
    await flush();
    expect(handle.debug()).toMatchObject({
      studio: 'fallback',
      fallbackReason: 'context-lost',
      excludedIds: [],
    });
    expect(made).toHaveLength(2);
    expect(notices.map((n) => n.id)).toEqual(['studio-unavailable']);
  });
});

describe('attachRealistic3D: slow-frame watchdog', () => {
  it('first drops the custom layer, then suggests the overview, and never switches modes', async () => {
    const { map, handle, notices, slowFrames } = attach();
    handle.setStudioModels([src('stu:bbbbbbbbbbbbbbbbbbbbbbbb')]);
    await flush();
    slowFrames(40, 80);
    await flush();
    expect(handle.debug()).toMatchObject({
      studio: 'fallback',
      fallbackReason: 'slow-frames',
      degradeLevel: 1,
    });
    expect(map.getLayer('studio-models')).toBeUndefined();
    slowFrames(40, 80);
    expect(notices.map((n) => n.id)).toEqual(['studio-slow', 'suggest-overview']);
    expect(handle.debug().degradeLevel).toBe(2);
    slowFrames(40, 80);
    expect(notices).toHaveLength(2);
  });

  it('fast frames and 2D mode never trigger it', async () => {
    const { handle, notices, slowFrames } = attach({ mode3d: false });
    handle.setStudioModels([src('stu:bbbbbbbbbbbbbbbbbbbbbbbb')]);
    await flush();
    slowFrames(60, 80); // 2D: not sampled
    handle.setMode3d(true);
    slowFrames(200, 16);
    expect(notices).toEqual([]);
    expect(handle.debug().studio).toBe('custom');
  });
});

describe('attachRealistic3D: light and optional layers', () => {
  it('updates the map-anchored light with the theme', () => {
    const { map, handle } = attach();
    handle.setTheme('dark');
    expect(map.lights.at(-1)).toMatchObject({ anchor: 'map', intensity: 0.35 });
    handle.setTheme('dark');
    expect(map.lights).toHaveLength(1);
  });

  const detections: DetectionsFile = { type: 'FeatureCollection', features: [] } as unknown as DetectionsFile;

  it('the detections layer carries its attribution only while shown', () => {
    const { map, handle } = attach();
    handle.setDetections(true, detections, '<a href="https://cdla.dev/permissive-2-0/">MS</a>');
    expect(map.sources.get(DETECTIONS_SOURCE_ID)).toMatchObject({
      attribution: '<a href="https://cdla.dev/permissive-2-0/">MS</a>',
    });
    // Flat, below the extrusion.
    expect(map.order.indexOf(OPTIONAL_LAYER_IDS.detectionOutline)).toBeLessThan(
      map.order.indexOf(BUILDING_LAYER_IDS.extrusion),
    );
    expect(handle.debug().detectionsShown).toBe(true);
    handle.setDetections(false, detections, '');
    expect(map.sources.get(DETECTIONS_SOURCE_ID)).toBeUndefined();
    expect(map.getLayer(OPTIONAL_LAYER_IDS.detectionOutline)).toBeUndefined();
    handle.setDetections(true, null, 'x'); // not loaded yet: nothing drawn
    expect(map.sources.get(DETECTIONS_SOURCE_ID)).toBeUndefined();
  });

  it('adds and removes the Outside campus badges', () => {
    const { map, handle } = attach();
    handle.setNearbyOutsideCampus(true);
    expect(map.getLayer(OPTIONAL_LAYER_IDS.outsideBadge)).toBeDefined();
    handle.setNearbyOutsideCampus(false);
    expect(map.getLayer(OPTIONAL_LAYER_IDS.outsideBadge)).toBeUndefined();
  });

  it('dispose unregisters every handler', async () => {
    const { map, handle } = attach();
    handle.setStudioModels([src('stu:bbbbbbbbbbbbbbbbbbbbbbbb')]);
    await flush();
    handle.dispose();
    expect(map.handlerCount()).toBe(0);
    expect(map.getLayer('studio-models')).toBeUndefined();
  });
});
