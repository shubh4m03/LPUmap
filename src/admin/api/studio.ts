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
  type StudioBuildingDetail,
  type StudioServerApi,
} from '../../building-studio/index.ts';
import type { AdminApiError } from './errors.ts';
import { seg, type AdminHttp } from './http.ts';

export type { StudioRevisionBody } from '../../building-studio/index.ts';

/**
 * The Studio's server port (src/building-studio/server-api.ts) with the admin
 * client's failure value, so every result is an `AdminResult`.
 */
export type StudioApi = StudioServerApi<AdminApiError>;

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
