import { z } from 'zod';

export const CORRECTION_KINDS = [
  'missing-facility',
  'wrong-name',
  'wrong-hours',
  'wrong-entrance',
  'closed',
  'accessibility',
  'geometry',
  'other',
] as const;

export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

export const CORRECTION_KIND_LABELS: Record<CorrectionKind, string> = {
  'missing-facility': 'Missing facility',
  'wrong-name': 'Wrong name',
  'wrong-hours': 'Wrong opening hours',
  'wrong-entrance': 'Wrong entrance',
  closed: 'Closed or no longer exists',
  accessibility: 'Accessibility information',
  geometry: 'Wrong position or shape',
  other: 'Other',
};

export const DETAILS_MIN = 10;
export const DETAILS_MAX = 2000;
export const PLACE_NAME_MAX = 200;
export const PLACE_ID_MAX = 200;
export const SOURCE_URL_MAX = 2000;

export function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Form fields arrive as strings; an empty or blank optional field means "not given". */
const blankToUndefined = (v: unknown): unknown => (typeof v === 'string' && v.trim() === '' ? undefined : v);

export const correctionDraftSchema = z.object({
  kind: z.enum(CORRECTION_KINDS, { error: 'Choose what kind of correction this is.' }),
  placeId: z.preprocess(
    blankToUndefined,
    z.string().trim().max(PLACE_ID_MAX, 'Place id is too long.').optional(),
  ),
  placeName: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .max(PLACE_NAME_MAX, `Place name must be at most ${PLACE_NAME_MAX} characters.`)
      .optional(),
  ),
  details: z
    .string({ error: 'Describe the correction.' })
    .trim()
    .min(DETAILS_MIN, `Details must be at least ${DETAILS_MIN} characters.`)
    .max(DETAILS_MAX, `Details must be at most ${DETAILS_MAX} characters.`),
  sourceUrl: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .max(SOURCE_URL_MAX, 'Source link is too long.')
      .refine(isHttpUrl, 'Source link must be a full http:// or https:// address.')
      .optional(),
  ),
});

export interface CorrectionDraft {
  kind: CorrectionKind;
  placeId?: string;
  placeName?: string;
  details: string;
  sourceUrl?: string;
}

export type CorrectionValidation = { ok: true; value: CorrectionDraft } | { ok: false; errors: string[] };

export function validateCorrection(d: unknown): CorrectionValidation {
  const result = correctionDraftSchema.safeParse(d);
  if (!result.success) {
    return { ok: false, errors: result.error.issues.map((issue) => issue.message) };
  }
  const { kind, placeId, placeName, details, sourceUrl } = result.data;
  const value: CorrectionDraft = { kind, details };
  if (placeId !== undefined) value.placeId = placeId;
  if (placeName !== undefined) value.placeName = placeName;
  if (sourceUrl !== undefined) value.sourceUrl = sourceUrl;
  return { ok: true, value };
}
