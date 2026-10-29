/**
 * Layers drawn above the buildings: route overlay, user location, POI
 * markers and labels. Order inside the returned array is the drawing order.
 */
import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  FillLayerSpecification,
  FilterSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import { APP_CONFIG } from '../config/index.ts';
import type { LayerGroupId } from '../config/index.ts';
import { LAYER_IDS, SOURCE_IDS } from './ids.ts';
import { mapThemeColors, type MapTheme } from '../styles/index.ts';

export const FONT_REGULAR = ['Noto Sans Regular'];
export const FONT_BOLD = ['Noto Sans Bold'];
export const POI_MIN_ZOOM = 14;

/** Lower keys are placed first and therefore win label collisions. */
export const LABEL_SORT_KEY = { building: 1, poi: 2, road: 3 } as const;

const SELECTED: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false];
const STALE: ExpressionSpecification = ['boolean', ['get', 'stale'], false];

/** POI filter: a marker is shown only when its category's layer group is visible. */
export function groupFilter(visibleGroups: ReadonlySet<LayerGroupId>): FilterSpecification {
  return ['in', ['get', 'group'], ['literal', [...visibleGroups].sort()]];
}

export function poiLabelFilter(visibleGroups: ReadonlySet<LayerGroupId>): FilterSpecification {
  return ['all', groupFilter(visibleGroups) as ExpressionSpecification, ['to-boolean', ['get', 'name']]];
}

export function labelVisibility(showLabels: boolean): 'visible' | 'none' {
  return showLabels ? 'visible' : 'none';
}

function routeWidth(z14: number, z18: number): ExpressionSpecification {
  return ['interpolate', ['exponential', 1.5], ['zoom'], 14, z14, 18, z18];
}

const ROLE = (role: string): FilterSpecification => ['==', ['get', 'role'], role];

export interface OverlayLayerOptions {
  visibleGroups: ReadonlySet<LayerGroupId>;
  showLabels: boolean;
}

type OverlaySpec =
  CircleLayerSpecification | FillLayerSpecification | LineLayerSpecification | SymbolLayerSpecification;

export function routeLayers(theme: MapTheme): LineLayerSpecification[] {
  const c = mapThemeColors(theme);
  const round = { 'line-join': 'round', 'line-cap': 'round' } as const;
  return [
    {
      id: LAYER_IDS.routeAlternative,
      type: 'line',
      source: SOURCE_IDS.route,
      filter: ROLE('alternative'),
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': c.routeAlternative,
        'line-width': routeWidth(3, 6),
        'line-opacity': 0.75,
        'line-dasharray': [1.5, 1.5],
      },
    },
    {
      id: LAYER_IDS.routeCasing,
      type: 'line',
      source: SOURCE_IDS.route,
      filter: ['in', ['get', 'role'], ['literal', ['completed', 'remaining']]],
      layout: round,
      paint: { 'line-color': c.routeCasing, 'line-width': routeWidth(7, 14) },
    },
    {
      id: LAYER_IDS.routeCompleted,
      type: 'line',
      source: SOURCE_IDS.route,
      filter: ROLE('completed'),
      layout: round,
      paint: { 'line-color': c.routeCompleted, 'line-width': routeWidth(4, 9) },
    },
    {
      id: LAYER_IDS.routeLine,
      type: 'line',
      source: SOURCE_IDS.route,
      filter: ROLE('remaining'),
      layout: round,
      paint: { 'line-color': c.routeLine, 'line-width': routeWidth(4.5, 10) },
    },
  ];
}

function userAccuracyLayers(theme: MapTheme): Array<FillLayerSpecification | LineLayerSpecification> {
  const c = mapThemeColors(theme);
  const color: ExpressionSpecification = ['case', STALE, c.userStale, c.userAccuracy];
  return [
    {
      id: LAYER_IDS.userAccuracyFill,
      type: 'fill',
      source: SOURCE_IDS.userLocation,
      filter: ROLE('accuracy'),
      paint: { 'fill-color': color, 'fill-opacity': 0.12 },
    },
    {
      id: LAYER_IDS.userAccuracyOutline,
      type: 'line',
      source: SOURCE_IDS.userLocation,
      filter: ROLE('accuracy'),
      paint: { 'line-color': color, 'line-opacity': 0.55, 'line-width': 1 },
    },
  ];
}

function userDotLayers(theme: MapTheme): CircleLayerSpecification[] {
  const c = mapThemeColors(theme);
  return [
    {
      id: LAYER_IDS.userHalo,
      type: 'circle',
      source: SOURCE_IDS.userLocation,
      filter: ROLE('position'),
      paint: {
        'circle-radius': 11,
        'circle-color': ['case', STALE, c.userStale, c.userDot],
        'circle-opacity': ['case', STALE, 0.12, 0.22],
      },
    },
    {
      id: LAYER_IDS.userDot,
      type: 'circle',
      source: SOURCE_IDS.userLocation,
      filter: ROLE('position'),
      paint: {
        'circle-radius': 6,
        'circle-color': ['case', STALE, c.userStale, c.userDot],
        'circle-stroke-color': c.userHalo,
        'circle-stroke-width': 2.5,
      },
    },
  ];
}

function poiCircleLayer(theme: MapTheme, opts: OverlayLayerOptions): CircleLayerSpecification {
  const c = mapThemeColors(theme);
  return {
    id: LAYER_IDS.poiCircle,
    type: 'circle',
    source: SOURCE_IDS.places,
    minzoom: POI_MIN_ZOOM,
    filter: groupFilter(opts.visibleGroups),
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        14,
        ['case', SELECTED, 6, 3.5],
        18,
        ['case', SELECTED, 10, 7],
      ],
      'circle-stroke-color': ['case', SELECTED, c.selectedOutline, c.poiStroke],
      'circle-stroke-width': ['case', SELECTED, 3, 1.5],
      'circle-opacity': ['case', ['boolean', ['get', 'offCampus'], false], 0.8, 1],
    },
  };
}

function labelPaint(theme: MapTheme, road = false): SymbolLayerSpecification['paint'] {
  const c = mapThemeColors(theme);
  return {
    'text-color': road ? c.roadLabelText : c.labelText,
    'text-halo-color': c.labelHalo,
    'text-halo-width': 1.5,
  };
}

function labelLayers(theme: MapTheme, opts: OverlayLayerOptions): SymbolLayerSpecification[] {
  const visibility = labelVisibility(opts.showLabels);
  const minzoom = APP_CONFIG.map.labelMinZoom;
  // Symbol placement runs top layer first, so the stack order (roads < POIs < buildings)
  // matches the sort-key priority below.
  return [
    {
      id: LAYER_IDS.labelRoad,
      type: 'symbol',
      source: SOURCE_IDS.basemap,
      minzoom,
      filter: [
        'all',
        ['in', ['get', 'layer'], ['literal', ['road-major', 'road', 'service']]],
        ['to-boolean', ['get', 'name']],
      ],
      layout: {
        visibility,
        'symbol-placement': 'line',
        'symbol-spacing': 350,
        'symbol-sort-key': LABEL_SORT_KEY.road,
        'text-field': ['get', 'name'],
        'text-font': FONT_REGULAR,
        'text-size': 11,
        'text-max-angle': 30,
        'text-padding': 4,
      },
      paint: labelPaint(theme, true),
    },
    {
      id: LAYER_IDS.labelPoi,
      type: 'symbol',
      source: SOURCE_IDS.places,
      minzoom,
      filter: poiLabelFilter(opts.visibleGroups),
      layout: {
        visibility,
        'symbol-sort-key': LABEL_SORT_KEY.poi,
        'text-field': ['get', 'name'],
        'text-font': FONT_REGULAR,
        'text-size': 12,
        'text-max-width': 9,
        'text-padding': 3,
        'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
        'text-radial-offset': 0.9,
        'text-justify': 'auto',
        // Markers are a separate circle layer (no sprite needed), so a colliding label
        // drops while its marker stays — what `text-optional` achieves for icon+text symbols.
      },
      paint: labelPaint(theme),
    },
    {
      id: LAYER_IDS.labelBuilding,
      type: 'symbol',
      source: SOURCE_IDS.buildings,
      minzoom,
      filter: ['to-boolean', ['get', 'name']],
      layout: {
        visibility,
        'symbol-sort-key': LABEL_SORT_KEY.building,
        'text-field': ['get', 'name'],
        'text-font': FONT_BOLD,
        'text-size': 12.5,
        'text-max-width': 8,
        'text-padding': 4,
      },
      paint: labelPaint(theme),
    },
  ];
}

/** Everything above the building layers, in drawing order. */
export function overlayLayers(theme: MapTheme, opts: OverlayLayerOptions): OverlaySpec[] {
  return [
    ...routeLayers(theme),
    ...userAccuracyLayers(theme),
    poiCircleLayer(theme, opts),
    ...labelLayers(theme, opts),
    ...userDotLayers(theme),
  ];
}
