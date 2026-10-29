/**
 * Which image files the illustrated overview shows for the master artwork.
 * Pure. Every file is placed in SOURCE PIXELS inside the one transformed
 * layer (viewport.ts), so a preview, the full image and pyramid tiles all
 * line up with each other and with the hotspot outlines.
 *
 * Files come from the manifest (public/isometric-art/manifest.json):
 *  - the published original (unchanged, byte-identical to the owner's file);
 *  - derived copies made by the art pipeline (`web-full` sRGB copy, a uniform
 *    `preview`, pyramid `tile`s), each recorded with the sha256 of its source.
 *    A derived copy whose sourceSha256 differs from the original's is stale and
 *    is never shown. Until the pipeline publishes derived copies the original
 *    is used directly.
 *
 * Choice: the base layer is the preview when there is one (fast first paint,
 * few bytes on phones), else the full image. When the zoom needs more pixels
 * than the base has, a detail layer is added: the visible tiles of the
 * coarsest pyramid level that is sharp enough, else the full image. Under
 * tiles the base is only a placeholder, so the smallest preview is used.
 *
 * Measured (2026-10-26, re-measured 2026-10-29; 390 × 844 phone, opening view at LEGIBLE_SCALE 0.5,
 * service worker blocked): DPR 1 loads the 1600-px preview only (0.63 MiB);
 * DPR 2 and 3 load it plus 12 level-0 tiles (1.99 MiB). Level 0 is what 1:1
 * sharpness needs there (1.0 device px per source px); level 1 (0.5 px/px) is
 * no sharper than the preview, so lighter tiles would halve the opening view's
 * resolution. With today's single preview the smallest-preview rule changes
 * nothing; a smaller preview from the art pipeline would cut the DPR-2 open.
 */
import type { ManifestAsset } from './schema.ts';
import type { ArtRect, ArtSourceSpace } from './viewport.ts';

export type ArtImagePurpose = 'original' | 'web-full' | 'preview' | 'tile';

export interface ArtImageLayer {
  /** Stable React key. */
  key: string;
  /** Manifest-relative URL ('original/…' or 'derived/…'). */
  url: string;
  purpose: ArtImagePurpose;
  /** Placement in source px (the layer's own units). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Pixel size of the file. */
  pixelWidth: number;
  pixelHeight: number;
  /** Tiles only: pyramid level (0 = full size). */
  level?: number;
}

export interface ArtImagePlan {
  base: ArtImageLayer;
  detail: ArtImageLayer[];
}

export interface ArtImageSources {
  /** Full-resolution image: the sRGB `web-full` copy when present, else the published original. */
  full: ArtImageLayer | null;
  previews: ArtImageLayer[];
  /** Tiles by level (0 = full size). */
  tiles: ReadonlyMap<number, readonly ArtImageLayer[]>;
}

/** Below this ratio of file px to device px the base layer counts as too soft and detail is added. */
export const SHARPNESS_TOLERANCE = 0.9;

export function artImageSources(asset: ManifestAsset, space: ArtSourceSpace): ArtImageSources {
  const sha = asset.source.sha256;
  const fresh = asset.derived.filter((d) => d.sourceSha256 === sha);
  const whole = (purpose: ArtImagePurpose, url: string, pw: number, ph: number): ArtImageLayer => ({
    key: `${purpose}:${url}`,
    url,
    purpose,
    x: 0,
    y: 0,
    width: space.width,
    height: space.height,
    pixelWidth: pw,
    pixelHeight: ph,
  });
  const webFull = fresh.find(
    (d) => d.purpose === 'web-full' && d.width === asset.source.width && d.height === asset.source.height,
  );
  const full = webFull
    ? whole('web-full', webFull.url, webFull.width, webFull.height)
    : asset.original
      ? whole('original', asset.original.url, asset.source.width, asset.source.height)
      : null;
  const previews = fresh
    .filter((d) => d.purpose === 'preview')
    .map((d) => whole('preview', d.url, d.width, d.height))
    .sort((a, b) => a.pixelWidth - b.pixelWidth);
  const tiles = new Map<number, ArtImageLayer[]>();
  for (const d of fresh) {
    if (d.purpose !== 'tile' || !d.tile) continue;
    const t = d.tile;
    const list = tiles.get(t.level) ?? [];
    list.push({
      key: `tile:${d.url}`,
      url: d.url,
      purpose: 'tile',
      x: t.nx * space.width,
      y: t.ny * space.height,
      width: t.nw * space.width,
      height: t.nh * space.height,
      pixelWidth: d.width,
      pixelHeight: d.height,
      level: t.level,
    });
    tiles.set(t.level, list);
  }
  return { full, previews, tiles };
}

/** File px per source px of a layer. */
const density = (l: ArtImageLayer) => l.pixelWidth / l.width;

const intersects = (l: ArtImageLayer, r: ArtRect) =>
  l.x < r.x + r.width && l.x + l.width > r.x && l.y < r.y + r.height && l.y + l.height > r.y;

/**
 * The layers to show at `deviceScale` (device px per source px = transform
 * scale × devicePixelRatio) for the visible source rectangle. Null when the
 * asset has no displayable file.
 */
export function planArtImages(
  sources: ArtImageSources,
  deviceScale: number,
  visible: ArtRect,
): ArtImagePlan | null {
  const { full, previews, tiles } = sources;
  // The smallest preview that is sharp enough, else the largest one.
  const preview =
    previews.find((p) => density(p) >= deviceScale * SHARPNESS_TOLERANCE) ?? previews[previews.length - 1];
  const base = preview ?? full;
  if (!base) return null;
  if (density(base) >= deviceScale * SHARPNESS_TOLERANCE) return { base, detail: [] };

  const levels = [...tiles.keys()].sort((a, b) => b - a); // coarsest first
  const sharp = levels.find((lv) => {
    const first = tiles.get(lv)?.[0];
    return first !== undefined && density(first) >= deviceScale * SHARPNESS_TOLERANCE;
  });
  const level = sharp ?? (tiles.has(0) ? 0 : levels[levels.length - 1]);
  if (level !== undefined) {
    const visibleTiles = (tiles.get(level) ?? []).filter((t) => intersects(t, visible));
    // The tiles carry the visible detail; the base is only the placeholder under them (while
    // they load, and at the edges during a pan), so the LIGHTEST preview is enough for it.
    if (visibleTiles.length > 0) return { base: previews[0] ?? base, detail: visibleTiles };
  }
  return full && full !== base ? { base, detail: [full] } : { base, detail: [] };
}
