/**
 * Building Studio domain entry point (docs/BUILDING_STUDIO_DESIGN.md §7–§12).
 * Every function takes the database first and a StudioContext
 * `{ now, actor, studio, ids?, validate?, library? }`; writes are audited
 * (success in the same batch as the change, rejected/failed afterwards) and
 * bump publication_version whenever the public `buildings` list changes.
 */
export type {
  StudioContext,
  StudioValidator,
  CodeTemplateLibrary,
  ServerValidationContext,
} from './context.ts';
export {
  getStudioBuilding,
  listStudioBuildings,
  createStudioBuilding,
  saveStudioDraft,
  discardStudioDraft,
  validateStudioRequest,
  publishStudioBuilding,
  archiveStudioBuilding,
  restoreStudioBuilding,
  deleteStudioBuilding,
  duplicateStudioBuilding,
  applyStudioTemplate,
  changedPaths,
  UNNAMED_STUDIO_TITLE,
} from './buildings.ts';
export {
  getStudioLibrary,
  createOwnerTemplate,
  updateOwnerTemplate,
  retireOwnerTemplate,
  unretireOwnerTemplate,
  resolveTemplateDefinition,
  renderCostOf,
} from './templates.ts';
export { getStudioQuality } from './quality.ts';
export { membershipFor, storedFootprintOf, publishedStudioBuildings, safetyNetIssues } from './engine.ts';
export { readDraft, toHead, toPublishedStudioBuilding, toPublishedVersion } from './records.ts';
