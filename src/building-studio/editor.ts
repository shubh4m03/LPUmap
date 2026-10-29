/**
 * src/building-studio — the editor entry (docs/BUILDING_STUDIO_DESIGN.md §14):
 * the owner's editing core — template library, editor state and history, crash
 * recovery, geometry tools, template compatibility, validation and thumbnails.
 * Used by the Studio UI, the admin and the server; never by the public map, so
 * none of it reaches the public chunks or the service-worker precache (G-19).
 * The published-record contract and what the map draws are ./index.ts.
 */
export {
  LIBRARY_CATEGORY_LABELS,
  STARTER_TEMPLATE_VERSIONS,
  modelFromVariant,
  renderCostForFaces,
  searchLibrary,
  starterLibrary,
  starterTemplate,
} from './asset-library.ts';
export type { LibraryEntry } from './asset-library.ts';
export {
  currentDraft,
  editorReducer,
  editorStatus,
  initialEditorState,
  publishBlockers,
  shouldGuardUnload,
} from './editor-state.ts';
export type {
  EditorAction,
  EditorState,
  EditorStatus,
  PlacementPreview,
  PublishBlocker,
  ServerOp,
  StatusKind,
  StudioTool,
} from './editor-state.ts';
export {
  NUDGE_STEPS,
  anchorFromCoordinates,
  deriveFootprint,
  footprintPrismPlacement,
  moveByMetres,
  normalizeRotation,
  nudgeMove,
  proposeAngleSnap,
  proposeEdgeAlignment,
  proposeGuideFit,
  resizeModel,
  rotateBy,
  rotateToEnu,
  setRotation,
} from './geometry.ts';
export type { Compass, DimensionField, SnapProposal } from './geometry.ts';
export { canRedo, canUndo, currentMarker, initHistory, nextLabels } from './history.ts';
export {
  LOCAL_RECOVERY_LABEL,
  clearAllRecovery,
  clearRecovery,
  loadRecovery,
  recoveryKey,
  saveRecovery,
} from './local-recovery.ts';
export type { RecoveryEntry, RecoveryStorage } from './local-recovery.ts';
export { applyTemplateVersion, changedPaths, templateAvailability } from './template-compat.ts';
export { modelThumbnailSvg, templateThumbnailSvg } from './thumbnails.ts';
export {
  membershipForPublish,
  polygonCoordsOf,
  studioFootprintFor,
  validateStudioDraft,
  validationResult,
} from './validate.ts';
