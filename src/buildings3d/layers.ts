/**
 * Building layers: flat footprints (2D) and native MapLibre fill-extrusion
 * (3D). Native extrusion renders every footprint as a lit 3D prism in the same
 * WebGL pass as the basemap, which satisfies the 3D-buildings requirement
 * without a second renderer such as Three.js (no extra bundle weight, no
 * camera synchronisation, picking and feature-state for free).
 */
import type {
  ExpressionSpecification,
  FillExtrusionLayerSpecification,
  FillLayerSpecification,
  LineLayerSpecification,
} from 'maplibre-gl';
import { APP_CONFIG } from '../config/index.ts';
import type { HeightSource } from '../data/schema.ts';
import { mapThemeColors, type MapTheme, type MapThemeColors } from '../map/theme-colors.ts';

export const BUILDINGS_SOURCE_ID = 'buildings';

export const BUILDING_LAYER_IDS = {
  fill: 'building-fill',
  outline: 'building-outline',
  extrusion: 'building-extrusion',
} as const;

export interface BuildingLayerOptions {
  sourceId?: string;
  /** Initial mode; setBuildingMode() switches it later without rebuilding the style. */
  mode3d?: boolean;
  minzoom?: number;
}

const SELECTED: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false];

/** Extrusion colour per heightSource, so placeholder heights are visibly different from data. */
export function extrusionColorExpression(c: MapThemeColors): ExpressionSpecification {
  return [
    'case',
    SELECTED,
    c.selected,
    [
      'match',
      ['get', 'heightSource'],
      'osm-height',
      c.extrusionMeasured,
      'osm-levels-estimate',
      c.extrusionEstimated,
      c.extrusionUnknown,
    ],
  ];
}

export function buildingExtrusionLayers(
  theme: MapTheme,
  opts: BuildingLayerOptions = {},
): FillExtrusionLayerSpecification[] {
  const c = mapThemeColors(theme);
  return [
    {
      id: BUILDING_LAYER_IDS.extrusion,
      type: 'fill-extrusion',
      source: opts.sourceId ?? BUILDINGS_SOURCE_ID,
      minzoom: opts.minzoom ?? APP_CONFIG.map.extrusionMinZoom,
      layout: { visibility: opts.mode3d ? 'visible' : 'none' },
      paint: {
        'fill-extrusion-color': extrusionColorExpression(c),
        'fill-extrusion-height': ['get', 'heightM'],
        'fill-extrusion-base': ['get', 'minHeightM'],
        'fill-extrusion-opacity': 0.92,
        'fill-extrusion-vertical-gradient': true,
      },
    },
  ];
}

/**
 * Max zoom of the flat fill. In 3D the flat fill only covers zooms where
 * extrusions are hidden by their minzoom; in 2D it is shown at every zoom.
 */
export function flatFillMaxZoom(mode3d: boolean): number {
  return mode3d ? APP_CONFIG.map.extrusionMinZoom : 24;
}

export function buildingFootprintLayers(
  theme: MapTheme,
  opts: BuildingLayerOptions = {},
): Array<FillLayerSpecification | LineLayerSpecification> {
  const c = mapThemeColors(theme);
  const source = opts.sourceId ?? BUILDINGS_SOURCE_ID;
  return [
    {
      id: BUILDING_LAYER_IDS.fill,
      type: 'fill',
      source,
      maxzoom: flatFillMaxZoom(opts.mode3d ?? false),
      paint: {
        'fill-color': ['case', SELECTED, c.selected, c.buildingFill],
        'fill-opacity': ['case', SELECTED, 0.85, 1],
      },
    },
    {
      id: BUILDING_LAYER_IDS.outline,
      type: 'line',
      source,
      minzoom: 15,
      paint: {
        'line-color': ['case', SELECTED, c.selectedOutline, c.buildingOutline],
        'line-width': ['case', SELECTED, 2, 0.75],
      },
    },
  ];
}

export interface BuildingLegendEntry {
  heightSource: HeightSource;
  label: string;
  description: string;
  color: string;
}

export function buildingLegend(theme: MapTheme): BuildingLegendEntry[] {
  const c = mapThemeColors(theme);
  return [
    {
      heightSource: 'osm-height',
      label: 'Measured height',
      description: 'Height taken from the OpenStreetMap height tag.',
      color: c.extrusionMeasured,
    },
    {
      heightSource: 'osm-levels-estimate',
      label: 'Estimated from floor count',
      description: `Mapped floor count × ${APP_CONFIG.map.metresPerLevel} m per floor — an estimate, not a measurement.`,
      color: c.extrusionEstimated,
    },
    {
      heightSource: 'fallback',
      label: 'Height unknown (placeholder)',
      description: `No height or floor count is mapped; drawn at a placeholder ${APP_CONFIG.map.fallbackBuildingHeightM} m.`,
      color: c.extrusionUnknown,
    },
  ];
}
