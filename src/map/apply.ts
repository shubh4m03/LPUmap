/**
 * Incremental updates to a live map. Each function changes only what its
 * prop affects, so a theme, filter or data change never rebuilds the style.
 */
import type { GeoJSON } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { LayerGroupId } from '../config/index.ts';
import { GROUP_FILTERED_LAYER_IDS, LABEL_LAYER_IDS, LAYER_IDS, SOURCE_IDS } from './ids.ts';
import { groupFilter, labelVisibility, poiLabelFilter } from './overlay-layers.ts';
import { buildLayers } from './style.ts';
import type { MapTheme } from '../styles/index.ts';

export type ApplyMap = Pick<
  MapLibreMap,
  | 'getLayer'
  | 'getSource'
  | 'setPaintProperty'
  | 'setLayoutProperty'
  | 'setFilter'
  | 'setFeatureState'
  | 'removeFeatureState'
>;

type PaintSetter = (layerId: string, name: string, value: unknown) => void;

/**
 * Re-applies every paint property for `theme`; sources, filters and layout
 * stay untouched. Paint values depend only on the theme, so the other layer
 * options are irrelevant here.
 */
export function applyTheme(map: ApplyMap, theme: MapTheme): void {
  const setPaint = map.setPaintProperty.bind(map) as unknown as PaintSetter;
  for (const layer of buildLayers({ theme, mode3d: false, visibleGroups: new Set(), showLabels: true })) {
    if (!layer.paint || !map.getLayer(layer.id)) continue;
    for (const [name, value] of Object.entries(layer.paint)) setPaint(layer.id, name, value);
  }
}

export function applyVisibleGroups(map: ApplyMap, groups: ReadonlySet<LayerGroupId>): void {
  for (const id of GROUP_FILTERED_LAYER_IDS) {
    if (!map.getLayer(id)) continue;
    map.setFilter(id, id === LAYER_IDS.labelPoi ? poiLabelFilter(groups) : groupFilter(groups));
  }
}

export function applyShowLabels(map: ApplyMap, show: boolean): void {
  for (const id of LABEL_LAYER_IDS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', labelVisibility(show));
  }
}

export function setSourceData(map: ApplyMap, sourceId: string, data: unknown): void {
  const source = map.getSource<GeoJSONSource>(sourceId);
  // setData returns a promise; failures surface through the map's `error` event.
  source?.setData(data as GeoJSON).catch(() => {});
}

export interface SelectionTarget {
  source: string;
  id: string;
}

/**
 * Which map feature represents the selected place: its own footprint, its own
 * marker, or — for a place with no marker of its own that the data says is
 * inside a building (e.g. a department) — that building's footprint.
 */
export function selectionTarget(
  placeId: string | null,
  idx: {
    footprintIds: ReadonlySet<string>;
    poiIds: ReadonlySet<string>;
    containingBuilding: ReadonlyMap<string, string>;
  },
): SelectionTarget | null {
  if (!placeId) return null;
  if (idx.footprintIds.has(placeId)) return { source: SOURCE_IDS.buildings, id: placeId };
  if (idx.poiIds.has(placeId)) return { source: SOURCE_IDS.places, id: placeId };
  const host = idx.containingBuilding.get(placeId);
  if (host && idx.footprintIds.has(host)) return { source: SOURCE_IDS.buildings, id: host };
  if (host && idx.poiIds.has(host)) return { source: SOURCE_IDS.places, id: host };
  return null;
}

export function applySelection(
  map: ApplyMap,
  prev: SelectionTarget | null,
  next: SelectionTarget | null,
): void {
  if (prev && (prev.source !== next?.source || prev.id !== next.id)) {
    map.removeFeatureState({ source: prev.source, id: prev.id }, 'selected');
  }
  if (next) map.setFeatureState({ source: next.source, id: next.id }, { selected: true });
}

/** Stable key for a group set so a new Set with the same members does not trigger work. */
export function groupsKey(groups: ReadonlySet<LayerGroupId>): string {
  return [...groups].sort().join('|');
}
