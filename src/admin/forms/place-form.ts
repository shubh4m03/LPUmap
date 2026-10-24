/**
 * Place form model shared by the owner-location editor and suggestion
 * approval (pure). Validation uses the server's own `placeFieldsSchema`, and
 * the request bodies carry only what the owner changed (PATCH semantics:
 * absent = keep, null = clear) so a stale form never resets other fields.
 */
import { placeFieldsSchema, type OverrideFields, type PlaceFields } from '../../community/schema.ts';
import type { LngLat, VerificationStatus, Wheelchair } from '../../data/schema.ts';
import type { UpdateLocationBody } from '../api/community.ts';
import type { LocationRecord, SuggestionRecord } from '../api/schemas.ts';
import { zodFieldErrors, type FieldErrors } from '../ui/form-errors.ts';

export interface PlaceFormValues {
  name: string;
  categoryId: string;
  location: LngLat | null;
  description: string;
  openingHours: string;
  wheelchair: Wheelchair;
  website: string;
  sourceUrl: string;
  verificationStatus: VerificationStatus;
  lastVerifiedAt: string;
}

export const OPTIONAL_TEXT_FIELDS = [
  'description',
  'openingHours',
  'website',
  'sourceUrl',
  'lastVerifiedAt',
] as const;
type OptionalTextField = (typeof OPTIONAL_TEXT_FIELDS)[number];

export function emptyPlaceForm(location: LngLat | null = null): PlaceFormValues {
  return {
    name: '',
    categoryId: '',
    location,
    description: '',
    openingHours: '',
    wheelchair: 'unknown',
    website: '',
    sourceUrl: '',
    verificationStatus: 'unverified',
    lastVerifiedAt: '',
  };
}

export function placeFormFromLocation(r: LocationRecord): PlaceFormValues {
  return {
    name: r.name,
    categoryId: r.categoryId,
    location: [r.location[0], r.location[1]],
    description: r.description ?? '',
    openingHours: r.openingHours ?? '',
    wheelchair: r.wheelchair,
    website: r.website ?? '',
    sourceUrl: r.sourceUrl ?? '',
    verificationStatus: r.verificationStatus,
    lastVerifiedAt: r.lastVerifiedAt ?? '',
  };
}

/** Approval starts from the submission; everything else starts at the schema defaults. */
export function placeFormFromSuggestion(s: SuggestionRecord): PlaceFormValues {
  return {
    ...emptyPlaceForm([s.location[0], s.location[1]]),
    name: s.name,
    categoryId: s.categoryId,
    description: s.description ?? '',
  };
}

export type PlaceValidation = { ok: true; fields: PlaceFields } | { ok: false; errors: FieldErrors };

/** Validates exactly as the server will (placeFieldsSchema); empty optional text = absent. */
export function validatePlaceForm(v: PlaceFormValues): PlaceValidation {
  const r = placeFieldsSchema.safeParse({
    name: v.name,
    categoryId: v.categoryId,
    location: v.location ?? undefined,
    description: v.description,
    openingHours: v.openingHours,
    wheelchair: v.wheelchair,
    website: v.website,
    sourceUrl: v.sourceUrl,
    verificationStatus: v.verificationStatus,
    lastVerifiedAt: v.lastVerifiedAt,
  });
  return r.success ? { ok: true, fields: r.data } : { ok: false, errors: zodFieldErrors(r.error) };
}

const sameLngLat = (a: readonly number[] | null, b: readonly number[] | null) =>
  a === b || (a !== null && b !== null && a[0] === b[0] && a[1] === b[1]);

/** PATCH fields for a location: only what changed; a cleared optional field is null. */
export function locationPatch(current: LocationRecord, f: PlaceFields): UpdateLocationBody['fields'] {
  const out: UpdateLocationBody['fields'] = {};
  if (f.name !== current.name) out.name = f.name;
  if (f.categoryId !== current.categoryId) out.categoryId = f.categoryId;
  if (!sameLngLat(f.location, current.location)) out.location = [f.location[0], f.location[1]];
  if (f.wheelchair !== current.wheelchair) out.wheelchair = f.wheelchair;
  if (f.verificationStatus !== current.verificationStatus) out.verificationStatus = f.verificationStatus;
  for (const k of OPTIONAL_TEXT_FIELDS) {
    const next = (f[k as OptionalTextField] as string | undefined) ?? null;
    if (next !== current[k]) out[k] = next;
  }
  return out;
}

/**
 * Owner corrections at approval: only fields that differ from the submission,
 * plus extra fields the owner filled in. undefined = approve as submitted.
 */
export function approveCorrections(s: SuggestionRecord, f: PlaceFields): OverrideFields | undefined {
  const out: OverrideFields = {};
  if (f.name !== s.name) out.name = f.name;
  if (f.categoryId !== s.categoryId) out.categoryId = f.categoryId;
  if (!sameLngLat(f.location, s.location)) out.location = [f.location[0], f.location[1]];
  if ((f.description ?? null) !== s.description && f.description !== undefined)
    out.description = f.description;
  if (f.openingHours !== undefined) out.openingHours = f.openingHours;
  if (f.website !== undefined) out.website = f.website;
  if (f.sourceUrl !== undefined) out.sourceUrl = f.sourceUrl;
  if (f.lastVerifiedAt !== undefined) out.lastVerifiedAt = f.lastVerifiedAt;
  if (f.wheelchair !== 'unknown') out.wheelchair = f.wheelchair;
  if (f.verificationStatus !== 'unverified') out.verificationStatus = f.verificationStatus;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** True when the form differs from the record it was loaded from. */
export function placeFormDirty(a: PlaceFormValues, b: PlaceFormValues): boolean {
  return (
    a.name !== b.name ||
    a.categoryId !== b.categoryId ||
    !sameLngLat(a.location, b.location) ||
    a.description !== b.description ||
    a.openingHours !== b.openingHours ||
    a.wheelchair !== b.wheelchair ||
    a.website !== b.website ||
    a.sourceUrl !== b.sourceUrl ||
    a.verificationStatus !== b.verificationStatus ||
    a.lastVerifiedAt !== b.lastVerifiedAt
  );
}
