import type { Map as MapLibreMap, PointLike } from 'maplibre-gl';
import { BUILDING_PICK_LAYER_IDS, POI_LAYER_IDS } from './ids.ts';

export type PickMap = Pick<MapLibreMap, 'queryRenderedFeatures' | 'getLayer'>;

/** Extra hit area around point markers so they are tappable on touch screens. */
export const POI_HIT_TOLERANCE_PX = 8;

function existing(map: PickMap, ids: readonly string[]): string[] {
  return ids.filter((id) => map.getLayer(id) !== undefined);
}

function firstId(features: ReturnType<PickMap['queryRenderedFeatures']>): string | null {
  for (const f of features) {
    const id: unknown = f.properties?.id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return null;
}

/** Place id under a screen point: POI markers win over the building beneath them. */
export function pickPlaceId(map: PickMap, point: { x: number; y: number }): string | null {
  const poiLayers = existing(map, POI_LAYER_IDS);
  if (poiLayers.length > 0) {
    const t = POI_HIT_TOLERANCE_PX;
    const box: [PointLike, PointLike] = [
      [point.x - t, point.y - t],
      [point.x + t, point.y + t],
    ];
    const id = firstId(map.queryRenderedFeatures(box, { layers: poiLayers }));
    if (id) return id;
  }
  const buildingLayers = existing(map, BUILDING_PICK_LAYER_IDS);
  if (buildingLayers.length === 0) return null;
  return firstId(map.queryRenderedFeatures([point.x, point.y], { layers: buildingLayers }));
}

/** Unique ids of buildings currently rendered (flat or extruded), sorted. */
export function renderedBuildingIds(map: PickMap): string[] {
  const layers = existing(map, BUILDING_PICK_LAYER_IDS);
  if (layers.length === 0) return [];
  const ids = new Set<string>();
  for (const f of map.queryRenderedFeatures({ layers })) {
    const id: unknown = f.properties?.id;
    if (typeof id === 'string') ids.add(id);
  }
  return [...ids].sort();
}
