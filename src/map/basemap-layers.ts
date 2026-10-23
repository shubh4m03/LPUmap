/**
 * Basemap layers drawn from our own GeoJSON (campus boundary + OSM-derived
 * basemap.geojson). No third-party tiles are involved.
 */
import type {
  BackgroundLayerSpecification,
  ExpressionSpecification,
  FillLayerSpecification,
  LineLayerSpecification,
} from 'maplibre-gl';
import type { BasemapLayer } from '../data/schema.ts';
import { LAYER_IDS, SOURCE_IDS } from './ids.ts';
import { mapThemeColors, type MapTheme } from './theme-colors.ts';

type BasemapLayerSpec = BackgroundLayerSpecification | FillLayerSpecification | LineLayerSpecification;

const IS_POLYGON: ExpressionSpecification = [
  'match',
  ['geometry-type'],
  ['Polygon', 'MultiPolygon'],
  true,
  false,
];
const IS_LINE: ExpressionSpecification = [
  'match',
  ['geometry-type'],
  ['LineString', 'MultiLineString'],
  true,
  false,
];

function ofLayer(layer: BasemapLayer, geometry: ExpressionSpecification): ExpressionSpecification {
  return ['all', ['==', ['get', 'layer'], layer], geometry];
}

/** Line width that scales exponentially with zoom, like real-world widths. */
function width(z14: number, z18: number): ExpressionSpecification {
  return ['interpolate', ['exponential', 1.6], ['zoom'], 14, z14, 18, z18];
}

function areaFill(id: string, layer: BasemapLayer, color: string, opacity = 1): FillLayerSpecification {
  return {
    id,
    type: 'fill',
    source: SOURCE_IDS.basemap,
    filter: ofLayer(layer, IS_POLYGON),
    paint: { 'fill-color': color, 'fill-opacity': opacity },
  };
}

function roadLine(
  id: string,
  layer: BasemapLayer,
  color: string,
  w: ExpressionSpecification,
  minzoom = 13,
): LineLayerSpecification {
  return {
    id,
    type: 'line',
    source: SOURCE_IDS.basemap,
    minzoom,
    filter: ofLayer(layer, IS_LINE),
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': color, 'line-width': w },
  };
}

export function basemapLayers(theme: MapTheme): BasemapLayerSpec[] {
  const c = mapThemeColors(theme);
  return [
    { id: LAYER_IDS.background, type: 'background', paint: { 'background-color': c.background } },
    {
      id: LAYER_IDS.campusFill,
      type: 'fill',
      source: SOURCE_IDS.boundary,
      paint: { 'fill-color': c.campusFill, 'fill-opacity': 0.9 },
    },
    areaFill(LAYER_IDS.landuse, 'landuse', c.landuse),
    areaFill(LAYER_IDS.green, 'green', c.green),
    areaFill(LAYER_IDS.waterFill, 'water', c.water),
    {
      id: LAYER_IDS.waterLine,
      type: 'line',
      source: SOURCE_IDS.basemap,
      filter: ofLayer('water', IS_LINE),
      paint: { 'line-color': c.water, 'line-width': width(1, 4) },
    },
    areaFill(LAYER_IDS.pitch, 'pitch', c.pitch),
    areaFill(LAYER_IDS.parking, 'parking', c.parking),
    // Casings first so every road fill sits above every casing at junctions.
    roadLine(LAYER_IDS.serviceCasing, 'service', c.roadCasing, width(2, 9), 15),
    roadLine(LAYER_IDS.roadCasing, 'road', c.roadCasing, width(3, 14)),
    roadLine(LAYER_IDS.roadMajorCasing, 'road-major', c.roadMajorCasing, width(4, 18)),
    roadLine(LAYER_IDS.service, 'service', c.service, width(1, 7), 15),
    roadLine(LAYER_IDS.road, 'road', c.road, width(2, 11.5)),
    roadLine(LAYER_IDS.roadMajor, 'road-major', c.roadMajor, width(3, 15)),
    {
      id: LAYER_IDS.path,
      type: 'line',
      source: SOURCE_IDS.basemap,
      minzoom: 14.5,
      filter: ofLayer('path', IS_LINE),
      layout: { 'line-join': 'round' },
      paint: { 'line-color': c.path, 'line-width': width(0.8, 2), 'line-dasharray': [2, 1.5] },
    },
    {
      id: LAYER_IDS.steps,
      type: 'line',
      source: SOURCE_IDS.basemap,
      minzoom: 15,
      filter: ofLayer('steps', IS_LINE),
      // Short thick dashes read as the rungs of a ladder: the cartographic convention for steps.
      paint: { 'line-color': c.steps, 'line-width': width(2, 5), 'line-dasharray': [0.4, 0.4] },
    },
    {
      id: LAYER_IDS.campusOutline,
      type: 'line',
      source: SOURCE_IDS.boundary,
      layout: { 'line-join': 'round' },
      paint: { 'line-color': c.campusOutline, 'line-width': width(1.2, 2.5), 'line-opacity': 0.7 },
    },
  ];
}
