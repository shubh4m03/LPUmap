/**
 * The Studio's asset library: starter (code) templates plus the owner's
 * templates from GET /studio/library, as one searchable list. Pure.
 *
 *  - A code listing resolves to the built-in LibraryEntry (computed render
 *    cost and triangle counts); an owner listing gets the same fields
 *    computed from its own variants, so both look and search alike.
 *  - Retired templates stay listed for management but are never offered for
 *    new placements (S2).
 *  - Thumbnails are the deterministic SVGs of thumbnails.ts, delivered as
 *    data: URLs for <img> (the SVG contains no user text; colours are
 *    validated), so no markup is injected into the page.
 */
import {
  LIBRARY_CATEGORY_LABELS,
  modelFromVariant,
  starterLibrary,
  starterTemplate,
  type LibraryEntry,
} from '../editor.ts';
import { APP_CONFIG } from '../../config/index.ts';
import type { LngLat } from '../../data/index.ts';
import { generateStudioMeshDetailed } from '../index.ts';
import type { TemplateDefinition, TemplateListing } from '../index.ts';
import { modelThumbnailSvg, templateThumbnailSvg } from '../editor.ts';

export interface StudioLibraryItem extends LibraryEntry {
  source: 'code' | 'owner';
  status: 'active' | 'retired';
  /** Every version of this template known to the server (ascending). */
  versions: readonly number[];
  /** Owner templates: optimistic-concurrency revision; null for code templates. */
  revision: number | null;
}

const THUMB_ANCHOR: LngLat = [APP_CONFIG.map.center[0], APP_CONFIG.map.center[1]];

function computedEntry(definition: TemplateDefinition): LibraryEntry {
  const variantStats = definition.variants.map((v) => {
    const r = generateStudioMeshDetailed(modelFromVariant(v, { anchor: THUMB_ANCHOR, rotationDeg: 0 }));
    return { variantId: v.id, faces: r.ok ? r.mesh.faces.length : 0, triangles: r.ok ? r.triangles : 0 };
  });
  return {
    definition,
    categoryHints: [definition.suggestedCategoryId],
    categoryLabel: LIBRARY_CATEGORY_LABELS[definition.libraryCategory],
    variantStats,
    estimatedTriangles: Math.max(0, ...variantStats.map((s) => s.triangles)),
  };
}

/** Library items from the server listing (code + owner templates). */
export function libraryItems(listings: readonly TemplateListing[]): StudioLibraryItem[] {
  return listings.map((l) => {
    const code = l.source === 'code' ? starterTemplate(l.definition.id, l.definition.version) : null;
    const entry = code ?? computedEntry(l.definition);
    return { ...entry, source: l.source, status: l.status, versions: l.versions, revision: l.revision };
  });
}

/** The built-in templates only (when the server library cannot be loaded). */
export function builtInLibraryItems(): StudioLibraryItem[] {
  return starterLibrary().map((e) => ({
    ...e,
    source: 'code' as const,
    status: 'active' as const,
    versions: [e.definition.version],
    revision: null,
  }));
}

const thumbCache = new Map<string, string | null>();

/** data: URL of a variant's thumbnail (memoised), or null when it cannot be generated. */
export function variantThumbnailUrl(
  item: Pick<StudioLibraryItem, 'definition' | 'source'>,
  variantId?: string,
  rotation: 0 | 1 | 2 | 3 = 0,
): string | null {
  const def = item.definition;
  const variant = variantId ? def.variants.find((v) => v.id === variantId) : def.variants[0];
  if (!variant) return null;
  const key = `${item.source}:${def.id}@${def.version}/${variant.id}/${rotation}`;
  if (!thumbCache.has(key)) {
    const svg =
      item.source === 'code' && rotation === 0
        ? templateThumbnailSvg(def.id, def.version, variant.id)
        : modelThumbnailSvg(modelFromVariant(variant, { anchor: THUMB_ANCHOR, rotationDeg: 0 }), {
            rotation,
          });
    thumbCache.set(key, svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null);
  }
  return thumbCache.get(key) ?? null;
}

/** Short defaults line of a variant, e.g. "20 × 40 m · 4 floors · 12.8 m". */
export function variantDefaultsText(v: TemplateDefinition['variants'][number]): string {
  const d = v.defaults;
  return `${d.widthM} × ${d.lengthM} m · ${d.floors} ${d.floors === 1 ? 'floor' : 'floors'} · ${d.heightM} m body height`;
}

export const ACCURACY_LABELS: Readonly<Record<TemplateDefinition['accuracyClass'], string>> = {
  'generic-prefab': 'Generic prefab',
  stylized: 'Stylized',
  'source-backed': 'Source-backed',
  surveyed: 'Surveyed',
};

export const RENDER_COST_LABELS: Readonly<Record<TemplateDefinition['renderCost'], string>> = {
  low: 'Light to draw',
  medium: 'Medium to draw',
  high: 'Heavy to draw',
};
