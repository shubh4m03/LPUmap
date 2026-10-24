/**
 * Base-place overrides model (pure): list tabs, a one-line summary of what an
 * override changes, base-place search, and the PUT body. A PUT replaces the
 * override's fields, so fields this screen does not edit are carried over
 * unchanged from the stored override (never silently dropped).
 */
import type { OverrideFields } from '../../../community/schema.ts';
import type { Place } from '../../../data/schema.ts';
import type { PutOverrideBody } from '../../api/community.ts';
import type { OverrideRecord, OverrideView } from '../../api/schemas.ts';
import { categoryLabel, ORPHAN_REASON_LABELS } from '../../ui/format.ts';

export type OverrideTab = 'all' | 'hidden' | 'orphans';

export function parseOverrideTab(query: Readonly<Record<string, string>>): OverrideTab {
  return query.tab === 'hidden' || query.tab === 'orphans' ? query.tab : 'all';
}

export function filterOverrides(items: readonly OverrideView[], tab: OverrideTab): OverrideView[] {
  const out = items.filter((o) => (tab === 'hidden' ? o.hidden : tab === 'orphans' ? o.orphan : true));
  return out.sort((a, b) => (a.baseName ?? a.targetId).localeCompare(b.baseName ?? b.targetId));
}

/** What an override changes, in words (never empty: an override exists for a reason). */
export function overrideSummary(
  o: Pick<OverrideView, 'fields' | 'hidden' | 'accessNodeId' | 'orphan' | 'orphanReason'>,
): string[] {
  const out: string[] = [];
  if (o.orphan) out.push(o.orphanReason ? ORPHAN_REASON_LABELS[o.orphanReason] : 'Orphaned');
  if (o.hidden) out.push('Hidden from the public map');
  if (o.fields.name !== undefined) out.push(`Renamed to “${o.fields.name}”`);
  if (o.fields.categoryId !== undefined) out.push(`Category: ${categoryLabel(o.fields.categoryId)}`);
  const others = Object.keys(o.fields).filter((k) => k !== 'name' && k !== 'categoryId');
  if (others.length > 0) out.push(`Also changes: ${others.join(', ')}`);
  if (o.accessNodeId !== null) out.push(`Owner access point (path node ${o.accessNodeId})`);
  if (out.length === 0) out.push('No changes recorded');
  return out;
}

const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/** Campus places matching `q` by name, aliases or id; exact-prefix matches first. */
export function searchBasePlaces(places: readonly Place[], q: string, limit = 20): Place[] {
  const needle = fold(q.trim());
  if (needle.length < 2) return [];
  const scored: Array<[number, Place]> = [];
  for (const p of places) {
    const names = [p.displayName, p.name ?? '', ...p.aliases].map(fold);
    let score = -1;
    if (names.some((n) => n.startsWith(needle))) score = 0;
    else if (names.some((n) => n.includes(needle))) score = 1;
    else if (p.id.toLowerCase().includes(needle)) score = 2;
    if (score >= 0) scored.push([score, p]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].displayName.localeCompare(b[1].displayName));
  return scored.slice(0, limit).map(([, p]) => p);
}

export interface OverrideFormValues {
  /** '' = keep the base name. */
  name: string;
  /** '' = keep the base category. */
  categoryId: string;
  hidden: boolean;
  note: string;
}

export function overrideForm(o: OverrideRecord | null): OverrideFormValues {
  return {
    name: o?.fields.name ?? '',
    categoryId: o?.fields.categoryId ?? '',
    hidden: o?.hidden ?? false,
    note: o?.note ?? '',
  };
}

/**
 * PUT body: stored fields carried over, then name / category from the form
 * (a value equal to the base value, or empty, removes that field). The server
 * drops fields equal to the base values as well.
 */
export function overridePutBody(
  place: Place,
  o: OverrideRecord | null,
  v: OverrideFormValues,
  accessPoint: { nodeId: number; note?: string } | null | undefined,
): PutOverrideBody {
  const fields: OverrideFields = { ...(o?.fields ?? {}) };
  delete fields.name;
  delete fields.categoryId;
  const name = v.name.trim();
  if (name && name !== place.name) fields.name = name;
  if (v.categoryId && v.categoryId !== place.categoryId) fields.categoryId = v.categoryId;
  const body: PutOverrideBody = { revision: o?.revision ?? null, fields, hidden: v.hidden };
  if (accessPoint !== undefined) body.accessPoint = accessPoint;
  const note = v.note.trim();
  if (note !== (o?.note ?? '')) body.note = note;
  return body;
}
