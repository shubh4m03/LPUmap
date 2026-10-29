/**
 * src/isometric-art — contracts for the owner-supplied campus illustration
 * (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md). Pure; no rendering here.
 */
export * from './schema.ts';
export { mergeArtworkAssociations } from './associations.ts';
export type {
  ArtworkAssociationIssue,
  ArtworkAssociationIssueCode,
  EffectiveArtworkAssociation,
  MergeArtworkAssociationsInput,
  MergedArtworkAssociations,
} from './associations.ts';
export { ARTWORK_NOT_ROUTABLE_NOTE, createArtworkDirectory } from './directory.ts';
export type {
  ArtworkDirectory,
  ArtworkJoin,
  ArtworkLabelRole,
  ArtworkLabelView,
  ArtworkOnlyEntry,
  ArtworkSearchHit,
} from './directory.ts';
export {
  ARTWORK_MANIFEST_URL,
  ARTWORK_UNAVAILABLE_REASON,
  artworkUrl,
  loadIsometricArtManifest,
  type ArtworkFetch,
  type ManifestLoadResult,
} from './manifest-loader.ts';
export { artworkNumberQuery, compareArtworkNumbers } from './directory.ts';
export { hitTestHotspots, prepareHotspots, svgPoints, unionBBox } from './hotspot-geometry.ts';
export { buildArtModel, hotspotsOfSubject, legendLabels, subjectsForSelection } from './hotspot-model.ts';
export type { ArtModel, ArtSubjectView } from './hotspot-model.ts';
export { artImageSources, planArtImages } from './image-plan.ts';
export type { ArtImageLayer, ArtImagePurpose } from './image-plan.ts';
export {
  ASSOCIATION_STATUS_TEXT,
  BUILDING_VERIFIED_ARTWORK_TEXT,
  publicReasonText,
  unconfirmedMatchLabel,
} from './text.ts';
export type { AssociationStatusName, StatusText } from './text.ts';
export {
  clampTransform,
  frameRect,
  gestureTransform,
  initialTransform,
  innerRect,
  interpolateTransform,
  isRectVisible,
  panBy,
  resizeTransform,
  sameTransform,
  scaleLimits,
  screenToSource,
  snapToDevicePixels,
  transformCss,
  visibleSourceRect,
  zoomAbout,
} from './viewport.ts';
export type {
  ArtInsets,
  ArtPoint,
  ArtRect,
  ArtSourceSpace,
  ArtTransform,
  ArtViewportSize,
} from './viewport.ts';
