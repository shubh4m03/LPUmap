/**
 * Request schemas for admin endpoints. Objects strip unknown keys, so any
 * client-supplied actor/role/status/approval field is ignored. The domain
 * re-validates the final records it writes.
 */
import { z } from 'zod';
import {
  LIMITS,
  accessPointSchema,
  categoryIdSchema,
  contributionInputSchema,
  overrideFieldsSchema,
  placeFieldsSchema,
  suggestionStatusSchema,
} from '../../../src/community/schema.ts';
import { MAX_PASSWORD_LENGTH } from '../../auth/password.ts';
import { HttpError } from '../../http/errors.ts';

const revision = z.number().int().positive();
const note = z.string().trim().max(LIMITS.note).optional();

export const loginBody = z.object({ password: z.string().min(1).max(MAX_PASSWORD_LENGTH) });

export const revisionBody = z.object({ revision });
export const nullableRevisionBody = z.object({ revision: revision.nullable() });

const contribution = contributionInputSchema.shape;

/** Pre-approval edit: a field set to null clears it; absent fields are kept. */
export const editSuggestionBody = z.object({
  revision,
  fields: z.object({
    name: contribution.name.optional(),
    categoryId: contribution.categoryId.optional(),
    location: contribution.location.optional(),
    description: contribution.description.nullable(),
    landmark: contribution.landmark.nullable(),
    evidenceUrl: contribution.evidenceUrl.nullable(),
    details: contribution.details.nullable(),
  }),
});

/**
 * Owner corrections at approval may be partial (absent = keep the submitted
 * value); the domain validates the FINAL merged record with placeFieldsSchema.
 */
export const approveBody = z.object({
  revision,
  fields: overrideFieldsSchema.optional(),
  accessPoint: accessPointSchema.optional(),
});

export const rejectBody = z.object({ revision, reason: note });
export const requestInfoBody = z.object({ revision, note });
export const duplicateBody = z.object({ revision, duplicateOf: z.string().trim().min(1).max(200) });

export const createLocationBody = z.object({
  fields: placeFieldsSchema,
  accessPoint: accessPointSchema.optional(),
});

const pf = overrideFieldsSchema.shape;

/**
 * PATCH semantics (the domain merges onto the current record): absent keys
 * are kept, null clears an optional field. No defaults are applied here, so a
 * partial edit can never silently reset wheelchair/verification values.
 */
export const locationPatchFields = z.object({
  name: pf.name,
  categoryId: pf.categoryId,
  location: pf.location,
  description: pf.description.nullable(),
  openingHours: pf.openingHours.nullable(),
  wheelchair: pf.wheelchair,
  website: pf.website.nullable(),
  sourceUrl: pf.sourceUrl.nullable(),
  verificationStatus: pf.verificationStatus,
  lastVerifiedAt: pf.lastVerifiedAt.nullable(),
});

export const updateLocationBody = z.object({
  revision,
  fields: locationPatchFields,
  accessPoint: accessPointSchema.nullable().optional(),
});

export const deleteLocationBody = z.object({ revision, confirmName: z.string().max(LIMITS.name.max + 20) });

export const putOverrideBody = z.object({
  revision: revision.nullable(),
  fields: overrideFieldsSchema,
  hidden: z.boolean(),
  accessPoint: accessPointSchema.nullable().optional(),
  note,
});

export const revertBody = z.object({ auditEventId: z.number().int().positive() });

const limit = z.coerce.number().int().min(1).max(200).optional();
const cursor = z.string().max(200).optional();
const numericCursor = z
  .string()
  .regex(/^\d{1,15}$/, 'Invalid cursor')
  .optional();
const q = z.string().trim().max(LIMITS.name.max).optional();

export const suggestionsQuery = z.object({
  status: suggestionStatusSchema.optional(),
  category: categoryIdSchema.optional(),
  q,
  sort: z.enum(['created_desc', 'created_asc']).optional(),
  limit,
  cursor,
});

export const locationsQuery = z.object({
  status: z.enum(['active', 'hidden']).optional(),
  origin: z.enum(['owner', 'community']).optional(),
  q,
});

export const auditQuery = z.object({
  entity: z.enum(['suggestion', 'location', 'override', 'session', 'system']).optional(),
  entityId: z.string().max(200).optional(),
  action: z.string().max(64).optional(),
  limit,
  cursor: numericCursor,
});

/**
 * Query string → plain object; repeated keys are rejected (ambiguous).
 * Built on a Map so keys such as `constructor`/`__proto__` are ordinary
 * (unknown, stripped) keys rather than prototype lookups.
 */
export function queryObject(url: URL): Record<string, string> {
  const seen = new Map<string, string>();
  for (const [k, v] of url.searchParams) {
    if (seen.has(k)) throw new HttpError('invalid', 'Repeated query parameter');
    seen.set(k, v);
  }
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [k, v] of seen) if (v !== '') out[k] = v;
  return out;
}
