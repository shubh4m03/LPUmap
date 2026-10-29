/**
 * Read-only Playwright hook of the illustrated overview, installed only when
 * the page URL carries `e2e=1` (like window.__ATLAS_ISO__ of the map-accurate
 * overview):
 *
 *   window.__ATLAS_ART__.getTransform()          → { scale, tx, ty } of the shared image+outline layer
 *   window.__ATLAS_ART__.getSpace()              → source image size (manifest coordinateSpace)
 *   window.__ATLAS_ART__.getStageRect()          → stage rectangle in viewport CSS px
 *   window.__ATLAS_ART__.getHotspotIds()         → hotspot ids in keyboard order
 *   window.__ATLAS_ART__.getHotspotCentroid(id)  → area centroid in source px, or null
 *   window.__ATLAS_ART__.getSelectedSubjectIds() → subjects highlighted for the app selection
 *   window.__ATLAS_ART__.getImageLayers()        → URLs and purposes of the image files shown
 *   window.__ATLAS_ART__.getStats()              → first paint and gesture frame timings
 *
 * Tests drive the overview through the UI (pointer, wheel, keyboard) and use
 * this hook only to READ where things are, then check pixels and hit-tests.
 */
import type { ArtImagePurpose } from '../index.ts';
import type { ArtPoint, ArtRect, ArtSourceSpace, ArtTransform } from '../index.ts';

export interface ArtStats {
  /** ms from the stage mounting to the base image being decoded and shown. */
  firstPaintMs: number | null;
  /** Bytes of the base image file (from the manifest). */
  baseImageBytes: number | null;
  /** Transform updates applied during gestures and animations. */
  frames: number;
  /** Duration of the last transform update (JS work only), ms. */
  lastFrameWorkMs: number;
}

export interface AtlasArtTestHooks {
  getTransform(): ArtTransform;
  getSpace(): ArtSourceSpace;
  getStageRect(): ArtRect;
  getHotspotIds(): string[];
  getHotspotCentroid(id: string): ArtPoint | null;
  getSelectedSubjectIds(): string[];
  getImageLayers(): { url: string; purpose: ArtImagePurpose }[];
  getStats(): ArtStats;
}

declare global {
  interface Window {
    __ATLAS_ART__?: Readonly<AtlasArtTestHooks>;
  }
}

export function isArtE2EMode(search: string): boolean {
  try {
    return new URLSearchParams(search).get('e2e') === '1';
  } catch {
    return false;
  }
}

/** Installs the hook in e2e mode; returns an uninstaller (a no-op otherwise). */
export function installArtTestHooks(hooks: AtlasArtTestHooks, search = window.location.search): () => void {
  if (!isArtE2EMode(search)) return () => {};
  const frozen = Object.freeze({ ...hooks });
  window.__ATLAS_ART__ = frozen;
  return () => {
    if (window.__ATLAS_ART__ === frozen) delete window.__ATLAS_ART__;
  };
}
