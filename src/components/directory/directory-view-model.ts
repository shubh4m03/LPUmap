/**
 * Pure view model of the building directory panel (docs/ISOMETRIC_AND_3D_DESIGN.md
 * §7.5; docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §5): search (map keys, exact
 * illustration labels and artwork numbers included), category filter, grouping
 * by grid cell, category or the illustration's own block captions, and the
 * honest row wording. The panel is the accessible alternative to every canvas
 * (§8.5): every building drawn is listed here, and so is every item of the
 * campus illustration.
 */
import { getCategory } from '../../config/categories.ts';
import type {
  ArtworkThumbnail,
  CampusDirectory,
  DirectoryEntry,
  DirectoryItem,
} from '../../directory/index.ts';
import type { ArtworkOnlyEntry } from '../../isometric-art/directory.ts';
import {
  ASSOCIATION_STATUS_TEXT,
  BUILDING_VERIFIED_ARTWORK_TEXT,
  type StatusText,
} from '../../isometric-art/text.ts';

export type DirectoryGrouping = 'cell' | 'category' | 'artwork';

export interface DirectoryGroup {
  id: string;
  label: string;
  /** Map buildings of this group, in display order. */
  entries: DirectoryEntry[];
  /** Every row of this group in display order (buildings and illustration items). */
  items: DirectoryItem[];
  /** Illustration grouping: the vignette that prints this caption (shown whole, never cropped). */
  thumbnail?: ArtworkThumbnail | null;
  /** Illustration grouping: the label is an exact caption printed on the artwork. */
  printedCaption?: boolean;
}

export interface DirectoryViewOptions {
  query: string;
  /**
   * null = all. In the cell/category groupings an app category id; in the
   * illustration grouping an index section heading printed on the overview
   * (exact text, e.g. "EDUCATION").
   */
  categoryId: string | null;
  grouping: DirectoryGrouping;
}

export interface DirectoryView {
  groups: DirectoryGroup[];
  /** Map buildings in display order (back-compatible: buildings only). */
  rows: DirectoryEntry[];
  /** Every row in display order (what arrow keys walk through). */
  items: DirectoryItem[];
  total: number;
  keyed: number;
  /** Items of the illustration not linked to a verified building (0 when the artwork is not loaded). */
  artworkOnly: number;
  /** True when a query is active: rows are in relevance order. */
  searching: boolean;
}

const UNKEYED_GROUP = 'unkeyed';
export const UNKEYED_GROUP_LABEL = 'Small structures and buildings without a map key';
export const ARTWORK_MATCHES_LABEL = 'On the campus illustration';
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

/** Illustration grouping filter: the index sections printed on the overview (exact), with counts. */
export function artworkSectionOptions(dir: CampusDirectory): { id: string; label: string; count: number }[] {
  return (dir.artwork?.sections ?? []).map((s) => ({ id: s.text, label: s.text, count: s.count }));
}

const building = (e: DirectoryEntry): DirectoryItem => ({ kind: 'building', id: e.id, entry: e });

/** Index section (exact) of a row in the illustration grouping. */
function sectionOfItem(dir: CampusDirectory, item: DirectoryItem): ReadonlySet<string> {
  const art = dir.artwork;
  if (!art) return new Set();
  const ids = item.kind === 'artwork' ? [item.id] : item.entry.artwork.map((l) => l.subjectId);
  return new Set(ids.map((id) => art.sectionOf.get(id)).filter((t): t is string => !!t));
}

export function directoryView(dir: CampusDirectory, opts: DirectoryViewOptions): DirectoryView {
  const q = opts.query.trim();
  const base = {
    total: dir.entries.length,
    keyed: dir.entries.filter((e) => e.key !== null).length,
    artworkOnly: dir.artwork?.entries.length ?? 0,
  };
  const finish = (groups: DirectoryGroup[], searching: boolean): DirectoryView => {
    const items = groups.flatMap((g) => g.items);
    const seen = new Set<string>();
    const rows: DirectoryEntry[] = [];
    for (const it of items)
      if (it.kind === 'building' && !seen.has(it.id)) {
        seen.add(it.id);
        rows.push(it.entry);
      }
    return { ...base, groups, rows, items, searching };
  };

  if (opts.grouping === 'artwork') return finish(artworkGroups(dir, opts, q), q !== '');

  const inCategory = (e: DirectoryEntry) => opts.categoryId === null || e.categoryId === opts.categoryId;
  if (q !== '') {
    const found = dir.find(q);
    const buildings = found
      .filter((i): i is Extract<DirectoryItem, { kind: 'building' }> => i.kind === 'building')
      .filter((i) => inCategory(i.entry));
    // Illustration items carry no app category: listed only when no category filter is set.
    const artwork = opts.categoryId === null ? found.filter((i) => i.kind === 'artwork') : [];
    const groups: DirectoryGroup[] = [];
    if (buildings.length > 0)
      groups.push({
        id: 'matches',
        label: 'Matches',
        entries: buildings.map((i) => i.entry),
        items: buildings,
      });
    if (artwork.length > 0)
      groups.push({ id: 'artwork-matches', label: ARTWORK_MATCHES_LABEL, entries: [], items: artwork });
    return finish(groups, true);
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
    items: byGroup.get(id)!.map(building),
  }));
  return finish(groups, false);
}

/** The illustration's own organisation: printed block captions first, then the rest. */
function artworkGroups(dir: CampusDirectory, opts: DirectoryViewOptions, q: string): DirectoryGroup[] {
  const art = dir.artwork;
  if (!art) return [];
  const inSection = (it: DirectoryItem) =>
    opts.categoryId === null || sectionOfItem(dir, it).has(opts.categoryId);
  if (q !== '') {
    // Search keeps the panel's single relevance list; map buildings without an illustration item are left out here.
    const items = dir
      .find(q)
      .filter(
        (it) =>
          it.kind === 'artwork' || it.entry.artwork.length > 0 || it.entry.unconfirmedArtwork.length > 0,
      )
      .filter(inSection);
    return items.length > 0
      ? [
          {
            id: 'matches',
            label: 'Matches',
            entries: items.flatMap((i) => (i.kind === 'building' ? [i.entry] : [])),
            items,
          },
        ]
      : [];
  }
  return art.groups
    .map((g) => {
      const items = g.items.filter(inSection);
      return {
        id: g.id,
        label: g.label,
        entries: items.flatMap((i) => (i.kind === 'building' ? [i.entry] : [])),
        items,
        thumbnail: g.thumbnail,
        printedCaption: g.kind === 'block-caption',
      };
    })
    .filter((g) => g.items.length > 0);
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

export type ArtworkStatusKind = 'verified' | 'unconfirmed' | 'unresolved';

/**
 * Association status indicator (text always shown; colour is never the only
 * signal), from the shared wording in src/isometric-art/text.ts. `verified` is
 * seen from the map building; the other two from the illustration item.
 * "Unconfirmed match" is the only wording for an approximate link.
 */
export const ARTWORK_STATUS: Record<ArtworkStatusKind, StatusText> = {
  verified: BUILDING_VERIFIED_ARTWORK_TEXT,
  unconfirmed: ASSOCIATION_STATUS_TEXT.approximate,
  unresolved: ASSOCIATION_STATUS_TEXT.unresolved,
};

export function artworkStatusOf(e: ArtworkOnlyEntry): ArtworkStatusKind {
  return e.association.status === 'approximate' && e.unconfirmedMatch ? 'unconfirmed' : 'unresolved';
}

/** Summary line for the panel header and the mobile peek. */
export function directorySummary(
  v: Pick<DirectoryView, 'total' | 'keyed'> & { artworkOnly?: number },
): string {
  const art =
    v.artworkOnly && v.artworkOnly > 0
      ? ` · ${v.artworkOnly} more ${v.artworkOnly === 1 ? 'item' : 'items'} on the illustration`
      : '';
  return `${v.total} campus buildings · ${v.keyed} with a map key${art}`;
}
