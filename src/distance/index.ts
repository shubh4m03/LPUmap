export {
  EARTH_RADIUS_M,
  bearingDeg,
  createLocalProjection,
  destinationPoint,
  haversineM,
  isValidLngLat,
} from './geodesic.ts';
export type { LocalProjection } from './geodesic.ts';
export {
  cumulativeLengthsM,
  pointAtDistance,
  polylineLengthM,
  projectOntoPolyline,
  projectOntoPolylineRange,
  slicePolyline,
} from './polyline.ts';
export type { PolylineProjection } from './polyline.ts';
export { DEFAULT_GRID_CELL_SIZE_M, createGridIndex } from './spatial-index.ts';
export type { GridHit, GridIndex } from './spatial-index.ts';
export { UNKNOWN_LABEL, formatDistance, formatDuration, formatSpeed } from './format.ts';
