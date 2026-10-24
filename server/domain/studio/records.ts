/**
 * Pure record shapes of the Building Studio: the admin head/version views and
 * the PUBLIC record of publication v2. No validator, no I/O — the public
 * publication path (GET /api/locations) uses only this module.
 */
import {
  publishedStudioBuildingSchema,
  studioDraftSchema,
  studioFootprintSchema,
  studioPublicId,
  type PublishedStudioBuilding,
  type StudioBuildingHead,
  type StudioDraft,
  type StudioMembership,
  type StudioPublishedVersion,
} from '../../../src/building-studio/schema.ts';
import type { StudioBuildingRow, StudioVersionRow } from '../../db/studio-buildings.ts';

/** Stored draft → StudioDraft, or null when it no longer parses with this build's schema. */
export function readDraft(stored: unknown): StudioDraft | null {
  if (stored === null || stored === undefined) return null;
  const r = studioDraftSchema.safeParse(stored);
  return r.success ? r.data : null;
}

export function toHead(r: StudioBuildingRow): StudioBuildingHead {
  return {
    id: r.id,
    targetId: r.targetId,
    status: r.status,
    revision: r.revision,
    draftRevision: r.draftRevision,
    hasDraft: r.draft !== null,
    publishedVersion: r.publishedVersion,
    archivedAt: r.archivedAt,
    archiveReason: r.archiveReason,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedBy: r.updatedBy,
    updatedAt: r.updatedAt,
  };
}

/** Admin view of a stored version, or null when its record no longer parses with this build. */
export function toPublishedVersion(v: StudioVersionRow): StudioPublishedVersion | null {
  const record = readDraft(v.record);
  const footprint = studioFootprintSchema.safeParse(v.footprint);
  if (!record || !footprint.success) return null;
  const acks = Array.isArray(v.acknowledgements)
    ? (v.acknowledgements as StudioPublishedVersion['acknowledgements'])
    : [];
  return {
    version: v.version,
    record,
    footprint: footprint.data,
    footprintAreaM2: v.footprintAreaM2,
    membership: v.membership as StudioMembership,
    acknowledgements: acks,
    changeSummary: v.changeSummary,
    publishedBy: v.publishedBy,
    publishedAt: v.publishedAt,
  };
}

/**
 * Public shape of a stored version (publication v2): no notes, actors,
 * drafts, acknowledgements, validation or change summary. Built from the raw
 * record so a model this build cannot generate is still published as an
 * envelope (rendered as a prism), never dropped; anything that fails the
 * public schema is not published (null).
 */
export function toPublishedStudioBuilding(
  v: StudioVersionRow,
  targetId: string | null,
): PublishedStudioBuilding | null {
  const rec = (typeof v.record === 'object' && v.record !== null ? v.record : {}) as Record<string, unknown>;
  const identity =
    typeof rec.identity === 'object' && rec.identity !== null
      ? (() => {
          const { notes: _private, ...pub } = rec.identity as Record<string, unknown>;
          return pub;
        })()
      : null;
  const candidate = {
    id: v.buildingId,
    targetId,
    version: v.version,
    publishedAt: v.publishedAt,
    identity,
    verification: rec.verification,
    accuracyClass: v.accuracyClass,
    templateRef: rec.templateRef ?? null,
    model: rec.model,
    footprint: v.footprint,
    footprintAreaM2: v.footprintAreaM2,
    membership: v.membership,
    accessNodeId: rec.accessNodeId ?? null,
    positionCorrected: v.positionCorrected,
  };
  const r = publishedStudioBuildingSchema.safeParse(candidate);
  return r.success ? r.data : null;
}

/** The record's public id (URL, search, directory): the base id for a base model. */
export const publicIdOf = (r: { id: string; targetId: string | null }) => studioPublicId(r);
