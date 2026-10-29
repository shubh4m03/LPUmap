/** Pre-approval edit of a suggestion (pure): validation with the public schema, PATCH body of changes only. */
import { contributionInputSchema } from '../../../community/index.ts';
import type { LngLat } from '../../../data/index.ts';
import { isValidLngLat } from '../../../distance/index.ts';
import type { EditSuggestionBody } from '../../api/community.ts';
import type { SuggestionRecord } from '../../api/schemas.ts';
import { zodFieldErrors, type FieldErrors } from '../../ui/form-errors.ts';

export interface SuggestionEditValues {
  name: string;
  categoryId: string;
  lat: string;
  lon: string;
  description: string;
  landmark: string;
  evidenceUrl: string;
  details: string;
}

/** The PATCH body for an edit: changed fields only, cleared optional text = null. Pure. */
export function suggestionEditBody(
  s: SuggestionRecord,
  v: SuggestionEditValues,
): { ok: true; body: EditSuggestionBody } | { ok: false; errors: FieldErrors } {
  const location: LngLat = [Number(v.lon), Number(v.lat)];
  const parsed = contributionInputSchema.safeParse({
    name: v.name,
    categoryId: v.categoryId,
    location: v.lat.trim() && v.lon.trim() && isValidLngLat(location) ? location : undefined,
    description: v.description,
    landmark: v.landmark,
    evidenceUrl: v.evidenceUrl,
    details: v.details,
  });
  if (!parsed.success) return { ok: false, errors: zodFieldErrors(parsed.error) };
  const f = parsed.data;
  const fields: EditSuggestionBody['fields'] = {};
  if (f.name !== s.name) fields.name = f.name;
  if (f.categoryId !== s.categoryId) fields.categoryId = f.categoryId;
  if (f.location[0] !== s.location[0] || f.location[1] !== s.location[1]) fields.location = f.location;
  for (const k of ['description', 'landmark', 'evidenceUrl', 'details'] as const) {
    const next = f[k] ?? null;
    if (next !== s[k]) fields[k] = next;
  }
  return { ok: true, body: { revision: s.revision, fields } };
}
