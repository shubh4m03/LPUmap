/**
 * Pure view model of the building directory panel (docs/ISOMETRIC_AND_3D_DESIGN.md
 * §7.5): search (map keys included), category filter, grouping by grid cell or
 * category, and the honest row wording. The panel is the accessible
 * alternative to every canvas (§8.5): every building drawn is listed here.
 */
import { getCategory } from '../../config/categories.ts';
import type { CampusDirectory, DirectoryEntry } from '../../directory/index.ts';

export type DirectoryGrouping = 'cell' | 'category';

export interface DirectoryGroup {
  id: string;
  label: string;
  entries: DirectoryEntry[];
}

export interface DirectoryViewOptions {
  query: string;
  /** null = all categories. */
  categoryId: string | null;
  grouping: DirectoryGrouping;
}

export interface DirectoryView {
  groups: DirectoryGroup[];
  /** Rows in display order (what arrow keys walk through). */
  rows: DirectoryEntry[];
  total: number;
  keyed: number;
  /** True when a query is active: rows are in relevance order under one group. */
  searching: boolean;
}

const UNKEYED_GROUP = 'unkeyed';
export const UNKEYED_GROUP_LABEL = 'Small structures and buildings without a map key';
const CELL_RE = /^([A-Z])(\d{1,2})$/;

function compareCells(a: string, b: string): number {
  const ma = CELL_RE.exec(a);
  const mb = CELL_RE.exec(b);
  if (!ma || !mb) return a < b ? -1 : a > b ? 1 : 0;
  return ma[1]!.localeCompare(mb[1]!) || Number(ma[2]) - Number(mb[2]);
}

/** Category options present in the directory, with counts, most common first. */
export function categoryOptions(
  entries: readonly DirectoryEntry[],
): { id: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.categoryId, (counts.get(e.categoryId) ?? 0) + 1);
  return [...counts]
    .map(([id, count]) => ({ id, label: getCategory(id).label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function directoryView(dir: CampusDirectory, opts: DirectoryViewOptions): DirectoryView {
  const q = opts.query.trim();
  const inCategory = (e: DirectoryEntry) => opts.categoryId === null || e.categoryId === opts.categoryId;
  const base = {
    total: dir.entries.length,
    keyed: dir.entries.filter((e) => e.key !== null).length,
  };
  if (q !== '') {
    const rows = dir.search(q).filter(inCategory);
    return {
      ...base,
      rows,
      searching: true,
      groups: rows.length > 0 ? [{ id: 'matches', label: 'Matches', entries: rows }] : [],
    };
  }
  const entries = dir.entries.filter(inCategory);
  const byGroup = new Map<string, DirectoryEntry[]>();
  for (const e of entries) {
    const id = opts.grouping === 'cell' ? (e.cell ?? UNKEYED_GROUP) : e.categoryId;
    const list = byGroup.get(id);
    if (list) list.push(e);
    else byGroup.set(id, [e]);
  }
  let ids = [...byGroup.keys()];
  if (opts.grouping === 'cell')
    ids = ids.sort((a, b) => (a === UNKEYED_GROUP ? 1 : b === UNKEYED_GROUP ? -1 : compareCells(a, b)));
  else
    ids = ids.sort(
      (a, b) =>
        byGroup.get(b)!.length - byGroup.get(a)!.length ||
        getCategory(a).label.localeCompare(getCategory(b).label),
    );
  const groups = ids.map((id) => ({
    id,
    label:
      opts.grouping === 'cell'
        ? id === UNKEYED_GROUP
          ? UNKEYED_GROUP_LABEL
          : `Grid cell ${id}`
        : getCategory(id).label,
    entries: byGroup.get(id)!,
  }));
  return { ...base, groups, rows: groups.flatMap((g) => g.entries), searching: false };
}

/** Height badge wording (legend semantics; never presented as a measurement unless it is one). */
export function heightBadge(e: DirectoryEntry): { text: string; tone: 'neutral' | 'warning' } {
  switch (e.renderHeightSource) {
    case 'osm-height':
      return { text: `${Math.round(e.renderHeightM)} m (mapped)`, tone: 'neutral' };
    case 'osm-levels-estimate':
      return {
        text:
          e.levels !== null
            ? `≈ ${Math.round(e.renderHeightM)} m, est. from ${e.levels} floors`
            : 'Height estimated',
        tone: 'neutral',
      };
    case 'fallback':
      return { text: 'No height data', tone: 'warning' };
    case 'studio-model':
      return { text: 'Illustrative model height', tone: 'warning' };
  }
}

/** "1 facility" / "No facilities recorded". */
export function facilityText(e: DirectoryEntry): string {
  const n = e.facilityIds.length + e.organizationIds.length;
  if (n === 0) return 'No facilities recorded yet';
  return n === 1 ? '1 facility or organisation' : `${n} facilities or organisations`;
}

/** Summary line for the panel header and the mobile peek. */
export function directorySummary(v: Pick<DirectoryView, 'total' | 'keyed'>): string {
  return `${v.total} campus buildings · ${v.keyed} with a map key`;
}
