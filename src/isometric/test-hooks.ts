/**
 * Read-only Playwright hook of the overview, installed only when the page URL
 * carries `e2e=1` (docs/ISOMETRIC_AND_3D_DESIGN.md §9.2):
 *
 *   window.__ATLAS_ISO__.getFrameStats()            → last scene build / full redraw / hit-test ms, cycles
 *   window.__ATLAS_ISO__.getView()                  → { center, pxPerMetre, rotation }
 *   window.__ATLAS_ISO__.getSelectedId()            → selected id or null
 *   window.__ATLAS_ISO__.getRouteCoordinateCount()  → vertices of the drawn main route (0 = none)
 *   window.__ATLAS_ISO__.projectToViewport(lngLat, z?) → viewport CSS px of a point, or null
 *   window.__ATLAS_ISO__.getDrawOrder()             → building ids, back to front
 *   window.__ATLAS_ISO__.getKey(id)                 → map key of a building, or null
 *   window.__ATLAS_ISO__.getPlacedLabelIds()        → ids of the labels/markers currently drawn
 *
 * Like __ATLAS_MAP__ it exposes no user position. Tests drive the overview
 * through the UI (pointer, keyboard), never through this hook.
 */
import type { LngLat } from '../data/index.ts';
import type { IsoView } from './iso-controller.ts';

export interface IsoFrameStats {
  /** Last scene build (data → scene, one rotation), ms. */
  sceneBuildMs: number;
  /** Last full redraw (static + dynamic layer), ms. */
  fullRedrawMs: number;
  /** Last dynamic-only redraw, ms. */
  dynamicRedrawMs: number;
  /** Last hit-test, ms. */
  hitTestMs: number;
  /** Depth-graph cycles broken at the current rotation. */
  cycles: number;
  faceCycles: number;
  interleavedPairs: number;
  buildings: number;
  faces: number;
  fullRedraws: number;
  dynamicRedraws: number;
}

export interface AtlasIsoTestHooks {
  getFrameStats(): IsoFrameStats;
  getView(): IsoView;
  getSelectedId(): string | null;
  getRouteCoordinateCount(): number;
  projectToViewport(lngLat: LngLat, z?: number): { x: number; y: number } | null;
  getDrawOrder(): string[];
  getKey(id: string): string | null;
  getPlacedLabelIds(): string[];
}

declare global {
  interface Window {
    __ATLAS_ISO__?: Readonly<AtlasIsoTestHooks>;
  }
}

export function isIsoE2EMode(search: string): boolean {
  try {
    return new URLSearchParams(search).get('e2e') === '1';
  } catch {
    return false;
  }
}

/** Installs the hook in e2e mode; returns an uninstaller (a no-op otherwise). */
export function installIsoTestHooks(hooks: AtlasIsoTestHooks, search = window.location.search): () => void {
  if (!isIsoE2EMode(search)) return () => {};
  const frozen = Object.freeze({ ...hooks });
  window.__ATLAS_ISO__ = frozen;
  return () => {
    if (window.__ATLAS_ISO__ === frozen) delete window.__ATLAS_ISO__;
  };
}
