/**
 * Pure display helpers for the admin: labels for server enums, dates,
 * coordinates and category options. Nothing here invents a value: unknown
 * input is shown as-is.
 */
import { ASSIGNABLE_CATEGORY_IDS, type SuggestionStatus } from '../../community/schema.ts';
import { VERIFICATION_BADGE, type BadgeTone } from '../../components/ui/badge-meta.ts';
import { getCategory } from '../../config/categories.ts';
import type { LngLat, VerificationStatus, Wheelchair } from '../../data/schema.ts';
import type { OrphanReason, QualityWarningKind } from '../api/schemas.ts';
import type { SelectOption } from './fields.tsx';

export const SUGGESTION_STATUS_LABELS: Readonly<Record<SuggestionStatus, string>> = {
  pending: 'Pending',
  needs_information: 'Needs information',
  approved: 'Approved',
  rejected: 'Rejected',
  duplicate: 'Duplicate',
};

export const SUGGESTION_STATUS_TONES: Readonly<Record<SuggestionStatus, BadgeTone>> = {
  pending: 'warning',
  needs_information: 'info',
  approved: 'success',
  rejected: 'neutral',
  duplicate: 'neutral',
};

export const ORPHAN_REASON_LABELS: Readonly<Record<OrphanReason, string>> = {
  'context-layer': 'Now an off-campus place',
  'boundary-review': 'Held for boundary review',
  'not-in-dataset': 'No longer in the dataset',
};

/** Why an orphan is not applied, and what to do (docs/ADMIN_OPERATIONS.md §5, docs/DATA_ROLLBACK.md). */
export const ORPHAN_REASON_ADVICE: Readonly<Record<OrphanReason, string>> = {
  'context-layer':
    'The place is now in the optional "Nearby, outside campus" layer. Owner overrides apply to campus places only, so this one is not applied. Keep it if a boundary decision may bring the place back.',
  'boundary-review':
    'The place is held out of the campus inventory while its boundary section is reviewed. The override applies again automatically once the owner confirms the place is on campus. Keep it.',
  'not-in-dataset':
    'The place is no longer in the dataset (for example an off-campus building or a removed duplicate). It is never applied to another feature. Delete it only when you are sure it is obsolete: a rollback to an older dataset would apply it again (docs/DATA_ROLLBACK.md).',
};

export const ORPHAN_GENERAL_ADVICE =
  'Orphaned overrides are never applied to a different place and are never deleted automatically. A deletion is not undone by rolling back the data or the code, so delete an orphan only when you are sure it is obsolete (see docs/DATA_ROLLBACK.md and docs/ADMIN_OPERATIONS.md §5).';

export const QUALITY_KIND_LABELS: Readonly<Record<QualityWarningKind, string>> = {
  'orphan-override': 'Orphaned overrides',
  'override-access-invalid': 'Override access points no longer valid',
  'location-outside-boundary': 'Locations outside the campus boundary',
  'location-not-routable': 'Locations without an access point (not routable)',
  'possible-duplicate': 'Possible duplicates among published places',
  'stale-pending': 'Suggestions pending for more than 14 days',
};

export const WHEELCHAIR_OPTIONS: readonly SelectOption[] = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'yes', label: 'Yes' },
  { value: 'limited', label: 'Limited' },
  { value: 'no', label: 'No' },
] satisfies ReadonlyArray<{ value: Wheelchair; label: string }>;

export const VERIFICATION_OPTIONS: readonly SelectOption[] = (
  ['unverified', 'verified', 'imported', 'estimated'] as const satisfies readonly VerificationStatus[]
).map((v) => ({ value: v, label: VERIFICATION_BADGE[v].label }));

export const categoryLabel = (id: string): string => getCategory(id).label;

/** Assignable categories, alphabetical by label. */
export const CATEGORY_OPTIONS: readonly SelectOption[] = ASSIGNABLE_CATEGORY_IDS.map((id) => ({
  value: id,
  label: categoryLabel(id),
})).sort((a, b) => a.label.localeCompare(b.label));

const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** "24 Oct 2026, 11:35" in the viewer's time zone; the raw text when it is not a date. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : DATE_TIME.format(new Date(t));
}

/** Six decimals (~0.1 m), longitude first as stored. */
export function formatLngLat(p: LngLat): string {
  return `${p[1].toFixed(6)}, ${p[0].toFixed(6)}`;
}

export const formatMetres = (m: number): string => `${m < 10 ? m.toFixed(1) : Math.round(m)} m`;
