/** Public entry point of the community module (see docs/COMMUNITY_MODULE_CONTRACTS.md). */
export * from './schema.ts';
export { mergePublication, OWNER_SOURCE, COMMUNITY_SOURCE } from './merge.ts';
export type { MergeIssue, MergeReport, MergeResult } from './merge.ts';
export {
  findPossibleDuplicates,
  nameSimilarity,
  keySimilarity,
  nameKey,
  SAME_CATEGORY_RADIUS_M,
  MAX_DUPLICATES,
} from './duplicates.ts';
export type { DuplicateOptions, DuplicateSource, DuplicateSubject } from './duplicates.ts';
export {
  boundaryPolygons,
  campusZoneFor,
  checkAccessNode,
  footNodeSet,
  insideContributionArea,
  pointInPolygons,
  pointInRing,
} from './geo.ts';
export type { AccessNodeCheck, PolygonRings } from './geo.ts';
