/**
 * Palette commands and layer docs. Every command listed here is wired in
 * useCommandRunner — none is a placeholder.
 */
import { categoriesInGroup, LAYER_GROUPS, type LayerGroupId } from '../config/index.ts';
import type { SearchDoc } from '../search/index.ts';
import type { IconName } from '../components/icons/index.ts';

export type CommandId =
  | 'toggle-3d'
  | 'toggle-theme'
  | 'reset-view'
  | 'show-layers'
  | 'locate'
  | 'track-walk'
  | 'about'
  | 'settings'
  | 'report'
  | 'campus-info'
  | 'favorites';

export interface CommandDef {
  id: CommandId;
  title: string;
  icon: IconName;
  keywords: string[];
  /** Needs the interactive map (hidden in list mode). */
  needsMap?: boolean;
}

export const COMMANDS: readonly CommandDef[] = [
  {
    id: 'toggle-3d',
    title: 'Toggle 3D buildings',
    icon: 'cube',
    keywords: ['3d', '2d', 'tilt', 'perspective', 'view'],
    needsMap: true,
  },
  {
    id: 'toggle-theme',
    title: 'Toggle dark theme',
    icon: 'moon',
    keywords: ['dark', 'light', 'theme', 'night', 'mode'],
  },
  {
    id: 'reset-view',
    title: 'Reset map view',
    icon: 'reset',
    keywords: ['reset', 'home', 'recenter', 'campus', 'view'],
    needsMap: true,
  },
  {
    id: 'show-layers',
    title: 'Show map layers',
    icon: 'layers',
    keywords: ['layers', 'filter', 'legend', 'labels'],
  },
  {
    id: 'locate',
    title: 'Show my location',
    icon: 'locate',
    keywords: ['gps', 'location', 'locate', 'where am i', 'me'],
  },
  {
    id: 'track-walk',
    title: 'Track my walk',
    icon: 'history',
    keywords: ['track', 'walk', 'record', 'distance', 'time', 'tracking'],
  },
  {
    id: 'favorites',
    title: 'Saved places',
    icon: 'heart',
    keywords: ['favorites', 'favourites', 'saved', 'starred', 'bookmarks'],
  },
  {
    id: 'about',
    title: 'About this map & data sources',
    icon: 'info',
    keywords: ['about', 'data', 'sources', 'licence', 'license', 'attribution', 'credits', 'osm'],
  },
  {
    id: 'settings',
    title: 'Settings & privacy',
    icon: 'settings',
    keywords: ['settings', 'privacy', 'history', 'preferences', 'theme'],
  },
  {
    id: 'report',
    title: 'Report a correction',
    icon: 'flag',
    keywords: ['report', 'missing', 'wrong', 'feedback', 'correction', 'fix'],
  },
  {
    id: 'campus-info',
    title: 'Campus information',
    icon: 'school',
    keywords: ['campus', 'info', 'lpu', 'university', 'contact'],
  },
];

export const COMMAND_DOC_PREFIX = 'command:';
export const LAYER_DOC_PREFIX = 'layer:';

export function commandDocs(): SearchDoc[] {
  return COMMANDS.map((c) => ({
    id: `${COMMAND_DOC_PREFIX}${c.id}`,
    kind: 'command',
    title: c.title,
    subtitle: 'Command',
    aliases: [],
    codes: [],
    keywords: c.keywords,
    ref: c.id,
    hasLocation: false,
  }));
}

/** Located places per layer group, derived from data counts. */
export function groupCount(group: LayerGroupId, locatedCounts: Record<string, number>): number {
  return categoriesInGroup(group).reduce((n, c) => n + (locatedCounts[c.id] ?? 0), 0);
}

export function layerDocs(locatedCounts: Record<string, number>): SearchDoc[] {
  return LAYER_GROUPS.map((g) => {
    const n = groupCount(g.id, locatedCounts);
    return {
      id: `${LAYER_DOC_PREFIX}${g.id}`,
      kind: 'layer',
      title: `Map layer: ${g.label}`,
      subtitle: n === 0 ? 'Map layer · none mapped yet' : `Map layer · ${n} on the map`,
      aliases: [],
      codes: [],
      keywords: ['layer', 'show', 'hide'],
      ref: g.id,
      hasLocation: false,
    };
  });
}

export function isCommandId(v: string): v is CommandId {
  return COMMANDS.some((c) => c.id === v);
}

/** Commands that only make sense with the interactive map. */
export function commandNeedsMap(id: string): boolean {
  return COMMANDS.find((c) => c.id === id)?.needsMap === true;
}

export function commandIcon(id: string): IconName {
  return COMMANDS.find((c) => c.id === id)?.icon ?? 'keyboard';
}
