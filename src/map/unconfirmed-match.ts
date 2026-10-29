/**
 * The "Unconfirmed match" outline on the map modes: when the owner's curated
 * baseline names a reviewed CANDIDATE footprint for an illustration item
 * (association status 'approximate'), "Show the candidate on the map" frames
 * that building AND draws its footprint with a dashed outline labelled
 * "Unconfirmed match". It is never the selection, never routed to and never
 * presented as the item's location: the dash and the label say so on the map
 * itself, not only in the toast.
 *
 * A runtime source + two layers on top of the style (added only while a
 * candidate is shown, removed afterwards), so the base style is untouched.
 */
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { LineLayerSpecification, Map as MapLibreMap, SymbolLayerSpecification } from 'maplibre-gl';
import { FONT_BOLD } from './overlay-layers.ts';
import { MAP_THEME_COLORS, type MapTheme } from '../styles/index.ts';

export const UNCONFIRMED_SOURCE_ID = 'unconfirmed-match';
export const UNCONFIRMED_LAYER_IDS = {
  outline: 'unconfirmed-match-outline',
  label: 'unconfirmed-match-label',
} as const;

/** Design-token warning colours (src/styles/tokens.css --ds-warning), ≥ 3:1 on the map surfaces. */
export const UNCONFIRMED_COLORS: Readonly<Record<MapTheme, string>> = { light: '#8a5300', dark: '#facc15' };

/** What the map shows: the candidate footprint, labelled. */
export interface UnconfirmedMatchOverlay {
  buildingId: string;
  /** unconfirmedMatchLabel(): "Unconfirmed match: <the candidate's own map name>". */
  label: string;
}

/** The candidate's footprint from the buildings source, carrying the label (empty if it is not there). */
export function unconfirmedMatchCollection(
  buildings: FeatureCollection,
  overlay: UnconfirmedMatchOverlay | null,
): FeatureCollection {
  if (!overlay) return { type: 'FeatureCollection', features: [] };
  const found = buildings.features.find(
    (f) => (f.properties as { id?: unknown } | null)?.id === overlay.buildingId,
  );
  if (!found?.geometry) return { type: 'FeatureCollection', features: [] };
  const feature: Feature<Geometry> = {
    type: 'Feature',
    geometry: found.geometry,
    properties: { buildingId: overlay.buildingId, label: overlay.label },
  };
  return { type: 'FeatureCollection', features: [feature] };
}

export function unconfirmedMatchLayers(theme: MapTheme): [LineLayerSpecification, SymbolLayerSpecification] {
  const c = MAP_THEME_COLORS[theme];
  const color = UNCONFIRMED_COLORS[theme];
  return [
    {
      id: UNCONFIRMED_LAYER_IDS.outline,
      type: 'line',
      source: UNCONFIRMED_SOURCE_ID,
      paint: {
        'line-color': color,
        'line-width': ['interpolate', ['linear'], ['zoom'], 15, 2, 18, 3.5],
        // Dashed: a candidate, never the solid outline of a selection.
        'line-dasharray': [2, 1.5],
      },
    },
    {
      id: UNCONFIRMED_LAYER_IDS.label,
      type: 'symbol',
      source: UNCONFIRMED_SOURCE_ID,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': FONT_BOLD,
        'text-size': 13,
        'text-max-width': 12,
        // Always drawn: the label is what says "unconfirmed", so it must not be hidden by collisions.
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': c.labelText, 'text-halo-color': c.labelHalo, 'text-halo-width': 1.6 },
    },
  ];
}

type OverlayMap = Pick<
  MapLibreMap,
  'getSource' | 'addSource' | 'removeSource' | 'getLayer' | 'addLayer' | 'removeLayer'
>;

function removeOverlay(map: OverlayMap): void {
  for (const id of [UNCONFIRMED_LAYER_IDS.label, UNCONFIRMED_LAYER_IDS.outline])
    if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(UNCONFIRMED_SOURCE_ID)) map.removeSource(UNCONFIRMED_SOURCE_ID);
}

/**
 * Shows (or replaces, or with an empty collection removes) the overlay. The
 * layers are rebuilt on every call, so a theme change is a call with the new theme.
 */
export function applyUnconfirmedMatch(map: OverlayMap, theme: MapTheme, collection: FeatureCollection): void {
  removeOverlay(map);
  if (collection.features.length === 0) return;
  map.addSource(UNCONFIRMED_SOURCE_ID, { type: 'geojson', data: collection });
  for (const layer of unconfirmedMatchLayers(theme)) map.addLayer(layer);
}
