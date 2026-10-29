/**
 * src/building-studio — public entry of the Studio core (docs/BUILDING_STUDIO_DESIGN.md §14):
 * the published-record schema and text rules, labels, procedural meshes, the
 * footprint frame, the merge into the campus data and the server port — what
 * the public map, the server and the other modules need. Pure: no React,
 * MapLibre or DOM. The owner's editing core is the second entry, ./editor.ts;
 * the Studio UI (./ui/index.ts) and the MapLibre renderer
 * (./render/maplibre/index.ts) are separate public entries in the view layer.
 */
export { jsonEqual } from './canonical.ts';
export { createEnuFrame, lngLatToLocalPolygon } from './footprint.ts';
export { studioPublicLabel } from './labels.ts';
export { UNNAMED_STUDIO_BUILDING, mergeStudioBuildings } from './merge.ts';
export type { StudioCampusData, StudioMergeReport, StudioRenderModel } from './merge.ts';
export { fallbackPrismMesh, generateStudioMesh, generateStudioMeshDetailed } from './mesh/generate.ts';
export { faceVertices, triangulateFace } from './mesh/triangulate.ts';
export type { MaterialSlot, StudioFace, StudioMesh, Vec2, Vec3, WindowGrid } from './mesh/types.ts';
export { pointToPolygonM } from './planar.ts';
export * from './schema.ts';
export type {
  StudioRevisionBody,
  StudioServerApi,
  StudioServerFailure,
  StudioServerResult,
} from './server-api.ts';
export {
  MARK_FLOOD_MESSAGE,
  PROHIBITED_SOURCE_MESSAGE,
  containsProhibitedSourceUrl,
  hasCombiningMarkFlood,
  hasControlChars,
  hasInvisibleNameChars,
  isProhibitedSourceUrl,
} from './text.ts';
