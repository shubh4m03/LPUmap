/**
 * Shown BEFORE a point outside the campus boundary is published (approve a
 * suggestion, create or move a location): what the public app will do with
 * it (owner decision 2, src/community/merge.ts rule 4a). Never blocks the
 * action; it states the consequence so the owner decides knowingly.
 */
import { Icon } from '../../components/icons/index.ts';
import type { CampusZoneVerdict } from './campus-zone.ts';

export const OUTSIDE_CAMPUS_TITLE = 'Outside the campus boundary';
export const OUTSIDE_CAMPUS_TEXT =
  'If published, it appears only in the opt-in “Nearby, outside campus” map layer — never in campus search results, categories, counts or the building directory — and it is not routable: directions cover campus places only.';

export function OutsideCampusNotice({ zone }: { zone: CampusZoneVerdict }) {
  if (zone !== 'outside') return null;
  return (
    <div
      role="status"
      data-testid="outside-campus-notice"
      className="flex items-start gap-2 rounded-md border border-warning bg-warning-soft p-3 text-sm"
    >
      <Icon name="warning" size={18} className="mt-px shrink-0 text-warning" />
      <div className="flex min-w-0 flex-col gap-1 text-text">
        <p className="font-semibold">{OUTSIDE_CAMPUS_TITLE}</p>
        <p>This point lies outside the campus boundary. {OUTSIDE_CAMPUS_TEXT}</p>
      </div>
    </div>
  );
}
