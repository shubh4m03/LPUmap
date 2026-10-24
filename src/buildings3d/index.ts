export { supportsWebGL, resetWebGLSupportCache } from './webgl.ts';
export {
  BUILDINGS_SOURCE_ID,
  BUILDING_LAYER_IDS,
  STUDIO_HEIGHT_SOURCE,
  UNVERIFIED_MODEL_LABEL,
  buildingExtrusionLayers,
  buildingFootprintLayers,
  buildingLegend,
  extrusionColorExpression,
  extrusionFilter,
  flatFillMaxZoom,
  studioPickLayer,
  type BuildingLayerOptions,
  type BuildingLegendEntry,
  type BuildingLegendKey,
  type BuildingLegendOptions,
} from './layers.ts';
export { setBuildingMode, MODE_TRANSITION_MS, type BuildingModeMap } from './mode.ts';
export {
  LIGHT_AZIMUTH_DEG,
  LIGHT_INTENSITY,
  LIGHT_POLAR_DEG,
  lightSpecification,
  realisticLight,
  type RealisticLight,
} from './lighting.ts';
export { REALISTIC_3D_COLORS, realistic3dColors, type Realistic3DColors } from './palette.ts';
// The realistic-3D controller (realistic3d.ts), optional layers, watchdog and the D3 model seam are
// imported by their module paths, not re-exported here: this barrel is in the startup chunk (AppShell
// uses supportsWebGL), and re-exporting them would pull map-only code into it.
