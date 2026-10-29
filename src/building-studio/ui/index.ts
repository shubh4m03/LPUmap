/**
 * src/building-studio/ui — public entry of the Studio UI state and actions
 * (docs/BUILDING_STUDIO_DESIGN.md §14), used by the admin's Studio screens.
 * Talks to the server only through the port it is given (../server-api.ts).
 */
export { createStudioActions } from './actions.ts';
export type { ApplyTemplatePreview, StudioActions } from './actions.ts';
export {
  APPEARANCE_PRESETS,
  DIMENSION_LABELS,
  STUDIO_CATEGORY_OPTIONS,
  applyPreset,
  categoryLabel,
  draftSchemaIssues,
  heightFloorsConflict,
  issuesAt,
  normalizeColour,
  outsidePublishRange,
  parseAliases,
  prohibitedSourceProblem,
  publishRangeText,
  roofOptions,
  walkableNodesNearFootprint,
  withRoofShape,
  withVerificationStatus,
  withWindowPattern,
} from './fields.ts';
export type { FootprintAccessCandidate } from './fields.ts';
export { applyHandleDrag, editHandles } from './handles.ts';
export type { HandleSet } from './handles.ts';
export { isoPreview } from './iso-preview.ts';
export {
  ACCURACY_LABELS,
  RENDER_COST_LABELS,
  builtInLibraryItems,
  libraryItems,
  variantDefaultsText,
  variantThumbnailUrl,
} from './library.ts';
export type { StudioLibraryItem } from './library.ts';
export { previewCollection, previewFootprint, previewRenderSource } from './preview.ts';
export { nearestBuildingOutline, nearestDetection } from './snap-targets.ts';
export {
  ACK_REASON_MAX,
  ACK_REASON_MIN,
  PUBLISH_BLOCKER_TEXT,
  checkTarget,
  createStudioStore,
  currentValidation,
  missingAcks,
  studioPublishBlockers,
  studioStatus,
  useStudio,
  validAckReason,
} from './store.ts';
export type { StudioStore, StudioUiState } from './store.ts';
export { RESOLVE_HINTS, SEVERITY_HEADINGS, changeList, fieldLabel, groupIssues, valueAt } from './text.ts';
