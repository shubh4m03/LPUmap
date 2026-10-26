/**
 * Response schemas for the community admin endpoints. The server returns the
 * record shapes of server/db/records.ts and server/domain/** (the domain owns
 * them; tests/unit/admin/api-contract.test.ts runs the server's own row
 * mappers through these schemas so the two cannot drift silently). Objects
 * strip unknown keys, so an additive server field never breaks the admin app.
 * Studio responses use the schemas in src/building-studio/schema.ts.
 */
import { z } from 'zod';
import {
  duplicateCandidateSchema,
  overrideFieldsSchema,
  suggestionStatusSchema,
} from '../../community/schema.ts';
import { lngLatSchema, placeSchema, verificationStatusSchema, wheelchairSchema } from '../../data/schema.ts';

const revision = z.number().int().positive();
const nullableText = z.string().nullable();

export const suggestionRecordSchema = z.object({
  id: z.string().min(1),
  status: suggestionStatusSchema,
  name: z.string(),
  categoryId: z.string(),
  location: lngLatSchema,
  description: nullableText,
  landmark: nullableText,
  evidenceUrl: nullableText,
  details: nullableText,
  duplicateOf: nullableText,
  /** Private review note (owner only). */
  reviewNote: nullableText,
  reviewedBy: nullableText,
  reviewedAt: nullableText,
  publishedLocationId: nullableText,
  createdAt: z.string(),
  updatedAt: z.string(),
  revision,
});
export type SuggestionRecord = z.infer<typeof suggestionRecordSchema>;

export const locationOriginSchema = z.enum(['owner', 'community']);
export const adminLocationStatusSchema = z.enum(['active', 'hidden']);

export const locationRecordSchema = z.object({
  id: z.string().min(1),
  origin: locationOriginSchema,
  suggestionId: nullableText,
  name: z.string(),
  categoryId: z.string(),
  location: lngLatSchema,
  description: nullableText,
  openingHours: nullableText,
  wheelchair: wheelchairSchema,
  website: nullableText,
  sourceUrl: nullableText,
  verificationStatus: verificationStatusSchema,
  lastVerifiedAt: nullableText,
  accessNodeId: z.number().int().nonnegative().nullable(),
  accessNote: nullableText,
  status: adminLocationStatusSchema,
  createdBy: z.string(),
  createdAt: z.string(),
  updatedBy: z.string(),
  updatedAt: z.string(),
  revision,
});
export type LocationRecord = z.infer<typeof locationRecordSchema>;

export const overrideRecordSchema = z.object({
  targetId: z.string().min(1),
  fields: overrideFieldsSchema,
  hidden: z.boolean(),
  accessNodeId: z.number().int().nonnegative().nullable(),
  accessNote: nullableText,
  /** Private owner note — never published. */
  note: nullableText,
  baseDatasetVersion: z.string(),
  updatedBy: z.string(),
  updatedAt: z.string(),
  revision,
});
export type OverrideRecord = z.infer<typeof overrideRecordSchema>;

/** Why an override's target is not a campus place (server/base-data.ts `OrphanReason`). */
export const orphanReasonSchema = z.enum(['context-layer', 'boundary-review', 'not-in-dataset']);
export type OrphanReason = z.infer<typeof orphanReasonSchema>;

export const overrideViewSchema = overrideRecordSchema.extend({
  orphan: z.boolean(),
  orphanReason: orphanReasonSchema.nullable(),
  baseName: nullableText,
});
export type OverrideView = z.infer<typeof overrideViewSchema>;

export const auditEntityTypeSchema = z.enum([
  'suggestion',
  'location',
  'override',
  'session',
  'system',
  'building',
  'template',
  'artwork',
]);
export type AuditEntityType = z.infer<typeof auditEntityTypeSchema>;

export const auditEventSchema = z.object({
  id: z.number().int().positive(),
  at: z.string(),
  actor: z.string(),
  action: z.string(),
  entityType: auditEntityTypeSchema,
  entityId: nullableText,
  before: z.unknown(),
  after: z.unknown(),
  outcome: z.enum(['success', 'rejected', 'failed']),
  detail: nullableText,
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

// --- endpoint responses ---

export const suggestionListSchema = z.object({
  items: z.array(suggestionRecordSchema),
  nextCursor: z.string().nullable(),
});
export type SuggestionList = z.infer<typeof suggestionListSchema>;

export const suggestionDetailSchema = z.object({
  suggestion: suggestionRecordSchema,
  possibleDuplicates: z.array(duplicateCandidateSchema),
  history: z.array(auditEventSchema),
});
export type SuggestionDetail = z.infer<typeof suggestionDetailSchema>;

export const approveResultSchema = z.object({
  suggestion: suggestionRecordSchema,
  location: locationRecordSchema,
});
export type ApproveResult = z.infer<typeof approveResultSchema>;

export const locationListSchema = z.object({ items: z.array(locationRecordSchema) });
export type LocationList = z.infer<typeof locationListSchema>;

export const deleteLocationResultSchema = z.object({ deleted: z.string().min(1) });

export const overrideListSchema = z.object({ items: z.array(overrideViewSchema) });
export type OverrideList = z.infer<typeof overrideListSchema>;

export const overrideDetailSchema = z.object({
  targetId: z.string().min(1),
  /** The base place, or null when the target is no longer a campus place (orphan). */
  place: placeSchema.nullable(),
  override: overrideViewSchema.nullable(),
  orphan: z.boolean(),
});
export type OverrideDetail = z.infer<typeof overrideDetailSchema>;

/** PUT / hide / unhide: the stored record (null when nothing remains); DELETE: always null. */
export const overrideWriteResultSchema = z.object({ override: overrideRecordSchema.nullable() });
export type OverrideWriteResult = z.infer<typeof overrideWriteResultSchema>;

export const revertResultSchema = z.object({
  revertedEventId: z.number().int().positive(),
  entityType: auditEntityTypeSchema,
  entityId: z.string(),
  /** The restored location / override (null when the revert removed the override). */
  record: z.unknown(),
});
export type RevertResult = z.infer<typeof revertResultSchema>;

export const auditListSchema = z.object({
  items: z.array(auditEventSchema),
  nextCursor: z.number().int().positive().nullable(),
});
export type AuditList = z.infer<typeof auditListSchema>;

const count = z.number().int().nonnegative();
const activeHidden = z.object({ active: count, hidden: count });

export const overviewSchema = z.object({
  suggestions: z.record(suggestionStatusSchema, count),
  locations: z.object({ owner: activeHidden, community: activeHidden }),
  overrides: z.object({
    total: count,
    hidden: count,
    withFields: count,
    withAccessPoint: count,
    orphan: count,
  }),
  auditLast7Days: count,
  qualityWarnings: count,
  publicationVersion: count,
  datasetVersion: z.string(),
});
export type Overview = z.infer<typeof overviewSchema>;

export const QUALITY_WARNING_KINDS = [
  'orphan-override',
  'override-access-invalid',
  'location-outside-boundary',
  'location-not-routable',
  'possible-duplicate',
  'stale-pending',
] as const;
export const qualityWarningKindSchema = z.enum(QUALITY_WARNING_KINDS);
export type QualityWarningKind = z.infer<typeof qualityWarningKindSchema>;

export const qualityWarningSchema = z.object({
  kind: qualityWarningKindSchema,
  entityType: z.enum(['override', 'location', 'suggestion']),
  id: z.string(),
  message: z.string(),
  relatedId: z.string().optional(),
  orphanReason: orphanReasonSchema.optional(),
});
export type QualityWarning = z.infer<typeof qualityWarningSchema>;

export const qualityReportSchema = z.object({
  warnings: z.array(qualityWarningSchema),
  counts: z.record(qualityWarningKindSchema, count),
});
export type QualityReport = z.infer<typeof qualityReportSchema>;

// --- session and health ---

export const authModeSchema = z.enum(['access', 'password']);
export type AuthMode = z.infer<typeof authModeSchema>;

/** GET /api/admin/session. `csrfToken`/`expiresAt` only in password mode. */
export const sessionInfoSchema = z.object({
  actor: z.string().min(1),
  mode: authModeSchema,
  csrfToken: z.string().min(1).optional(),
  expiresAt: z.string().optional(),
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;

/** POST /api/admin/session (password mode). */
export const loginResultSchema = z.object({
  actor: z.string().min(1),
  csrfToken: z.string().min(1),
  expiresAt: z.string(),
});
export type LoginResult = z.infer<typeof loginResultSchema>;

export const okSchema = z.object({ ok: z.literal(true) });

/** GET /api/health (public): which authentication mode the server is configured for. */
export const healthSchema = z.object({
  ok: z.boolean(),
  db: z.enum(['ok', 'unavailable']),
  auth: z.enum(['access', 'password', 'not-configured']),
});
export type Health = z.infer<typeof healthSchema>;
