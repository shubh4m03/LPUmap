/**
 * Puts satellite imagery under the campus overlays of a live MapLibre map, and
 * takes it away again — incrementally, never with setStyle, so selection,
 * routes, the GPS puck, studio models and editing layers are untouched.
 *
 * On imagery:
 *  - the raster goes directly above the background; our basemap area fills and
 *    road fills are hidden (the imagery shows the ground); footpaths, steps,
 *    the campus boundary and every overlay stay;
 *  - overlays get more contrast (white building outlines over translucent
 *    fills, stronger boundary, wider label halos, light path dashes);
 *  - Campus 3D extrusions use the light-theme neutral tones in both themes
 *    (restrained wall/roof colours, no textures), keeping the height-source classes;
 *  - the camera zoom is capped where low-detail imagery would mislead (with a
 *    wider panning limit, so the cap is reachable on wide screens).
 */
import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { extrusionColorExpression } from '../../buildings3d/layers.ts';
import { realistic3dColors } from '../../buildings3d/palette.ts';
import { APP_CONFIG } from '../../config/index.ts';
import { LAYER_IDS, LABEL_LAYER_IDS } from '../ids.ts';
import { buildLayers } from '../style.ts';
import { mapThemeColors, type MapTheme } from '../theme-colors.ts';
import { attributionHtml } from './attribution.ts';
import type { ImageryProvider } from './types.ts';

export const IMAGERY_SOURCE_ID = 'imagery';
export const IMAGERY_LAYER_ID = 'imagery-raster';

/** Our own basemap paint that the imagery replaces. */
export const HIDDEN_ON_IMAGERY: readonly string[] = [
  LAYER_IDS.campusFill,
  LAYER_IDS.landuse,
  LAYER_IDS.green,
  LAYER_IDS.waterFill,
  LAYER_IDS.waterLine,
  LAYER_IDS.pitch,
  LAYER_IDS.parking,
  LAYER_IDS.serviceCasing,
  LAYER_IDS.roadCasing,
  LAYER_IDS.roadMajorCasing,
  LAYER_IDS.service,
  LAYER_IDS.road,
  LAYER_IDS.roadMajor,
];

/** Light, neutral line colour for paths and outlines over imagery. */
export const IMAGERY_LINE = '#fafaf9';

const SELECTED: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false];

/** [layer id, paint property, value] overrides applied while imagery is shown. */
export function imageryPaintOverrides(theme: MapTheme): Array<[string, string, unknown]> {
  const c = mapThemeColors(theme);
  const light = mapThemeColors('light');
  return [
    [LAYER_IDS.buildingFill, 'fill-opacity', ['case', SELECTED, 0.6, 0.22]],
    [LAYER_IDS.buildingOutline, 'line-color', ['case', SELECTED, c.selectedOutline, IMAGERY_LINE]],
    [LAYER_IDS.buildingOutline, 'line-width', ['case', SELECTED, 2.5, 1.25]],
    [LAYER_IDS.campusOutline, 'line-opacity', 1],
    [LAYER_IDS.campusOutline, 'line-width', ['interpolate', ['linear'], ['zoom'], 14, 2, 18, 4]],
    [LAYER_IDS.path, 'line-color', IMAGERY_LINE],
    [LAYER_IDS.steps, 'line-color', IMAGERY_LINE],
    ...LABEL_LAYER_IDS.map((id): [string, string, unknown] => [id, 'text-halo-width', 2.25]),
    [
      LAYER_IDS.buildingExtrusion,
      'fill-extrusion-color',
      extrusionColorExpression(light, realistic3dColors('light').extrusionStudio),
    ],
    [LAYER_IDS.buildingExtrusion, 'fill-extrusion-opacity', 0.95],
  ];
}

export type ImageryMap = Pick<
  MapLibreMap,
  | 'getLayer'
  | 'getSource'
  | 'addSource'
  | 'removeSource'
  | 'addLayer'
  | 'removeLayer'
  | 'setLayoutProperty'
  | 'setPaintProperty'
  | 'setMaxZoom'
  | 'setMaxBounds'
>;

/** Which provider each map currently shows (the source itself cannot carry it). */
const active = new WeakMap<object, string>();

export function activeImageryId(map: object): string | null {
  return active.get(map) ?? null;
}

type PaintSetter = (layerId: string, name: string, value: unknown) => void;

function restorePaint(map: ImageryMap, theme: MapTheme, ids: ReadonlySet<string>): void {
  const setPaint = map.setPaintProperty.bind(map) as unknown as PaintSetter;
  for (const layer of buildLayers({ theme, mode3d: false, visibleGroups: new Set(), showLabels: true })) {
    if (!ids.has(layer.id) || !layer.paint || !map.getLayer(layer.id)) continue;
    for (const [name, value] of Object.entries(layer.paint)) setPaint(layer.id, name, value);
  }
}

export interface ApplyImageryOptions {
  theme: MapTheme;
  reducedMotion: boolean;
}

/**
 * Shows `provider` (or removes imagery when null). Idempotent: calling it again
 * with the same provider only re-applies the paint overrides (e.g. after a
 * theme change re-set every paint property).
 */
export function applyImagery(
  map: ImageryMap,
  provider: ImageryProvider | null,
  opts: ApplyImageryOptions,
): void {
  const setPaint = map.setPaintProperty.bind(map) as unknown as PaintSetter;
  const overrides = imageryPaintOverrides(opts.theme);
  const source = provider?.source() ?? null;
  const current = active.get(map) ?? null;

  if (current !== null && (source === null || current !== provider?.id)) {
    if (map.getLayer(IMAGERY_LAYER_ID)) map.removeLayer(IMAGERY_LAYER_ID);
    if (map.getSource(IMAGERY_SOURCE_ID)) map.removeSource(IMAGERY_SOURCE_ID);
    active.delete(map);
  }

  if (!provider || source === null || source.kind !== 'raster-tiles') {
    // Nothing was shown: the map already has its normal look.
    if (current === null) return;
    for (const id of HIDDEN_ON_IMAGERY)
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
    restorePaint(map, opts.theme, new Set(overrides.map(([id]) => id)));
    map.setMaxZoom(APP_CONFIG.map.maxZoom);
    map.setMaxBounds(APP_CONFIG.map.maxBounds);
    return;
  }

  if (!active.has(map)) {
    map.addSource(IMAGERY_SOURCE_ID, {
      type: 'raster',
      tiles: [...source.tiles],
      tileSize: source.tileSize,
      minzoom: provider.minZoom,
      // Beyond this MapLibre over-zooms the last level instead of requesting tiles that do not exist.
      maxzoom: provider.maxZoom,
      attribution: attributionHtml(provider.attribution),
    });
    const before = map.getLayer(LAYER_IDS.campusFill) ? LAYER_IDS.campusFill : undefined;
    map.addLayer(
      {
        id: IMAGERY_LAYER_ID,
        type: 'raster',
        source: IMAGERY_SOURCE_ID,
        paint: { 'raster-fade-duration': opts.reducedMotion ? 0 : 200 },
      },
      before,
    );
    active.set(map, provider.id);
  }
  for (const id of HIDDEN_ON_IMAGERY) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
  for (const [id, name, value] of overrides) if (map.getLayer(id)) setPaint(id, name, value);
  // Bounds first: a wider limit lets the zoom cap below take effect on wide screens.
  map.setMaxBounds(provider.cameraBounds ? [...provider.cameraBounds] : APP_CONFIG.map.maxBounds);
  map.setMaxZoom(provider.cameraMaxZoom ?? APP_CONFIG.map.maxZoom);
}
