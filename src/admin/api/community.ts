/**
 * Community admin endpoints (server/handlers/admin/routes.ts): overview,
 * quality, suggestions + moderation, owner/community locations, base-place
 * overrides, audit and revert. One function per route; bodies mirror the
 * server's request schemas (server/handlers/admin/schemas.ts), which strip
 * unknown keys and re-validate everything.
 *
 * Every write to an existing record sends the `revision` it was loaded at. A
 * 409 `conflict` carries the current record in `error.current` (and its
 * revision in `error.currentRevision`): show it, let the owner re-check their
 * edit, then retry with the new revision. Never retry automatically.
 */
import type { z } from 'zod';
import type {
  ContributionInput,
  OverrideFields,
  placeFieldsSchema,
  SuggestionStatus,
} from '../../community/index.ts';
import type { LngLat } from '../../data/index.ts';
import { seg, type AdminHttp, type AdminResult } from './http.ts';
import {
  approveResultSchema,
  auditListSchema,
  deleteLocationResultSchema,
  locationListSchema,
  locationRecordSchema,
  overrideDetailSchema,
  overrideListSchema,
  overrideWriteResultSchema,
  overviewSchema,
  qualityReportSchema,
  revertResultSchema,
  suggestionDetailSchema,
  suggestionListSchema,
  suggestionRecordSchema,
  type ApproveResult,
  type AuditEntityType,
  type AuditList,
  type LocationList,
  type LocationRecord,
  type OverrideDetail,
  type OverrideList,
  type OverrideWriteResult,
  type Overview,
  type QualityReport,
  type RevertResult,
  type SuggestionDetail,
  type SuggestionList,
  type SuggestionRecord,
} from './schemas.ts';

/**
 * An existing routing-graph node the owner asserts is the real way in. The
 * server checks it exists, is walkable and is close enough; it never picks one.
 */
export interface AccessPointInput {
  nodeId: number;
  note?: string;
}

/** Place fields as sent (wheelchair / verificationStatus default on the server). */
export type PlaceFieldsInput = z.input<typeof placeFieldsSchema>;

export interface SuggestionsQuery {
  status?: SuggestionStatus;
  category?: string;
  q?: string;
  sort?: 'created_desc' | 'created_asc';
  limit?: number;
  cursor?: string;
}

/** Pre-approval edit: absent = keep, null = clear (optional fields only). */
export interface EditSuggestionBody {
  revision: number;
  fields: {
    name?: string;
    categoryId?: string;
    location?: LngLat;
    description?: string | null;
    landmark?: string | null;
    evidenceUrl?: string | null;
    details?: string | null;
  };
}

/** Owner corrections are partial; the server validates the FINAL merged record. */
export interface ApproveBody {
  revision: number;
  fields?: OverrideFields;
  /** Optional; without it the new location is not routable (never auto-snapped). */
  accessPoint?: AccessPointInput;
}

export interface RejectBody {
  revision: number;
  /** Private reason (never shown publicly). */
  reason?: string;
}

export interface RequestInfoBody {
  revision: number;
  /** Private note. No email is sent: the submitter is not contacted. */
  note?: string;
}

export interface DuplicateBody {
  revision: number;
  /** An existing base place id, location id or suggestion id. */
  duplicateOf: string;
}

export interface RevisionBody {
  revision: number;
}

export interface LocationsQuery {
  status?: 'active' | 'hidden';
  origin?: 'owner' | 'community';
  q?: string;
}

export interface CreateLocationBody {
  fields: PlaceFieldsInput;
  accessPoint?: AccessPointInput;
}

/** PATCH: absent keys are kept, null clears an optional field. */
export interface UpdateLocationBody {
  revision: number;
  fields: {
    name?: string;
    categoryId?: string;
    location?: LngLat;
    description?: string | null;
    openingHours?: string | null;
    wheelchair?: PlaceFieldsInput['wheelchair'];
    website?: string | null;
    sourceUrl?: string | null;
    verificationStatus?: PlaceFieldsInput['verificationStatus'];
    lastVerifiedAt?: string | null;
  };
  /** null removes the access point; absent keeps it. */
  accessPoint?: AccessPointInput | null;
}

export interface DeleteLocationBody {
  revision: number;
  /** Typed confirmation: must equal the location's current name. Only hidden locations can be deleted. */
  confirmName: string;
}

export interface PutOverrideBody {
  /** null when no override exists yet for this base place. */
  revision: number | null;
  /** Fields equal to the base values are dropped by the server. */
  fields: OverrideFields;
  hidden: boolean;
  accessPoint?: AccessPointInput | null;
  /** Private owner note. */
  note?: string;
}

export interface AuditQuery {
  entity?: AuditEntityType;
  entityId?: string;
  action?: string;
  limit?: number;
  /** `nextCursor` of the previous page. */
  cursor?: number;
}

type R<T> = Promise<AdminResult<T>>;
type Opts = { signal?: AbortSignal };

export interface CommunityApi {
  overview(o?: Opts): R<Overview>;
  quality(o?: Opts): R<QualityReport>;

  listSuggestions(q?: SuggestionsQuery, o?: Opts): R<SuggestionList>;
  getSuggestion(id: string, o?: Opts): R<SuggestionDetail>;
  editSuggestion(id: string, body: EditSuggestionBody): R<SuggestionRecord>;
  approveSuggestion(id: string, body: ApproveBody): R<ApproveResult>;
  rejectSuggestion(id: string, body: RejectBody): R<SuggestionRecord>;
  markDuplicate(id: string, body: DuplicateBody): R<SuggestionRecord>;
  requestInformation(id: string, body: RequestInfoBody): R<SuggestionRecord>;
  reopenSuggestion(id: string, body: RevisionBody): R<SuggestionRecord>;

  listLocations(q?: LocationsQuery, o?: Opts): R<LocationList>;
  createLocation(body: CreateLocationBody): R<LocationRecord>;
  updateLocation(id: string, body: UpdateLocationBody): R<LocationRecord>;
  hideLocation(id: string, body: RevisionBody): R<LocationRecord>;
  restoreLocation(id: string, body: RevisionBody): R<LocationRecord>;
  deleteLocation(id: string, body: DeleteLocationBody): R<{ deleted: string }>;

  listOverrides(o?: Opts): R<OverrideList>;
  getOverride(targetId: string, o?: Opts): R<OverrideDetail>;
  putOverride(targetId: string, body: PutOverrideBody): R<OverrideWriteResult>;
  /** revision null when the place has no override yet. */
  hideOverride(targetId: string, body: { revision: number | null }): R<OverrideWriteResult>;
  unhideOverride(targetId: string, body: RevisionBody): R<OverrideWriteResult>;
  /** Reverts the base place to its base values (removes the override). */
  deleteOverride(targetId: string, body: RevisionBody): R<OverrideWriteResult>;

  listAudit(q?: AuditQuery, o?: Opts): R<AuditList>;
  revert(auditEventId: number): R<RevertResult>;
}

/** Public submission body shape, re-exported for the suggestion editor. */
export type { ContributionInput };

export function createCommunityApi(http: AdminHttp): CommunityApi {
  return {
    overview: (o) => http.request({ method: 'GET', path: '/overview', schema: overviewSchema, ...o }),
    quality: (o) => http.request({ method: 'GET', path: '/quality', schema: qualityReportSchema, ...o }),

    listSuggestions: (q, o) =>
      http.request({
        method: 'GET',
        path: '/suggestions',
        query: { ...q },
        schema: suggestionListSchema,
        ...o,
      }),
    getSuggestion: (id, o) =>
      http.request({ method: 'GET', path: `/suggestions/${seg(id)}`, schema: suggestionDetailSchema, ...o }),
    editSuggestion: (id, body) =>
      http.request({
        method: 'PATCH',
        path: `/suggestions/${seg(id)}`,
        body,
        schema: suggestionRecordSchema,
      }),
    approveSuggestion: (id, body) =>
      http.request({
        method: 'POST',
        path: `/suggestions/${seg(id)}/approve`,
        body,
        schema: approveResultSchema,
      }),
    rejectSuggestion: (id, body) =>
      http.request({
        method: 'POST',
        path: `/suggestions/${seg(id)}/reject`,
        body,
        schema: suggestionRecordSchema,
      }),
    markDuplicate: (id, body) =>
      http.request({
        method: 'POST',
        path: `/suggestions/${seg(id)}/duplicate`,
        body,
        schema: suggestionRecordSchema,
      }),
    requestInformation: (id, body) =>
      http.request({
        method: 'POST',
        path: `/suggestions/${seg(id)}/request-info`,
        body,
        schema: suggestionRecordSchema,
      }),
    reopenSuggestion: (id, body) =>
      http.request({
        method: 'POST',
        path: `/suggestions/${seg(id)}/reopen`,
        body,
        schema: suggestionRecordSchema,
      }),

    listLocations: (q, o) =>
      http.request({ method: 'GET', path: '/locations', query: { ...q }, schema: locationListSchema, ...o }),
    createLocation: (body) =>
      http.request({ method: 'POST', path: '/locations', body, schema: locationRecordSchema }),
    updateLocation: (id, body) =>
      http.request({ method: 'PATCH', path: `/locations/${seg(id)}`, body, schema: locationRecordSchema }),
    hideLocation: (id, body) =>
      http.request({
        method: 'POST',
        path: `/locations/${seg(id)}/hide`,
        body,
        schema: locationRecordSchema,
      }),
    restoreLocation: (id, body) =>
      http.request({
        method: 'POST',
        path: `/locations/${seg(id)}/restore`,
        body,
        schema: locationRecordSchema,
      }),
    deleteLocation: (id, body) =>
      http.request({
        method: 'DELETE',
        path: `/locations/${seg(id)}`,
        body,
        schema: deleteLocationResultSchema,
      }),

    listOverrides: (o) =>
      http.request({ method: 'GET', path: '/overrides', schema: overrideListSchema, ...o }),
    getOverride: (targetId, o) =>
      http.request({
        method: 'GET',
        path: `/overrides/${seg(targetId)}`,
        schema: overrideDetailSchema,
        ...o,
      }),
    putOverride: (targetId, body) =>
      http.request({
        method: 'PUT',
        path: `/overrides/${seg(targetId)}`,
        body,
        schema: overrideWriteResultSchema,
      }),
    hideOverride: (targetId, body) =>
      http.request({
        method: 'POST',
        path: `/overrides/${seg(targetId)}/hide`,
        body,
        schema: overrideWriteResultSchema,
      }),
    unhideOverride: (targetId, body) =>
      http.request({
        method: 'POST',
        path: `/overrides/${seg(targetId)}/unhide`,
        body,
        schema: overrideWriteResultSchema,
      }),
    deleteOverride: (targetId, body) =>
      http.request({
        method: 'DELETE',
        path: `/overrides/${seg(targetId)}`,
        body,
        schema: overrideWriteResultSchema,
      }),

    listAudit: (q, o) =>
      http.request({ method: 'GET', path: '/audit', query: { ...q }, schema: auditListSchema, ...o }),
    revert: (auditEventId) =>
      http.request({ method: 'POST', path: '/revert', body: { auditEventId }, schema: revertResultSchema }),
  };
}
