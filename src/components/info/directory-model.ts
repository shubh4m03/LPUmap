import { getCategory } from '../../config/index.ts';
import type { Place } from '../../data/index.ts';

export interface OrgGroup {
  categoryId: string;
  label: string;
  places: Place[];
}

/**
 * Group headings for organisation records. The 'academic' category is labelled
 * "Academic building" for map features, but its organisation records are the
 * schools and disciplines from LPU's schools index, not buildings.
 */
const ORG_GROUP_LABELS: Readonly<Record<string, string>> = { academic: 'Schools and disciplines' };

/** Organisation records (schools, departments, services) grouped by category label, sorted by name. */
export function groupOrganizations(places: readonly Place[]): OrgGroup[] {
  const groups = new Map<string, Place[]>();
  for (const p of places) {
    if (p.kind !== 'organization') continue;
    const list = groups.get(p.categoryId) ?? [];
    list.push(p);
    groups.set(p.categoryId, list);
  }
  return [...groups.entries()]
    .map(([categoryId, list]) => ({
      categoryId,
      label: ORG_GROUP_LABELS[categoryId] ?? getCategory(categoryId).label,
      places: list.sort((a, b) => a.displayName.localeCompare(b.displayName, 'en')),
    }))
    .sort((a, b) => b.places.length - a.places.length || a.label.localeCompare(b.label, 'en'));
}
