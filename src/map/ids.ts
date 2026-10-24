/** Source and layer ids shared by the style builders, MapView and tests. */
import { BUILDINGS_SOURCE_ID, BUILDING_LAYER_IDS } from '../buildings3d/index.ts';

export const SOURCE_IDS = {
  boundary: 'campus-boundary',
  basemap: 'basemap',
  buildings: BUILDINGS_SOURCE_ID,
  places: 'places',
  route: 'route',
  userLocation: 'user-location',
} as const;

export const LAYER_IDS = {
  background: 'background',
  campusFill: 'campus-fill',
  landuse: 'landuse',
  green: 'green',
  waterFill: 'water-fill',
  waterLine: 'water-line',
  pitch: 'pitch',
  parking: 'parking',
  serviceCasing: 'service-casing',
  roadCasing: 'road-casing',
  roadMajorCasing: 'road-major-casing',
  service: 'service',
  road: 'road',
  roadMajor: 'road-major',
  path: 'path',
  steps: 'steps',
  campusOutline: 'campus-outline',
  buildingFill: BUILDING_LAYER_IDS.fill,
  buildingOutline: BUILDING_LAYER_IDS.outline,
  buildingExtrusion: BUILDING_LAYER_IDS.extrusion,
  studioPick: BUILDING_LAYER_IDS.studioPick,
  routeAlternative: 'route-alternative',
  routeCasing: 'route-casing',
  routeCompleted: 'route-completed',
  routeLine: 'route-line',
  userAccuracyFill: 'user-accuracy-fill',
  userAccuracyOutline: 'user-accuracy-outline',
  poiCircle: 'poi-circle',
  labelRoad: 'label-road',
  labelPoi: 'label-poi',
  labelBuilding: 'label-building',
  userHalo: 'user-halo',
  userDot: 'user-dot',
} as const;

export const LABEL_LAYER_IDS = [LAYER_IDS.labelRoad, LAYER_IDS.labelPoi, LAYER_IDS.labelBuilding] as const;

/** Layers filtered by the layer-panel groups. */
export const GROUP_FILTERED_LAYER_IDS = [LAYER_IDS.poiCircle, LAYER_IDS.labelPoi] as const;

/** Clickable layers, highest priority first. */
export const POI_LAYER_IDS = [LAYER_IDS.poiCircle] as const;
/** Studio models are picked through their invisible footprint extrusion, never the custom layer (S1). */
export const BUILDING_PICK_LAYER_IDS = [
  LAYER_IDS.buildingExtrusion,
  LAYER_IDS.studioPick,
  LAYER_IDS.buildingFill,
] as const;
