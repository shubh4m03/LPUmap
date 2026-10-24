/**
 * Public honesty label of a published studio model (S3). Pure, tiny, and
 * shared by the merge (place provenance notes, search and directory
 * subtitles) and the overview's info card, so every view says the same.
 *
 * VERIFICATION_LABELS describe the evidence for the RECORD (that the
 * building is there). A model built from a generic or stylized template is
 * still not the real building's design, so a verified record of such a model
 * says so: a generic prefab is never presented as a verified LPU building.
 */
import { VERIFICATION_LABELS, type AccuracyClass, type StudioVerificationStatus } from './schema.ts';

export const GENERIC_SHAPE_NOTE = 'shape and appearance from a generic template, not the real design';

export function studioPublicLabel(m: {
  verification: { status: StudioVerificationStatus };
  accuracyClass?: AccuracyClass;
}): string {
  const label = VERIFICATION_LABELS[m.verification.status];
  const generic =
    m.accuracyClass === undefined || m.accuracyClass === 'generic-prefab' || m.accuracyClass === 'stylized';
  return m.verification.status !== 'unverified' && generic ? `${label} (${GENERIC_SHAPE_NOTE})` : label;
}
