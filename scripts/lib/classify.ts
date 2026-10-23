/**
 * Category classification from OSM tags using CATEGORIES[].osm matchers.
 *
 * Priority (documented in data/README.md):
 *   1. "Use" matchers — any matcher whose key is not `building` (amenity,
 *      shop, tourism, leisure, barrier, entrance, …), in registry order. What
 *      happens in a place beats what the structure is.
 *   2. Building-type matchers with explicit values (building=university →
 *      academic, building=dormitory → hostel, …), in registry order.
 *   3. The generic `building` category (any building=* value).
 * Within a pass the registry order decides, so specific categories listed
 * before generic ones (food's shop=bakery before shop's shop=*) win.
 * The value "no" never matches a key-only matcher (building=no is not a building).
 */
import { CATEGORIES } from '../../src/config/categories.ts';
import type { CategoryDef, OsmMatcher } from '../../src/config/categories.ts';
import type { Tags } from './osm-parse.ts';

export function matchesMatcher(tags: Tags, m: OsmMatcher): boolean {
  const v = tags[m.key];
  if (v === undefined || v === '') return false;
  if (!m.values) return v !== 'no';
  return v.split(';').some((part) => m.values!.includes(part.trim()));
}

const isGenericBuilding = (m: OsmMatcher) => m.key === 'building' && !m.values;

export function classifyTags(tags: Tags, categories: readonly CategoryDef[] = CATEGORIES): string | null {
  const passes: Array<(m: OsmMatcher) => boolean> = [
    (m) => m.key !== 'building',
    (m) => m.key === 'building' && !isGenericBuilding(m),
    isGenericBuilding,
  ];
  for (const inPass of passes) {
    for (const cat of categories) {
      if (cat.osm.some((m) => inPass(m) && matchesMatcher(tags, m))) return cat.id;
    }
  }
  return null;
}

export function isBuildingTagged(tags: Tags): boolean {
  const b = tags.building;
  return b !== undefined && b !== '' && b !== 'no';
}

export function categoryIds(categories: readonly CategoryDef[] = CATEGORIES): Set<string> {
  return new Set(categories.map((c) => c.id));
}
