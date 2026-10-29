/**
 * Pure helpers of the admin artwork images (ArtworkImages.tsx): which file to
 * show for an asset and the zoom window around outlines, in SOURCE pixels.
 */
import type { IsometricArtManifest, ManifestAsset } from '../../../isometric-art/index.ts';

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The asset to display for an id: itself, or its canonical copy when it is a byte-identical duplicate. */
export function displayAsset(manifest: IsometricArtManifest, assetId: string): ManifestAsset | null {
  const a = manifest.assets.find((x) => x.assetId === assetId) ?? null;
  if (!a) return null;
  if (a.original) return a;
  return a.duplicateOf ? (manifest.assets.find((x) => x.assetId === a.duplicateOf) ?? null) : null;
}

export const masterAsset = (manifest: IsometricArtManifest): ManifestAsset | null =>
  manifest.assets.find((a) => a.assetId === manifest.coordinateSpace.assetId) ?? null;

/**
 * Window around the hotspots (source px): the union box plus a margin, at
 * least `minSize` wide/high, kept inside the image. Pure.
 */
export function zoomViewBox(
  box: ViewBox,
  space: { width: number; height: number },
  margin = 0.35,
  minSize = 360,
): ViewBox {
  const w = Math.min(space.width, Math.max(minSize, box.width * (1 + 2 * margin)));
  const h = Math.min(space.height, Math.max(minSize, box.height * (1 + 2 * margin)));
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const x = Math.min(Math.max(0, cx - w / 2), space.width - w);
  const y = Math.min(Math.max(0, cy - h / 2), space.height - h);
  return { x, y, width: w, height: h };
}
