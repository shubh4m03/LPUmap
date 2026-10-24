/**
 * Map providers (docs/MAP_PROVIDER_CONFIGURATION.md §Modes): free sources only.
 * This entry has no MapLibre dependency; the MapLibre wiring is
 * ./imagery-layer.ts, imported by MapView only.
 */
export * from './types.ts';
export { parseProviderEnv, type ProviderConfig, type ProviderEnv } from './config.ts';
export { esriWorldImagery, ESRI_IMAGERY_DATE, ESRI_ORIGIN, ESRI_PROVIDER_ID } from './esri.ts';
export { eoxSentinel2016, EOX_NOTICE, EOX_ORIGIN, EOX_PROVIDER_ID } from './eox.ts';
export {
  capabilityReport,
  createProviderRegistry,
  HEALTHY_RUNTIME,
  IMAGERY_ORIGINS,
  imageryForMode,
  imageryStatus,
  primaryImagery,
  viewModeAvailability,
  type ImageryRuntime,
} from './registry.ts';
export { classifyImageryError, classifyProbeResponse, ImageryHealth, probeImagery } from './failure.ts';
export { attributionHtml, attributionText, imageryDateLine, safeHref } from './attribution.ts';
export {
  boundsIntersect,
  boundsOfPolygons,
  campusOutOfView,
  MAX_PITCH,
  polygonsOf,
  polygonsTouchBounds,
  type Bounds,
  type CameraView,
  type PolygonRings,
} from './camera.ts';
export { BUILD_PROVIDER_CONFIG, BUILD_PROVIDERS, BUILD_VIEW_MODE_AVAILABILITY } from './runtime.ts';
