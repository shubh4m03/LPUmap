/** Pure view-model for the command palette: sections and flat option order. */
import { commandIcon, commandNeedsMap } from '../../app/commands.ts';
import { getCategory, LAYER_GROUPS, categoriesInGroup } from '../../config/categories.ts';
import type { Place } from '../../data/index.ts';
import { highlightSegments, type SearchDocKind, type SearchHit } from '../../search/index.ts';
import { iconForCategory, type IconName, type TitleSegment } from '../ui/index.ts';

export type SectionId = 'recent' | 'favorites' | 'places' | 'categories' | 'commands';

export interface PaletteItem {
  key: string;
  kind: SearchDocKind;
  /** Place id, category id, layer group id or command id. */
  ref: string;
  title: string;
  segments?: TitleSegment[];
  subtitle?: string;
  icon: IconName;
  iconColor?: string;
  /** Place with no verified position: selectable, never flown to or routed. */
  noLocation?: boolean;
}

export interface PaletteSection {
  id: SectionId;
  label: string;
  items: PaletteItem[];
}

const SECTION_LABELS: Record<SectionId, string> = {
  recent: 'Recent',
  favorites: 'Saved places',
  places: 'Places',
  categories: 'Categories',
  commands: 'Commands',
};

const SECTION_OF: Record<SearchDocKind, SectionId> = {
  place: 'places',
  category: 'categories',
  layer: 'commands',
  command: 'commands',
};

function layerIcon(groupId: string): IconName {
  const first = LAYER_GROUPS.some((g) => g.id === groupId)
    ? categoriesInGroup(groupId as (typeof LAYER_GROUPS)[number]['id'])[0]
    : undefined;
  return first ? iconForCategory(first.icon) : 'layers';
}

/** `qualifier` tells same-named places apart (SearchDoc.qualifier), e.g. 'Facility'. */
export function placeItem(place: Place, key: string, qualifier?: string): PaletteItem {
  const category = getCategory(place.categoryId);
  const zone = place.campusZone === 'off-campus-nearby' ? ' · Off campus (nearby)' : '';
  const base =
    place.location === null ? `${category.label} · No verified map position` : `${category.label}${zone}`;
  return {
    key,
    kind: 'place',
    ref: place.id,
    title: place.displayName,
    subtitle: qualifier ? `${base} · ${qualifier}` : base,
    icon: iconForCategory(category.icon),
    iconColor: category.color,
    noLocation: place.location === null,
  };
}

function hitItem(hit: SearchHit, getPlace: (id: string) => Place | undefined): PaletteItem | null {
  const { doc } = hit;
  const segments = highlightSegments(doc.title, hit.highlights);
  const base = { key: doc.id, kind: doc.kind, ref: doc.ref, title: doc.title, segments };
  if (doc.kind === 'place') {
    const place = getPlace(doc.ref);
    if (!place) return null;
    return { ...placeItem(place, doc.id, doc.qualifier), title: doc.title, segments };
  }
  if (doc.kind === 'category') {
    const c = getCategory(doc.ref);
    return {
      ...base,
      subtitle: doc.subtitle ?? 'Category',
      icon: iconForCategory(c.icon),
      iconColor: c.color,
    };
  }
  if (doc.kind === 'layer')
    return { ...base, subtitle: doc.subtitle ?? 'Map layer', icon: layerIcon(doc.ref) };
  return { ...base, subtitle: doc.subtitle ?? 'Command', icon: commandIcon(doc.ref) };
}

/** Groups hits into sections; a section's position follows its best-ranked hit. */
export function buildResultSections(
  hits: readonly SearchHit[],
  opts: { listMode: boolean; getPlace(id: string): Place | undefined },
): PaletteSection[] {
  const sections = new Map<SectionId, PaletteSection>();
  for (const hit of hits) {
    if (
      opts.listMode &&
      (hit.doc.kind === 'layer' || (hit.doc.kind === 'command' && commandNeedsMap(hit.doc.ref)))
    )
      continue;
    const item = hitItem(hit, opts.getPlace);
    if (!item) continue;
    const id = SECTION_OF[hit.doc.kind];
    let section = sections.get(id);
    if (!section) {
      section = { id, label: SECTION_LABELS[id], items: [] };
      sections.set(id, section);
    }
    section.items.push(item);
  }
  return [...sections.values()];
}

/** Recent and saved places for an empty query (ids no longer in the data are dropped). */
export function buildIdleSections(
  recentIds: readonly string[],
  favoriteIds: readonly string[],
  getPlace: (id: string) => Place | undefined,
): PaletteSection[] {
  const make = (id: SectionId, ids: readonly string[]): PaletteSection | null => {
    const items = ids
      .map((pid) => getPlace(pid))
      .filter((p): p is Place => p !== undefined)
      .map((p) => placeItem(p, `${id}:${p.id}`));
    return items.length ? { id, label: SECTION_LABELS[id], items } : null;
  };
  return [make('recent', recentIds), make('favorites', favoriteIds)].filter(
    (s): s is PaletteSection => s !== null,
  );
}

export function flattenSections(sections: readonly PaletteSection[]): PaletteItem[] {
  return sections.flatMap((s) => s.items);
}
