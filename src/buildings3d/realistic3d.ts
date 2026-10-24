/**
 * Realistic-3D controller, attached to a loaded MapLibre map. It owns:
 *
 * - the map-anchored light (and its theme updates);
 * - the opt-in "Unverified detected footprints" layer (with its attribution)
 *   and the "Outside campus" badges of the "Nearby, outside campus" layer;
 * - owner-placed studio models (S1): the lazily loaded WebGL2 custom layer,
 *   the extrusion exclusion + invisible pick layer while it is healthy, and
 *   the fill-extrusion fallback (footprint × body height) when it is not;
 * - the slow-frame watchdog and WebGL context-loss handling, which degrade
 *   to that fallback and report a visible notice. It never switches modes.
 *
 * The studio features themselves (one BuildingsFile feature per published
 * studio building, same id as everywhere else) are added to the buildings
 * source by the merge (integrate); this controller only decides how they
 * are drawn.
 */
import type { FeatureCollection, Polygon } from 'geojson';
import type { FillExtrusionLayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import type {
  StudioCustomLayer,
  StudioLayerFailure,
  StudioLayerStats,
  StudioLayerStyle,
  StudioRendererModule,
  StudioRenderSource,
} from '../building-studio/render/maplibre/index.ts';
import { loadStudioRenderer } from '../building-studio/render/maplibre/index.ts';
import { APP_CONFIG } from '../config/index.ts';
import type { DetectionsFile } from '../data/schema.ts';
import { mapThemeColors, type MapTheme } from '../map/theme-colors.ts';
import { BUILDING_LAYER_IDS, BUILDINGS_SOURCE_ID, extrusionFilter, studioPickLayer } from './layers.ts';
import { lightSpecification, realisticLight } from './lighting.ts';
import { applyOptionalLayersTheme, setDetectionsLayer, setOutsideBadgeLayer } from './optional-layers.ts';
import { realistic3dColors } from './palette.ts';
import { createFrameWatchdog, type FrameWatchdogOptions, type SlowFrameReport } from './watchdog.ts';

export type Realistic3DMap = Pick<
  MapLibreMap,
  | 'addLayer'
  | 'removeLayer'
  | 'getLayer'
  | 'addSource'
  | 'removeSource'
  | 'getSource'
  | 'setFilter'
  | 'setLight'
  | 'setPaintProperty'
  | 'setLayoutProperty'
  | 'on'
  | 'off'
  | 'once'
  | 'triggerRepaint'
  | 'getZoom'
  | 'isStyleLoaded'
  | 'getLayersOrder'
>;

export type StudioRenderState = 'idle' | 'loading' | 'custom' | 'fallback';
export type StudioFallbackReason = StudioLayerFailure | 'load-failed' | 'slow-frames';

export type RenderNoticeId = 'studio-slow' | 'studio-unavailable' | 'suggest-overview';

export interface RenderNotice {
  id: RenderNoticeId;
  message: string;
}

export const RENDER_NOTICES: Readonly<Record<RenderNoticeId, string>> = {
  'studio-slow':
    'Owner-placed 3D models are now drawn as plain blocks to keep the map responsive on this device.',
  'studio-unavailable':
    'Owner-placed 3D models could not be drawn on this device, so they are shown as plain blocks.',
  'suggest-overview':
    'The 3D map is running slowly on this device. The Overview view may be smoother; your selection is kept.',
};

export const STUDIO_PREVIEW_SOURCE_ID = 'studio-preview';
export const STUDIO_PREVIEW_FALLBACK_LAYER_ID = 'studio-preview-fallback';

export interface Realistic3DOptions {
  theme: MapTheme;
  mode3d: boolean;
  onNotice(notice: RenderNotice): void;
  /** Injected in tests; defaults to the lazy chunk. */
  loadRenderer?: () => Promise<StudioRendererModule>;
  watchdog?: Omit<FrameWatchdogOptions, 'onSlow'>;
}

export interface Realistic3DDebug {
  studio: StudioRenderState;
  fallbackReason: StudioFallbackReason | null;
  degradeLevel: number;
  excludedIds: string[];
  layer: StudioLayerStats | null;
  detectionsShown: boolean;
  nearbyShown: boolean;
  /** Models drawn as the S2 fallback prism because this build cannot generate them. */
  modelUnavailable: string[];
}

export interface Realistic3DHandle {
  setTheme(theme: MapTheme): void;
  setMode3d(on: boolean): void;
  /** Published studio buildings plus any Studio preview (preview: true). */
  setStudioModels(models: readonly StudioRenderSource[]): void;
  setSelected(id: string | null): void;
  /** The Studio is open: load the renderer even before any model exists. */
  setStudioOpen(open: boolean): void;
  setDetections(visible: boolean, data: DetectionsFile | null, attributionHtml: string): void;
  setNearbyOutsideCampus(visible: boolean): void;
  debug(): Realistic3DDebug;
  dispose(): void;
}

const sameIds = (a: readonly string[] | null, b: readonly string[]) =>
  a !== null && a.length === b.length && a.every((v, i) => v === b[i]);

function layerStyle(theme: MapTheme): StudioLayerStyle {
  const l = realisticLight(theme);
  return {
    light: { position: l.position, intensity: l.intensity, colour: l.color },
    highlight: mapThemeColors(theme).selected,
    glass: realistic3dColors(theme).glass,
  };
}

function previewFallbackLayer(theme: MapTheme): FillExtrusionLayerSpecification {
  return {
    id: STUDIO_PREVIEW_FALLBACK_LAYER_ID,
    type: 'fill-extrusion',
    source: STUDIO_PREVIEW_SOURCE_ID,
    paint: {
      'fill-extrusion-color': realistic3dColors(theme).extrusionStudio,
      'fill-extrusion-height': ['get', 'top'],
      'fill-extrusion-base': ['get', 'base'],
      'fill-extrusion-opacity': 0.55,
    },
  };
}

function previewCollection(previews: readonly StudioRenderSource[]): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: previews.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: p.footprint.coordinates },
      properties: { id: p.publicId, base: p.model.baseOffsetM, top: p.model.baseOffsetM + p.model.heightM },
    })),
  };
}

export function attachRealistic3D(map: Realistic3DMap, opts: Realistic3DOptions): Realistic3DHandle {
  const load = opts.loadRenderer ?? loadStudioRenderer;
  let theme = opts.theme;
  let mode3d = opts.mode3d;
  let models: readonly StudioRenderSource[] = [];
  let selected: string | null = null;
  let studioOpen = false;
  let renderer: StudioRendererModule | null = null;
  let loading: Promise<void> | null = null;
  let layer: StudioCustomLayer | null = null;
  let state: StudioRenderState = 'idle';
  let fallbackReason: StudioFallbackReason | null = null;
  let degradeLevel = 0;
  let excluded: string[] | null = [];
  let unavailable: string[] = [];
  let contextLost = false;
  let contextRetries = 0;
  let disposed = false;
  let detections: { visible: boolean; data: DetectionsFile | null; attribution: string } = {
    visible: false,
    data: null,
    attribution: '',
  };
  let nearby = false;
  const noticed = new Set<RenderNoticeId>();

  const notify = (id: RenderNoticeId) => {
    if (noticed.has(id)) return;
    noticed.add(id);
    opts.onNotice({ id, message: RENDER_NOTICES[id] });
  };

  const extrusionReady = () => !contextLost && Boolean(map.getLayer(BUILDING_LAYER_IDS.extrusion));

  /** The layer drawn right after the extrusion, so studio layers sit just above it. */
  const layerAfterExtrusion = (): string | undefined => {
    const order = map.getLayersOrder();
    const i = order.indexOf(BUILDING_LAYER_IDS.extrusion);
    return i >= 0 ? order[i + 1] : undefined;
  };

  const applyExclusion = (ids: string[]) => {
    if (!extrusionReady() || sameIds(excluded, ids)) return;
    map.setFilter(BUILDING_LAYER_IDS.extrusion, extrusionFilter(ids));
    if (map.getLayer(BUILDING_LAYER_IDS.studioPick)) map.removeLayer(BUILDING_LAYER_IDS.studioPick);
    if (ids.length > 0 && map.getSource(BUILDINGS_SOURCE_ID))
      map.addLayer(studioPickLayer(ids, { mode3d }), layerAfterExtrusion());
    excluded = ids;
  };

  const applyPreviewFallback = (previews: readonly StudioRenderSource[]) => {
    if (contextLost) return;
    const show = previews.length > 0;
    const source = map.getSource(STUDIO_PREVIEW_SOURCE_ID) as { setData?(d: unknown): unknown } | undefined;
    if (!show) {
      if (map.getLayer(STUDIO_PREVIEW_FALLBACK_LAYER_ID)) map.removeLayer(STUDIO_PREVIEW_FALLBACK_LAYER_ID);
      if (source) map.removeSource(STUDIO_PREVIEW_SOURCE_ID);
      return;
    }
    const data = previewCollection(previews);
    if (source?.setData) source.setData(data);
    else map.addSource(STUDIO_PREVIEW_SOURCE_ID, { type: 'geojson', data });
    if (!map.getLayer(STUDIO_PREVIEW_FALLBACK_LAYER_ID))
      map.addLayer(previewFallbackLayer(theme), layerAfterExtrusion());
  };

  const visibleNow = () => mode3d && map.getZoom() >= APP_CONFIG.map.extrusionMinZoom;

  const removeLayer = () => {
    if (!layer) return;
    const id = layer.id;
    layer = null;
    if (!contextLost && map.getLayer(id)) map.removeLayer(id);
  };

  const fallback = (reason: StudioFallbackReason) => {
    if (disposed) return;
    fallbackReason = reason;
    state = models.length > 0 ? 'fallback' : 'idle';
    removeLayer();
    sync();
    if (reason === 'slow-frames') notify('studio-slow');
    else if (reason !== 'context-lost') notify('studio-unavailable');
  };

  const mount = () => {
    if (!renderer || layer || fallbackReason || contextLost) return;
    const l = renderer.createStudioCustomLayer({
      style: layerStyle(theme),
      // Deferred: a failure inside onAdd must not remove the layer while MapLibre is still adding it.
      onFailure: (reason) => queueMicrotask(() => fallback(reason)),
    });
    layer = l;
    try {
      map.addLayer(l, layerAfterExtrusion());
    } catch {
      layer = null;
      queueMicrotask(() => fallback('program'));
    }
  };

  function sync(): void {
    if (disposed) return;
    const wanted = models.length > 0 || studioOpen;
    if (wanted && !renderer && !loading && !fallbackReason) {
      state = 'loading';
      loading = load().then(
        (mod) => {
          loading = null;
          renderer = mod;
          sync();
        },
        () => {
          loading = null;
          fallback('load-failed');
        },
      );
    }
    const previews = models.filter((m) => m.preview);
    const published = models.filter((m) => !m.preview);
    if (renderer && !fallbackReason && wanted) {
      mount();
      if (layer) {
        const results = models.map((m) => renderer!.studioInstanceFor(m));
        unavailable = results.filter((r) => !r.modelAvailable).map((r) => r.instance.id);
        layer.setInstances(results.map((r) => r.instance));
        layer.setSelected(selected);
        layer.setVisible(visibleNow());
        applyExclusion([...new Set(published.map((m) => m.publicId))].sort());
        applyPreviewFallback([]);
        state = models.length > 0 ? 'custom' : 'idle';
        return;
      }
    }
    // Not drawn by the custom layer (idle, loading or fallback): plain extrusions.
    layer?.setInstances([]);
    applyExclusion([]);
    applyPreviewFallback(previews);
    if (models.length === 0) state = 'idle';
    else if (fallbackReason) state = 'fallback';
    else state = 'loading';
  }

  const onSlow = (_report: SlowFrameReport) => {
    if (state === 'custom' && layer) {
      degradeLevel = Math.max(degradeLevel, 1);
      fallback('slow-frames');
      return;
    }
    if (degradeLevel < 2) {
      degradeLevel = 2;
      notify('suggest-overview');
    }
  };
  const watchdog = createFrameWatchdog({ ...opts.watchdog, onSlow });

  const onMoveStart = () => {
    if (mode3d) watchdog.start();
  };
  const onMoveEnd = () => watchdog.stop();
  const onZoom = () => layer?.setVisible(visibleNow());
  const onContextLost = () => {
    contextLost = true;
    watchdog.stop();
    // The style is destroyed: drop GL references only, never call into the map here.
    layer?.contextLost();
    layer = null;
  };
  const restore = () => {
    if (disposed) return;
    contextLost = false;
    excluded = null; // the restored style carries an unknown filter state: re-apply
    if (contextRetries < 1 && fallbackReason === 'context-lost') {
      contextRetries += 1;
      fallbackReason = null;
    } else if (fallbackReason === 'context-lost') notify('studio-unavailable');
    sync();
  };
  const onContextRestored = () => {
    if (map.isStyleLoaded()) restore();
    else map.once('style.load', restore);
  };

  map.on('movestart', onMoveStart);
  map.on('moveend', onMoveEnd);
  map.on('zoom', onZoom);
  map.on('webglcontextlost', onContextLost);
  map.on('webglcontextrestored', onContextRestored);
  // The initial light is part of the style (src/map/style.ts); theme changes update it here.

  return {
    setTheme(t) {
      if (t === theme) return;
      theme = t;
      if (contextLost) return;
      map.setLight(lightSpecification(theme));
      layer?.setStyle(layerStyle(theme));
      applyOptionalLayersTheme(map, theme);
      if (map.getLayer(STUDIO_PREVIEW_FALLBACK_LAYER_ID))
        map.setPaintProperty(
          STUDIO_PREVIEW_FALLBACK_LAYER_ID,
          'fill-extrusion-color',
          realistic3dColors(theme).extrusionStudio,
        );
    },
    setMode3d(on) {
      mode3d = on;
      if (!on) watchdog.stop();
      layer?.setVisible(visibleNow());
      if (!contextLost && map.getLayer(BUILDING_LAYER_IDS.studioPick))
        map.setLayoutProperty(BUILDING_LAYER_IDS.studioPick, 'visibility', on ? 'visible' : 'none');
    },
    setStudioModels(next) {
      models = next;
      sync();
    },
    setSelected(id) {
      selected = id;
      layer?.setSelected(id);
    },
    setStudioOpen(open) {
      studioOpen = open;
      sync();
    },
    setDetections(visible, data, attribution) {
      detections = { visible, data, attribution };
      if (!contextLost) setDetectionsLayer(map, visible, data, attribution, theme);
    },
    setNearbyOutsideCampus(visible) {
      nearby = visible;
      if (!contextLost) setOutsideBadgeLayer(map, visible, theme);
    },
    debug() {
      return {
        studio: state,
        fallbackReason,
        degradeLevel,
        excludedIds: [...(excluded ?? [])],
        layer: layer?.stats() ?? null,
        detectionsShown: detections.visible && detections.data !== null,
        nearbyShown: nearby,
        modelUnavailable: [...unavailable],
      };
    },
    dispose() {
      disposed = true;
      watchdog.dispose();
      map.off('movestart', onMoveStart);
      map.off('moveend', onMoveEnd);
      map.off('zoom', onZoom);
      map.off('webglcontextlost', onContextLost);
      map.off('webglcontextrestored', onContextRestored);
      map.off('style.load', restore);
      try {
        removeLayer();
      } catch {
        // The map may already be torn down.
      }
    },
  };
}
