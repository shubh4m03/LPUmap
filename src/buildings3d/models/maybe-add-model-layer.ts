/**
 * D3 seam: adds a GLB model layer only when the registry is non-empty AND a
 * loader is supplied. Today the registry is empty and no loader exists (the
 * module that would import `three` is deliberately not written until the D3
 * adoption gate passes), so this resolves to 'empty' and loads nothing.
 */
import type { CustomLayerInterface, Map as MapLibreMap } from 'maplibre-gl';
import { BUILDING_LAYER_IDS } from '../layers.ts';
import { MODEL_REGISTRY, type ModelEntry } from './registry.ts';

export type ModelHostMap = Pick<MapLibreMap, 'addLayer' | 'getLayer'>;

/** Builds the model layer (the only place that would import `three`). Not provided before D3 adoption. */
export type ModelLayerLoader = () => Promise<(registry: readonly ModelEntry[]) => CustomLayerInterface>;

export type ModelLayerOutcome = 'empty' | 'not-adopted' | 'added';

export async function maybeAddModelLayer(
  map: ModelHostMap,
  registry: readonly ModelEntry[] = MODEL_REGISTRY,
  loader: ModelLayerLoader | null = null,
): Promise<ModelLayerOutcome> {
  if (registry.length === 0) return 'empty';
  if (!loader) return 'not-adopted';
  const createModelLayer = await loader();
  const before = map.getLayer(BUILDING_LAYER_IDS.extrusion) ? BUILDING_LAYER_IDS.extrusion : undefined;
  map.addLayer(createModelLayer(registry), before);
  return 'added';
}
