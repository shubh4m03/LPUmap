/**
 * The two opt-in layers that are never part of the campus inventory
 * (APP_CONFIG.optionalLayers, both off by default):
 *
 * - "Unverified detected footprints": machine-detected outlines from
 *   detections.geojson, drawn FLAT with a dashed outline (polygons) or a
 *   hollow ring (Google Open Buildings points, which have no polygon). Never
 *   extruded, never pickable, never searched, routed or keyed. While it is
 *   shown its source carries the Microsoft (CDLA Permissive 2.0) and Google
 *   Open Buildings (ODbL) attribution, so the map's attribution control lists
 *   them; hiding the layer removes the source and with it the attribution.
 * - "Nearby, outside campus": off-campus places come through the places
 *   source (poiCollection with includeOffCampus); this module adds the
 *   "Outside campus" badge under each of their markers.
 */
import type { GeoJSON } from 'geojson';
import type {
  CircleLayerSpecification,
  FillLayerSpecification,
  FilterSpecification,
  LineLayerSpecification,
  Map as MapLibreMap,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import { APP_CONFIG } from '../config/index.ts';
import type { DetectionsFile, SourceRecord } from '../data/schema.ts';
import { DETECTION_MANIFEST_SOURCE_IDS } from '../data/schema.ts';
import type { MapTheme } from '../map/theme-colors.ts';
import { safeExternalUrl } from '../utils/safe-url.ts';
import { BUILDING_LAYER_IDS } from './layers.ts';
import { realistic3dColors } from './palette.ts';

export const DETECTIONS_SOURCE_ID = 'detections';

export const OPTIONAL_LAYER_IDS = {
  detectionFill: 'detection-fill',
  detectionOutline: 'detection-outline',
  detectionPoint: 'detection-point',
  outsideBadge: 'poi-outside-badge',
} as const;

const DETECTION_LAYER_IDS = [
  OPTIONAL_LAYER_IDS.detectionFill,
  OPTIONAL_LAYER_IDS.detectionOutline,
  OPTIONAL_LAYER_IDS.detectionPoint,
] as const;

/** Places source (owned by src/map/ids.ts; repeated here to avoid an import cycle). */
const PLACES_SOURCE_ID = 'places';
const POI_MIN_ZOOM = 14;

export function detectionLayers(
  theme: MapTheme,
): Array<FillLayerSpecification | LineLayerSpecification | CircleLayerSpecification> {
  const r = realistic3dColors(theme);
  const polygon: FilterSpecification = ['==', ['geometry-type'], 'Polygon'];
  return [
    {
      id: OPTIONAL_LAYER_IDS.detectionFill,
      type: 'fill',
      source: DETECTIONS_SOURCE_ID,
      filter: polygon,
      paint: { 'fill-color': r.detectionFill, 'fill-opacity': 0.08 },
    },
    {
      id: OPTIONAL_LAYER_IDS.detectionOutline,
      type: 'line',
      source: DETECTIONS_SOURCE_ID,
      filter: polygon,
      paint: {
        'line-color': r.detectionOutline,
        'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1, 18, 2],
        'line-dasharray': [2, 1.5],
      },
    },
    {
      // Google Open Buildings ships points (no polygon): a hollow ring, never a shape.
      id: OPTIONAL_LAYER_IDS.detectionPoint,
      type: 'circle',
      source: DETECTIONS_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 3, 18, 6],
        'circle-color': r.detectionFill,
        'circle-opacity': 0.08,
        'circle-stroke-color': r.detectionOutline,
        'circle-stroke-width': 1.5,
      },
    },
  ];
}

export function outsideBadgeLayer(theme: MapTheme): SymbolLayerSpecification {
  const r = realistic3dColors(theme);
  return {
    id: OPTIONAL_LAYER_IDS.outsideBadge,
    type: 'symbol',
    source: PLACES_SOURCE_ID,
    minzoom: POI_MIN_ZOOM + 1,
    filter: ['==', ['get', 'offCampus'], true],
    layout: {
      'text-field': ['coalesce', ['get', 'badge'], APP_CONFIG.optionalLayers.nearbyOutsideCampus.badge],
      'text-font': ['Noto Sans Regular'],
      'text-size': 10,
      'text-anchor': 'top',
      'text-offset': [0, 0.9],
      'text-optional': true,
    },
    paint: { 'text-color': r.badgeText, 'text-halo-color': r.badgeHalo, 'text-halo-width': 1.5 },
  };
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );

/**
 * Attribution HTML for the detection sources, built from manifest records
 * (never hard-coded): each source's attribution text, linked to its licence
 * URL (else its URL) when that is a safe http(s) link.
 */
export function detectionAttributionHtml(sources: readonly SourceRecord[]): string {
  const parts: string[] = [];
  for (const id of Object.values(DETECTION_MANIFEST_SOURCE_IDS)) {
    const s = sources.find((x) => x.id === id);
    if (!s) continue;
    const text = escapeHtml(s.attribution ?? `${s.name}${s.license ? ` (${s.license})` : ''}`);
    const href = safeExternalUrl(s.licenseUrl) ?? safeExternalUrl(s.url);
    parts.push(
      href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text,
    );
  }
  return parts.join(' · ');
}

/** The map surface the optional layers need. */
export type OptionalLayersMap = Pick<
  MapLibreMap,
  'addSource' | 'removeSource' | 'getSource' | 'addLayer' | 'removeLayer' | 'getLayer' | 'setPaintProperty'
>;

/**
 * Shows or hides the detections layer. Showing adds the source (with
 * attribution) and layers just above the flat building footprints, below
 * the extrusions; hiding removes both, so the attribution disappears too.
 */
export function setDetectionsLayer(
  map: OptionalLayersMap,
  visible: boolean,
  data: DetectionsFile | null,
  attribution: string,
  theme: MapTheme,
): void {
  for (const id of DETECTION_LAYER_IDS) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(DETECTIONS_SOURCE_ID)) map.removeSource(DETECTIONS_SOURCE_ID);
  if (!visible || !data) return;
  // The schema types MultiPolygon coordinates loosely; the file was validated on load.
  map.addSource(DETECTIONS_SOURCE_ID, { type: 'geojson', data: data as unknown as GeoJSON, attribution });
  const before = map.getLayer(BUILDING_LAYER_IDS.extrusion) ? BUILDING_LAYER_IDS.extrusion : undefined;
  for (const layer of detectionLayers(theme)) map.addLayer(layer, before);
}

/** Shows or hides the "Outside campus" badges (the markers themselves come from the places source). */
export function setOutsideBadgeLayer(map: OptionalLayersMap, visible: boolean, theme: MapTheme): void {
  if (map.getLayer(OPTIONAL_LAYER_IDS.outsideBadge)) map.removeLayer(OPTIONAL_LAYER_IDS.outsideBadge);
  if (visible && map.getSource(PLACES_SOURCE_ID)) map.addLayer(outsideBadgeLayer(theme));
}

/** Re-applies theme colours to whichever optional layers are present. */
export function applyOptionalLayersTheme(map: OptionalLayersMap, theme: MapTheme): void {
  const set = map.setPaintProperty.bind(map) as (layer: string, name: string, value: unknown) => void;
  const layers = [...detectionLayers(theme), outsideBadgeLayer(theme)];
  for (const layer of layers) {
    if (!map.getLayer(layer.id) || !layer.paint) continue;
    for (const [name, value] of Object.entries(layer.paint)) set(layer.id, name, value);
  }
}
