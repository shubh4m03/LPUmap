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
