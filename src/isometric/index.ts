/**
 * src/isometric — the isometric overview (docs/ISOMETRIC_AND_3D_DESIGN.md §6,
 * Decision D4). Canvas2D only; never imports maplibre-gl. Nothing here reads the
 * app: src/app/IsoStage.tsx wires IsoView to the store, and the app loads it
 * lazily through src/app/IsoStudioStage.tsx.
 *
 * `isoStudioModel` (./studio.ts) is a second public entry, apart from this one,
 * so the overview chunk does not pull in the studio schema.
 */
export { IsoView } from './IsoView.tsx';
export type { IsoViewProps } from './IsoView.tsx';
export { createIsoController, FOCUS_PX_PER_M } from './iso-controller.ts';
export type { IsoController, IsoView as IsoViewState, IsoViewChange } from './iso-controller.ts';
export {
  createIsoProjection,
  createLocalFrame,
  defaultRotation,
  pxPerMetreForZoom,
  zoomForPxPerMetre,
} from './projection.ts';
export type { IsoProjection, IsoRotation, LocalFrame, ScreenTransform } from './projection.ts';
export { buildGround, buildIsoScene } from './scene.ts';
export type { IsoBuilding, IsoScene, IsoSceneInput, IsoStudioModel } from './scene.ts';
export { ISO_THEME_COLORS } from './iso-theme.ts';
export type { IsoTheme, IsoThemeColors } from './iso-theme.ts';
export { spokenMapKey } from './labels.ts';
export type { AtlasIsoTestHooks, IsoFrameStats } from './test-hooks.ts';
