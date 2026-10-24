/**
 * "Suggest a missing place" model (pure): the form, client validation that
 * mirrors the server (it IS the server's `contributionInputSchema`), the
 * request body, and the contribution area check. The server re-validates
 * everything and always stores the suggestion as `pending`.
 */
import { contributionInputSchema, LIMITS, type ContributionInput } from '../../community/schema.ts';
import { insideContributionArea } from '../../community/geo.ts';
import type { LngLat } from '../../data/schema.ts';

export interface SuggestFormValues {
  name: string;
  categoryId: string;
  description: string;
  landmark: string;
  evidenceUrl: string;
  /** Honeypot: hidden from people; a value means a bot (the server stores nothing). */
  website: string;
}

export const EMPTY_SUGGEST_FORM: SuggestFormValues = {
  name: '',
  categoryId: '',
  description: '',
  landmark: '',
  evidenceUrl: '',
  website: '',
};

export type SuggestField = 'location' | 'name' | 'categoryId' | 'description' | 'landmark' | 'evidenceUrl';
export type SuggestErrors = Partial<Record<SuggestField, string>>;

/** In form order, for focusing the first invalid field. */
export const SUGGEST_FIELD_ORDER: readonly SuggestField[] = [
  'location',
  'name',
  'categoryId',
  'description',
  'landmark',
  'evidenceUrl',
];

export const OUTSIDE_AREA_MESSAGE =
  'This point is outside the area the atlas covers. Suggestions must be on or near the LPU campus.';

/** The schema's stacked-mark rule (src/community/schema.ts). */
export const MARK_FLOOD_FIELD_MESSAGE = 'Remove the stacked accent marks: a letter can carry only a few.';

function messageFor(field: SuggestField, raw: string): string {
  if (/combining marks/i.test(raw)) return MARK_FLOOD_FIELD_MESSAGE;
  switch (field) {
    case 'name':
      return `Enter the place's name (${LIMITS.name.min}–${LIMITS.name.max} characters).`;
    case 'categoryId':
      return 'Choose what kind of place it is.';
    case 'evidenceUrl':
      return 'Enter a full web address starting with https:// or http://, or leave it empty.';
    case 'location':
      return 'Place the point on the map first.';
    case 'description':
      return /control/i.test(raw)
        ? 'Remove the special control characters.'
        : `Keep it under ${LIMITS.description} characters.`;
    case 'landmark':
      return /control/i.test(raw)
        ? 'Remove the special control characters.'
        : `Keep it under ${LIMITS.landmark} characters.`;
  }
}

export type SuggestValidation = { ok: true; body: ContributionInput } | { ok: false; errors: SuggestErrors };

/** Validates with the server's schema; the body carries only the contract's fields. */
export function validateSuggestion(values: SuggestFormValues, location: LngLat | null): SuggestValidation {
  const errors: SuggestErrors = {};
  if (!location) errors.location = messageFor('location', '');
  else if (!insideContributionArea(location)) errors.location = OUTSIDE_AREA_MESSAGE;
  const parsed = contributionInputSchema.safeParse({
    name: values.name,
    categoryId: values.categoryId,
    location: location ?? undefined,
    description: values.description,
    landmark: values.landmark,
    evidenceUrl: values.evidenceUrl,
    website: values.website === '' ? undefined : values.website,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '') as SuggestField;
      if (SUGGEST_FIELD_ORDER.includes(key) && !errors[key]) errors[key] = messageFor(key, issue.message);
    }
  }
  if (!parsed.success || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, body: parsed.data };
}

/** Maps server `issues` (paths like `name`, `location`) onto the form fields. */
export function serverIssueErrors(issues: ReadonlyArray<{ path: string; message: string }>): SuggestErrors {
  const out: SuggestErrors = {};
  for (const i of issues) {
    const key = i.path.split('.')[0] as SuggestField;
    if (SUGGEST_FIELD_ORDER.includes(key) && !out[key]) out[key] = messageFor(key, i.message);
  }
  return out;
}
