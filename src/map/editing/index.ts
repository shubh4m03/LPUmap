export type {
  EditHandle,
  EditHandleKind,
  EditInputMode,
  EditPointerEvent,
  EditPreviewCollection,
  EditPreviewFeature,
  EditPreviewProperties,
  EditPreviewRole,
  HandleDragEvent,
  HandleDragPhase,
  MapEditingProps,
  MapInteractionPolicy,
  ResizeAxis,
} from './types.ts';
export { EDIT_PREVIEW_ROLES, mapInteractionPolicy } from './types.ts';
export { createEditingController, HANDLE_HIT_TOLERANCE_PX } from './controller.ts';
export type { EditingController, EditingMap } from './controller.ts';
export { EDIT_COLORS, EDIT_LAYER_IDS, EDIT_SOURCE_IDS, editLayers, handleCollection } from './layers.ts';
