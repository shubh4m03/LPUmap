/**
 * src/geo — the campus boundary service (pure; shared by scripts/, the app,
 * server/ and admin). See docs/MODULE_CONTRACTS.md "v2 geographic contract".
 */
export {
  DEFAULT_CONTEXT_AREA,
  DEFAULT_MEMBERSHIP_THRESHOLDS,
  InvalidGeometryError,
  boundaryFromFeatureCollection,
  classifyFootprint,
  createBoundary,
  decisionSourceLabel,
  distanceToReviewGeometryM,
  geometryProblems,
  pointOnSurface,
  polygonAreaM2,
  validatePointLocation,
  vertexMeanAnchor,
} from './boundary.ts';
export type {
  CampusBoundary,
  ContextArea,
  FootprintInput,
  MembershipResult,
  MembershipThresholds,
  MultiPolygonCoords,
  PointValidation,
  PolygonCoords,
  PolygonalGeometry,
} from './boundary.ts';
