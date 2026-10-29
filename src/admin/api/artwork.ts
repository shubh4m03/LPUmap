/**
 * Artwork verification admin endpoints (/api/admin/artwork/**,
 * docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §4.2). Request bodies are the
 * frozen contract schemas of src/isometric-art/schema.ts; every 2xx body is
 * parsed here, so a response the admin cannot trust is an error, not a save.
 *
 * Errors worth handling explicitly (see AdminApiError):
 *  - 409 `conflict` → `error.current` is the current owner decision (or null
 *    when it was reset meanwhile): reload, re-check, retry with its revision;
 *  - 422 (`unprocessable`) → a rule refused the values (`error.issues` names
 *    the field: evidence, evidence.N.url, evidence.N.date, note, buildingId);
 *  - 404 → the subject is not in this deployment's illustration registry.
 */
import { z } from 'zod';
import {
  ASSOCIATION_STATUSES,
  associationEvidenceSchema,
  candidateFootprintSchema,
  curatedAssociationSchema,
  type ArtworkAssociationWrite,
} from '../../isometric-art/index.ts';
import { seg, type AdminHttp, type AdminResult } from './http.ts';
import { auditEventSchema } from './schemas.ts';

type R<T> = Promise<AdminResult<T>>;
type Opts = { signal?: AbortSignal };

const status = z.enum(ASSOCIATION_STATUSES);

/** The owner's stored decision (admin only: includes the PRIVATE note and actors). */
export const artworkDecisionSchema = z.object({
  subjectId: z.string(),
  status,
  buildingId: z.string().nullable(),
  evidence: z.array(associationEvidenceSchema),
  note: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedBy: z.string(),
  updatedAt: z.string(),
  revision: z.number().int().positive(),
});
export type ArtworkDecision = z.infer<typeof artworkDecisionSchema>;

/** mergeArtworkAssociations output (src/isometric-art/associations.ts EffectiveArtworkAssociation). */
export const effectiveArtworkAssociationSchema = z.object({
  subjectId: z.string(),
  status,
  buildingId: z.string().nullable(),
  unconfirmedMatchId: z.string().nullable(),
  evidence: z.array(associationEvidenceSchema),
  candidateFootprints: z.array(candidateFootprintSchema),
  reason: z.string().nullable(),
  source: z.enum(['owner', 'curated', 'default']),
  revision: z.number().int().nullable(),
  updatedAt: z.string().nullable(),
});
export type EffectiveArtworkAssociationView = z.infer<typeof effectiveArtworkAssociationSchema>;

export const artworkAssociationViewSchema = z.object({
  subjectId: z.string(),
  baseline: curatedAssociationSchema.nullable(),
  decision: artworkDecisionSchema.nullable(),
  effective: effectiveArtworkAssociationSchema,
});
export type ArtworkAssociationView = z.infer<typeof artworkAssociationViewSchema>;

export const artworkAssociationListSchema = z.object({
  items: z.array(artworkAssociationViewSchema),
  issues: z.array(z.object({ subjectId: z.string(), code: z.string(), message: z.string() })),
});
export type ArtworkAssociationList = z.infer<typeof artworkAssociationListSchema>;

export const artworkAssociationDetailSchema = artworkAssociationViewSchema.extend({
  history: z.array(auditEventSchema),
});
export type ArtworkAssociationDetail = z.infer<typeof artworkAssociationDetailSchema>;

export interface ArtworkApi {
  listAssociations(o?: Opts): R<ArtworkAssociationList>;
  getAssociation(subjectId: string, o?: Opts): R<ArtworkAssociationDetail>;
  /** `expectedRevision` null = create the first decision (409 when one exists). */
  putAssociation(subjectId: string, body: ArtworkAssociationWrite): R<ArtworkAssociationView>;
  /** Deletes the owner decision: the curated baseline applies again (audited). */
  resetAssociation(subjectId: string, body: { expectedRevision: number }): R<ArtworkAssociationView>;
}

const path = (subjectId: string) => `/artwork/associations/${seg(subjectId)}`;

export function createArtworkApi(http: AdminHttp): ArtworkApi {
  return {
    listAssociations: (o) =>
      http.request({
        method: 'GET',
        path: '/artwork/associations',
        schema: artworkAssociationListSchema,
        ...o,
      }),
    getAssociation: (subjectId, o) =>
      http.request({ method: 'GET', path: path(subjectId), schema: artworkAssociationDetailSchema, ...o }),
    putAssociation: (subjectId, body) =>
      http.request({ method: 'PUT', path: path(subjectId), body, schema: artworkAssociationViewSchema }),
    resetAssociation: (subjectId, body) =>
      http.request({ method: 'DELETE', path: path(subjectId), body, schema: artworkAssociationViewSchema }),
  };
}
