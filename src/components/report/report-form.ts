/** Pure helpers for the correction form: initial draft, per-field validation. */
import type { ReportTarget } from '../../app/store/index.ts';
import {
  correctionDraftSchema,
  validateCorrection,
  type CorrectionDraft,
  type CorrectionFormDraft,
} from '../../feedback/index.ts';

export type FieldName = 'kind' | 'placeName' | 'details' | 'sourceUrl';
export type FieldErrors = Partial<Record<FieldName, string>>;

/** Order in which invalid fields receive focus. */
export const FIELD_ORDER: readonly FieldName[] = ['kind', 'placeName', 'details', 'sourceUrl'];

export function freshDraft(target: ReportTarget): CorrectionFormDraft {
  return {
    kind: target.kind ?? '',
    placeId: target.placeId ?? '',
    placeName: target.placeName ?? '',
    details: '',
    sourceUrl: '',
  };
}

export function hasUserContent(d: CorrectionFormDraft): boolean {
  return d.details.trim() !== '' || d.sourceUrl.trim() !== '';
}

/**
 * The session draft is restored only when it has something the user typed and
 * is about the same thing (same place id; for reports not tied to a place, the
 * same suggested name or none). Otherwise the form starts fresh from the target
 * and the older draft is left alone until the user starts typing.
 */
export function initialDraft(
  target: ReportTarget,
  saved: CorrectionFormDraft,
): { draft: CorrectionFormDraft; restored: boolean } {
  const placeId = target.placeId ?? '';
  const sameTarget =
    saved.placeId === placeId &&
    (placeId !== '' || target.placeName === undefined || saved.placeName === target.placeName);
  if (sameTarget && hasUserContent(saved)) {
    return { draft: { ...saved, kind: saved.kind || (target.kind ?? '') }, restored: true };
  }
  return { draft: freshDraft(target), restored: false };
}

export type FormValidation = { ok: true; value: CorrectionDraft } | { ok: false; errors: FieldErrors };

/** Validates with the feedback module's schema and maps each issue to its field. */
export function validateForm(d: CorrectionFormDraft): FormValidation {
  const input = { ...d, kind: d.kind === '' ? undefined : d.kind };
  const parsed = correctionDraftSchema.safeParse(input);
  if (!parsed.success) {
    const errors: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      const field: FieldName = key === 'kind' || key === 'placeName' || key === 'sourceUrl' ? key : 'details';
      errors[field] ??= issue.message;
    }
    return { ok: false, errors };
  }
  const result = validateCorrection(input);
  return result.ok ? { ok: true, value: result.value } : { ok: false, errors: { details: result.errors[0] } };
}

export function errorSummary(errors: FieldErrors): string {
  const messages = FIELD_ORDER.flatMap((f) => (errors[f] ? [errors[f]] : []));
  const count = messages.length === 1 ? '1 problem' : `${messages.length} problems`;
  return `The report has ${count}: ${messages.join(' ')}`;
}
