/**
 * Binds the HTTP layer's DomainPort to the domain barrel (server/domain/index.ts).
 * Listing every operation explicitly lets the compiler check each signature
 * against the port; the only translation is the typed suggestion filter.
 */
import * as artwork from '../domain/artwork/associations.ts';
import * as domain from '../domain/index.ts';
import * as studio from '../domain/studio/index.ts';
import type { ArtworkPort, DomainPort, Filter, StudioPort } from './ports.ts';

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export const domainAdapter: DomainPort = {
  createSuggestion: domain.createSuggestion,
  decoySuggestion: domain.decoySuggestion,
  listSuggestions: (db, f: Filter) =>
    domain.listSuggestions(db, {
      status: str(f.status),
      category: str(f.category),
      q: str(f.q),
      sort: str(f.sort),
      limit: num(f.limit),
      cursor: str(f.cursor),
    }),
  getSuggestion: domain.getSuggestion,
  editSuggestion: domain.editSuggestion,
  approveSuggestion: domain.approveSuggestion,
  rejectSuggestion: domain.rejectSuggestion,
  markDuplicate: domain.markDuplicate,
  requestInformation: domain.requestInformation,
  reopenSuggestion: domain.reopenSuggestion,

  listLocations: domain.listLocations,
  createLocation: domain.createLocation,
  updateLocation: domain.updateLocation,
  hideLocation: domain.hideLocation,
  restoreLocation: domain.restoreLocation,
  deleteLocation: domain.deleteLocation,

  listOverrides: domain.listOverrides,
  getOverride: domain.getOverride,
  putOverride: domain.putOverride,
  hideOverride: domain.hideOverride,
  unhideOverride: domain.unhideOverride,
  deleteOverride: domain.deleteOverride,

  revertAuditEvent: domain.revertAuditEvent,
  listAudit: domain.listAudit,

  getPublication: domain.getPublication,
  getPublicationVersion: domain.getPublicationVersion,
  getOverview: domain.getOverview,
  getQualityWarnings: domain.getQualityWarnings,
};

/** Building Studio operations (server/domain/studio). */
export const studioAdapter: StudioPort = {
  getLibrary: studio.getStudioLibrary,
  createTemplate: studio.createOwnerTemplate,
  updateTemplate: studio.updateOwnerTemplate,
  retireTemplate: studio.retireOwnerTemplate,
  unretireTemplate: studio.unretireOwnerTemplate,
  listBuildings: studio.listStudioBuildings,
  getBuilding: studio.getStudioBuilding,
  createBuilding: studio.createStudioBuilding,
  saveDraft: studio.saveStudioDraft,
  discardDraft: studio.discardStudioDraft,
  validate: studio.validateStudioRequest,
  publish: studio.publishStudioBuilding,
  archive: studio.archiveStudioBuilding,
  restore: studio.restoreStudioBuilding,
  deleteBuilding: studio.deleteStudioBuilding,
  duplicate: studio.duplicateStudioBuilding,
  applyTemplate: studio.applyStudioTemplate,
  getQuality: studio.getStudioQuality,
};

/** Artwork association verification (server/domain/artwork). */
export const artworkAdapter: ArtworkPort = {
  list: artwork.listArtworkAssociations,
  get: artwork.getArtworkAssociation,
  put: artwork.putArtworkAssociation,
  reset: artwork.resetArtworkAssociation,
};
