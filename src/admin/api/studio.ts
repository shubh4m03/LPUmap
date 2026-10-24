/**
 * Building Studio admin endpoints (/api/admin/studio/**,
 * docs/BUILDING_STUDIO_DESIGN.md §7). Request and response shapes are the
 * strict schemas of src/building-studio/schema.ts; every 2xx body is parsed
 * with them, so a response the studio cannot trust is an error, not a save.
 *
 * Errors worth handling explicitly (see AdminApiError):
 *  - 409 `conflict` → `error.current` is the server head (`StudioBuildingHead`,
 *    or the template listing for template routes) and `error.currentRevision`
 *    its revision: reload, re-validate, then retry with that revision;
 *  - 409 `invalid-transition` → the state machine (§9) refuses the action;
 *  - 422 `validation-failed` → `error.validation` and `error.missingAcknowledgements`;
 *  - 422 `unsupported-model` → this build cannot generate the model;
 *  - 413 → the draft exceeds STUDIO_LIMITS.bodyBytes.
 */
import type { z } from 'zod';
import {
  applyTemplateResponseSchema,
  deleteStudioBuildingResponseSchema,
  publishResponseSchema,
  studioBuildingDetailSchema,
  studioBuildingListSchema,
  studioLibraryResponseSchema,
  studioQualityResponseSchema,
  templateListingSchema,
  validationResultSchema,
  type ApplyTemplateRequest,
  type ApplyTemplateResponse,
  type ArchiveRequest,
  type CreateStudioBuildingRequest,
  type DeleteStudioBuildingRequest,
  type DeleteStudioBuildingResponse,
  type DuplicateRequest,
  type OwnerTemplateInput,
  type PublishRequest,
  type PublishResponse,
  type RestoreRequest,
  type SaveDraftRequest,
  type StudioBuildingDetail,
  type StudioBuildingList,
  type StudioLibraryResponse,
  type StudioListQuery,
  type StudioQualityResponse,
  type TemplateListing,
  type ValidateRequest,
  type ValidationResult,
} from '../../building-studio/schema.ts';
import { seg, type AdminHttp, type AdminResult } from './http.ts';

type R<T> = Promise<AdminResult<T>>;
type Opts = { signal?: AbortSignal };

export interface StudioRevisionBody {
  revision: number;
}

export interface StudioApi {
  library(o?: Opts): R<StudioLibraryResponse>;
  createTemplate(definition: OwnerTemplateInput): R<TemplateListing>;
  /** Creates a new immutable version of an owner template. */
  updateTemplate(
    templateId: string,
    body: { revision: number; definition: OwnerTemplateInput },
  ): R<TemplateListing>;
  retireTemplate(templateId: string, body: StudioRevisionBody): R<TemplateListing>;
  unretireTemplate(templateId: string, body: StudioRevisionBody): R<TemplateListing>;

  listBuildings(q?: StudioListQuery, o?: Opts): R<StudioBuildingList>;
  getBuilding(id: string, o?: Opts): R<StudioBuildingDetail>;
  createBuilding(body: CreateStudioBuildingRequest): R<StudioBuildingDetail>;
  saveDraft(id: string, body: SaveDraftRequest): R<StudioBuildingDetail>;
  discardDraft(id: string, body: StudioRevisionBody): R<StudioBuildingDetail>;
  /** Dry run: no write. */
  validate(body: ValidateRequest, o?: Opts): R<ValidationResult>;
  publish(id: string, body: PublishRequest): R<PublishResponse>;
  archive(id: string, body: ArchiveRequest): R<PublishResponse>;
  restore(id: string, body: RestoreRequest): R<PublishResponse>;
  /** Permanent; only archived records; `confirmId` must equal `id`. */
  deleteBuilding(id: string, body: DeleteStudioBuildingRequest): R<DeleteStudioBuildingResponse>;
  duplicate(id: string, body: DuplicateRequest): R<StudioBuildingDetail>;
  /** `dryRun: true` previews (nothing saved). */
  applyTemplate(id: string, body: ApplyTemplateRequest): R<ApplyTemplateResponse>;
  quality(o?: Opts): R<StudioQualityResponse>;
}

const b = (id: string) => `/studio/buildings/${seg(id)}`;
const t = (id: string) => `/studio/templates/${seg(id)}`;

/** The server answers 201 for creates; the body is the same schema. */
const detail: z.ZodType<StudioBuildingDetail> = studioBuildingDetailSchema;

export function createStudioApi(http: AdminHttp): StudioApi {
  return {
    library: (o) =>
      http.request({ method: 'GET', path: '/studio/library', schema: studioLibraryResponseSchema, ...o }),
    createTemplate: (definition) =>
      http.request({
        method: 'POST',
        path: '/studio/templates',
        body: { definition },
        schema: templateListingSchema,
      }),
    updateTemplate: (id, body) =>
      http.request({ method: 'PUT', path: t(id), body, schema: templateListingSchema }),
    retireTemplate: (id, body) =>
      http.request({ method: 'POST', path: `${t(id)}/retire`, body, schema: templateListingSchema }),
    unretireTemplate: (id, body) =>
      http.request({ method: 'POST', path: `${t(id)}/unretire`, body, schema: templateListingSchema }),

    listBuildings: (q, o) =>
      http.request({
        method: 'GET',
        path: '/studio/buildings',
        query: { ...q },
        schema: studioBuildingListSchema,
        ...o,
      }),
    getBuilding: (id, o) => http.request({ method: 'GET', path: b(id), schema: detail, ...o }),
    createBuilding: (body) =>
      http.request({ method: 'POST', path: '/studio/buildings', body, schema: detail }),
    saveDraft: (id, body) => http.request({ method: 'PUT', path: `${b(id)}/draft`, body, schema: detail }),
    discardDraft: (id, body) =>
      http.request({ method: 'DELETE', path: `${b(id)}/draft`, body, schema: detail }),
    validate: (body, o) =>
      http.request({ method: 'POST', path: '/studio/validate', body, schema: validationResultSchema, ...o }),
    publish: (id, body) =>
      http.request({ method: 'POST', path: `${b(id)}/publish`, body, schema: publishResponseSchema }),
    archive: (id, body) =>
      http.request({ method: 'POST', path: `${b(id)}/archive`, body, schema: publishResponseSchema }),
    restore: (id, body) =>
      http.request({ method: 'POST', path: `${b(id)}/restore`, body, schema: publishResponseSchema }),
    deleteBuilding: (id, body) =>
      http.request({ method: 'DELETE', path: b(id), body, schema: deleteStudioBuildingResponseSchema }),
    duplicate: (id, body) =>
      http.request({ method: 'POST', path: `${b(id)}/duplicate`, body, schema: detail }),
    applyTemplate: (id, body) =>
      http.request({
        method: 'POST',
        path: `${b(id)}/apply-template`,
        body,
        schema: applyTemplateResponseSchema,
      }),
    quality: (o) =>
      http.request({ method: 'GET', path: '/studio/quality', schema: studioQualityResponseSchema, ...o }),
  };
}
